import { readFileSync } from "node:fs";
import { writeAtomic } from "./state-file";

export interface CalicoConfig {
  port: number;
  webhook_token: string;
  cursor_api_key: string;
  cursor_poll_seconds: number;
  panel_url: string;
  panel_token: string;
  /** How long a running agent stays running without an update. */
  running_timeout_seconds: number;
  /** A relay's topic URL, its read token, and the id of the last message applied. */
  relay_url: string;
  relay_token: string;
  relay_cursor: string;
}

export const DEFAULT_PORT = 8787;

/** Startup-fatal. The message names the file. */
export class ConfigError extends Error {}
export const DEFAULT_RUNNING_TIMEOUT = 120;
export const MIN_RUNNING_TIMEOUT = 30;
export const MAX_RUNNING_TIMEOUT = 3600;

/** A request body the HTTP layer answers with 400. */
export class BadInput extends Error {}

export function defaultConfig(): CalicoConfig {
  return {
    port: DEFAULT_PORT,
    webhook_token: "",
    cursor_api_key: "",
    cursor_poll_seconds: 30,
    panel_url: "",
    panel_token: "",
    running_timeout_seconds: DEFAULT_RUNNING_TIMEOUT,
    relay_url: "",
    relay_token: "",
    relay_cursor: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A missing key means unset. Any other non-string is a hand-edit gone wrong,
// and treating it as unset would quietly turn auth off.
function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  throw new BadInput(key);
}

function boundedInt(
  value: unknown,
  low: number,
  high: number,
  key: string,
): number {
  let n: number;
  if (typeof value === "number" && Number.isInteger(value)) n = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) n = Number(value);
  else throw new BadInput(key);
  if (n < low || n > high) throw new BadInput(key);
  return n;
}

export function loadConfig(path: string): {
  config: CalicoConfig;
  existed: boolean;
} {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { config: defaultConfig(), existed: false };
    throw new ConfigError(`Cannot read ${path}: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConfigError(
      `${path} is not valid JSON. Fix or delete it. Calico will not overwrite it.`,
    );
  }
  if (!isRecord(data))
    throw new ConfigError(`${path} must contain a JSON object.`);
  const base = defaultConfig();
  try {
    return {
      existed: true,
      config: {
        port:
          "port" in data ? boundedInt(data.port, 1, 65535, "port") : base.port,
        webhook_token: str(data, "webhook_token"),
        cursor_api_key: str(data, "cursor_api_key"),
        cursor_poll_seconds:
          "cursor_poll_seconds" in data
            ? boundedInt(
                data.cursor_poll_seconds,
                5,
                86400,
                "cursor_poll_seconds",
              )
            : base.cursor_poll_seconds,
        panel_url: str(data, "panel_url"),
        panel_token: str(data, "panel_token"),
        running_timeout_seconds:
          "running_timeout_seconds" in data
            ? boundedInt(
                data.running_timeout_seconds,
                MIN_RUNNING_TIMEOUT,
                MAX_RUNNING_TIMEOUT,
                "running_timeout_seconds",
              )
            : base.running_timeout_seconds,
        relay_url: str(data, "relay_url"),
        relay_token: str(data, "relay_token"),
        relay_cursor: str(data, "relay_cursor"),
      },
    };
  } catch (err) {
    if (!(err instanceof BadInput)) throw err;
    throw new ConfigError(`${path} has an invalid ${err.message}.`);
  }
}

// Keys calico does not know are not kept: a save rewrites the file from the
// known fields only.
export function saveConfig(path: string, config: CalicoConfig): void {
  writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** `detail` adds settings the Python companion never had, so its plain view stays as the panel contract froze it. */
export function publicView(config: CalicoConfig, detail = false) {
  return {
    port: config.port,
    cursor_poll_seconds: config.cursor_poll_seconds,
    webhook_token_set: Boolean(config.webhook_token),
    cursor_api_key_set: Boolean(config.cursor_api_key),
    ...(detail
      ? { running_timeout_seconds: config.running_timeout_seconds }
      : {}),
  };
}

export function mergeConfig(
  current: CalicoConfig,
  patch: Record<string, unknown>,
): { config: CalicoConfig; restart: boolean } {
  const merged = { ...current };
  if ("port" in patch) merged.port = boundedInt(patch.port, 1, 65535, "port");
  if ("cursor_poll_seconds" in patch)
    merged.cursor_poll_seconds = boundedInt(
      patch.cursor_poll_seconds,
      5,
      86400,
      "cursor_poll_seconds",
    );
  if ("running_timeout_seconds" in patch)
    merged.running_timeout_seconds = boundedInt(
      patch.running_timeout_seconds,
      MIN_RUNNING_TIMEOUT,
      MAX_RUNNING_TIMEOUT,
      "running_timeout_seconds",
    );
  if ("webhook_token" in patch)
    merged.webhook_token = String(patch.webhook_token);
  if ("cursor_api_key" in patch)
    merged.cursor_api_key = String(patch.cursor_api_key);
  return { config: merged, restart: merged.port !== current.port };
}

const WIFI_KEYS = [
  "ssid",
  "pass",
  "password",
  "passphrase",
  "psk",
  "wifi",
  "wifi_ssid",
  "wifi_password",
  "wifi_pass",
];
const PANEL_URL_MAX = 127;
const PANEL_TOKEN_MAX = 127;

function plainText(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit)
    throw new BadInput("bad panel");
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 32 || code > 126 || ch === '"' || ch === "\\")
      throw new BadInput("bad panel");
  }
  return value;
}

function panelUrl(value: unknown): string {
  if (typeof value !== "string") throw new BadInput("bad panel");
  const url = plainText(value.replace(/\/+$/, ""), PANEL_URL_MAX);
  if (!url.startsWith("http://") && !url.startsWith("https://"))
    throw new BadInput("bad panel");
  const host = url.split("://", 2)[1]?.split("/", 1)[0] ?? "";
  if (!host || host.includes("@") || host.startsWith(":"))
    throw new BadInput("bad panel");
  return url;
}

export function panelPublicView(config: CalicoConfig) {
  return { url: config.panel_url, token_set: Boolean(config.panel_token) };
}

export function panelStatusField(
  config: CalicoConfig,
): { url: string; token: string } | null {
  return config.panel_url
    ? { url: config.panel_url, token: config.panel_token }
    : null;
}

export function mergePanel(
  current: CalicoConfig,
  patch: Record<string, unknown>,
): CalicoConfig {
  if (WIFI_KEYS.some((key) => key in patch))
    throw new BadInput("wifi rejected");
  const merged = { ...current };
  if (patch.clear === true)
    return { ...merged, panel_url: "", panel_token: "" };
  if ("url" in patch) merged.panel_url = panelUrl(patch.url);
  else if (!merged.panel_url) throw new BadInput("bad panel");
  if ("token" in patch)
    merged.panel_token = plainText(patch.token, PANEL_TOKEN_MAX);
  return merged;
}

export function relayPublicView(config: CalicoConfig) {
  return { url: config.relay_url, token_set: Boolean(config.relay_token) };
}

// The relay URL and token end up in a request header and URL, so keep them
// plain. http is for a self-hosted relay on this computer, nothing else.
function relayUrl(value: unknown): string {
  if (typeof value !== "string") throw new BadInput("bad relay");
  const url = plainText(value.replace(/\/+$/, ""), 512);
  const [scheme, rest = ""] = url.split("://", 2);
  const host = rest.split("/", 1)[0] ?? "";
  if (!host || host.includes("@") || host.startsWith(":"))
    throw new BadInput("bad relay");
  const name = host.replace(/:\d+$/, "");
  const local = name === "localhost" || name === "127.0.0.1";
  if (scheme !== "https" && !(scheme === "http" && local))
    throw new BadInput("bad relay");
  return url;
}

function relayToken(value: unknown): string {
  const token = plainText(value, 256);
  if (!token) throw new BadInput("bad relay");
  return token;
}

export function mergeRelay(
  current: CalicoConfig,
  patch: Record<string, unknown>,
): CalicoConfig {
  if (patch.clear === true)
    return { ...current, relay_url: "", relay_token: "", relay_cursor: "" };
  if (!("url" in patch) || !("token" in patch)) throw new BadInput("bad relay");
  const url = relayUrl(patch.url);
  const token = relayToken(patch.token);
  const same = url === current.relay_url && token === current.relay_token;
  return {
    ...current,
    relay_url: url,
    relay_token: token,
    relay_cursor: same ? current.relay_cursor : "",
  };
}
