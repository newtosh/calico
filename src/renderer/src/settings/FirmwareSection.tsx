import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";

export function FirmwareSection({ info }: { info: CalicoInfo }) {
  const [check, setCheck] = useState(info.firmware.check);
  return (
    <section>
      <h2 className="section-title">Panel firmware</h2>
      <label className="flex items-center gap-2 px-4 pb-1">
        <input
          type="checkbox"
          checked={check}
          onChange={(e) => {
            setCheck(e.target.checked);
            void window.calico
              .firmwareSetCheck(e.target.checked)
              .catch(() => undefined);
          }}
        />
        Check for panel firmware updates
      </label>
      <p className="px-4 text-xs text-muted">
        Calico asks GitHub's public releases list for a newer panel firmware
        when it starts and every 12 hours. Nothing about you or your panel is
        sent.
      </p>
    </section>
  );
}
