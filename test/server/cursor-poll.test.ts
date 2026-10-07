import { describe, expect, it, vi } from "vitest";
import { mapCursorStatus, pollOnce } from "../../src/server/cursor-poll";
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
});
