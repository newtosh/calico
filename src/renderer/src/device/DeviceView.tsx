import { useCallback, useRef, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { connectBle } from "./ble";
import type { DeviceLink } from "./commands";
import { FirewallAssist } from "./FirewallAssist";
import { LinkActions } from "./LinkActions";
import { ProvisionFlow } from "./ProvisionFlow";
import { RebootWait } from "./RebootWait";
import { SerialAssist } from "./SerialAssist";
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
  const [assist, setAssist] = useState<"firewall" | "serial" | null>(null);
  const manualClose = useRef(false);
  const [rebootAt, setRebootAt] = useState<number | null>(null);
  const showFirewall = useCallback(() => setAssist("firewall"), []);

  // The desk resets as it takes the command, so the link drop that follows is
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
    }
  }

  async function open(kind: "usb" | "ble") {
    setError("");
    setRebootAt(null);
    const lost = () => {
      setLink(null);
      if (manualClose.current) {
        manualClose.current = false;
        return;
      }
      setError("Lost the connection to the desk. Connect again.");
    };
    try {
      setLink(
        kind === "usb" ? await connectUsb(onLog, lost) : await connectBle(lost),
      );
    } catch (err) {
      const e = err as Error;
      if (e.name === "NotFoundError" || e.name === "AbortError") return; // picker cancelled
      setError(e.message);
      if (kind === "usb") setAssist("serial");
    }
  }

  if (!link) {
    return (
      <div>
        <h2 className="section-title">Connect to the desk</h2>
        <div className="flex gap-3 px-4">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void open("usb")}
          >
            Connect over USB
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void open("ble")}
          >
            Connect over Bluetooth
          </button>
        </div>
        <p className="max-w-2xl px-4 pt-2 text-muted">
          USB works with any firmware that has the serial console and is the
          only way to recover a desk that will not boot. Bluetooth works without
          a cable once the desk is advertising.
        </p>
        {error ? (
          <p role="alert" className="px-4 pt-2">
            <ErrorNote>{error}</ErrorNote>
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

  return (
    <div className="pb-6">
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
      <ProvisionFlow info={info} link={link} onReboot={() => reboot(link)} />
      <button
        type="button"
        className="btn mx-4 mt-4"
        onClick={() => setAssist("firewall")}
      >
        Panel not connecting?
      </button>
      {rebootAt !== null ? (
        <RebootWait since={rebootAt} onSilent={showFirewall} />
      ) : null}
      {assist === "serial" ? <SerialAssist /> : null}
      {assist === "firewall" ? <FirewallAssist port={info.port} /> : null}
    </div>
  );
}
