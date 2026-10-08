import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { panelOnlineSince } from "../lib/panel-online";
import type { Ap, DeviceLink } from "./commands";
import { ErrorNote } from "../shell/ErrorNote";

type Stage =
  | "idle"
  | "scanning"
  | "pick"
  | "verifying"
  | "saving"
  | "waiting"
  | "online"
  | "silent";

export function ProvisionFlow({
  info,
  link,
  onSilent,
}: {
  info: CalicoInfo;
  link: DeviceLink;
  onSilent: () => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [aps, setAps] = useState<Ap[]>([]);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  async function scan() {
    setError("");
    setStage("scanning");
    const reply = await link.send({ op: "scan" });
    if (!reply.ok) {
      setError(reply.error);
      return setStage("idle");
    }
    setAps(reply.aps ?? []);
    setStage("pick");
  }

  async function connect() {
    setError("");
    setStage("verifying");
    const verify = await link.send({ op: "verify", ssid, pass });
    if (!verify.ok) {
      setError(verify.error);
      return setStage("pick");
    }
    setStage("saving");
    const lan = info.lanUrls[0];
    const steps = [
      link.send.bind(link, { op: "wifi", ssid, pass }),
      ...(lan ? [link.send.bind(link, { op: "url", value: lan })] : []),
      link.send.bind(link, { op: "token", value: info.webhookToken }),
    ];
    for (const step of steps) {
      const reply = await step();
      if (!reply.ok) {
        setError(reply.error);
        return setStage("pick");
      }
    }
    setPass("");
    if (lan) await window.calico.adoptPort();
    const rebootAt = Date.now();
    await link.send({ op: "reboot" });
    setStage("waiting");
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const next = await window.calico.info();
      if (panelOnlineSince(next.lastPanelPoll, rebootAt))
        return setStage("online");
    }
    setStage("silent");
    onSilent();
  }

  const busy =
    stage === "scanning" ||
    stage === "verifying" ||
    stage === "saving" ||
    stage === "waiting";
  return (
    <section>
      <h2 className="section-title">Set up Wi-Fi</h2>
      <p className="max-w-2xl px-4 text-muted">
        The desk tries the network first. A wrong password is not saved. When it
        joins, calico also sends this computer's URL and the webhook token, then
        reboots the desk.
      </p>
      <div className="flex max-w-2xl flex-wrap items-end gap-3 px-4 pt-3">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void scan()}
        >
          {stage === "scanning" ? "Scanning (up to 30 s)" : "Scan networks"}
        </button>
        {aps.length > 0 ? (
          <label className="label">
            Network
            <select
              className="field mt-1 w-56"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
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
        <label className="label">
          Or type an SSID
          <input
            className="field mt-1 w-48"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
          />
        </label>
        <label className="label">
          Password
          <input
            type="password"
            className="field mt-1 w-48"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ssid}
          onClick={() => void connect()}
        >
          {stage === "verifying"
            ? "Testing (up to 30 s)"
            : stage === "saving"
              ? "Saving"
              : "Test and save"}
        </button>
      </div>
      <p role="status" className="px-4 pt-2">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {stage === "waiting" ? (
          <span className="text-amber">
            Rebooted. Waiting up to 30 s for the panel to poll calico.
          </span>
        ) : null}
        {stage === "online" ? (
          <span className="text-sage">Panel online.</span>
        ) : null}
        {stage === "silent" ? (
          <span className="text-amber">
            The panel joined Wi-Fi but has not reached calico. See below.
          </span>
        ) : null}
      </p>
    </section>
  );
}
