import { BatteryCharging, BatteryFull, BatteryLow } from "lucide-react";
import type { PanelBatteryInfo } from "../../../shared/ipc";
import { batteryState, freshBattery } from "../lib/panel-battery";

export function PanelBattery({
  battery,
  now,
}: {
  battery: PanelBatteryInfo | null;
  now: number;
}) {
  const live = freshBattery(battery, now);
  if (!live) return null;
  const state = batteryState(live);
  const Icon = live.charging
    ? BatteryCharging
    : live.pct <= 20
      ? BatteryLow
      : BatteryFull;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      aria-label={`Panel battery ${live.pct}%, ${state}`}
      title={state}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{live.pct}%</span>
    </span>
  );
}
