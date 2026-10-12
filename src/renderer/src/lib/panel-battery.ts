import type { PanelBatteryInfo } from "../../../shared/ipc";

/** The panel reports on every poll. A silent minute means it is off or away. */
export const BATTERY_FRESH_MS = 60_000;

export function freshBattery(
  battery: PanelBatteryInfo | null,
  now: number,
): PanelBatteryInfo | null {
  return battery !== null && now - battery.at <= BATTERY_FRESH_MS
    ? battery
    : null;
}

export function batteryState(
  battery: PanelBatteryInfo,
): "Charging" | "On external power" | "On battery" {
  if (battery.charging) return "Charging";
  return battery.external ? "On external power" : "On battery";
}

/** Width in px of the fill at 100 percent: the battery body less its border and inset. */
export const BATTERY_INNER_PX = 22;

export type BatteryFill = "sage" | "amber" | "red" | "cream";

/** The same choice as power_fill() in the panel firmware, so the two always agree. */
export function batteryFill(battery: PanelBatteryInfo): BatteryFill {
  if (battery.charging) return "sage";
  if (battery.pct <= 10) return "red";
  if (battery.pct <= 20) return "amber";
  return "cream";
}

/** Whole pixels, never fewer than one, like the panel. */
export function batteryFillWidth(pct: number): number {
  return Math.max(1, Math.floor((pct * BATTERY_INNER_PX) / 100));
}
