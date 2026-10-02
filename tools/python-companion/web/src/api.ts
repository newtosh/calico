export interface DeskAgent {
  id: string;
  title: string;
  status: string;
  updated_at: string;
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
}

export interface PublicConfig {
  bind_host: string;
  bind_port: number;
  sqlite_path: string;
  cursor_poll_seconds: number;
  webhook_token_set: boolean;
  cursor_api_key_set: boolean;
}

export interface ConfigPatch {
  bind_host: string;
  bind_port: number;
  sqlite_path: string;
  cursor_poll_seconds: number;
  webhook_token?: string;
  cursor_api_key?: string;
}

const TOKEN_KEY = "grok-desk-token";

export function injectBody(
  type: string,
  agentId: string,
  message: string,
): WebhookBody {
  return {
    type,
    agent_id: agentId,
    title: agentId,
    message,
    source: "manual",
  };
}

export function rememberToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function authorizationHeader(): Record<string, string> {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function eventFrom(value: unknown): DeskEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    type: value.type,
    agent_id: readString(value.agent_id),
    title: readString(value.title),
    message: readString(value.message),
    source: readString(value.source),
    at: readString(value.at),
  };
}

function agentFrom(value: unknown): DeskAgent | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  return {
    id: value.id,
    title: readString(value.title),
    status: readString(value.status),
    updated_at: readString(value.updated_at),
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
  const events = Array.isArray(value.events)
    ? value.events.flatMap((item) => {
        const event = eventFrom(item);
        return event ? [event] : [];
      })
    : [];
  return {
    phase: value.phase,
    needs_you: value.needs_you === true,
    agents: value.agents.flatMap((item) => {
      const agent = agentFrom(item);
      return agent ? [agent] : [];
    }),
    last_event: eventFrom(value.last_event),
    events,
  };
}

export function parseConfig(value: unknown): PublicConfig {
  if (!isRecord(value) || typeof value.bind_host !== "string") {
    throw new Error("bad config");
  }
  return {
    bind_host: value.bind_host,
    bind_port: typeof value.bind_port === "number" ? value.bind_port : 8787,
    sqlite_path: readString(value.sqlite_path),
    cursor_poll_seconds:
      typeof value.cursor_poll_seconds === "number"
        ? value.cursor_poll_seconds
        : 30,
    webhook_token_set: value.webhook_token_set === true,
    cursor_api_key_set: value.cursor_api_key_set === true,
  };
}

async function readBody(response: Response): Promise<unknown> {
  return response.json();
}

export async function fetchStatus(): Promise<DeskStatus> {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error(`status ${response.status}`);
  }
  return parseStatus(await readBody(response));
}

export async function fetchConfig(): Promise<PublicConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`config ${response.status}`);
  }
  return parseConfig(await readBody(response));
}

export async function postWebhook(body: WebhookBody): Promise<void> {
  const response = await fetch("/api/webhook/grok-bot", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorizationHeader() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`webhook ${response.status}`);
  }
}

export async function postDismiss(): Promise<void> {
  const response = await fetch("/api/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorizationHeader() },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`dismiss ${response.status}`);
  }
}

export async function putConfig(patch: ConfigPatch): Promise<void> {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authorizationHeader() },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`config ${response.status}`);
  }
}
