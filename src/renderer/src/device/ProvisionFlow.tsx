import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { validateCmd, type Cmd, type DeviceLink } from "./commands";
import { OLD_FIRMWARE } from "./ble";
import { NETWORKS_MAX } from "../../../shared/panel-fields";
import { ScanSelect } from "./ScanSelect";
import { ErrorNote } from "../shell/ErrorNote";

type Stage = "idle" | "verifying" | "saving";

export function ProvisionFlow({
  info,
  link,
  onReboot,
}: {
  info: CalicoInfo;
  link: DeviceLink;
  onReboot: () => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [scanning, setScanning] = useState(false);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [ownUrl, setOwnUrl] = useState("");
  const [ownToken, setOwnToken] = useState("");
  const [error, setError] = useState("");

  async function connect() {
    setError("");
    // Only a network with its own URL or token sends the four-line wifi.
    const wifi: Cmd =
      ownUrl || ownToken
        ? { op: "wifi", ssid, pass, url: ownUrl, token: ownToken }
        : { op: "wifi", ssid, pass };
    // Refuse bad fields now, not after the 30 s network test.
    try {
      validateCmd(wifi);
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    setStage("verifying");
    // Read the panel's list first, so a full panel or old firmware says so now
    // and not after the 30 s test. A failed read never blocks the setup.
    const list = await link.send({ op: "nets" });
    const own = wifi.op === "wifi" && wifi.url !== undefined;
    const blocked = !list.ok
      ? own && list.error === OLD_FIRMWARE
        ? OLD_FIRMWARE
        : ""
      : (list.nets ?? []).length >= NETWORKS_MAX &&
          !(list.nets ?? []).some((n) => n.ssid === ssid)
        ? `The panel already has ${NETWORKS_MAX} networks. Forget one under Networks on the panel, then try again.`
        : "";
    if (blocked) {
      setError(blocked);
      return setStage("idle");
    }
    const verify = await link.send({ op: "verify", ssid, pass });
    if (!verify.ok) {
      setError(verify.error);
      return setStage("idle");
    }
    setStage("saving");
    const lan = info.lanUrls[0];
    const steps = [
      link.send.bind(link, wifi),
      ...(lan ? [link.send.bind(link, { op: "url", value: lan })] : []),
      link.send.bind(link, { op: "token", value: info.webhookToken }),
    ];
    for (const step of steps) {
      const reply = await step();
      if (!reply.ok) {
        setError(reply.error);
        return setStage("idle");
      }
    }
    setPass("");
    setOwnToken("");
    if (lan) await window.calico.adoptPort();
    setStage("idle");
    await onReboot();
  }

  const busy = scanning || stage !== "idle";
  return (
    <section>
      <h2 className="section-title">Set up Wi-Fi</h2>
      <p className="max-w-2xl px-4 text-muted">
        The panel tries the network first. A wrong password is not saved. When
        it joins, Calico also sends Calico's address and the webhook token, then
        reboots the panel.
      </p>
      <div className="flex max-w-2xl flex-wrap items-end gap-3 px-4 pt-3">
        <ScanSelect
          link={link}
          value={ssid}
          onPick={setSsid}
          onError={setError}
          onBusy={setScanning}
          disabled={busy}
        />
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
            autoComplete="off"
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
      <details className="max-w-2xl px-4 pt-3">
        <summary className="cursor-pointer text-muted">
          This network's own Calico address and token (optional)
        </summary>
        <p className="pt-2 text-muted">
          Leave both empty to keep what this network already has. To clear them,
          forget the network on the panel and set it up again.
        </p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <label className="label">
            Calico's address on this network
            <input
              className="field mt-1 font-mono"
              autoComplete="off"
              value={ownUrl}
              placeholder="Default URL"
              onChange={(e) => setOwnUrl(e.target.value)}
            />
          </label>
          <label className="label">
            Token for this network
            <input
              type="password"
              autoComplete="off"
              className="field mt-1"
              value={ownToken}
              placeholder="Default token"
              onChange={(e) => setOwnToken(e.target.value)}
            />
          </label>
        </div>
      </details>
      <p role="status" className="px-4 pt-2">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </p>
    </section>
  );
}
