import type { ReactNode } from "react";
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import type { DeviceLink } from "../device/commands";
import { loadTab, saveTab, type SettingsTab } from "../lib/settings-tab";
import { AboutSection } from "./AboutSection";
import { AgentUpdatesSection } from "./AgentUpdatesSection";
import { AutostartSection } from "./AutostartSection";
import { ConfigSection } from "./ConfigSection";
import { CursorStatus } from "./CursorStatus";
import { NetworksSection } from "./NetworksSection";
import { NotifySection } from "./NotifySection";
import { PanelSection } from "./PanelSection";
import { PortSection } from "./PortSection";
import { RelaySection } from "./RelaySection";
import { panelId, SettingsTabs, tabId, type TabSpec } from "./SettingsTabs";

const TABS: readonly TabSpec<SettingsTab>[] = [
  { id: "agents", label: "Agents" },
  { id: "connectivity", label: "Connectivity" },
  { id: "app", label: "App" },
];

// Every panel stays mounted and the inactive ones are hidden, so a half-typed
// field or a running setup survives a trip to another tab.
function Panel({
  id,
  current,
  children,
}: {
  id: SettingsTab;
  current: SettingsTab;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(id)}
      aria-labelledby={tabId(id)}
      hidden={current !== id}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export function SettingsView({
  info,
  link = null,
}: {
  info: CalicoInfo;
  link?: DeviceLink | null;
}) {
  const [tab, setTab] = useState<SettingsTab>(loadTab);
  const choose = (next: SettingsTab) => {
    setTab(next);
    saveTab(next);
  };
  const server = info.serverUrl !== null;
  return (
    // isolate keeps the pinned strip's z-index local, so a dialog portaled to the
    // body paints above it.
    <div className="isolate pb-6">
      <SettingsTabs tabs={TABS} value={tab} onChange={choose} />
      <Panel id="agents" current={tab}>
        <AgentUpdatesSection info={info} />
        {server ? <ConfigSection /> : null}
        {server ? <CursorStatus /> : null}
      </Panel>
      <Panel id="connectivity" current={tab}>
        {server ? (
          <>
            <PortSection />
            <RelaySection />
            <NotifySection />
            <PanelSection />
          </>
        ) : (
          <p className="max-w-2xl px-4 pt-4 text-muted">
            Connectivity settings need calico's server, which is not running.
          </p>
        )}
        <NetworksSection link={link} />
      </Panel>
      <Panel id="app" current={tab}>
        <AutostartSection autostart={info.autostart} />
        <AboutSection version={info.version} />
      </Panel>
    </div>
  );
}
