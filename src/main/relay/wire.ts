import { dialog, shell } from "electron";
// Bundled as a string so the app can upload exactly the Worker that CI tests.
import workerSource from "../../../tools/relay/src/index.js?raw";
import { fetchRelay } from "../../server/relay";
import { CloudflareApi } from "../cloudflare/api";
import { revokeToken, signIn, WORKERS_SCOPE } from "../cloudflare/oauth";
import type { SetupDeps } from "./setup";

/** The private OAuth client. Phase 4 swaps in the public one. */
const CLIENT_ID = "80700e7a799c4dd0b74304fd4bed9f76";

/** The real Cloudflare, unless a test points the endpoints at a fake. */
export function cloudflareSetupDeps(
  signal: AbortSignal,
): Omit<SetupDeps, "report" | "persist"> {
  const env = process.env;
  const clientId = env.CALICO_CF_CLIENT_ID || CLIENT_ID;
  return {
    signIn: () =>
      signIn({
        clientId,
        scope: WORKERS_SCOPE,
        authUrl: env.CALICO_CF_AUTH_URL,
        tokenUrl: env.CALICO_CF_TOKEN_URL,
        openUrl: (url) => shell.openExternal(url),
        signal,
      }),
    revoke: (token) =>
      revokeToken({ clientId, revokeUrl: env.CALICO_CF_REVOKE_URL }, token),
    api: (token) => new CloudflareApi(token, env.CALICO_CF_API_URL),
    workerSource,
    origin: env.CALICO_CF_WORKERS_ORIGIN
      ? () => env.CALICO_CF_WORKERS_ORIGIN as string
      : undefined,
    probe: async (url, readToken) => {
      try {
        const reply = await fetchRelay(
          `${url}/json?poll=1&since=all`,
          readToken,
        );
        return reply.status === 200;
      } catch {
        return false;
      }
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    chooseAccount: async (accounts) => {
      const { response } = await dialog.showMessageBox({
        type: "question",
        message: "Which Cloudflare account should hold the relay?",
        buttons: [...accounts.map((a) => a.name), "Cancel"],
        cancelId: accounts.length,
        noLink: true,
      });
      return accounts[response]?.id ?? null;
    },
    signal,
  };
}
