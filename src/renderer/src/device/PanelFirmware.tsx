import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { FIRMWARE_HELP_URL } from "../../../shared/firmware";
import { isSemver } from "../../../shared/semver";
import { panelLabel } from "../lib/firmware";

function summary(fw: CalicoInfo["firmware"]): string {
  const { latest } = fw;
  if (fw.panel === null)
    return "The panel's firmware version is not known yet.";
  if (fw.status === "current" && isSemver(fw.panel))
    return `Panel ${panelLabel(fw.panel)} is up to date.`;
  if (latest && fw.status === "available")
    return `Panel firmware ${latest.version} is available. This panel has ${panelLabel(fw.panel)}.`;
  if (latest && fw.status === "needs_calico")
    return `Panel firmware ${latest.version} needs Calico ${latest.minApp} or later. Update Calico first, then the panel.`;
  return `This panel has ${panelLabel(fw.panel)}. No release information yet.`;
}

export function PanelFirmware({ info }: { info: CalicoInfo }) {
  const fw = info.firmware;
  const [busy, setBusy] = useState(false);
  async function checkNow() {
    setBusy(true);
    try {
      await window.calico.firmwareCheckNow();
    } catch {
      // The next report from main shows the outcome; the button just comes back.
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2 className="section-title">Panel firmware</h2>
      <p className="px-4">{summary(fw)}</p>
      {fw.belowMinimum ? (
        <p className="px-4 text-muted">
          This panel runs firmware older than the first versioned release.
        </p>
      ) : null}
      <p className="px-4 text-muted">
        {fw.checkedAt === null
          ? "Not checked yet."
          : `Last checked ${new Date(fw.checkedAt).toLocaleString()}.`}
        {fw.lastError ? ` Could not check: ${fw.lastError}.` : ""}
        {fw.check ? "" : " Automatic checks are off."}
      </p>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-2">
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
          disabled={busy}
          onClick={() => void checkNow()}
        >
          {busy ? "Checking" : "Check now"}
        </button>
      </div>
    </section>
  );
}
