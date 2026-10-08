import type { CalicoInfo } from "../../../shared/ipc";
import { AboutSection } from "./AboutSection";
import { AutostartSection } from "./AutostartSection";
import { ConfigSection } from "./ConfigSection";
import { PanelSection } from "./PanelSection";

export function SettingsView({ info }: { info: CalicoInfo }) {
  return (
    <div className="pb-6">
      {info.serverUrl ? <ConfigSection /> : null}
      {info.serverUrl ? <PanelSection /> : null}
      <AutostartSection autostart={info.autostart} />
      <AboutSection version={info.version} />
    </div>
  );
}
