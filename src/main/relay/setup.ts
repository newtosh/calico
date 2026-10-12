import { randomBytes } from "node:crypto";
import type { Account, WorkerUpload } from "../cloudflare/api";
import { CloudflareError } from "../cloudflare/api";
import { OAuthError, type Token } from "../cloudflare/oauth";

export const WORKER_NAME = "calico-relay";
export const DURABLE_OBJECT = { binding: "INBOX", className: "Inbox" };
/** Kept equal to tools/relay/wrangler.jsonc by a test. */
export const RELAY_VARS: Record<string, string> = {
  TOPIC: "inbox",
  TTL_SECONDS: "86400",
  MAX_MESSAGES: "200",
  MAX_BODY_BYTES: "4096",
  DAILY_REQUEST_BUDGET: "60000",
};

export type SetupStep = "sign-in" | "upload" | "address" | "check" | "save";

export interface SetupProgress {
  step: SetupStep;
  state: "active" | "done" | "failed";
}

/** The part of CloudflareApi that setup uses, so a test can stand in for it. */
export interface SetupApi {
  accounts(): Promise<Account[]>;
  subdomain(accountId: string): Promise<string | null>;
  scriptExists(accountId: string, name: string): Promise<boolean>;
  uploadWorker(
    accountId: string,
    name: string,
    upload: WorkerUpload,
  ): Promise<void>;
  enableSubdomain(accountId: string, name: string): Promise<void>;
  deleteWorker(accountId: string, name: string): Promise<void>;
}

export interface SetupDeps {
  signIn(): Promise<Token>;
  revoke(accessToken: string): Promise<boolean>;
  api(accessToken: string): SetupApi;
  workerSource: string;
  /** True once the relay answers at `url` and accepts `readToken`. */
  probe(url: string, readToken: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
  report(progress: SetupProgress): void;
  /** Only asked when the person has several accounts. Null means they backed out. */
  chooseAccount?(accounts: Account[]): Promise<string | null>;
  signal?: AbortSignal;
  /** How many times to ask a new address whether it answers. */
  attempts?: number;
}

export interface SetupResult {
  /** The topic URL, such as https://calico-relay.you.workers.dev/inbox. */
  url: string;
  sendToken: string;
  readToken: string;
  accountId: string;
  workerName: string;
  /** False when Cloudflare would not revoke the access: it lapses within the hour. */
  revoked: boolean;
}

/**
 * Setup failed or was cancelled. `message` is safe to show: it never holds a token.
 * `cleanedUp` is false only when something was left behind in the account.
 */
export class SetupError extends Error {
  constructor(
    readonly step: SetupStep,
    message: string,
    readonly cleanedUp: boolean,
    readonly cancelled = false,
  ) {
    super(message);
  }
}

const PROBE_DELAY_MS = 2000;
const PROBE_ATTEMPTS = 20;

const token = (prefix: string) =>
  `${prefix}_${randomBytes(24).toString("hex")}`;

function describe(err: unknown): string {
  if (err instanceof CloudflareError || err instanceof OAuthError)
    return err.message;
  return err instanceof Error ? err.message : "Something went wrong.";
}

class Stop extends Error {}

/**
 * Deploys the relay to the person's own account, checks it, and revokes the
 * access it was given. Whatever happens, the access is revoked, and a Worker
 * that was uploaded is removed unless setup finished.
 */
export async function setupRelay(deps: SetupDeps): Promise<SetupResult> {
  let step: SetupStep = "sign-in";
  let accessToken = "";
  let api: SetupApi | undefined;
  let accountId = "";
  let uploaded = false;
  let finished = false;
  const check = () => {
    if (deps.signal?.aborted) throw new Stop();
  };
  // The window can be gone by the time we report, and that must not skip cleanup.
  const say = (progress: SetupProgress) => {
    try {
      deps.report(progress);
    } catch {
      /* nobody is listening */
    }
  };
  const begin = (next: SetupStep) => {
    step = next;
    say({ step, state: "active" });
  };
  const done = () => say({ step, state: "done" });

  try {
    begin("sign-in");
    const signedIn = await deps.signIn();
    accessToken = signedIn.accessToken;
    api = deps.api(accessToken);
    check();

    const accounts = await api.accounts();
    if (accounts.length === 0)
      throw new SetupError(
        step,
        "That Cloudflare login has no accounts.",
        true,
      );
    const first = accounts[0] as Account;
    const chosen =
      accounts.length === 1 || !deps.chooseAccount
        ? first.id
        : await deps.chooseAccount(accounts);
    if (chosen === null) throw new Stop();
    accountId = chosen;
    done();

    begin("upload");
    check();
    const subdomain = await api.subdomain(accountId);
    if (!subdomain)
      throw new SetupError(
        step,
        "Your Cloudflare account has no workers.dev address yet. Open Workers & Pages in the Cloudflare dashboard once to pick one, then set up again.",
        true,
      );
    if (await api.scriptExists(accountId, WORKER_NAME))
      throw new SetupError(
        step,
        `A Worker called ${WORKER_NAME} already exists in this account, and calico will not overwrite it. Delete it in Cloudflare, or connect to it with its read token.`,
        true,
      );
    const sendToken = token("send");
    const readToken = token("read");
    check();
    try {
      await api.uploadWorker(accountId, WORKER_NAME, {
        source: deps.workerSource,
        vars: RELAY_VARS,
        secrets: { SEND_TOKEN: sendToken, READ_TOKEN: readToken },
        durableObject: DURABLE_OBJECT,
      });
    } catch (err) {
      // No HTTP answer means the upload may have landed: clean up to be sure.
      if (!(err instanceof CloudflareError) || err.status === 0)
        uploaded = true;
      throw err;
    }
    uploaded = true;
    done();

    begin("address");
    check();
    await api.enableSubdomain(accountId, WORKER_NAME);
    done();

    begin("check");
    const url = `https://${WORKER_NAME}.${subdomain}.workers.dev/${RELAY_VARS.TOPIC}`;
    let answered = false;
    for (
      let i = 0;
      i < (deps.attempts ?? PROBE_ATTEMPTS) && !answered;
      i += 1
    ) {
      check();
      answered = await deps.probe(url, readToken);
      if (!answered) await deps.wait(PROBE_DELAY_MS);
    }
    check();
    if (!answered)
      throw new SetupError(
        step,
        "The relay was uploaded but did not answer at its new address. Cloudflare can take a minute: try again.",
        true,
      );
    done();

    begin("save");
    const revoked = await revokeTwice(deps, accessToken);
    accessToken = "";
    finished = true;
    done();
    return {
      url,
      sendToken,
      readToken,
      accountId,
      workerName: WORKER_NAME,
      revoked,
    };
  } catch (err) {
    say({ step, state: "failed" });
    let cleanedUp = true;
    if (uploaded && !finished && api) {
      try {
        await api.deleteWorker(accountId, WORKER_NAME);
      } catch {
        cleanedUp = false;
      }
    }
    const cancelled =
      err instanceof Stop ||
      (err instanceof OAuthError && err.reason === "cancelled");
    if (err instanceof SetupError)
      throw cleanedUp ? err : leftBehind(err.step, err.message, err.cancelled);
    if (!cleanedUp) throw leftBehind(step, describe(err), cancelled);
    throw new SetupError(
      step,
      cancelled ? "Setup was cancelled." : describe(err),
      true,
      cancelled,
    );
  } finally {
    if (accessToken) await revokeTwice(deps, accessToken);
  }
}

async function revokeTwice(deps: SetupDeps, accessToken: string) {
  for (let i = 0; i < 2; i += 1) {
    try {
      if (await deps.revoke(accessToken)) return true;
    } catch {
      /* try once more */
    }
  }
  return false;
}

function leftBehind(
  step: SetupStep,
  why: string,
  cancelled: boolean,
): SetupError {
  return new SetupError(
    step,
    `${why} calico could not remove the Worker it uploaded. Delete the Worker called ${WORKER_NAME} in your Cloudflare dashboard.`,
    false,
    cancelled,
  );
}
