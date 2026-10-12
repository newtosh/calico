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
