import { app, dialog, shell } from "electron";
// Bundled as a string so the app can upload exactly the Worker that CI tests.
import workerSource from "../../../tools/relay/src/index.js?raw";
import { fetchRelay } from "../../server/relay";
import { CloudflareApi } from "../cloudflare/api";
import { revokeToken, signIn, WORKERS_SCOPE } from "../cloudflare/oauth";
import { endpoints } from "./endpoints";
import type { SetupDeps } from "./setup";

/** The real Cloudflare, unless a test points the endpoints at a fake. */
export function cloudflareSetupDeps(
  signal: AbortSignal,
): Omit<SetupDeps, "report" | "persist"> {
  const ep = endpoints(process.env, app.isPackaged);
  return {
    signIn: () =>
      signIn({
        clientId: ep.clientId,
        scope: WORKERS_SCOPE,
        authUrl: ep.authUrl,
        tokenUrl: ep.tokenUrl,
        openUrl: (url) => shell.openExternal(url),
        signal,
      }),
    revoke: (token) =>
      revokeToken({ clientId: ep.clientId, revokeUrl: ep.revokeUrl }, token),
    api: (token) => new CloudflareApi(token, ep.apiUrl),
    workerSource,
    origin: ep.workersOrigin ? () => ep.workersOrigin as string : undefined,
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
