import type { CalicoInfo } from "../../../shared/ipc";
import { AgentUpdatesSection } from "./AgentUpdatesSection";
import { AboutSection } from "./AboutSection";
import { AutostartSection } from "./AutostartSection";
import { ConfigSection } from "./ConfigSection";
import { CursorStatus } from "./CursorStatus";
import { PanelSection } from "./PanelSection";

export function SettingsView({ info }: { info: CalicoInfo }) {
  return (
    <div className="pb-6">
      {info.serverUrl ? <ConfigSection /> : null}
      {info.serverUrl ? <CursorStatus /> : null}
      <AgentUpdatesSection info={info} />
      {info.serverUrl ? <PanelSection /> : null}
      <AutostartSection autostart={info.autostart} />
      <AboutSection version={info.version} />
    </div>
  );
}
