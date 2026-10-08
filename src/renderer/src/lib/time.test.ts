import { afterEach, describe, expect, it, vi } from "vitest";
import { ago, localTime } from "./time";

afterEach(() => vi.unstubAllEnvs());

describe("localTime", () => {
  it("shows event times in the viewer's timezone, not UTC", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(localTime("2026-01-01T12:34:56Z")).toMatch(/07:34:56/);
  });

  it("keeps the raw value when it is not a date", () => {
    expect(localTime("nope")).toBe("nope");
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const at = (secondsBefore: number) =>
    new Date(now - secondsBefore * 1000).toISOString();

  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1 min ago"],
    [3599, "59 min ago"],
    [3600, "1 h ago"],
    [86399, "23 h ago"],
    [86400, "1 d ago"],
    [-30, "just now"],
  ])("%s seconds ago reads %s", (seconds, text) => {
    expect(ago(at(seconds), now)).toBe(text);
  });

  it("is empty for something that is not a date", () => {
    expect(ago("never", now)).toBe("");
  });
});
