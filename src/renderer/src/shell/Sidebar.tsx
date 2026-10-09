import { Cpu, LayoutList, Settings, SquareTerminal } from "lucide-react";
import type { ComponentType } from "react";
import logo from "../assets/calico.png";

export type View = "dashboard" | "device" | "console" | "settings";

const ITEMS: {
  view: View;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { view: "dashboard", label: "Dashboard", Icon: LayoutList },
  { view: "device", label: "Device", Icon: Cpu },
  { view: "console", label: "Console", Icon: SquareTerminal },
  { view: "settings", label: "Settings", Icon: Settings },
];

export function Sidebar({
  view,
  onSelect,
  panelOnline,
}: {
  view: View;
  onSelect: (v: View) => void;
  panelOnline: boolean;
}) {
  return (
    <nav
      aria-label="Views"
      className="flex w-48 shrink-0 flex-col border-r border-stroke/40 bg-surface"
    >
      <p className="flex items-center gap-2 px-4 pt-4 pb-3 text-base font-medium">
        <img src={logo} alt="" className="h-7 w-auto" />
        Calico
      </p>
      <ul>
        {ITEMS.map(({ view: v, label, Icon }) => (
          <li key={v}>
            <button
              type="button"
              aria-current={view === v ? "page" : undefined}
              onClick={() => onSelect(v)}
              className={`w-full px-4 py-2 text-left transition-colors duration-150 ${view === v ? "bg-selected text-cream" : "text-muted hover:text-cream"}`}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="size-4" />
                {label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-auto px-4 py-3 text-xs text-muted">
        <span
          className={`mr-2 inline-block size-2 rounded-full ${panelOnline ? "bg-sage" : "bg-stroke"}`}
          aria-hidden="true"
        />
        {panelOnline ? "Panel online" : "Panel not polling"}
      </p>
    </nav>
  );
}
