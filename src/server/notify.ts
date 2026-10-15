import { randomUUID } from "node:crypto";
import type { PanelBatteryInfo } from "../shared/ipc";
import {
  BadInput,
  type CalicoConfig,
  notifyHeader,
  notifyKey,
  notifyOffline,
  notifyUrl,
} from "./config";
import { BASE64, keyringRefusal, type SecretBox } from "./keyring";
import { isoSeconds } from "./store";

export type NotifyBox = SecretBox;

export const NO_KEYRING =
  "Calico could not reach a system keyring, so it did not save the sender key. Unlock GNOME Keyring or KWallet, then try again.";
export const PLAINTEXT_KEYRING =
  "This desktop gives Calico no keyring, so the sender key would be stored as plain text. Calico did not save it. Install GNOME Keyring or KWallet, then try again.";
export const KEYRING_CHANGED =
  "Calico could not unlock the saved sender key. The system keyring is locked or has changed. Unlock it, or type the key again in Settings.";

export const NOTIFY_TIMEOUT_MS = 5_000;
/** Attempts after the first. A network error, 429, or 5xx may try this many more times. */
export const NOTIFY_RETRIES = 2;
export const NOTIFY_BACKOFF_MS = [500, 2_000] as const;
/** A Retry-After longer than this still waits only this long. */
const RETRY_AFTER_CAP_MS = 30_000;
const RECENT_MAX = 8;

export interface NotifyBattery {
  pct: number;
  charging: boolean;
  external: boolean;
}

export interface OnlinePayload {
  type: "calico.online";
  id: string;
  at: string;
  offline_seconds: number;
  battery: NotifyBattery | null;
}

export interface DismissedPayload {
  type: "needs_you.dismissed";
  id: string;
  agent_id: string;
  at: string;
}

export type NotifyPayload = OnlinePayload | DismissedPayload;

export interface NotifyDelivery {
  at: string;
  type: NotifyPayload["type"];
  ok: boolean;
  /** HTTP status when the peer answered. Null on a timeout or a network error. */
  status: number | null;
  /** Empty when ok. Never the sender key. */
  error: string;
}

export interface NotifyPublic {
  /** Address with its path and query masked. The POST still uses the saved URL. */
  url: string;
  /** Effective header name. `Authorization` when the default Bearer form is in use. */
  header: string;
  offline_seconds: number;
  key_set: boolean;
  last: NotifyDelivery | null;
  /** Newest first, including `last`. Capped so a later success cannot hide a failure. */
  recent: NotifyDelivery[];
}

export interface NotifyOptions {
  getConfig: () => CalicoConfig;
  box: NotifyBox;
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tests pass a short one. Production uses {@link NOTIFY_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Tests pass a stable id. Production uses a UUID, the same one on every retry. */
  id?: () => string;
}

/** A path or query can itself be a credential, so the view shows only the origin. */
export function maskNotifyUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" && !parsed.search) return url;
    return `${parsed.origin}/\u2026`;
  } catch {
    return "";
  }
}

export function notifyPublicView(
  config: CalicoConfig,
  last: NotifyDelivery | null,
  recent: NotifyDelivery[] = [],
): NotifyPublic {
  return {
    url: maskNotifyUrl(config.notify_url),
    header: config.notify_header || "Authorization",
    offline_seconds: config.notify_offline_seconds,
    key_set: config.notify_key !== "",
    last,
    recent,
  };
}

/** Default is `Authorization: Bearer <key>`. A custom name carries the raw key. */
export function notifyHeaders(
  headerName: string,
  key: string,
  version: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `calico/${version}`,
  };
  if (!key) return headers;
  const name = headerName || "Authorization";
  headers[name] =
    name.toLowerCase() === "authorization" ? `Bearer ${key}` : key;
  return headers;
}

function batteryOf(info: PanelBatteryInfo | null): NotifyBattery | null {
  if (!info) return null;
  return { pct: info.pct, charging: info.charging, external: info.external };
}

function isTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Delta-seconds or an HTTP-date. Null when the header is missing or unusable. */
function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed))
    return Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), RETRY_AFTER_CAP_MS);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type Outbound = Omit<OnlinePayload, "id"> | Omit<DismissedPayload, "id">;

/**
 * Posts calico.online and needs_you.dismissed. Sends are not awaited by the
 * caller: a slow webhook must not hold the panel's status response or a dismiss.
 */
export class OutboundNotifier {
  private lastDelivery: NotifyDelivery | null = null;
  private recent: NotifyDelivery[] = [];
  private inflight = 0;
  private waiters: (() => void)[] = [];
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly id: () => string;

  constructor(private readonly opts: NotifyOptions) {
    this.now = opts.now ?? Date.now;
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? delay;
    this.timeoutMs = opts.timeoutMs ?? NOTIFY_TIMEOUT_MS;
    this.id = opts.id ?? randomUUID;
  }

  view(config: CalicoConfig): NotifyPublic {
    return notifyPublicView(config, this.lastDelivery, this.recent);
  }

  /** Validate a settings patch and seal a new key. Does not write the file. */
  apply(current: CalicoConfig, patch: Record<string, unknown>): CalicoConfig {
    if (patch.clear === true)
      return {
        ...current,
        notify_url: "",
        notify_key: "",
        notify_header: "",
      };
    const merged = { ...current };
    if ("offline_seconds" in patch)
      merged.notify_offline_seconds = notifyOffline(patch.offline_seconds);
    if ("header" in patch) merged.notify_header = notifyHeader(patch.header);
    if ("url" in patch) {
      const url = notifyUrl(patch.url);
      // A new address must not inherit the key sealed for the previous one.
      if (url !== current.notify_url && !("key" in patch))
        merged.notify_key = "";
      merged.notify_url = url;
    } else if (!merged.notify_url) throw new BadInput("bad notify");
    if ("key" in patch) {
      if (typeof patch.key !== "string") throw new BadInput("bad notify");
      merged.notify_key = patch.key === "" ? "" : this.seal(patch.key);
    }
    return merged;
  }

  /**
   * A non-loopback panel status poll. `previous` is the poll time before this
   * one, null on the first poll after startup. The first poll does not send:
   * there is no gap yet. `lastPanelPoll` has already moved on by the time the
   * hook runs.
   */
  notePoll(previous: number | null, battery: PanelBatteryInfo | null): void {
    if (previous === null) return;
    const config = this.opts.getConfig();
    if (!config.notify_url) return;
    const now = this.now();
    const gap = now - previous;
    if (gap < config.notify_offline_seconds * 1000) return;
    this.send({
      type: "calico.online",
      at: isoSeconds(new Date(now)),
      offline_seconds: Math.floor(Math.max(0, gap) / 1000),
      battery: batteryOf(battery),
    });
  }

  /** One POST per agent whose attention was actually cleared. An empty list sends nothing. */
  dismissed(agentIds: readonly string[], at: string): void {
    for (const agent_id of agentIds) {
      if (!agent_id) continue;
      this.send({ type: "needs_you.dismissed", agent_id, at });
    }
  }

  /** Resolves when every POST started so far has finished. For tests. */
  settled(): Promise<void> {
    if (this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private seal(key: string): string {
    const plain = notifyKey(key);
    if (!plain) throw new BadInput("bad notify");
    const refused = keyringRefusal(
      this.opts.box,
      NO_KEYRING,
      PLAINTEXT_KEYRING,
    );
    if (refused) throw new BadInput(refused);
    try {
      const sealed = this.opts.box.encrypt(plain).toString("base64");
      if (!BASE64.test(sealed)) throw new Error("unusable seal");
      return sealed;
    } catch (err) {
      if (err instanceof BadInput) throw err;
      throw new BadInput(NO_KEYRING);
    }
  }

  private openKey(
    sealed: string,
  ): { ok: true; key: string } | { ok: false; error: string } {
    if (
      !BASE64.test(sealed) ||
      keyringRefusal(this.opts.box, NO_KEYRING, PLAINTEXT_KEYRING)
    )
      return { ok: false, error: KEYRING_CHANGED };
    try {
      return {
        ok: true,
        key: this.opts.box.decrypt(Buffer.from(sealed, "base64")),
      };
    } catch {
      return { ok: false, error: KEYRING_CHANGED };
    }
  }

  /** False when nothing was posted. */
  private send(payload: Outbound): boolean {
    const config = this.opts.getConfig();
    if (!config.notify_url) return false;
    const id = this.id();
    const full: NotifyPayload =
      payload.type === "calico.online"
        ? {
            type: payload.type,
            id,
            at: payload.at,
            offline_seconds: payload.offline_seconds,
            battery: payload.battery,
          }
        : {
            type: payload.type,
            id,
            agent_id: payload.agent_id,
            at: payload.at,
          };
    this.track(
      this.deliver(
        config.notify_url,
        config.notify_header,
        config.notify_key,
        full,
      ),
    );
    return true;
  }

  private track(pending: Promise<void>): void {
    this.inflight += 1;
    void pending
      .catch(() => undefined)
      .finally(() => {
        this.inflight -= 1;
        if (this.inflight === 0) {
          const waiters = this.waiters.splice(0);
          for (const resolve of waiters) resolve();
        }
      });
  }

  private async deliver(
    url: string,
    headerName: string,
    sealed: string,
    payload: NotifyPayload,
  ): Promise<void> {
    // Yield before decrypt or fetch. A keyring unlock prompt must not stall
    // the status response that called notePoll.
    await Promise.resolve();
    let key = "";
    if (sealed) {
      const opened = this.openKey(sealed);
      if (!opened.ok) {
        this.finish(payload.type, {
          ok: false,
          status: null,
          error: opened.error,
        });
        return;
      }
      key = opened.key;
    }
    const headers = notifyHeaders(headerName, key, this.opts.version);
    const body = JSON.stringify(payload);
    let status: number | null = null;
    let error = "network error";
    let retryAfter: string | null;
    for (let attempt = 0; attempt <= NOTIFY_RETRIES; attempt++) {
      try {
        const res = await this.fetch(url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        retryAfter = res.headers.get("retry-after");
        await res.body?.cancel().catch(() => undefined);
        if (res.ok) {
          this.finish(payload.type, {
            ok: true,
            status: res.status,
            error: "",
          });
          return;
        }
        status = res.status;
        error = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) break;
      } catch (err) {
        status = null;
        retryAfter = null;
        error = isTimeout(err) ? "timed out" : "network error";
      }
      if (attempt === NOTIFY_RETRIES) break;
      const backoff = NOTIFY_BACKOFF_MS[attempt] ?? NOTIFY_BACKOFF_MS[1];
      const honored =
        status === 429 ? retryAfterMs(retryAfter, this.now()) : null;
      await this.sleep(honored ?? backoff);
    }
    this.finish(payload.type, { ok: false, status, error });
  }

  private finish(
    type: NotifyPayload["type"],
    result: { ok: boolean; status: number | null; error: string },
  ): void {
    const delivery: NotifyDelivery = {
      at: isoSeconds(new Date(this.now())),
      type,
      ok: result.ok,
      status: result.status,
      error: result.error,
    };
    this.lastDelivery = delivery;
    this.recent = [delivery, ...this.recent].slice(0, RECENT_MAX);
  }
}
