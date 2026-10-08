import { describe, expect, it, vi } from "vitest";
import {
  CursorState,
  mapCursorStatus,
  pollOnce,
} from "../../src/server/cursor-poll";
import { DeskStore } from "../../src/server/store";

const NOW = "2026-10-07T12:00:00Z";

describe("cursor poll", () => {
  it("maps statuses", () => {
    expect(mapCursorStatus("active")).toBe("running");
    expect(mapCursorStatus("IDLE")).toBe("idle");
    expect(mapCursorStatus("archived")).toBe("idle");
    expect(mapCursorStatus("error")).toBeNull();
  });

  it("applies items and forwards identity", async () => {
    const store = new DeskStore({ now: () => new Date(NOW) });
    const body = JSON.stringify({
      items: [
        {
          id: "c1",
          name: "Fix tests",
          status: "ACTIVE",
          color: "#9bb57a",
          shape: "Square",
        },
        { id: "", name: "skip", status: "ACTIVE" },
        { id: "c2", name: "weird", status: "ERROR" },
        "junk",
      ],
    });
    await pollOnce(store, "key", async () => body, NOW);
    expect(store.status().agents).toMatchObject([
      {
        id: "c1",
        title: "Fix tests",
        status: "running",
        color: "#9bb57a",
        shape: "square",
      },
    ]);
  });

  it("does nothing without a key", async () => {
    const get = vi.fn();
    await pollOnce(new DeskStore(), "", get, NOW);
    expect(get).not.toHaveBeenCalled();
  });

  it("logs a transport error and keeps going", async () => {
    const warn = vi.fn();
    await pollOnce(
      new DeskStore(),
      "key",
      async () => {
        throw new Error("boom");
      },
      NOW,
      warn,
    );
    expect(warn).toHaveBeenCalledWith("cursor poll failed: boom");
  });

  it("reports how many agents a poll listed", async () => {
    const body = JSON.stringify({
      items: [
        { id: "c1", name: "A", status: "ACTIVE" },
        { id: "c2", name: "B", status: "IDLE" },
        { id: "c3", name: "C", status: "ERROR" },
      ],
    });
    expect(
      await pollOnce(new DeskStore(), "key", async () => body, NOW),
    ).toEqual({ ok: true, agents: 2 });
  });

  it("says nothing when there is no key", async () => {
    expect(await pollOnce(new DeskStore(), "", vi.fn(), NOW)).toBeNull();
  });

  it("explains a rejected key in plain words", async () => {
    const result = await pollOnce(
      new DeskStore(),
      "key",
      async () => {
        throw new Error("HTTP 401");
      },
      NOW,
      () => undefined,
    );
    expect(result).toEqual({
      ok: false,
      error: "Cursor rejected the API key (HTTP 401).",
    });
  });

  it("reports other failures without echoing the key", async () => {
    const result = await pollOnce(
      new DeskStore(),
      "secret-key-123",
      async () => {
        throw new Error("fetch failed");
      },
      NOW,
      () => undefined,
    );
    expect(result).toEqual({
      ok: false,
      error: "Could not reach Cursor: fetch failed.",
    });
    expect(JSON.stringify(result)).not.toContain("secret-key-123");
  });

  it("treats an unexpected body as a failure the user can see", async () => {
    const result = await pollOnce(
      new DeskStore(),
      "key",
      async () => '{"nope":1}',
      NOW,
      () => undefined,
    );
    expect(result).toEqual({
      ok: false,
      error: "Cursor answered, but not with an agent list.",
    });
  });
});

describe("CursorState", () => {
  it("starts unconfigured and reports the last result", () => {
    const state = new CursorState();
    expect(state.snapshot(false)).toEqual({
      configured: false,
      last_poll_at: null,
      ok: null,
      agents: 0,
      error: "",
    });
    state.record({ ok: true, agents: 3 }, NOW);
    expect(state.snapshot(true)).toEqual({
      configured: true,
      last_poll_at: NOW,
      ok: true,
      agents: 3,
      error: "",
    });
    state.record(
      { ok: false, error: "Cursor rejected the API key (HTTP 401)." },
      NOW,
    );
    expect(state.snapshot(true)).toMatchObject({ ok: false, agents: 0 });
  });

  it("forgets the result once the key is removed", () => {
    const state = new CursorState();
    state.record({ ok: true, agents: 3 }, NOW);
    expect(state.snapshot(false)).toMatchObject({
      configured: false,
      last_poll_at: null,
      ok: null,
    });
  });
});
