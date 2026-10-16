import { useCallback, useRef, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { connectBle } from "./ble";
import type { DeviceLink } from "./commands";
import { FirewallAssist } from "./FirewallAssist";
import { LinkActions } from "./LinkActions";
import { PanelNetworks } from "./PanelNetworks";
import { ProvisionFlow } from "./ProvisionFlow";
import { PushNetworks } from "./PushNetworks";
import { RebootWait } from "./RebootWait";
import { SerialAssist } from "./SerialAssist";
import { PanelFirmware } from "./PanelFirmware";
import { connectUsb } from "./usb";
import { ErrorNote } from "../shell/ErrorNote";

interface Props {
  info: CalicoInfo;
  link: DeviceLink | null;
  setLink: (link: DeviceLink | null) => void;
  onLog: (line: string) => void;
}

export function DeviceView({ info, link, setLink, onLog }: Props) {
  const [error, setError] = useState("");
  // Non-empty while a Connect is under way. Both Connect buttons wait for it.
  const [progress, setProgress] = useState("");
  const [assist, setAssist] = useState<"firewall" | "serial" | null>(null);
  const manualClose = useRef(false);
  const [rebootAt, setRebootAt] = useState<number | null>(null);
  // The push's outcome. Here, not in PushNetworks: a dropped link unmounts that section.
  const [pushNote, setPushNote] = useState("");
  const showFirewall = useCallback(() => setAssist("firewall"), []);

  // The panel resets as it takes the command, so the link drop that follows is
  // expected. RebootWait reports the outcome from here, where it stays mounted.
  async function reboot(target: DeviceLink) {
    setError("");
    manualClose.current = true;
    setRebootAt(Date.now());
    const reply = await target.send({ op: "reboot" });
    if (!reply.ok) {
      manualClose.current = false;
      setRebootAt(null);
      setError(reply.error);
      return;
    }
    // If the link survives the reboot, a later drop is a real one again.
    window.setTimeout(() => {
      manualClose.current = false;
    }, 30_000);
  }

  async function open(kind: "usb" | "ble") {
    setError("");
    setRebootAt(null);
    setPushNote("");
    const lost = () => {
      setLink(null);
      if (manualClose.current) {
        manualClose.current = false;
        return;
      }
      setError("Lost the connection to the panel. Connect again.");
    };
    setProgress("Connecting.");
    try {
      setLink(
        kind === "usb"
          ? await connectUsb(onLog, lost)
          : await connectBle(
              lost,
              () =>
                setProgress(
                  "Confirm the code on the panel and in the system dialog.",
                ),
              info.hostname,
            ),
      );
    } catch (err) {
      const e = err as Error;
      if (e.name === "NotFoundError" || e.name === "AbortError") return; // picker cancelled
      setError(e.message);
      if (kind === "usb") setAssist("serial");
    } finally {
      setProgress("");
    }
  }

  // One tree for both states: the reboot drops the link, and the wait, the
  // error, and the assists must stay mounted through that.
  return (
    <div className="pb-6">
      <PanelFirmware info={info} />
      {link ? (
        <>
          <div className="flex items-center gap-3 px-4 pt-4">
            <span className="text-sage">
              Connected over {link.kind === "usb" ? "USB" : "Bluetooth"}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                manualClose.current = true;
                link.close();
                setLink(null);
              }}
            >
              Disconnect
            </button>
          </div>
          <LinkActions info={info} link={link} onReboot={() => reboot(link)} />
          <ProvisionFlow
            info={info}
            link={link}
            onReboot={() => reboot(link)}
          />
          <PanelNetworks link={link} />
          <PushNetworks
            link={link}
            onFinished={(message, restart) => {
              setPushNote(message);
              if (restart) void reboot(link);
            }}
          />
          <button
            type="button"
            className="btn mx-4 mt-4"
            onClick={() => setAssist("firewall")}
          >
            Panel not connecting?
          </button>
        </>
      ) : (
        <>
          <h2 className="section-title">Connect to the panel</h2>
          <div className="flex gap-3 px-4">
            <button
              type="button"
              className="btn btn-primary"
              disabled={progress !== ""}
              onClick={() => void open("usb")}
            >
              Connect over USB
            </button>
            <button
              type="button"
              className="btn"
              disabled={progress !== ""}
              onClick={() => void open("ble")}
            >
              Connect over Bluetooth
            </button>
          </div>
          {progress ? (
            <p role="status" className="px-4 pt-2">
              {progress}
            </p>
          ) : null}
          <p className="max-w-2xl px-4 pt-2 text-muted">
            USB works with any firmware that has the serial console and is the
            only way to recover a panel that will not boot. Bluetooth works
            without a cable once the panel is advertising.
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
      {pushNote ? (
        <p role="status" className="max-w-2xl px-4 pt-2">
          {pushNote}
        </p>
      ) : null}
      {rebootAt !== null ? (
        <RebootWait since={rebootAt} onSilent={showFirewall} />
      ) : null}
      {assist === "serial" ? <SerialAssist /> : null}
      {assist === "firewall" ? <FirewallAssist port={info.port} /> : null}
    </div>
  );
}
