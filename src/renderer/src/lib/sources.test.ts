import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeskAgent, DeskEvent } from "./api";
import {
  agentSource,
  loadFilter,
  matchesFilter,
  saveFilter,
  sourceOf,
} from "./sources";

afterEach(() => vi.unstubAllGlobals());

const agent = (id: string, source = ""): DeskAgent => ({
  id,
  title: id,
  status: "running",
  attention: false,
  message: "",
  updated_at: "2026-10-08T12:00:00Z",
  color: "",
  shape: "",
  icon: "",
  source,
});
const event = (agent_id: string, source: string): DeskEvent => ({
  id: `${agent_id}-${source}`,
  type: "agent.launched",
  agent_id,
  title: "",
  message: "",
  source,
  at: "2026-10-08T12:00:00Z",
});

describe("sources", () => {
  it("sorts every source into Cursor or Grok Bot", () => {
    expect(sourceOf("cursor")).toBe("cursor");
    for (const s of ["grok-bot", "manual", "scaffold", ""])
      expect(sourceOf(s)).toBe("grok");
  });

  it("filters", () => {
    expect(matchesFilter("cursor", "combined")).toBe(true);
    expect(matchesFilter("grok-bot", "combined")).toBe(true);
    expect(matchesFilter("cursor", "cursor")).toBe(true);
    expect(matchesFilter("grok-bot", "cursor")).toBe(false);
    expect(matchesFilter("cursor", "grok")).toBe(false);
    expect(matchesFilter("manual", "grok")).toBe(true);
  });

  it("uses the agent's own source, then its latest event, then Grok Bot", () => {
    expect(agentSource(agent("a", "cursor"), [])).toBe("cursor");
    expect(agentSource(agent("a"), [event("a", "cursor")])).toBe("cursor");
    expect(agentSource(agent("a"), [event("b", "cursor")])).toBe("grok-bot");
  });

  it("remembers the choice and falls back to Combined", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadFilter()).toBe("combined");
    saveFilter("cursor");
    expect(loadFilter()).toBe("cursor");
    store.set("calico.sourceFilter", "nonsense");
    expect(loadFilter()).toBe("combined");
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadFilter()).toBe("combined");
    expect(() => saveFilter("grok")).not.toThrow();
  });
});
