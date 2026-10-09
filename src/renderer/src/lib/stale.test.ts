import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, staleUpdateText } from "./stale";

const NOW = Date.parse("2026-10-09T18:00:00Z");
const at = (msAgo: number) => ({ at: new Date(NOW - msAgo).toISOString() });

describe("staleUpdateText", () => {
  it("stays quiet while updates are fresh", () => {
    expect(staleUpdateText([at(0)], NOW)).toBe("");
    expect(staleUpdateText([at(STALE_AFTER_MS - 1000)], NOW)).toBe("");
  });

  it("says how long it has been once the newest update is old", () => {
    expect(staleUpdateText([at(STALE_AFTER_MS + 60_000)], NOW)).toBe(
      "Last update 31 min ago",
    );
    expect(staleUpdateText([at(20 * 3_600_000)], NOW)).toBe(
      "Last update 20 h ago",
    );
    expect(staleUpdateText([at(3 * 86_400_000)], NOW)).toBe(
      "Last update 3 d ago",
    );
  });

  it("goes by the newest event, whatever order they arrive in", () => {
    expect(staleUpdateText([at(5 * 3_600_000), at(60_000)], NOW)).toBe("");
  });

  it("says so when there is nothing at all", () => {
    expect(staleUpdateText([], NOW)).toBe("No updates yet");
  });

  it("ignores events whose time cannot be read", () => {
    expect(staleUpdateText([{ at: "garbage" }], NOW)).toBe("No updates yet");
  });
});
