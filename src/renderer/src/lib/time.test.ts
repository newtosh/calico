import { afterEach, describe, expect, it, vi } from "vitest";
import { localTime } from "./time";

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
