import type { CalicoConfig } from "./config";
import { type DeskStore, eventIn, isoSeconds, StoreError } from "./store";

export interface RelayReply {
  status: number;
  /** Lower-cased names. */
  headers: Record<string, string>;
  body: string;
}

export type RelayGet = (url: string, token: string) => Promise<RelayReply>;

export interface RelayTarget {
  /** The topic URL, such as https://calico-relay.you.workers.dev/inbox. */
  url: string;
  token: string;
  /** The id of the last message applied. Empty asks for everything. */
  cursor: string;
}

export type RelayResult =
  | {
      ok: true;
      applied: number;
      refused: number;
      cursor: string;
      used?: number;
      budget?: number;
    }
  | { ok: false; error: string; retryAfterSeconds?: number };

export interface RelayStatus {
  configured: boolean;
  last_poll_at: string | null;
  ok: boolean | null;
  applied: number;
  refused: number;
  error: string;
  used: number | null;
  budget: number | null;
}

export const EMPTY_RELAY_STATUS: RelayStatus = {
  configured: false,
  last_poll_at: null,
  ok: null,
  applied: 0,
  refused: 0,
  error: "",
  used: null,
  budget: null,
};

export const BASE_DELAY_SECONDS = 15;
export const SLOW_DELAY_SECONDS = 60;
export const MAX_BACKOFF_SECONDS = 300;
const MAX_RETRY_AFTER_SECONDS = 3600;
// Past this share of the daily budget, poll slowly so the agents keep room to post.
const SLOW_AT = 0.8;

function number(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function describeFailure(status: number): string {
  if (status === 401 || status === 403)
    return `The relay rejected the read token (HTTP ${status}).`;
  if (status === 404)
    return "The relay answered, but not at that address (HTTP 404).";
  if (status === 429) return "The relay has used its daily request budget.";
  return `The relay answered HTTP ${status}.`;
}

function applyLine(
  store: DeskStore,
  raw: string,
): "applied" | "refused" | "skipped" {
  let row: unknown;
  try {
    row = JSON.parse(raw);
  } catch {
    return "refused";
  }
  if (!row || typeof row !== "object") return "refused";
  const message = row as Record<string, unknown>;
  if (message.event !== "message") return "skipped";
  let payload: unknown;
  try {
    payload = JSON.parse(String(message.message ?? ""));
  } catch {
    return "refused";
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return "refused";
  const seconds = message.time;
  const at =
    typeof seconds === "number" && Number.isFinite(seconds)
      ? isoSeconds(new Date(seconds * 1000))
      : "";
  try {
    store.applyEvent(eventIn(payload as Record<string, unknown>), at);
    return "applied";
  } catch (err) {
    if (err instanceof StoreError) return "refused";
    throw err;
  }
}

/** One read of the relay. Never throws: a failure is the result. */
export async function pollRelayOnce(
  store: DeskStore,
  relay: RelayTarget,
  get: RelayGet,
): Promise<RelayResult> {
  const url = `${relay.url.replace(/\/+$/, "")}/json?poll=1&since=${encodeURIComponent(relay.cursor || "all")}`;
  let answer: RelayReply;
  try {
    answer = await get(url, relay.token);
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach the relay: ${(err as Error).message}.`,
    };
  }
  if (answer.status !== 200) {
    const wait = number(answer.headers["retry-after"]);
    return {
      ok: false,
      error: describeFailure(answer.status),
      ...(wait === undefined ? {} : { retryAfterSeconds: wait }),
    };
  }
  let cursor = relay.cursor;
  let applied = 0;
  let refused = 0;
  const seen = new Set<string>();
  for (const raw of answer.body.split("\n")) {
    if (!raw.trim()) continue;
    let id = "";
    try {
      id = String((JSON.parse(raw) as { id?: unknown }).id ?? "");
    } catch {
      // applyLine counts it as refused.
    }
    if (id && seen.has(id)) continue;
    const outcome = applyLine(store, raw);
    if (outcome === "skipped") continue;
    if (id) {
      seen.add(id);
      cursor = id;
    }
    if (outcome === "applied") applied += 1;
    else refused += 1;
  }
  const used = number(answer.headers["x-relay-requests-today"]);
  const budget = number(answer.headers["x-relay-budget"]);
  return {
    ok: true,
    applied,
    refused,
    cursor,
    ...(used === undefined ? {} : { used }),
    ...(budget === undefined ? {} : { budget }),
  };
}

/** Seconds to wait before the next read. */
export function nextDelaySeconds(
  result: RelayResult,
  failures: number,
): number {
  if (result.ok) {
    const full =
      result.used !== undefined &&
      result.budget !== undefined &&
      result.used >= result.budget * SLOW_AT;
    return full ? SLOW_DELAY_SECONDS : BASE_DELAY_SECONDS;
  }
  if (result.retryAfterSeconds !== undefined)
    return Math.min(
      MAX_RETRY_AFTER_SECONDS,
      Math.max(BASE_DELAY_SECONDS, result.retryAfterSeconds),
    );
  return Math.min(MAX_BACKOFF_SECONDS, BASE_DELAY_SECONDS * 2 ** failures);
}

export class RelayState {
  private last: { result: RelayResult; at: string } | null = null;

  record(result: RelayResult, at: string): void {
    this.last = { result, at };
  }

  snapshot(configured: boolean): RelayStatus {
    if (!configured || !this.last) return { ...EMPTY_RELAY_STATUS, configured };
    const { result, at } = this.last;
    return {
      configured,
      last_poll_at: at,
      ok: result.ok,
      applied: result.ok ? result.applied : 0,
      refused: result.ok ? result.refused : 0,
      error: result.ok ? "" : result.error,
      used: result.ok ? (result.used ?? null) : null,
      budget: result.ok ? (result.budget ?? null) : null,
    };
  }
}

export async function fetchRelay(
  url: string,
  token: string,
): Promise<RelayReply> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "calico" },
    signal: AbortSignal.timeout(15_000),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: res.status, headers, body: await res.text() };
}

/** Reads the relay until the returned stop function is called. Reads the config fresh each round. */
export function startRelayPoll(
  store: DeskStore,
  getConfig: () => CalicoConfig,
  setCursor: (cursor: string) => void,
  state?: RelayState,
  get: RelayGet = fetchRelay,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let failures = 0;
  const round = async () => {
    const config = getConfig();
    let delay = BASE_DELAY_SECONDS;
    if (config.relay_url && config.relay_token) {
      const result = await pollRelayOnce(
        store,
        {
          url: config.relay_url,
          token: config.relay_token,
          cursor: config.relay_cursor,
        },
        get,
      );
      state?.record(result, isoSeconds(new Date()));
      if (result.ok) {
        failures = 0;
        if (result.cursor !== config.relay_cursor) setCursor(result.cursor);
      } else failures += 1;
      delay = nextDelaySeconds(result, failures);
    }
    if (!stopped) timer = setTimeout(() => void round(), delay * 1000);
  };
  void round();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
