import { describe, expect, it, vi } from "vitest";
import { DeskStore, FRAME_MAX, type Snapshot } from "../../src/server/store";

function clock(start = "2026-10-07T12:00:00Z") {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance: (seconds: number) => {
      t += seconds * 1000;
    },
  };
}

describe("DeskStore", () => {
  it("goes launched, needs_you, dismissed", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "a1",
      title: "Scaffold",
    });
    expect(store.status().phase).toBe("running");
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "Pick one",
    });
    expect(store.status()).toMatchObject({
      phase: "needs_you",
      needs_you: true,
    });
    store.dismiss();
    const after = store.status();
    expect(after).toMatchObject({ phase: "running", needs_you: false });
    expect(after.last_event).toMatchObject({
      type: "note",
      source: "manual",
      title: "",
      message: "",
    });
  });

  it("orders waiting agents first, then newest", () => {
    const row = (
      id: string,
      status: "running" | "idle",
      at: string,
      attention = false,
    ) => ({
      id,
      title: id.toUpperCase(),
      status,
      updated_at: at,
      color: "",
      shape: "",
      icon: "",
      attention,
      message: "",
      source: "grok-bot",
    });
    const snapshot: Snapshot = {
      events: [],
      unread: 0,
      agents: [
        row("m", "running", "2026-10-05T12:00:00Z"),
        row("z", "running", "2026-10-05T09:00:00Z", true),
        row("a", "running", "2026-10-05T12:00:00Z"),
        row("b", "idle", "2026-10-05T15:00:00Z"),
        row("n", "running", "2026-10-05T10:00:00Z", true),
      ],
    };
    const store = new DeskStore({
      snapshot,
      now: clock("2026-10-05T12:01:00Z").now,
    });
    expect(store.status().agents.map((a) => a.id)).toEqual([
      "n",
      "z",
      "b",
      "a",
      "m",
    ]);
  });

  it("returns every stored agent", () => {
    const store = new DeskStore({ now: clock().now });
    for (let i = 0; i < 17; i++) {
      const id = `a${String(i).padStart(2, "0")}`;
      store.applyEvent({
        type: "agent.launched",
        agent_id: id,
        title: `Agent ${i}`,
      });
    }
    const agents = store.status().agents;
    expect(agents).toHaveLength(17);
    expect(agents[0]?.id).toBe("a00");
    expect(agents[16]).toMatchObject({ id: "a16", title: "Agent 16" });
  });

  it("counts unread as waiting agents and clears with them", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "one",
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "b2",
      message: "two",
    });
    expect(store.status().unread).toBe(2);
    store.dismiss();
    expect(store.status().unread).toBe(0);
  });

  it("keeps a note out of the roster and finishes to idle", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "note", message: "hi" });
    expect(store.status()).toMatchObject({ agents: [], unread: 1 });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    store.applyEvent({ type: "agent.finished", agent_id: "a1" });
    expect(store.status().agents[0]?.status).toBe("idle");
  });

  it("rejects unknown types and agent events without an id", () => {
    const store = new DeskStore();
    expect(() => store.applyEvent({ type: "nope", agent_id: "a1" })).toThrow(
      "unknown event type",
    );
    expect(() => store.applyEvent({ type: "agent.launched" })).toThrow(
      "agent_id required",
    );
  });

  it("caps events at 50", () => {
    const store = new DeskStore({ now: clock().now });
    for (let i = 0; i < 60; i++)
      store.applyEvent({ type: "note", message: `n${i}` });
    const events = store.status().events;
    expect(events).toHaveLength(50);
    expect(events[0]?.message).toBe("n59");
  });

  it("does not let cursor clear needs_you", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "wait",
    });
    expect(
      store.applyCursorItem("a1", "Cursor", "idle", "2026-10-07T12:00:05Z"),
    ).toBe(false);
    expect(store.status().phase).toBe("needs_you");
  });

  it("treats a repeated launch as a standing ping", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    expect(store.status().events).toHaveLength(1);
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "q" });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    const body = store.status();
    expect(body.phase).toBe("needs_you");
    expect(body.events).toHaveLength(2);
  });

  it("ages a silent running agent to idle after 120 s", () => {
    const c = clock();
    const store = new DeskStore({ now: c.now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    c.advance(121);
    expect(store.status()).toMatchObject({
      phase: "idle",
      agents: [{ status: "idle" }],
    });
  });

  it("dismisses one named agent and ignores a name that matches nobody", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "one",
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "b2",
      message: "two",
    });
    store.dismiss("zz");
    expect(store.status().unread).toBe(2);
    store.dismiss("a1");
    const body = store.status();
    expect(body.unread).toBe(1);
    expect(body.agents.find((a) => a.id === "b2")?.attention).toBe(true);
    expect(body.agents.find((a) => a.id === "a1")?.attention).toBe(false);
  });

  it("keeps a single waiter's question on last_event", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "a1",
      title: "Scaffold",
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "Pick one",
    });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "b2",
      title: "Builder",
    });
    expect(store.status().last_event).toMatchObject({
      type: "agent.launched",
      agent_id: "a1",
      title: "Scaffold",
      message: "Pick one",
    });
  });

  it("stores one frame and clears the capture flag", () => {
    const store = new DeskStore();
    store.requestFrame();
    expect(store.status().capture).toBe(true);
    expect(store.saveFrame(Buffer.from("XX"))).toBe("bad");
    expect(store.saveFrame(Buffer.alloc(FRAME_MAX + 1))).toBe("too_big");
    expect(store.status().capture).toBe(true);
    const bmp = Buffer.from("BM1234");
    expect(store.saveFrame(bmp)).toBe("ok");
    expect(store.status().capture).toBe(false);
    expect(store.frame()?.equals(bmp)).toBe(true);
  });

  it("clips identity and lowercases the shape", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "a1",
      shape: "  DiamondDiamondDiamond ",
      color: " #9bb57a ",
    });
    expect(store.status().agents[0]).toMatchObject({
      shape: "diamonddiamonddi",
      color: "#9bb57a",
    });
  });

  it("round-trips through a snapshot and reports every change", () => {
    const onChange = vi.fn();
    const c = clock();
    const store = new DeskStore({ now: c.now, onChange });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      title: "A",
      message: "q",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const copy = new DeskStore({ now: c.now, snapshot: store.snapshot() });
    expect(copy.status()).toEqual(store.status());
  });

  it("remembers where each agent's last update came from", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "g1",
      title: "Desky",
    });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "m1",
      title: "Test",
      source: "manual",
    });
    store.applyCursorItem("c1", "Fix tests", "running", "2026-10-07T12:00:00Z");
    const sources = Object.fromEntries(
      store.status(true).agents.map((a) => [a.id, a.source]),
    );
    expect(sources).toEqual({ g1: "grok-bot", m1: "manual", c1: "cursor" });
  });

  it("keeps source out of the panel's status unless asked", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "g1",
      title: "Desky",
    });
    expect(Object.keys(store.status().agents[0] ?? {})).not.toContain("source");
    expect(Object.keys(store.status(true).agents[0] ?? {})).toContain("source");
  });

  it("lets a running agent go idle after the timeout, which can be longer", () => {
    const c = clock();
    let ttlMs = 120_000;
    const store = new DeskStore({ now: c.now, runningTtlMs: () => ttlMs });
    store.applyEvent({ type: "agent.launched", agent_id: "a1", title: "Bot" });
    c.advance(119);
    expect(store.status().agents[0]?.status).toBe("running");
    c.advance(2);
    expect(store.status().agents[0]?.status).toBe("idle");
    // A routine that can only ping every 5 minutes needs a longer window.
    ttlMs = 600_000;
    c.advance(-121);
    store.applyEvent({ type: "agent.launched", agent_id: "a2", title: "Slow" });
    c.advance(300);
    expect(store.status().agents.find((a) => a.id === "a2")?.status).toBe(
      "running",
    );
    c.advance(301);
    expect(store.status().agents.find((a) => a.id === "a2")?.status).toBe(
      "idle",
    );
  });
});

describe("DeskStore agent titles", () => {
  const agents = (store: DeskStore) =>
    store.status().agents.map((a) => [a.id, a.title, a.status]);

  it("retires an idle agent when the same title arrives under a new id", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "scaffold",
      title: "Scaffold",
    });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "a3d2b1ed",
      title: "scaffold ",
    });
    expect(agents(store)).toEqual([["a3d2b1ed", "scaffold ", "running"]]);
  });

  it("keeps a running or waiting agent that shares the title", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "one",
      title: "Scaffold",
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "two",
      title: "Scaffold",
      message: "Pick one",
    });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "three",
      title: "Scaffold",
    });
    expect(
      store
        .status()
        .agents.map((a) => a.id)
        .sort(),
    ).toEqual(["one", "three", "two"]);
  });

  it("does not merge agents from different sources", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "cursor-1",
      title: "Scaffold",
      source: "cursor",
    });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "bot-1",
      title: "Scaffold",
    });
    expect(store.status().agents).toHaveLength(2);
  });

  it("drops a replayed event that would bring back an older same-title record", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "uuid-1",
      title: "Scaffold",
    });
    expect(
      store.applyReplayed(
        { type: "agent.finished", agent_id: "scaffold", title: "Scaffold" },
        "2026-10-07T11:00:00Z",
      ),
    ).toBe("stale");
    expect(agents(store)).toEqual([["uuid-1", "Scaffold", "idle"]]);
  });

  it("never merges Cursor agents that share a title", () => {
    const store = new DeskStore({ now: clock().now });
    for (const id of ["a", "b", "a", "b"])
      store.applyEvent({
        type: "agent.finished",
        agent_id: id,
        title: "Untitled",
        source: "cursor",
      });
    expect(store.status().agents).toHaveLength(2);
  });

  it("treats an empty source as grok-bot on both sides", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "old",
      title: "Scaffold",
      source: "",
    });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "new",
      title: "Scaffold",
    });
    expect(agents(store)).toEqual([["new", "Scaffold", "running"]]);
  });

  // Both ids already exist, as in a state saved before the dedupe: the new-id rule never fires.
  const bothKnown = () => {
    const c = clock("2026-10-07T12:00:00Z");
    const row = (id: string, status: "idle" | "running", at: string) => ({
      id,
      title: "Scaffold",
      status,
      updated_at: at,
      color: "",
      shape: "",
      icon: "",
      attention: false,
      message: "",
      source: "grok-bot",
    });
    const snapshot: Snapshot = {
      events: [],
      unread: 0,
      agents: [
        row("scaffold", "idle", "2026-10-07T11:00:00Z"),
        row("uuid-1", "idle", "2026-10-07T11:30:00Z"),
      ],
    };
    return { store: new DeskStore({ snapshot, now: c.now }), c };
  };

  it("retires an idle namesake on a live event even when both ids are already known", () => {
    const { store, c } = bothKnown();
    expect(store.status().agents).toHaveLength(2);
    c.advance(1);
    store.applyEvent({
      type: "agent.launched",
      agent_id: "scaffold",
      title: "Scaffold",
    });
    expect(agents(store)).toEqual([["scaffold", "Scaffold", "running"]]);
  });

  it("lets the most recent reporter win when the bot switches ids back and forth", () => {
    const { store, c } = bothKnown();
    for (const id of ["scaffold", "uuid-1", "scaffold", "uuid-1"]) {
      c.advance(1);
      store.applyEvent({
        type: "agent.finished",
        agent_id: id,
        title: "Scaffold",
      });
      expect(store.status().agents.map((a) => a.id)).toEqual([id]);
    }
  });

  it("matches the namesake by the stored title when the event carries none", () => {
    const { store, c } = bothKnown();
    c.advance(1);
    store.applyEvent({ type: "agent.finished", agent_id: "uuid-1" });
    expect(store.status().agents.map((a) => a.id)).toEqual(["uuid-1"]);
  });

  it("still keeps a running or waiting namesake when a known id reports", () => {
    const c = clock();
    const store = new DeskStore({ now: c.now });
    store.applyEvent({
      type: "agent.launched",
      agent_id: "a",
      title: "Scaffold",
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "b",
      title: "Scaffold",
      message: "Pick one",
    });
    c.advance(1);
    store.applyEvent({
      type: "agent.launched",
      agent_id: "a",
      title: "Scaffold",
    });
    expect(
      store
        .status()
        .agents.map((a) => a.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("drops a replay of a known id that is older than a namesake's latest report", () => {
    const { store } = bothKnown();
    // uuid-1 reported at 11:30. A replay for scaffold at 11:20 is newer than scaffold's own 11:00
    // but older than the namesake, so it must not light the row again.
    expect(
      store.applyReplayed(
        { type: "agent.finished", agent_id: "scaffold", title: "Scaffold" },
        "2026-10-07T11:20:00Z",
      ),
    ).toBe("stale");
  });

  it("keeps agents with no title apart", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.finished", agent_id: "x" });
    store.applyEvent({ type: "agent.finished", agent_id: "y" });
    expect(store.status().agents).toHaveLength(2);
  });

  it("does not retire an agent that reports again under its own id", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "a",
      title: "Scaffold",
    });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "a",
      title: "Scaffold",
    });
    expect(store.status().agents).toHaveLength(1);
  });
});

describe("DeskStore replayed events", () => {
  const launch = { type: "agent.launched", agent_id: "a1", title: "Scaffold" };

  it("stamps a replayed event with its own time, so an old launch is not running", () => {
    const store = new DeskStore({ now: clock("2026-10-07T12:00:00Z").now });
    store.applyEvent(launch, "2026-10-07T09:00:00Z");
    expect(store.status().phase).toBe("idle");
    expect(store.status().agents[0]?.updated_at).toBe("2026-10-07T09:00:00Z");
    expect(store.status().events[0]?.at).toBe("2026-10-07T09:00:00Z");
  });

  it("keeps an old needs_you waiting, since the person still has to answer", () => {
    const store = new DeskStore({ now: clock("2026-10-07T12:00:00Z").now });
    store.applyEvent(
      { type: "agent.needs_you", agent_id: "a1", message: "Pick one" },
      "2026-10-07T09:00:00Z",
    );
    expect(store.status().phase).toBe("needs_you");
  });

  it("ignores a replayed event older than what the agent already shows", () => {
    const store = new DeskStore({ now: clock("2026-10-07T12:00:00Z").now });
    store.applyEvent({
      type: "agent.finished",
      agent_id: "a1",
      title: "Scaffold",
    });
    const before = store.snapshot();
    store.applyEvent(launch, "2026-10-07T09:00:00Z");
    expect(store.snapshot()).toEqual(before);
  });

  it("clamps a time in the future to now", () => {
    const store = new DeskStore({ now: clock("2026-10-07T12:00:00Z").now });
    store.applyEvent(launch, "2030-01-01T00:00:00Z");
    expect(store.status().agents[0]?.updated_at).toBe("2026-10-07T12:00:00Z");
  });

  it("falls back to now for a time that is not a stamp", () => {
    const store = new DeskStore({ now: clock("2026-10-07T12:00:00Z").now });
    store.applyEvent(launch, "yesterday");
    expect(store.status().agents[0]?.updated_at).toBe("2026-10-07T12:00:00Z");
  });
});

describe("DeskStore applyReplayed", () => {
  it("says when it dropped a replay as stale", () => {
    const store = new DeskStore({ now: clock("2026-10-07T12:00:00Z").now });
    store.applyEvent({ type: "agent.finished", agent_id: "a1" });
    expect(
      store.applyReplayed(
        { type: "agent.launched", agent_id: "a1" },
        "2026-10-07T09:00:00Z",
      ),
    ).toBe("stale");
    expect(
      store.applyReplayed(
        { type: "agent.launched", agent_id: "a2" },
        "2026-10-07T09:00:00Z",
      ),
    ).toBe("applied");
  });

  it("does not bring back a note the person already cleared", () => {
    const c = clock("2026-10-07T12:00:00Z");
    const store = new DeskStore({ now: c.now });
    store.applyEvent({ type: "note", message: "FYI" });
    c.advance(60);
    store.clearUnread();
    expect(
      store.applyReplayed(
        { type: "note", message: "FYI" },
        "2026-10-07T12:00:00Z",
      ),
    ).toBe("stale");
    expect(store.status().unread).toBe(0);
  });

  it("still takes a note newer than the last clear", () => {
    const c = clock("2026-10-07T12:00:00Z");
    const store = new DeskStore({ now: c.now });
    store.clearUnread();
    c.advance(600);
    expect(
      store.applyReplayed(
        { type: "note", message: "New" },
        "2026-10-07T12:05:00Z",
      ),
    ).toBe("applied");
    expect(store.status().unread).toBe(1);
  });
});
