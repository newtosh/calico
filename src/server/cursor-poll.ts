import type { CalicoConfig } from "./config";
import {
  COLOR_LIMIT,
  clipShape,
  clipText,
  type DeskStore,
  ICON_LIMIT,
  isoSeconds,
} from "./store";

export const AGENTS_URL = "https://api.cursor.com/v1/agents?limit=20";

export function mapCursorStatus(status: string): "running" | "idle" | null {
  const key = status.toUpperCase();
  if (key === "ACTIVE") return "running";
  if (key === "IDLE" || key === "ARCHIVED") return "idle";
  return null;
}

export async function pollOnce(
  store: DeskStore,
  apiKey: string,
  get: (url: string, apiKey: string) => Promise<string>,
  now: string,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  if (!apiKey) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await get(AGENTS_URL, apiKey));
  } catch (err) {
    warn(`cursor poll failed: ${(err as Error).message}`);
    return;
  }
  const items =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).items
      : undefined;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mapped = mapCursorStatus(String(row.status ?? ""));
    const agentId = String(row.id ?? "");
    if (!mapped || !agentId) continue;
    store.applyCursorItem(
      agentId,
      String(row.name ?? ""),
      mapped,
      now,
      clipText(row.color, COLOR_LIMIT),
      clipShape(row.shape),
      clipText(row.icon, ICON_LIMIT),
    );
  }
}

export async function fetchGet(url: string, apiKey: string): Promise<string> {
  const basic = Buffer.from(`${apiKey}:`).toString("base64");
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Polls until the returned stop function is called. Reads the key and interval fresh each round. */
export function startCursorPoll(
  store: DeskStore,
  getConfig: () => CalicoConfig,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const round = async () => {
    const config = getConfig();
    await pollOnce(
      store,
      config.cursor_api_key,
      fetchGet,
      isoSeconds(new Date()),
    );
    if (!stopped)
      timer = setTimeout(
        () => void round(),
        Math.max(5, config.cursor_poll_seconds) * 1000,
      );
  };
  void round();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
