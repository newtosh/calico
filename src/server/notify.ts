import type { PanelBatteryInfo } from "../shared/ipc";
import {
  BadInput,
  type CalicoConfig,
  notifyHeader,
  notifyKey,
  notifyOffline,
  notifyUrl,
} from "./config";
import { isoSeconds } from "./store";

/** What delivery needs from Electron's safeStorage. Tests pass a fake. */
export interface NotifyBox {
  /** safeStorage.getSelectedStorageBackend() on Linux. */
  backend(): string;
  available(): boolean;
  encrypt(text: string): Buffer;
  /** Throws when the keyring is locked or did not seal this blob. */
  decrypt(sealed: Buffer): string;
}

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

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface NotifyBattery {
  pct: number;
  charging: boolean;
  external: boolean;
}

export interface OnlinePayload {
  type: "calico.online";
  at: string;
  offline_seconds: number;
  battery: NotifyBattery | null;
}

export interface DismissedPayload {
  type: "needs_you.dismissed";
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
  url: string;
  /** Effective header name. `Authorization` when the default Bearer form is in use. */
  header: string;
  offline_seconds: number;
  key_set: boolean;
  last: NotifyDelivery | null;
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
}

export function notifyPublicView(
  config: CalicoConfig,
  last: NotifyDelivery | null,
): NotifyPublic {
  return {
    url: config.notify_url,
    header: config.notify_header || "Authorization",
    offline_seconds: config.notify_offline_seconds,
    key_set: config.notify_key !== "",
    last,
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

function keyringRefusal(box: NotifyBox): string | null {
  const backend = box.backend();
  if (backend === "basic_text") return PLAINTEXT_KEYRING;
  if (backend === "unknown" || !box.available()) return NO_KEYRING;
  return null;
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

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Posts calico.online and needs_you.dismissed. Sends are not awaited by the
 * caller: a slow webhook must not hold the panel's status response or a dismiss.
 */
export class OutboundNotifier {
  private lastSentAt: number | null = null;
  /**
   * Set when the first poll arrived before a URL was saved, so that poll is
   * delivered on the next one once a URL exists.
   */
  private startupOwed = false;
  private lastDelivery: NotifyDelivery | null = null;
  private inflight = 0;
  private waiters: (() => void)[] = [];
  private readonly startedAt: number;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly opts: NotifyOptions) {
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? delay;
    this.timeoutMs = opts.timeoutMs ?? NOTIFY_TIMEOUT_MS;
  }

  view(config: CalicoConfig): NotifyPublic {
    return notifyPublicView(config, this.lastDelivery);
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
    if ("url" in patch) merged.notify_url = notifyUrl(patch.url);
    else if (!merged.notify_url) throw new BadInput("bad notify");
    if ("key" in patch) {
      if (typeof patch.key !== "string") throw new BadInput("bad notify");
      merged.notify_key = patch.key === "" ? "" : this.seal(patch.key);
    }
    return merged;
  }

  /**
   * A non-loopback panel status poll. `previous` is the poll time before this
   * one, null on the first poll after startup. `lastPanelPoll` has already
   * moved on by the time the hook runs, so this argument is the gap.
   */
  notePoll(previous: number | null, battery: PanelBatteryInfo | null): void {
    // A hook that omits the argument is the startup poll: there is no earlier one.
    const prior = previous ?? null;
    const config = this.opts.getConfig();
    if (!config.notify_url) {
      if (prior === null) this.startupOwed = true;
      return;
    }
    const now = this.now();
    const thresholdMs = config.notify_offline_seconds * 1000;
    if (this.lastSentAt !== null && now - this.lastSentAt < thresholdMs) return;
    const gap = prior === null ? null : now - prior;
    const due =
      prior === null ||
      this.startupOwed ||
      (gap !== null && gap >= thresholdMs);
    if (!due) return;
    const offlineSeconds =
      gap === null
        ? Math.max(0, Math.floor((now - this.startedAt) / 1000))
        : Math.floor(Math.max(0, gap) / 1000);
    const sent = this.send({
      type: "calico.online",
      at: isoSeconds(new Date(now)),
      offline_seconds: offlineSeconds,
      battery: batteryOf(battery),
    });
    if (!sent) return;
    this.startupOwed = false;
    this.lastSentAt = now;
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
    const refused = keyringRefusal(this.opts.box);
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
    if (!BASE64.test(sealed) || keyringRefusal(this.opts.box))
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

  /** False when nothing was posted, so the caller does not count a debounce window. */
  private send(payload: NotifyPayload): boolean {
    const config = this.opts.getConfig();
    if (!config.notify_url) return false;
    let key = "";
    if (config.notify_key) {
      const opened = this.openKey(config.notify_key);
      if (!opened.ok) {
        this.finish(payload.type, {
          ok: false,
          status: null,
          error: opened.error,
        });
        return false;
      }
      key = opened.key;
    }
    const headers = notifyHeaders(config.notify_header, key, this.opts.version);
    this.track(this.deliver(config.notify_url, headers, payload));
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
    headers: Record<string, string>,
    payload: NotifyPayload,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    let status: number | null = null;
    let error = "network error";
    for (let attempt = 0; attempt <= NOTIFY_RETRIES; attempt++) {
      try {
        const res = await this.fetch(url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
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
        error = isTimeout(err) ? "timed out" : "network error";
      }
      if (attempt === NOTIFY_RETRIES) break;
      const pause = NOTIFY_BACKOFF_MS[attempt] ?? NOTIFY_BACKOFF_MS[1];
      await this.sleep(pause);
    }
    this.finish(payload.type, { ok: false, status, error });
  }

  private finish(
    type: NotifyPayload["type"],
    result: { ok: boolean; status: number | null; error: string },
  ): void {
    this.lastDelivery = {
      at: isoSeconds(new Date(this.now())),
      type,
      ok: result.ok,
      status: result.status,
      error: result.error,
    };
  }
}
