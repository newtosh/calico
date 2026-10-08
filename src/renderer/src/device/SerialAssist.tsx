import { useEffect, useState } from "react";
import type { FixResult, SerialAccess } from "../../../shared/ipc";

const UDEV =
  'SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", MODE="0660", TAG+="uaccess"';

export function SerialAssist() {
  const [access, setAccess] = useState<SerialAccess | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);

  useEffect(() => {
    void window.calico.serialAccess().then(setAccess);
  }, []);

  if (!access || access.denied.length === 0) return null;
  return (
    <section className="border-t border-stroke/40">
      <h2 className="section-title">USB permission</h2>
      <p className="max-w-2xl px-4 text-muted">
        Your user cannot open {access.denied.join(", ")}. Add yourself to the{" "}
        {access.group} group, then log out and back in:
      </p>
      <pre className="mx-4 mt-2 max-w-2xl border border-stroke bg-field px-3 py-2 font-mono text-xs">
        {access.command}
      </pre>
      <div className="flex gap-3 px-4 pt-2">
        <button
          type="button"
          className="btn"
          onClick={() => void navigator.clipboard.writeText(access.command)}
        >
          Copy
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void window.calico.runFix("serial").then(setResult)}
        >
          Run (asks for your password)
        </button>
      </div>
      <p className="max-w-2xl px-4 pt-3 text-muted">
        Or, without a group change, save this as
        /etc/udev/rules.d/60-calico.rules and run sudo udevadm control --reload
        && sudo udevadm trigger:
      </p>
      <pre className="mx-4 mt-2 max-w-2xl border border-stroke bg-field px-3 py-2 font-mono text-xs">
        {UDEV}
      </pre>
      {result ? (
        <p
          role="status"
          className={`px-4 pt-2 ${result.ok ? "text-sage" : "text-red"}`}
        >
          {result.ok
            ? "Done. Log out and back in, then connect again."
            : result.output}
        </p>
      ) : null}
    </section>
  );
}
