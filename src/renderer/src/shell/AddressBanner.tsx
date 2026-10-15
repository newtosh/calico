import { useCallback, useEffect, useRef, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { updatePanelAddress } from "../device/address-update";
import { connectBle } from "../device/ble";
import type { DeviceLink } from "../device/commands";
import { RebootWait } from "../device/RebootWait";
import { ErrorNote } from "./ErrorNote";
import { keepStoredAddress } from "../lib/stored-url";

export const NO_PANEL =
  "No panel was chosen. If it did not appear, check that it is on and within reach, then try again.";
export const SILENT =
  "The panel has not polled Calico since it restarted. Check that it is on its network, then see Panel not connecting on the Panel page.";
const quiet = () => undefined;

/**
 * "Calico's address may have changed". Main decides when (CalicoInfo.addressChange). One click
 * connects over the existing pairing, writes the new URL, reboots the panel and waits for its
 * first poll. Sends no password or token. An inline status, not a modal: it never takes focus
 * when it appears.
 */
export function AddressBanner({
  info,
  link,
  onOpenDevice,
}: {
  info: CalicoInfo;
  link: DeviceLink | null;
  onOpenDevice: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  // The panel was updated, but the address saved in Settings was not.
  const [note, setNote] = useState("");
  const [since, setSince] = useState<number | null>(null);
  // The URL being written. Kept so the banner stays up when the panel polls and main clears it.
  const [target, setTarget] = useState("");
  // Hidden until main's next report: dismissed, main stops offering this address until a new poll.
  const [dismissedAt, setDismissedAt] = useState<CalicoInfo | null>(null);
  const result = useRef<HTMLDivElement>(null);
  const offered = info.addressChange?.url ?? "";
  // A new attempt takes the current offer; the first URL stays only while it is being written.
  const url = working || since !== null ? target : offered || target;

  // After a click the outcome is what matters: land on it.
  useEffect(() => {
    if (error || since !== null) result.current?.focus();
  }, [error, since]);

  const silent = useCallback(() => {
    setSince(null);
    setError(SILENT);
  }, []);

  if (!url || (!working && !error && since === null && dismissedAt === info))
    return null;

  function close() {
    setTarget("");
    setError("");
    setNote("");
    setSince(null);
  }

  // connectBle must be the first await: Web Bluetooth opens its picker only inside the click.
  async function update() {
    setTarget(url);
    setError("");
    setNote("");
    setWorking(true);
    setProgress("Looking for the panel over Bluetooth.");
    let panel: DeviceLink;
    try {
      panel = await connectBle(
        quiet,
        () =>
          setProgress(
            "Confirm the code on the panel and in the system dialog.",
          ),
        info.hostname,
      );
    } catch (err) {
      const e = err as Error;
      setError(
        e.name === "NotFoundError" || e.name === "AbortError"
          ? NO_PANEL
          : e.message,
      );
      setWorking(false);
      return;
    }
    setProgress("Writing the new address.");
    const at = Date.now();
    try {
      const done = await updatePanelAddress(panel, url);
      if (!done.ok) return setError(done.error);
      if (info.port && url.endsWith(`:${info.port}`))
        await window.calico.adoptPort();
      setNote(await keepStoredAddress(url));
      setSince(at);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      // The panel has one Bluetooth slot. After a reboot the link is gone anyway.
      panel.close();
      setWorking(false);
    }
  }

  const waiting = since !== null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-start gap-3 border-b border-amber/60 bg-surface px-4 py-3"
    >
      <span className="min-w-0 text-amber">
        Calico's address may have changed, so the panel may not find it. Calico
        is now at <span className="break-all font-mono">{url}</span>.
      </span>
      <div className="flex flex-wrap items-center gap-3 empty:hidden">
        {!waiting && link ? (
          <button
            type="button"
            className="btn"
            disabled={working}
            onClick={onOpenDevice}
          >
            Update on the Panel page
          </button>
        ) : null}
        {!waiting && !link ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={working}
            onClick={() => void update()}
          >
            Update over Bluetooth
          </button>
        ) : null}
        {!waiting && !error ? (
          <button
            type="button"
            className="btn"
            disabled={working}
            onClick={() => {
              setDismissedAt(info);
              void window.calico.dismissAddress();
            }}
          >
            Not now
          </button>
        ) : null}
        {working ? <span>{progress}</span> : null}
      </div>
      <div
        ref={result}
        tabIndex={-1}
        className="min-w-0 break-words outline-none"
      >
        {error ? (
          <p role="alert">
            <ErrorNote>{error}</ErrorNote>
          </p>
        ) : null}
        {note ? <p className="text-muted">{note}</p> : null}
        {since !== null ? (
          <RebootWait since={since} onSilent={silent} className="" />
        ) : null}
      </div>
      {error || waiting ? (
        <button type="button" className="btn" onClick={close}>
          Close
        </button>
      ) : null}
    </div>
  );
}
