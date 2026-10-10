import { randomUUID } from "node:crypto";

export const AGENT_TYPES = new Set([
  "agent.launched",
  "agent.finished",
  "agent.needs_you",
]);
export const EVENT_CAP = 50;
export const COLOR_LIMIT = 32;
export const SHAPE_LIMIT = 16;
export const ICON_LIMIT = 200;
// A launch POST that nobody refreshes must not pin the desk on the 2 s poll.
export const RUNNING_TTL_MS = 120_000;
// One 480x480 RGB565 BMP plus the 66-byte header and a little slack.
export const FRAME_MAX = 480 * 480 * 2 + 256;

export class StoreError extends Error {}

export interface EventIn {
  type: string;
  agent_id?: string;
  title?: string;
  message?: string;
  source?: string;
  color?: string;
  shape?: string;
  icon?: string;
}

export interface DeskEvent {
  id: string;
  type: string;
  agent_id: string;
  title: string;
  message: string;
  source: string;
  at: string;
  color: string;
  shape: string;
  icon: string;
}

export interface AgentRecord {
  id: string;
  title: string;
  status: "running" | "idle";
  updated_at: string;
  color: string;
  shape: string;
  icon: string;
  // Awaiting the user. Independent of running/idle so a finish does not drop the lamp.
  attention: boolean;
  message: string;
  // Where the last update came from: grok-bot, cursor, or manual.
  source: string;
}

export type Phase = "idle" | "running" | "needs_you";

export interface PublicAgent {
  id: string;
  title: string;
  status: Phase;
  attention: boolean;
  message: string;
  updated_at: string;
  color: string;
  shape: string;
  icon: string;
  /** Only on a detail request. The panel's status never carries it. */
  source?: string;
}

export interface StatusBody {
  phase: Phase;
  needs_you: boolean;
  unread: number;
  capture: boolean;
  agents: PublicAgent[];
  last_event: DeskEvent | null;
  events: DeskEvent[];
}

export interface Snapshot {
  events: DeskEvent[];
  agents: AgentRecord[];
  unread: number;
}

export interface StoreOptions {
  now?: () => Date;
  /** Read on every status, so a change applies without a restart. */
  runningTtlMs?: () => number;
  snapshot?: Snapshot | null;
  onChange?: (snapshot: Snapshot) => void;
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function clipText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function clipShape(value: unknown): string {
  return clipText(value, SHAPE_LIMIT).toLowerCase();
}

/** Panel headline. A dismiss acknowledgement is not one. */
export function faceEventTitle(title: string, message = ""): string {
  return title === "Dismissed" && !message ? "" : title;
}

/** Python's str() of a JSON value, which the old companion stored. */
function pyStr(value: unknown, fallback = ""): string {
  if (value === undefined) return fallback;
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export function eventIn(payload: Record<string, unknown>): EventIn {
  return {
    type: pyStr(payload.type),
    agent_id: pyStr(payload.agent_id),
    title: pyStr(payload.title),
    message: pyStr(payload.message),
    source: pyStr(payload.source, "grok-bot"),
    color: clipText(payload.color, COLOR_LIMIT),
    shape: clipShape(payload.shape),
    icon: clipText(payload.icon, ICON_LIMIT),
  };
}

export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function makeEvent(fields: Omit<DeskEvent, "id">): DeskEvent {
  return {
    id: randomUUID(),
    type: fields.type,
    agent_id: fields.agent_id,
    title: fields.title,
    message: fields.message,
    source: fields.source,
    at: fields.at,
    color: fields.color,
    shape: fields.shape,
    icon: fields.icon,
  };
}

function publicEvent(event: DeskEvent): DeskEvent {
  return { ...event, title: faceEventTitle(event.title, event.message) };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class DeskStore {
  private events: DeskEvent[] = [];
  private agents = new Map<string, AgentRecord>();
  private unread = 0;
  private capture = false;
  // When unread was last cleared. A replayed note from before it stays gone.
  private noteFloor = "";
  private frameBytes: Buffer | null = null;
  private readonly now: () => Date;
  private readonly runningTtlMs: () => number;
  private readonly onChange: (snapshot: Snapshot) => void;

  constructor(opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.runningTtlMs = opts.runningTtlMs ?? (() => RUNNING_TTL_MS);
    this.onChange = opts.onChange ?? (() => undefined);
    if (opts.snapshot) {
      this.events = opts.snapshot.events
        .slice(0, EVENT_CAP)
        .map((e) => ({ ...e }));
      for (const agent of opts.snapshot.agents)
        this.agents.set(agent.id, { ...agent });
      this.unread = Math.max(0, opts.snapshot.unread);
    }
  }

  snapshot(): Snapshot {
    return {
      events: this.events.map((e) => ({ ...e })),
      agents: [...this.agents.values()].map((a) => ({ ...a })),
      unread: this.unread,
    };
  }

  /**
   * `at` is for the relay, which replays events that happened while the app
   * was off. The webhook never passes it, so a caller cannot back-date itself.
   * A replay older than what the agent already shows is dropped.
   */
  applyEvent(raw: EventIn, at?: string): DeskEvent {
    return this.ingest(raw, at).event;
  }

  /** Apply an event that happened at `at`. "stale" means it changed nothing. */
  applyReplayed(raw: EventIn, at: string): "applied" | "stale" {
    return this.ingest(raw, at).stale ? "stale" : "applied";
  }

  private ingest(
    raw: EventIn,
    at?: string,
  ): { event: DeskEvent; stale: boolean } {
    const agentId = raw.agent_id ?? "";
    if (!AGENT_TYPES.has(raw.type) && raw.type !== "note")
      throw new StoreError("unknown event type");
    if (AGENT_TYPES.has(raw.type) && !agentId)
      throw new StoreError("agent_id required");
    const stamp = at === undefined ? this.stamp() : this.replayStamp(at);
    const known = this.agents.get(agentId);
    const behind = known ? stamp < known.updated_at : false;
    // A note has no agent, so it is stale when the person cleared unread since.
    const cleared = raw.type === "note" && stamp <= this.noteFloor;
    if (at !== undefined && (behind || cleared))
      return { event: this.stale(raw, stamp), stale: true };
    const title = raw.title ?? "";
    const message = raw.message ?? "";
    const event = makeEvent({
      type: raw.type,
      agent_id: agentId,
      title,
      message,
      source: raw.source ?? "grok-bot",
      at: stamp,
      color: clipText(raw.color ?? "", COLOR_LIMIT),
      shape: clipShape(raw.shape ?? ""),
      icon: clipText(raw.icon ?? "", ICON_LIMIT),
    });
    // A standing launch ping refreshes updated_at and must not flood the log,
    // bump unread, or clear attention.
    if (raw.type === "agent.launched") {
      const current = this.agents.get(agentId);
      if (current && (current.status === "running" || current.attention)) {
        const changed = Boolean(message) && message !== current.message;
        this.touch(
          agentId,
          title,
          event,
          "running",
          current.attention,
          message || null,
        );
        if (changed) this.remember(event);
        this.persist();
        return { event, stale: false };
      }
    }
    if (raw.type === "agent.finished") {
      const waiting = this.agents.get(agentId)?.attention === true;
      this.remember(event);
      // Keep the question up while they are still waiting.
      this.touch(agentId, title, event, "idle", waiting, waiting ? null : "");
      this.persist();
      return { event, stale: false };
    }
    if (raw.type === "note" && message) this.unread = 1;
    this.remember(event);
    if (raw.type === "agent.needs_you") {
      // The question is `message`. A title here must not rename the agent to the question.
      const named = this.agents.has(agentId) ? "" : title;
      this.touch(agentId, named, event, "running", true, message || null);
    } else if (raw.type === "agent.launched") {
      this.touch(agentId, title, event, "running", false, message || null);
    }
    this.persist();
    return { event, stale: false };
  }

  dismiss(agentId = ""): void {
    const at = this.stamp();
    let cleared = false;
    for (const agent of this.agents.values()) {
      if (!agent.attention) continue;
      if (agentId && agent.id !== agentId) continue;
      agent.attention = false;
      agent.message = "";
      if (agent.status === "running") agent.updated_at = at;
      cleared = true;
    }
    const still = [...this.agents.values()].some((a) => a.attention);
    // A named dismiss that matched nobody must not clear the others.
    if (agentId && !cleared) return;
    if (still) {
      this.persist();
      return;
    }
    this.unread = 0;
    this.noteFloor = at;
    this.remember(
      makeEvent({
        type: "note",
        agent_id: "",
        title: "",
        message: "",
        source: "manual",
        at,
        color: "",
        shape: "",
        icon: "",
      }),
    );
    this.persist();
  }

  requestFrame(): void {
    this.capture = true;
  }

  /** Store one BMP. "too_big" and "bad" leave the previous frame and the flag. */
  saveFrame(body: Buffer): "ok" | "too_big" | "bad" {
    if (body.length > FRAME_MAX) return "too_big";
    if (body.length < 2 || body[0] !== 0x42 || body[1] !== 0x4d) return "bad";
    this.frameBytes = Buffer.from(body);
    this.capture = false;
    return "ok";
  }

  frame(): Buffer | null {
    return this.frameBytes;
  }

  clearUnread(): void {
    if (this.unread === 0) return;
    this.unread = 0;
    this.noteFloor = this.stamp();
    this.persist();
  }

  /** `detail` adds each agent's source. Only the app asks for it. */
  status(detail = false): StatusBody {
    // attention, then newest updated_at. Two needs_you in one second follow
    // event order (later event first). id is the last tie. Stable sorts keep
    // the earlier key, exactly like the Python companion.
    const recent = new Map<string, number>();
    this.events.forEach((event, index) => {
      if (event.agent_id && !recent.has(event.agent_id))
        recent.set(event.agent_id, index);
    });
    const tail = this.events.length;
    const ordered = [...this.agents.values()].sort((a, b) =>
      compare(a.id, b.id),
    );
    const waitKey = (a: AgentRecord) =>
      a.attention ? (recent.get(a.id) ?? tail) : 0;
    ordered.sort((a, b) => waitKey(a) - waitKey(b));
    ordered.sort((a, b) => compare(b.updated_at, a.updated_at));
    ordered.sort((a, b) => Number(!a.attention) - Number(!b.attention));
    const now = this.now().getTime();
    const agents: PublicAgent[] = ordered.map((agent) => ({
      id: agent.id,
      title: agent.title,
      status: visibleStatus(agent, now, this.runningTtlMs()),
      attention: agent.attention,
      message: agent.message,
      updated_at: agent.updated_at,
      color: agent.color,
      shape: agent.shape,
      icon: agent.icon,
      ...(detail ? { source: agent.source } : {}),
    }));
    const statuses = new Set(agents.map((a) => a.status));
    const phase: Phase = statuses.has("needs_you")
      ? "needs_you"
      : statuses.has("running")
        ? "running"
        : "idle";
    const unread = this.reportedUnread();
    if (unread === 0 && this.unread !== 0) {
      this.unread = 0;
      this.persist();
    }
    return {
      phase,
      needs_you: phase === "needs_you",
      unread,
      // Before agents: a 16 KB panel buffer drops the tail.
      capture: this.capture,
      agents,
      last_event: this.faceLast(),
      events: this.events.map(publicEvent),
    };
  }

  applyCursorItem(
    agentId: string,
    name: string,
    mapped: string,
    at: string,
    color = "",
    shape = "",
    icon = "",
  ): boolean {
    if (mapped !== "running" && mapped !== "idle")
      throw new StoreError("cursor status must be running or idle");
    const current = this.agents.get(agentId);
    if (current?.attention) return false;
    if (current && current.status === mapped) {
      // Same status is the heartbeat. A newer stamp keeps the row from aging out.
      if (mapped === "running" && at > current.updated_at) {
        current.updated_at = at;
        this.persist();
      }
      return false;
    }
    const event = makeEvent({
      type: mapped === "running" ? "agent.launched" : "agent.finished",
      agent_id: agentId,
      title: name,
      message: "",
      source: "cursor",
      at,
      color: clipText(color, COLOR_LIMIT),
      shape: clipShape(shape),
      icon: clipText(icon, ICON_LIMIT),
    });
    this.remember(event);
    this.touch(agentId, name, event, mapped, false);
    this.persist();
    return true;
  }

  private stamp(): string {
    return isoSeconds(this.now());
  }

  /** A replay time is never later than now, and a malformed one counts as now. */
  private replayStamp(at: string): string {
    const now = this.stamp();
    return STAMP.test(at) && at < now ? at : now;
  }

  private stale(raw: EventIn, at: string): DeskEvent {
    return makeEvent({
      type: raw.type,
      agent_id: raw.agent_id ?? "",
      title: raw.title ?? "",
      message: raw.message ?? "",
      source: raw.source ?? "grok-bot",
      at,
      color: "",
      shape: "",
      icon: "",
    });
  }

  private persist(): void {
    this.onChange(this.snapshot());
  }

  private remember(event: DeskEvent): void {
    this.events.unshift(event);
    this.events.length = Math.min(this.events.length, EVENT_CAP);
  }

  private touch(
    agentId: string,
    title: string,
    event: DeskEvent,
    status: "running" | "idle",
    attention: boolean,
    message: string | null = null,
  ): void {
    const current = this.agents.get(agentId);
    this.agents.set(agentId, {
      id: agentId,
      title: title || current?.title || "",
      status,
      updated_at: event.at,
      color: event.color || current?.color || "",
      shape: event.shape || current?.shape || "",
      icon: event.icon || current?.icon || "",
      attention,
      message: message ?? current?.message ?? "",
      source: event.source || current?.source || "",
    });
  }

  /** Badge equals waiting agents. A note counts only when nothing is waiting. */
  private reportedUnread(): number {
    const waiters = [...this.agents.values()].filter((a) => a.attention).length;
    if (waiters) return waiters;
    const last = this.events[0];
    if (last && last.type === "note" && last.message && this.unread) return 1;
    return 0;
  }

  /**
   * Last event the face matches onto a row. One waiting agent keeps their
   * question on that row even when a later event has no text.
   */
  private faceLast(): DeskEvent | null {
    const first = this.events[0];
    if (!first) return null;
    const data = publicEvent(first);
    const waiters = [...this.agents.values()].filter(
      (a) => a.attention && a.message,
    );
    const only = waiters.length === 1 ? waiters[0] : undefined;
    if (only) {
      data.agent_id = only.id;
      data.title = only.title || only.id;
      data.message = only.message;
      return data;
    }
    if (data.message && data.agent_id) {
      const agent = this.agents.get(data.agent_id);
      const bound = agent ? agent.title || agent.id : "";
      if (
        agent &&
        bound &&
        data.title !== agent.title &&
        data.title !== agent.id
      )
        data.title = bound;
    }
    return data;
  }
}

function visibleStatus(agent: AgentRecord, now: number, ttlMs: number): Phase {
  if (agent.attention) return "needs_you";
  if (agent.status !== "running") return "idle";
  if (!STAMP.test(agent.updated_at)) return agent.status;
  return now - Date.parse(agent.updated_at) > ttlMs ? "idle" : "running";
}
