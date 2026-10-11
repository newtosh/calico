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
  warn: (message: string) => void,
): "applied" | "refused" | "stale" | "skipped" {
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
  const sent =
    typeof seconds === "number" ? new Date(seconds * 1000) : new Date(NaN);
  // An out-of-range time makes toISOString throw, so check before using it.
  if (Number.isNaN(sent.getTime())) return "refused";
  try {
    return store.applyReplayed(
      eventIn(payload as Record<string, unknown>),
      isoSeconds(sent),
    );
  } catch (err) {
    if (!(err instanceof StoreError))
      warn(`relay message not applied: ${(err as Error).message}`);
    return "refused";
  }
}

/** One read of the relay. Never throws: a failure is the result. */
export async function pollRelayOnce(
  store: DeskStore,
  relay: RelayTarget,
  get: RelayGet,
  warn: (message: string) => void = console.warn,
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
  // Ids restart when a relay is deleted and set up again. Starting over is safe,
  // since a replay that is no newer than what the app already shows is dropped.
  if (answer.status === 409)
    return { ok: true, applied: 0, refused: 0, cursor: "" };
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
    // Without an id the cursor could not move past it, so it would replay forever.
    const outcome = id ? applyLine(store, raw, warn) : "refused";
    if (outcome === "skipped") continue;
    if (id) {
      seen.add(id);
      cursor = id;
    }
    if (outcome === "applied") applied += 1;
    else if (outcome === "refused") refused += 1;
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

  /** The relay changed, so the last result says nothing about the new one. */
  clear(): void {
    this.last = null;
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
    // A relay has no reason to redirect, and a hostile one could aim the read elsewhere.
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: res.status, headers, body: await res.text() };
}

const TICK_SECONDS = 5;

const signature = (c: CalicoConfig) => `${c.relay_url}\n${c.relay_token}`;

/**
 * Reads the relay until the returned stop function is called. It waits in
 * short ticks, so a newly connected relay is read within seconds even after a
 * long back-off for the old one.
 */
export function startRelayPoll(
  store: DeskStore,
  getConfig: () => CalicoConfig,
  setCursor: (cursor: string) => void,
  state?: RelayState,
  get: RelayGet = fetchRelay,
  warn: (message: string) => void = console.warn,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let failures = 0;
  let polled = "";
  const round = async () => {
    const config = getConfig();
    const sig = signature(config);
    if (sig !== polled) {
      polled = sig;
      failures = 0;
      state?.clear();
    }
    let delay = BASE_DELAY_SECONDS;
    if (config.relay_url && config.relay_token) {
      try {
        const result = await pollRelayOnce(
          store,
          {
            url: config.relay_url,
            token: config.relay_token,
            cursor: config.relay_cursor,
          },
          get,
          warn,
        );
        // The person may have connected another relay while this read was in flight.
        if (signature(getConfig()) === sig) {
          state?.record(result, isoSeconds(new Date()));
          if (result.ok) {
            failures = 0;
            if (result.cursor !== config.relay_cursor) setCursor(result.cursor);
          } else failures += 1;
          delay = nextDelaySeconds(result, failures);
        }
      } catch (err) {
        warn(`relay poll failed: ${(err as Error).message}`);
        failures += 1;
        delay = nextDelaySeconds({ ok: false, error: "" }, failures);
      }
    }
    wait(delay);
  };
  const wait = (remaining: number) => {
    if (stopped) return;
    const step = Math.min(TICK_SECONDS, remaining);
    timer = setTimeout(() => {
      if (signature(getConfig()) !== polled || remaining - step <= 0)
        void round();
      else wait(remaining - step);
    }, step * 1000);
  };
  void round();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
