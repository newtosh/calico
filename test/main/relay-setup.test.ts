import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CloudflareError } from "../../src/main/cloudflare/api";
import { OAuthError } from "../../src/main/cloudflare/oauth";
import {
  type SetupApi,
  type SetupDeps,
  type SetupProgress,
  RELAY_VARS,
  SetupError,
  setupRelay,
  WORKER_NAME,
} from "../../src/main/relay/setup";

function fakes(over: Partial<SetupDeps> = {}) {
  const log: string[] = [];
  const progress: SetupProgress[] = [];
  const api = {
    accounts: vi.fn(async () => [{ id: "a1", name: "Me" }]),
    subdomain: vi.fn(async () => "jon-xo" as string | null),
    scriptExists: vi.fn(async () => false),
    uploadWorker: vi.fn<SetupApi["uploadWorker"]>(
      async () => void log.push("upload"),
    ),
    enableSubdomain: vi.fn(async () => void log.push("enable")),
    deleteWorker: vi.fn(async () => void log.push("delete")),
  };
  const deps: SetupDeps = {
    signIn: vi.fn(async () => ({ accessToken: "tok", expiresIn: 3600 })),
    revoke: vi.fn(async () => {
      log.push("revoke");
      return true;
    }),
    api: () => api,
    workerSource: "export default {};",
    probe: vi.fn(async () => true),
    wait: async () => undefined,
    report: (p) => progress.push(p),
    ...over,
  };
  return { deps, api, log, progress };
}

describe("setupRelay", () => {
  it("signs in, uploads, turns on the address, checks it, and revokes", async () => {
    const { deps, api, log, progress } = fakes();
    const out = await setupRelay(deps);
    expect(log).toEqual(["upload", "enable", "revoke"]);
    expect(out.url).toBe(`https://${WORKER_NAME}.jon-xo.workers.dev/inbox`);
    expect(out.readToken).toMatch(/^read_[0-9a-f]{48}$/);
    expect(out.sendToken).toMatch(/^send_[0-9a-f]{48}$/);
    expect(out.readToken).not.toBe(out.sendToken);
    expect(out).toMatchObject({ accountId: "a1", workerName: WORKER_NAME });
    const upload = api.uploadWorker.mock.calls[0] as unknown as [
      string,
      string,
      { secrets: Record<string, string> },
    ];
    expect(upload[2].secrets).toEqual({
      SEND_TOKEN: out.sendToken,
      READ_TOKEN: out.readToken,
    });
    expect(progress.map((p) => `${p.step}:${p.state}`)).toEqual([
      "sign-in:active",
      "sign-in:done",
      "upload:active",
      "upload:done",
      "address:active",
      "address:done",
      "check:active",
      "check:done",
      "save:active",
      "save:done",
    ]);
  });

  it("checks the relay with the read token it just made", async () => {
    const { deps } = fakes();
    const out = await setupRelay(deps);
    expect(deps.probe).toHaveBeenCalledWith(out.url, out.readToken);
  });

  it("keeps trying while the new address warms up", async () => {
    const answers = [false, false, true];
    const { deps } = fakes({
      probe: vi.fn(async () => answers.shift() ?? true),
    });
    await setupRelay(deps);
    expect(deps.probe).toHaveBeenCalledTimes(3);
  });

  it("gives up on an address that never answers, removes the Worker, and revokes", async () => {
    const { deps, log } = fakes({ probe: async () => false, attempts: 3 });
    const error = await setupRelay(deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SetupError);
    expect(error).toMatchObject({ step: "check", cleanedUp: true });
    expect(log).toEqual(["upload", "enable", "delete", "revoke"]);
  });

  it("removes the Worker when turning on the address fails", async () => {
    const { deps, api, log } = fakes();
    api.enableSubdomain.mockRejectedValue(
      new CloudflareError(403, "Cloudflare answered HTTP 403: nope."),
    );
    await expect(setupRelay(deps)).rejects.toMatchObject({
      step: "address",
      cleanedUp: true,
    });
    expect(log).toEqual(["upload", "delete", "revoke"]);
  });

  it("does not delete anything when Cloudflare refuses the upload", async () => {
    const { deps, api, log } = fakes();
    api.uploadWorker.mockRejectedValue(
      new CloudflareError(
        403,
        "Cloudflare answered HTTP 403: Authentication error.",
      ),
    );
    const error = await setupRelay(deps).catch((e: unknown) => e as SetupError);
    expect(error).toMatchObject({ step: "upload", cleanedUp: true });
    expect(String((error as SetupError).message)).toContain(
      "Authentication error",
    );
    expect(log).toEqual(["revoke"]);
  });

  it("still removes the Worker when reporting progress throws, as when the window is gone", async () => {
    let failing = false;
    const { deps, log } = fakes({
      probe: async () => false,
      attempts: 1,
      report: (p) => {
        if (p.state === "failed") failing = true;
        if (failing) throw new Error("Object has been destroyed");
      },
    });
    const error = await setupRelay(deps).catch((e: unknown) => e);
    expect(error).toMatchObject({ step: "check", cleanedUp: true });
    expect(log).toEqual(["upload", "enable", "delete", "revoke"]);
  });

  it("removes the Worker when the upload may have landed but the reply never came", async () => {
    const { deps, api, log } = fakes();
    api.uploadWorker.mockRejectedValue(
      new CloudflareError(0, "Could not reach Cloudflare: timed out."),
    );
    await expect(setupRelay(deps)).rejects.toMatchObject({
      step: "upload",
      cleanedUp: true,
    });
    expect(log).toEqual(["delete", "revoke"]);
  });

  it("retries a revoke that failed, and says if the access is still live", async () => {
    const revoke = vi.fn(async () => false);
    const { deps } = fakes({ revoke });
    const out = await setupRelay(deps);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(out.revoked).toBe(false);
  });

  it("reports the access revoked when the retry works", async () => {
    const answers = [false, true];
    const { deps } = fakes({ revoke: async () => answers.shift() ?? true });
    expect((await setupRelay(deps)).revoked).toBe(true);
  });

  it("keeps the result when revoking throws", async () => {
    const { deps } = fakes({
      revoke: async () => {
        throw new Error("net down");
      },
    });
    expect((await setupRelay(deps)).revoked).toBe(false);
  });

  it("says what to delete by hand when the cleanup fails too", async () => {
    const { deps, api } = fakes({ probe: async () => false, attempts: 1 });
    api.deleteWorker.mockRejectedValue(new CloudflareError(500, "boom"));
    const error = (await setupRelay(deps).catch(
      (e: unknown) => e,
    )) as SetupError;
    expect(error.cleanedUp).toBe(false);
    expect(error.message).toContain(WORKER_NAME);
    expect(error.message).toMatch(/delete/i);
  });

  it("stops before touching Cloudflare when sign-in fails", async () => {
    const { deps, api, log } = fakes({
      signIn: async () => {
        throw new OAuthError("denied", "Cloudflare sign-in was declined.");
      },
    });
    await expect(setupRelay(deps)).rejects.toMatchObject({
      step: "sign-in",
      message: "Cloudflare sign-in was declined.",
    });
    expect(api.accounts).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("will not overwrite a Worker that is already there", async () => {
    const { deps, api, log } = fakes();
    api.scriptExists.mockResolvedValue(true);
    const error = (await setupRelay(deps).catch(
      (e: unknown) => e,
    )) as SetupError;
    expect(error.step).toBe("upload");
    expect(error.message).toContain(WORKER_NAME);
    expect(log).toEqual(["revoke"]);
    expect(api.uploadWorker).not.toHaveBeenCalled();
  });

  it("explains an account with no workers.dev name yet", async () => {
    const { deps, api } = fakes();
    api.subdomain.mockResolvedValue(null);
    const error = (await setupRelay(deps).catch(
      (e: unknown) => e,
    )) as SetupError;
    expect(error.step).toBe("upload");
    expect(error.message).toMatch(/workers\.dev/);
    expect(api.uploadWorker).not.toHaveBeenCalled();
  });

  it("asks which account when there are several", async () => {
    const { deps, api } = fakes({ chooseAccount: vi.fn(async () => "a2") });
    api.accounts.mockResolvedValue([
      { id: "a1", name: "Me" },
      { id: "a2", name: "Team" },
    ]);
    const out = await setupRelay(deps);
    expect(out.accountId).toBe("a2");
    expect(deps.chooseAccount).toHaveBeenCalledWith([
      { id: "a1", name: "Me" },
      { id: "a2", name: "Team" },
    ]);
  });

  it("stops quietly when the person picks no account", async () => {
    const { deps, api, log } = fakes({ chooseAccount: async () => null });
    api.accounts.mockResolvedValue([
      { id: "a1", name: "Me" },
      { id: "a2", name: "Team" },
    ]);
    await expect(setupRelay(deps)).rejects.toMatchObject({
      step: "sign-in",
      cancelled: true,
    });
    expect(log).toEqual(["revoke"]);
  });

  it("cleans up when cancelled part way", async () => {
    const controller = new AbortController();
    const { deps, log } = fakes({
      signal: controller.signal,
      probe: async () => {
        controller.abort();
        return false;
      },
    });
    await expect(setupRelay(deps)).rejects.toMatchObject({
      cancelled: true,
      cleanedUp: true,
    });
    expect(log).toEqual(["upload", "enable", "delete", "revoke"]);
  });

  it("never puts a token in an error", async () => {
    const { deps } = fakes({ probe: async () => false, attempts: 1 });
    const error = (await setupRelay(deps).catch(
      (e: unknown) => e,
    )) as SetupError;
    expect(error.message).not.toMatch(/tok\b|read_|send_/);
  });
});

describe("the variables setup uploads", () => {
  it("match the ones the relay is tested and documented with", () => {
    const text = readFileSync("tools/relay/wrangler.jsonc", "utf8");
    const wrangler = JSON.parse(text) as { vars: Record<string, string> };
    expect(RELAY_VARS).toEqual(wrangler.vars);
  });
});
