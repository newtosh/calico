export interface DeskAgent {
  id: string;
  title: string;
  status: string;
  attention: boolean;
  message: string;
  updated_at: string;
  color: string;
  shape: string;
  icon: string;
}

export interface DeskEvent {
  id: string;
  type: string;
  agent_id: string;
  title: string;
  message: string;
  source: string;
  at: string;
}

export interface DeskStatus {
  phase: string;
  needs_you: boolean;
  unread: number;
  agents: DeskAgent[];
  last_event: DeskEvent | null;
  events: DeskEvent[];
}

export interface WebhookBody {
  type: string;
  agent_id: string;
  title: string;
  message: string;
  source: string;
  color?: string;
  shape?: string;
}

export interface PublicConfig {
  port: number;
  cursor_poll_seconds: number;
  webhook_token_set: boolean;
  cursor_api_key_set: boolean;
}

export interface ConfigPatch {
  port?: number;
  cursor_poll_seconds?: number;
  webhook_token?: string;
  cursor_api_key?: string;
}

export interface PanelPush {
  url: string;
  token_set: boolean;
}

export interface PanelPatch {
  url?: string;
  token?: string;
  clear?: boolean;
}

export type MarkShape = "circle" | "square" | "diamond" | "triangle";
export const NEUTRAL_MARK = "#a39b88";

let base = "";
let token = "";

export function configureApi(serverUrl: string, webhookToken: string): void {
  base = serverUrl;
  token = webhookToken;
}

function headers(json = true): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function agentMark(
  color: string,
  shape: string,
): { color: string; shape: MarkShape } {
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  const key = shape.trim().toLowerCase();
  const known =
    key === "square" ||
    key === "diamond" ||
    key === "triangle" ||
    key === "circle"
      ? key
      : "circle";
  return { color: hex ? `#${hex[1]}` : NEUTRAL_MARK, shape: known };
}

export function injectBody(
  type: string,
  agentId: string,
  message: string,
  identity: { color?: string; shape?: string } = {},
): WebhookBody {
  const body: WebhookBody = {
    type,
    agent_id: agentId,
    title: agentId,
    message,
    source: "manual",
  };
  const color = identity.color?.trim() ?? "";
  const shape = identity.shape?.trim() ?? "";
  if (color) body.color = color;
  if (shape) body.shape = shape;
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const s = (value: unknown): string => (typeof value === "string" ? value : "");

function eventFrom(value: unknown): DeskEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string"
  )
    return null;
  return {
    id: value.id,
    type: value.type,
    agent_id: s(value.agent_id),
    title: s(value.title),
    message: s(value.message),
    source: s(value.source),
    at: s(value.at),
  };
}

function agentFrom(value: unknown): DeskAgent | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    title: s(value.title),
    status: s(value.status),
    attention: value.attention === true,
    message: s(value.message),
    updated_at: s(value.updated_at),
    color: s(value.color),
    shape: s(value.shape),
    icon: s(value.icon),
  };
}

export function parseStatus(value: unknown): DeskStatus {
  if (
    !isRecord(value) ||
    typeof value.phase !== "string" ||
    !Array.isArray(value.agents)
  ) {
    throw new Error("bad status");
  }
  return {
    phase: value.phase,
    needs_you: value.needs_you === true,
    unread: typeof value.unread === "number" ? value.unread : 0,
    agents: value.agents.flatMap((item) => agentFrom(item) ?? []),
    last_event: eventFrom(value.last_event),
    events: Array.isArray(value.events)
      ? value.events.flatMap((item) => eventFrom(item) ?? [])
      : [],
  };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(base + path, init);
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? "Unauthorized. Check the webhook token in Settings."
        : `${path} ${res.status}`,
    );
  return res;
}

export async function fetchStatus(): Promise<DeskStatus> {
  return parseStatus(await (await call("/api/status")).json());
}

export async function postWebhook(body: WebhookBody): Promise<void> {
  await call("/api/webhook/grok-bot", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
}

export async function postDismiss(agentId = ""): Promise<void> {
  await call("/api/dismiss", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(agentId ? { agent_id: agentId } : {}),
  });
}

export async function fetchConfig(): Promise<PublicConfig> {
  const value: unknown = await (await call("/api/config")).json();
  if (!isRecord(value) || typeof value.port !== "number")
    throw new Error("bad config");
  return {
    port: value.port,
    cursor_poll_seconds:
      typeof value.cursor_poll_seconds === "number"
        ? value.cursor_poll_seconds
        : 30,
    webhook_token_set: value.webhook_token_set === true,
    cursor_api_key_set: value.cursor_api_key_set === true,
  };
}

export async function putConfig(
  patch: ConfigPatch,
): Promise<{ restart_required: boolean }> {
  const value: unknown = await (
    await call("/api/config", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(patch),
    })
  ).json();
  return {
    restart_required: isRecord(value) && value.restart_required === true,
  };
}

function panelFrom(value: unknown): PanelPush {
  if (!isRecord(value) || typeof value.url !== "string")
    throw new Error("bad panel");
  return { url: value.url, token_set: value.token_set === true };
}

export async function fetchPanel(): Promise<PanelPush> {
  return panelFrom(await (await call("/api/panel")).json());
}

export async function putPanel(patch: PanelPatch): Promise<PanelPush> {
  return panelFrom(
    await (
      await call("/api/panel", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(patch),
      })
    ).json(),
  );
}
