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

export type PollResult =
  { ok: true; agents: number } | { ok: false; error: string };

export interface CursorStatus {
  /** A Cursor API key is set. */
  configured: boolean;
  /** When the last poll finished, as an ISO timestamp. */
  last_poll_at: string | null;
  /** The last poll's outcome, or null before the first poll. */
  ok: boolean | null;
  agents: number;
  error: string;
}

export const EMPTY_CURSOR_STATUS: CursorStatus = {
  configured: false,
  last_poll_at: null,
  ok: null,
  agents: 0,
  error: "",
};

/** The last poll's outcome, so the app can show whether Cursor polling works. */
export class CursorState {
  private last: { result: PollResult; at: string } | null = null;

  record(result: PollResult, at: string): void {
    this.last = { result, at };
  }

  snapshot(configured: boolean): CursorStatus {
    if (!configured || !this.last)
      return { ...EMPTY_CURSOR_STATUS, configured };
    const { result, at } = this.last;
    return {
      configured,
      last_poll_at: at,
      ok: result.ok,
      agents: result.ok ? result.agents : 0,
      error: result.ok ? "" : result.error,
    };
  }
}

const NOT_A_LIST = "Cursor answered, but not with an agent list.";

function describeFailure(err: Error): string {
  const http = /^HTTP (\d{3})$/.exec(err.message);
  if (http && (http[1] === "401" || http[1] === "403"))
    return `Cursor rejected the API key (HTTP ${http[1]}).`;
  if (http) return `Cursor answered HTTP ${http[1]}.`;
  return `Could not reach Cursor: ${err.message}.`;
}

/** Null when there is no key to poll with. */
export async function pollOnce(
  store: DeskStore,
  apiKey: string,
  get: (url: string, apiKey: string) => Promise<string>,
  now: string,
  warn: (message: string) => void = console.warn,
): Promise<PollResult | null> {
  if (!apiKey) return null;
  let body: string;
  try {
    body = await get(AGENTS_URL, apiKey);
  } catch (err) {
    warn(`cursor poll failed: ${(err as Error).message}`);
    return { ok: false, error: describeFailure(err as Error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: NOT_A_LIST };
  }
  const items =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).items
      : undefined;
  if (!Array.isArray(items)) return { ok: false, error: NOT_A_LIST };
  let agents = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mapped = mapCursorStatus(String(row.status ?? ""));
    const agentId = String(row.id ?? "");
    if (!mapped || !agentId) continue;
    agents += 1;
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
  return { ok: true, agents };
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
  state?: CursorState,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const round = async () => {
    const config = getConfig();
    const now = isoSeconds(new Date());
    const result = await pollOnce(store, config.cursor_api_key, fetchGet, now);
    if (result) state?.record(result, now);
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
