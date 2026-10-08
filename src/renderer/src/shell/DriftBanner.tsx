import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";

export function DriftBanner({
  info,
  onRepoint,
}: {
  info: CalicoInfo;
  onRepoint: () => void;
}) {
  const [holders, setHolders] = useState<string[] | null>(null);
  if (!info.port || info.port === info.expectedPort) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-amber/60 bg-surface px-4 py-2"
    >
      <span className="text-amber">
        The panel is set to port {info.expectedPort}, but calico is on{" "}
        {info.port} because {info.expectedPort} was busy.
      </span>
      <button type="button" className="btn" onClick={onRepoint}>
        Re-point panel
      </button>
      <button
        type="button"
        className="btn"
        onClick={() =>
          void window.calico.portHolders(info.expectedPort).then(setHolders)
        }
      >
        What holds {info.expectedPort}?
      </button>
      {holders ? (
        <span className="font-mono text-xs text-muted">
          {holders.length
            ? holders.join(", ")
            : "Nothing you own. It may be another user's process."}
        </span>
      ) : null}
    </div>
  );
}
