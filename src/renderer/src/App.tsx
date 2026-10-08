import { useState } from "react";
import { ConsoleView } from "./console/ConsoleView";
import { Dashboard } from "./dashboard/Dashboard";
import type { DeviceLink } from "./device/commands";
import { DeviceView } from "./device/DeviceView";
import { Picker } from "./device/Picker";
import { useInfo } from "./lib/use-info";
import { webhookUrl } from "./lib/webhook";
import { SettingsView } from "./settings/SettingsView";
import { DriftBanner } from "./shell/DriftBanner";
import { ServerErrorPanel } from "./shell/ServerErrorPanel";
import { Sidebar, type View } from "./shell/Sidebar";
import { UrlChip } from "./shell/UrlChip";

export function App() {
  const info = useInfo();
  const [view, setView] = useState<View>("dashboard");
  const [link, setLink] = useState<DeviceLink | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const onLog = (line: string) => setLog((prev) => [...prev.slice(-499), line]);
  const panelOnline =
    info?.lastPanelPoll != null && Date.now() - info.lastPanelPoll < 10_000;
  const lanUrl = info?.lanUrls[0];

  return (
    <div className="flex h-dvh">
      <Sidebar view={view} onSelect={setView} panelOnline={panelOnline} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-stroke/40 px-4 py-2">
          {lanUrl ? <UrlChip url={lanUrl} /> : null}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {info ? (
            <DriftBanner info={info} onRepoint={() => setView("device")} />
          ) : null}
          {info?.serverError ? (
            <ServerErrorPanel error={info.serverError} />
          ) : null}
          {view === "dashboard" && info?.serverUrl ? (
            <Dashboard
              serverUrl={info.serverUrl}
              webhookUrl={webhookUrl(info)}
              onSetup={() => setView("settings")}
            />
          ) : null}
          {view === "settings" && info ? <SettingsView info={info} /> : null}
          {view === "device" && info ? (
            <DeviceView
              info={info}
              link={link}
              setLink={setLink}
              onLog={onLog}
            />
          ) : null}
          {view === "console" ? (
            <ConsoleView
              lines={log}
              usbConnected={link?.kind === "usb"}
              onClear={() => setLog([])}
            />
          ) : null}
        </main>
      </div>
      <Picker />
    </div>
  );
}
