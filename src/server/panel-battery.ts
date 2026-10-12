import type { PanelBatteryInfo } from "../shared/ipc";

const flag = (value: string | null): boolean | null =>
  value === "1" ? true : value === "0" ? false : null;

/**
 * The panel adds ?bat=81&chg=1&ext=1 to its status poll. Anything that is not
 * a full, in-range set is ignored, so a bad value never replaces a good one.
 */
export function parsePanelBattery(
  params: URLSearchParams,
): Omit<PanelBatteryInfo, "at"> | null {
  const bat = params.get("bat");
  if (bat === null || !/^(0|[1-9]\d{0,2})$/.test(bat)) return null;
  const pct = Number(bat);
  const charging = flag(params.get("chg"));
  const external = flag(params.get("ext"));
  if (pct > 100 || charging === null || external === null) return null;
  return { pct, charging, external };
}

/** Keeps the last valid report. A malformed one never replaces it. */
export function recordPanelBattery(
  stats: { panelBattery: PanelBatteryInfo | null },
  params: URLSearchParams,
  now: number,
): void {
  const battery = parsePanelBattery(params);
  if (battery) stats.panelBattery = { ...battery, at: now };
}
