import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";

export function AutostartSection({
  autostart,
}: {
  autostart: CalicoInfo["autostart"];
}) {
  const [enabled, setEnabled] = useState(autostart.enabled);
  return (
    <section>
      <h2 className="section-title">Startup</h2>
      <label className="flex items-center gap-2 px-4 pb-1">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!autostart.available}
          onChange={(e) =>
            void window.calico.setAutostart(e.target.checked).then(setEnabled)
          }
        />
        Start calico in the tray when I log in
      </label>
      {!autostart.available ? (
        <p className="px-4 text-xs text-muted">
          Available in installed builds.
        </p>
      ) : null}
    </section>
  );
}
