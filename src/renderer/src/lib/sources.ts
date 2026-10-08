import type { DeskAgent, DeskEvent } from "./api";

export type SourceFilter = "combined" | "grok" | "cursor";

const KEY = "calico.sourceFilter";

/** Cursor polling is its own source. Everything else is a Grok Bot routine or a manual test. */
export function sourceOf(source: string): "grok" | "cursor" {
  return source === "cursor" ? "cursor" : "grok";
}

export function matchesFilter(source: string, filter: SourceFilter): boolean {
  return filter === "combined" || sourceOf(source) === filter;
}

/**
 * The agent's own source, else its latest event's, else Grok Bot. State saved
 * before agents carried a source has none, and events are capped at 50, so an
 * old Cursor agent can count as Grok Bot until its next poll sets it.
 */
export function agentSource(agent: DeskAgent, events: DeskEvent[]): string {
  if (agent.source) return agent.source;
  return events.find((e) => e.agent_id === agent.id)?.source || "grok-bot";
}

export function loadFilter(): SourceFilter {
  try {
    const value = localStorage.getItem(KEY);
    return value === "grok" || value === "cursor" ? value : "combined";
  } catch {
    return "combined";
  }
}

export function saveFilter(filter: SourceFilter): void {
  try {
    localStorage.setItem(KEY, filter);
  } catch {
    // Blocked storage only costs the remembered choice.
  }
}
