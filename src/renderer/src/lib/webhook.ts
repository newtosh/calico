import type { CalicoInfo } from "../../../shared/ipc";

/** Where agents post updates: the LAN address when there is one, else loopback. */
export function webhookUrl(info: CalicoInfo): string | null {
  const base = info.lanUrls[0] ?? info.serverUrl;
  return base ? `${base}/api/webhook/grok-bot` : null;
}
