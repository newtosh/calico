import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { FIRMWARE_HELP_URL } from "../../../shared/firmware";
import { panelLabel } from "../lib/firmware";

/** A polite status like AddressBanner: it never takes focus. Release notes open externally via main's window-open handler. */
export function FirmwareBanner({ info }: { info: CalicoInfo }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const fw = info.firmware;
  const latest = fw.latest;
  if (
    !latest ||
    fw.dismissed ||
    hidden === latest.version ||
    (fw.status !== "available" && fw.status !== "needs_calico")
  )
    return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-start gap-3 border-b border-amber/60 bg-surface px-4 py-3"
    >
      <span className="min-w-0 text-amber">
        {fw.status === "available"
          ? `Panel firmware ${latest.version} is available. This panel has ${panelLabel(fw.panel)}.`
          : `Panel firmware ${latest.version} needs Calico ${latest.minApp} or later. Update Calico first, then the panel.`}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <a
          className="btn"
          href={latest.notesUrl}
          target="_blank"
          rel="noreferrer"
        >
          Release notes
        </a>
        {fw.status === "available" ? (
          <a
            className="btn"
            href={FIRMWARE_HELP_URL}
            target="_blank"
            rel="noreferrer"
          >
            How to update
          </a>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setHidden(latest.version);
            void window.calico
              .firmwareDismiss(latest.version)
              .catch(() => undefined);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
