import { describe, expect, it } from "vitest";
import { compareSemver, isSemver, parseSemver } from "../../src/shared/semver";

describe("semver", () => {
  it("parses plain X.Y.Z only", () => {
    expect(parseSemver("0.2.0")).toEqual([0, 2, 0]);
    expect(parseSemver("10.20.30")).toEqual([10, 20, 30]);
    for (const bad of [
      "0.2",
      "v0.2.0",
      "0.2.0-rc1",
      "01.2.3",
      "0.2.0\n",
      " 0.2.0",
      "1.2.3.4",
      "٣.٢.٠",
      "9999999.0.0",
      "886dd11",
      "unknown",
      "",
      null,
      42,
    ])
      expect(parseSemver(bad)).toBeNull();
    expect(isSemver("1.0.0")).toBe(true);
    expect(isSemver("1.0")).toBe(false);
  });

  it("compares numerically, not as text", () => {
    expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
    expect(compareSemver("0.9.0", "0.10.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.2.1", "0.2.0")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
  });

  it("refuses to compare something that is not a version", () => {
    expect(() => compareSemver("886dd11", "0.2.0")).toThrow(RangeError);
  });
});
