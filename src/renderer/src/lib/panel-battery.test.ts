import { describe, expect, it } from "vitest";
import {
  BATTERY_FRESH_MS,
  BATTERY_INNER_PX,
  batteryFill,
  batteryFillWidth,
  batteryState,
  freshBattery,
} from "./panel-battery";

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

// These mirror power_fill() in the panel firmware, so the two always agree.
describe("batteryFill", () => {
  it("is sage while charging, whatever the level", () => {
    expect(batteryFill({ ...b, pct: 5, charging: true })).toBe("sage");
    expect(batteryFill({ ...b, pct: 95, charging: true })).toBe("sage");
  });
  it("is red at 10 percent or less, amber at 20 or less, else cream", () => {
    expect(batteryFill({ ...b, pct: 10 })).toBe("red");
    expect(batteryFill({ ...b, pct: 11 })).toBe("amber");
    expect(batteryFill({ ...b, pct: 20 })).toBe("amber");
    expect(batteryFill({ ...b, pct: 21 })).toBe("cream");
    expect(batteryFill({ ...b, pct: 100 })).toBe("cream");
  });
});

describe("batteryFillWidth", () => {
  it("grows with the level and never disappears", () => {
    expect(batteryFillWidth(100)).toBe(BATTERY_INNER_PX);
    expect(batteryFillWidth(50)).toBe(BATTERY_INNER_PX / 2);
    expect(batteryFillWidth(0)).toBe(1);
    expect(batteryFillWidth(1)).toBe(1);
    expect(batteryFillWidth(180)).toBe(BATTERY_INNER_PX);
  });
});
