import { Usb, Zap } from "lucide-react";
import type { PanelBatteryInfo } from "../../../shared/ipc";
import {
  type BatteryFill,
  batteryFill,
  batteryFillWidth,
  batteryState,
  freshBattery,
} from "../lib/panel-battery";

// Tailwind needs whole class names, so the colors are listed here.
const FILL: Record<BatteryFill, string> = {
  sage: "fill-sage",
  amber: "fill-amber",
  red: "fill-red",
  cream: "fill-cream",
};

// The same drawing as the panel's status bar: the number, then an outline with
// its nub on the left and a fill that grows from the right. 30 by 13 px.
const BODY = { x: 2.5, width: 27 };
// The fill ends 2 px inside the body, as on the panel.
const FILL_RIGHT = 28;
// The mark sits at the body's middle. It is dark over a fill that reaches it and
// cream over the empty body, so a low charge does not lose it.
const MARK_REACH = 12;

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
  const width = batteryFillWidth(live.pct);
  const markTone =
    FILL_RIGHT - width <= MARK_REACH ? "text-glass" : "text-cream";
  return (
    <span
      role="img"
      className="inline-flex items-center gap-1.5 text-xs text-cream"
      aria-label={`Panel battery ${live.pct}%, ${state}`}
      title={state}
    >
      <span>{live.pct}%</span>
      <span className="relative inline-flex">
        <svg width="30" height="13" viewBox="0 0 30 13" aria-hidden="true">
          <rect
            data-part="nub"
            x="0"
            y="3.5"
            width="2"
            height="6"
            rx="1"
            className="fill-cream opacity-60"
          />
          <rect
            data-part="body"
            x={BODY.x}
            y="0.5"
            width={BODY.width}
            height="12"
            rx="3"
            className="fill-none stroke-cream opacity-60"
          />
          <rect
            data-part="fill"
            x={FILL_RIGHT - width}
            y="2"
            width={width}
            height="9"
            rx="2"
            className={FILL[batteryFill(live)]}
          />
        </svg>
        {live.charging ? (
          <Zap
            aria-hidden="true"
            className={`absolute top-1/2 left-4 size-[11px] -translate-x-1/2 -translate-y-1/2 fill-current ${markTone}`}
          />
        ) : live.external ? (
          <Usb
            aria-hidden="true"
            className={`absolute top-1/2 left-4 size-[11px] -translate-x-1/2 -translate-y-1/2 ${markTone}`}
          />
        ) : null}
      </span>
    </span>
  );
}
