import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
export const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
export const REVOKE_URL = "https://dash.cloudflare.com/oauth2/revoke";
/** The loopback port registered with Cloudflare for the client. */
export const CALLBACK_PORT = 53682;
/** The narrowest scope Cloudflare has that allows uploading a Worker. */
export const WORKERS_SCOPE = "workers-scripts.admin";

export type OAuthReason =
  "port" | "denied" | "timeout" | "cancelled" | "exchange";

/** Every message is safe to show to the person: it names what happened, never a token. */
export class OAuthError extends Error {
  constructor(
    readonly reason: OAuthReason,
    message: string,
  ) {
    super(message);
  }
}

export interface SignInOptions {
  clientId: string;
  scope: string;
  /** 0 picks a free port, for tests. */
  port?: number;
  authUrl?: string;
  tokenUrl?: string;
  /** Opens the system browser. The app passes shell.openExternal. */
  openUrl(url: string): void | Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Token {
  accessToken: string;
  expiresIn: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

const PAGE = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>calico</title><body style="font:16px system-ui;background:#0c0e09;color:#efe7d6;padding:2rem"><p>${text}</p>`;

function sha256Base64Url(text: string): string {
  return createHash("sha256").update(text).digest("base64url");
}

/**
 * Authorization Code with PKCE and a loopback redirect. There is no client
 * secret. The listener is up only while the person is signing in.
 */
export async function signIn(opts: SignInOptions): Promise<Token> {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  let server: Server | undefined;
  let timer: NodeJS.Timeout | undefined;
  const stop = () => {
    if (timer) clearTimeout(timer);
    server?.closeAllConnections();
    server?.close();
  };
  // Let the browser finish reading its answer before the listener goes.
  const stopAfter = (res: ServerResponse, then: () => void) =>
    res.once("close", then);

  try {
    const redirect = await new Promise<string>((resolve, reject) => {
      server = createServer();
      server.once("error", () =>
        reject(
          new OAuthError(
            "port",
            "calico could not open its sign-in address. Another program is using port " +
              `${opts.port ?? CALLBACK_PORT}.`,
          ),
        ),
      );
      server.listen(opts.port ?? CALLBACK_PORT, "127.0.0.1", () => {
        const port = (server?.address() as AddressInfo).port;
        resolve(`http://127.0.0.1:${port}/callback`);
      });
    });

    const code = await new Promise<string>((resolve, reject) => {
      const fail = (error: OAuthError) => reject(error);
      server?.removeAllListeners("error");
      // A late listener error must not become an uncaught exception.
      server?.on("error", (err) =>
        fail(
          new OAuthError(
            "port",
            `The sign-in listener failed: ${err.message}.`,
          ),
        ),
      );
      server?.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirect);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const answer = (status: number, text: string) =>
          res
            .writeHead(status, { "content-type": "text/html" })
            .end(PAGE(text));
        if (url.searchParams.get("state") !== state) {
          answer(
            400,
            "That sign-in did not start from calico. You can close this tab.",
          );
          return;
        }
        if (url.searchParams.get("error")) {
          answer(
            200,
            "Sign-in was cancelled. You can close this tab and go back to calico.",
          );
          fail(new OAuthError("denied", "Cloudflare sign-in was declined."));
          return;
        }
        const got = url.searchParams.get("code");
        if (!got) {
          answer(
            400,
            "Cloudflare did not send a sign-in code. You can close this tab.",
          );
          fail(
            new OAuthError(
              "exchange",
              "Cloudflare did not send a sign-in code.",
            ),
          );
          return;
        }
        answer(
          200,
          "Signed in to Cloudflare. You can close this tab and go back to calico.",
        );
        stopAfter(res, () => resolve(got));
      });
      timer = setTimeout(
        () =>
          fail(
            new OAuthError(
              "timeout",
              "Cloudflare sign-in took too long. Try again when you are ready.",
            ),
          ),
        opts.timeoutMs ?? FIVE_MINUTES,
      );
      const cancel = () =>
        fail(new OAuthError("cancelled", "Setup was cancelled."));
      if (opts.signal?.aborted) cancel();
      else opts.signal?.addEventListener("abort", cancel, { once: true });

      const ask = new URL(opts.authUrl ?? AUTH_URL);
      ask.search = new URLSearchParams({
        response_type: "code",
        client_id: opts.clientId,
        redirect_uri: redirect,
        scope: opts.scope,
        state,
        code_challenge: sha256Base64Url(verifier),
        code_challenge_method: "S256",
      }).toString();
      const noBrowser = () =>
        fail(new OAuthError("exchange", "calico could not open your browser."));
      try {
        Promise.resolve(opts.openUrl(ask.toString())).catch(noBrowser);
      } catch {
        noBrowser();
      }
    });
    stop();

    let reply: Response;
    try {
      reply = await fetch(opts.tokenUrl ?? TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
          client_id: opts.clientId,
          code_verifier: verifier,
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(20_000),
          ...(opts.signal ? [opts.signal] : []),
        ]),
        redirect: "error",
      });
    } catch (err) {
      if (opts.signal?.aborted)
        throw new OAuthError("cancelled", "Setup was cancelled.");
      throw new OAuthError(
        "exchange",
        `Could not reach Cloudflare to finish signing in: ${(err as Error).message}.`,
      );
    }
    const body: unknown = await reply.json().catch(() => null);
    const token =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (!reply.ok || typeof token.access_token !== "string")
      throw new OAuthError(
        "exchange",
        `Cloudflare did not accept the sign-in (HTTP ${reply.status}).`,
      );
    return {
      accessToken: token.access_token,
      expiresIn: typeof token.expires_in === "number" ? token.expires_in : 3600,
    };
  } finally {
    stop();
  }
}

/** Never throws: it runs at the end of setup, and a failure here must not hide the result. */
export async function revokeToken(
  opts: { clientId: string; revokeUrl?: string },
  accessToken: string,
): Promise<boolean> {
  try {
    const reply = await fetch(opts.revokeUrl ?? REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: accessToken,
        client_id: opts.clientId,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    return reply.ok;
  } catch {
    return false;
  }
}
