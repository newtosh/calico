import { describe, expect, it } from "vitest";
import { BATTERY_FRESH_MS, batteryState, freshBattery } from "./panel-battery";

const at = 1_000_000;
const b = { pct: 81, charging: false, external: false, at };

describe("freshBattery", () => {
  it("keeps a recent reading", () => {
    expect(freshBattery(b, at + BATTERY_FRESH_MS)).toBe(b);
  });
  it("drops one older than 60 seconds", () => {
    expect(freshBattery(b, at + BATTERY_FRESH_MS + 1)).toBeNull();
  });
  it("has nothing when there is no reading", () => {
    expect(freshBattery(null, at)).toBeNull();
  });
});

describe("batteryState", () => {
  it("names the three states", () => {
    expect(batteryState({ ...b, charging: true, external: true })).toBe(
      "Charging",
    );
    expect(batteryState({ ...b, external: true })).toBe("On external power");
    expect(batteryState(b)).toBe("On battery");
  });
});
