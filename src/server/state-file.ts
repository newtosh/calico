import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentRecord, DeskEvent, Snapshot } from "./store";

// ponytail: whole-file JSON snapshot on every change. The store holds at most
// 50 events and a few dozen agents. Move to SQLite if history ever needs queries.

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function eventFrom(value: unknown): DeskEvent {
  if (!isRecord(value)) throw new Error("bad event");
  return {
    id: str(value.id),
    type: str(value.type),
    agent_id: str(value.agent_id),
    title: str(value.title),
    message: str(value.message),
    source: str(value.source),
    at: str(value.at),
    color: str(value.color),
    shape: str(value.shape),
    icon: str(value.icon),
  };
}

function agentFrom(value: unknown): AgentRecord {
  if (!isRecord(value) || typeof value.id !== "string")
    throw new Error("bad agent");
  return {
    id: value.id,
    title: str(value.title),
    status: value.status === "running" ? "running" : "idle",
    updated_at: str(value.updated_at),
    color: str(value.color),
    shape: str(value.shape),
    icon: str(value.icon),
    attention: value.attention === true,
    message: str(value.message),
  };
}

export function parseSnapshot(value: unknown): Snapshot {
  if (
    !isRecord(value) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.agents)
  ) {
    throw new Error("bad snapshot");
  }
  return {
    events: value.events.map(eventFrom),
    agents: value.agents.map(agentFrom),
    unread:
      typeof value.unread === "number" && value.unread > 0
        ? Math.floor(value.unread)
        : 0,
  };
}

export function loadSnapshot(path: string): Snapshot | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return parseSnapshot(JSON.parse(text));
  } catch {
    renameSync(path, `${path}.bad`);
    return null;
  }
}

export function saveSnapshot(path: string, snapshot: Snapshot): void {
  writeAtomic(path, JSON.stringify(snapshot));
}
