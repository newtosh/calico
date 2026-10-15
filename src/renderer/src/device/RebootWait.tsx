import { useEffect, useState } from "react";
import { panelOnlineSince } from "../lib/panel-online";

// Lives in DeviceView, not the flow that rebooted the panel: the reboot drops
// the link, which unmounts everything that needs one.
export function RebootWait({
  since,
  onSilent,
  className = "px-4 pt-2",
}: {
  since: number;
  onSilent: () => void;
  className?: string;
}) {
  const [stage, setStage] = useState<"waiting" | "online" | "silent">(
    "waiting",
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive) return;
        const next = await window.calico.info();
        if (panelOnlineSince(next.lastPanelPoll, since)) {
          if (alive) setStage("online");
          return;
        }
      }
      if (!alive) return;
      setStage("silent");
      onSilent();
    })();
    return () => {
      alive = false;
    };
  }, [since, onSilent]);

  return (
    <p role="status" className={className}>
      {stage === "waiting" ? (
        <span className="text-amber">
          Rebooted. Waiting up to 30 s for the panel to poll Calico.
        </span>
      ) : null}
      {stage === "online" ? (
        <span className="text-sage">Panel online.</span>
      ) : null}
      {stage === "silent" ? (
        <span className="text-amber">
          The panel has not reached Calico since the reboot. See below.
        </span>
      ) : null}
    </p>
  );
}
