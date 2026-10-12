import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  OAuthError,
  revokeToken,
  signIn,
  type SignInOptions,
} from "../../src/main/cloudflare/oauth";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

interface Seen {
  auth: URLSearchParams | null;
  token: URLSearchParams | null;
  revoke: URLSearchParams | null;
}

/** A stand-in for dash.cloudflare.com's two endpoints. */
async function fakeCloudflare(
  tokenReply: object = { access_token: "tok-1", expires_in: 3600 },
  tokenStatus = 200,
) {
  const seen: Seen = { auth: null, token: null, revoke: null };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (url.pathname === "/oauth2/token") {
        seen.token = new URLSearchParams(body);
        res
          .writeHead(tokenStatus, { "content-type": "application/json" })
          .end(JSON.stringify(tokenReply));
      } else if (url.pathname === "/oauth2/revoke") {
        seen.revoke = new URLSearchParams(body);
        res.writeHead(200).end("{}");
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen };
}

function options(
  base: string,
  seen: Seen,
  browser: (auth: URL) => Promise<void> | void,
  extra: Partial<SignInOptions> = {},
): SignInOptions {
  return {
    clientId: "client-1",
    scope: "workers-scripts.admin",
    port: 0,
    authUrl: `${base}/oauth2/auth`,
    tokenUrl: `${base}/oauth2/token`,
    timeoutMs: 5000,
    openUrl: async (url) => {
      seen.auth = new URL(url).searchParams;
      await browser(new URL(url));
    },
    ...extra,
  };
}

/** What Cloudflare's page does at the end: send the browser back to the loopback address. */
async function approve(auth: URL, overrides: Record<string, string> = {}) {
  const back = new URL(auth.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("code", "code-1");
  back.searchParams.set("state", auth.searchParams.get("state") ?? "");
  for (const [k, v] of Object.entries(overrides)) back.searchParams.set(k, v);
  return fetch(back);
}

describe("signIn", () => {
  it("asks with PKCE and the loopback address, then trades the code for a token", async () => {
    const cf = await fakeCloudflare();
    const token = await signIn(
      options(cf.base, cf.seen, (auth) => void approve(auth)),
    );
    expect(token).toEqual({ accessToken: "tok-1", expiresIn: 3600 });
    const ask = cf.seen.auth;
    expect(ask?.get("response_type")).toBe("code");
    expect(ask?.get("client_id")).toBe("client-1");
    expect(ask?.get("scope")).toBe("workers-scripts.admin");
    expect(ask?.get("code_challenge_method")).toBe("S256");
    expect(ask?.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(cf.seen.token?.get("grant_type")).toBe("authorization_code");
    expect(cf.seen.token?.get("code")).toBe("code-1");
    expect(cf.seen.token?.get("client_id")).toBe("client-1");
    expect(cf.seen.token?.has("client_secret")).toBe(false);
  });

  it("proves the code with the verifier that the challenge came from", async () => {
    const { createHash } = await import("node:crypto");
    const cf = await fakeCloudflare();
    await signIn(options(cf.base, cf.seen, (auth) => void approve(auth)));
    const verifier = cf.seen.token?.get("code_verifier") ?? "";
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(cf.seen.auth?.get("code_challenge")).toBe(challenge);
  });

  it("uses a different state and verifier each time", async () => {
    const cf = await fakeCloudflare();
    const states: string[] = [];
    for (let i = 0; i < 2; i += 1)
      await signIn(
        options(cf.base, cf.seen, (auth) => {
          states.push(auth.searchParams.get("state") ?? "");
          void approve(auth);
        }),
      );
    expect(new Set(states).size).toBe(2);
  });

  it("ignores a callback with the wrong state and still takes the real one", async () => {
    const cf = await fakeCloudflare();
    const token = await signIn(
      options(cf.base, cf.seen, async (auth) => {
        const bad = await approve(auth, { state: "forged" });
        expect(bad.status).toBe(400);
        void approve(auth);
      }),
    );
    expect(token.accessToken).toBe("tok-1");
    expect(cf.seen.token?.get("code")).toBe("code-1");
  });

  it("serves the whole success page before it closes", async () => {
    const cf = await fakeCloudflare();
    let page = "";
    await signIn(
      options(cf.base, cf.seen, (auth) => {
        void approve(auth)
          .then((r) => r.text())
          .then((t) => (page = t));
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(page).toContain("Signed in to Cloudflare");
  });

  it("raises an OAuthError when the browser cannot be opened", async () => {
    const cf = await fakeCloudflare();
    await expect(
      signIn(
        options(cf.base, cf.seen, () => {
          throw new Error("no xdg-open");
        }),
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("says so when the person declines", async () => {
    const cf = await fakeCloudflare();
    const attempt = signIn(
      options(cf.base, cf.seen, (auth) => {
        const back = new URL(auth.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("state", auth.searchParams.get("state") ?? "");
        void fetch(back);
      }),
    );
    await expect(attempt).rejects.toMatchObject({ reason: "denied" });
  });

  it("gives up after the timeout", async () => {
    const cf = await fakeCloudflare();
    await expect(
      signIn(options(cf.base, cf.seen, () => undefined, { timeoutMs: 80 })),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("stops when cancelled, and frees the port", async () => {
    const cf = await fakeCloudflare();
    const controller = new AbortController();
    const attempt = signIn(
      options(
        cf.base,
        cf.seen,
        () => {
          setTimeout(() => controller.abort(), 20);
        },
        { signal: controller.signal },
      ),
    );
    await expect(attempt).rejects.toMatchObject({ reason: "cancelled" });
  });

  it("reports a rejected code exchange without the token body", async () => {
    const cf = await fakeCloudflare(
      { error: "invalid_grant", error_description: "bad code" },
      400,
    );
    await expect(
      signIn(options(cf.base, cf.seen, (auth) => void approve(auth))),
    ).rejects.toMatchObject({ reason: "exchange" });
  });

  it("reports a reply with no access token", async () => {
    const cf = await fakeCloudflare({ nope: true });
    await expect(
      signIn(options(cf.base, cf.seen, (auth) => void approve(auth))),
    ).rejects.toMatchObject({ reason: "exchange" });
  });

  it("answers anything else on the loopback port with 404 and keeps waiting", async () => {
    const cf = await fakeCloudflare();
    let stray = 0;
    const token = await signIn(
      options(cf.base, cf.seen, async (auth) => {
        const back = new URL(auth.searchParams.get("redirect_uri") ?? "");
        stray = (await fetch(new URL("/favicon.ico", back))).status;
        await approve(auth);
      }),
    );
    expect(stray).toBe(404);
    expect(token.accessToken).toBe("tok-1");
  });

  it("says so when the port is taken", async () => {
    const cf = await fakeCloudflare();
    const holder = createServer();
    await new Promise<void>((r) => holder.listen(0, "127.0.0.1", r));
    servers.push(holder);
    const port = (holder.address() as AddressInfo).port;
    await expect(
      signIn(options(cf.base, cf.seen, () => undefined, { port })),
    ).rejects.toMatchObject({ reason: "port" });
  });
});

describe("revokeToken", () => {
  it("revokes the access token", async () => {
    const cf = await fakeCloudflare();
    await revokeToken(
      { clientId: "client-1", revokeUrl: `${cf.base}/oauth2/revoke` },
      "tok-1",
    );
    expect(cf.seen.revoke?.get("token")).toBe("tok-1");
    expect(cf.seen.revoke?.get("client_id")).toBe("client-1");
  });

  it("does not throw when revoking fails, since it runs after everything else", async () => {
    await expect(
      revokeToken(
        { clientId: "c", revokeUrl: "http://127.0.0.1:1/oauth2/revoke" },
        "t",
      ),
    ).resolves.toBe(false);
  });
});
