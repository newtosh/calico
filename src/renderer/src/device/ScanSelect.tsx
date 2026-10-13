import { useState } from "react";
import type { Ap, DeviceLink } from "./commands";

/** Scan through the panel and pick an SSID. Hidden networks are typed by the caller. */
export function ScanSelect({
  link,
  value,
  onPick,
  onError,
  onBusy = () => undefined,
  disabled = false,
}: {
  link: DeviceLink | null;
  value: string;
  onPick: (ssid: string) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const [aps, setAps] = useState<Ap[]>([]);

  async function scan() {
    if (!link) return;
    onError("");
    setScanning(true);
    onBusy(true);
    const reply = await link.send({ op: "scan" });
    setScanning(false);
    onBusy(false);
    if (!reply.ok) return onError(reply.error);
    setAps(reply.aps ?? []);
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={disabled || scanning || !link}
        onClick={() => void scan()}
      >
        {scanning ? "Scanning (up to 30 s)" : "Scan networks"}
      </button>
      {aps.length > 0 ? (
        <label className="label">
          Network
          <select
            className="field mt-1 w-56"
            value={value}
            onChange={(e) => onPick(e.target.value)}
          >
            <option value="">Choose a network</option>
            {aps.map((ap) => (
              <option key={ap.ssid} value={ap.ssid}>
                {ap.ssid} ({ap.rssi} dBm)
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
