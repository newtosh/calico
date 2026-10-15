import { useEffect, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import type { DeskInfo, DeviceLink } from "./commands";

export function LinkActions({
  info,
  link,
  onReboot,
}: {
  info: CalicoInfo;
  link: DeviceLink;
  onReboot: () => Promise<void>;
}) {
  const [panelInfo, setPanelInfo] = useState<DeskInfo | null>(null);
  // Follows the address banner's offer, even when already open, until the person types.
  const [typed, setTyped] = useState<string | null>(null);
  const url = typed ?? info.addressChange?.url ?? info.lanUrls[0] ?? "";
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const reply = await link.send({ op: "status" });
    if (reply.ok && reply.info) setPanelInfo(reply.info);
    else if (!reply.ok) setNotice(reply.error);
  };

  useEffect(() => {
    void refresh();
  }, [link]);

  async function setPanelUrl() {
    const reply = await link.send({ op: "url", value: url });
    if (!reply.ok) return setNotice(reply.error);
    if (info.port && url.endsWith(`:${info.port}`))
      await window.calico.adoptPort();
    setNotice(
      "Calico's address saved on the panel. It applies after a reboot.",
    );
    await refresh();
  }

  async function sendToken() {
    const reply = await link.send({ op: "token", value: info.webhookToken });
    setNotice(
      reply.ok
        ? info.webhookToken
          ? "Token sent."
          : "Token cleared on the panel."
        : reply.error,
    );
    await refresh();
  }

  // DeviceView shows the outcome: the wait for the panel, or the error.
  async function reboot() {
    setNotice("");
    await onReboot();
  }

  return (
    <section>
      <h2 className="section-title">Panel</h2>
      {panelInfo ? (
        <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-y-1 px-4">
          <dt className="text-muted">Firmware</dt>
          <dd>{panelInfo.fw || "unknown"}</dd>
          <dt className="text-muted">Wi-Fi</dt>
          <dd>{panelInfo.ssid || "none"}</dd>
          <dt className="text-muted">Calico address</dt>
          <dd className="font-mono">{panelInfo.url || "none"}</dd>
          <dt className="text-muted">Token</dt>
          <dd>{panelInfo.token}</dd>
        </dl>
      ) : (
        <p className="px-4 text-muted">Reading the panel.</p>
      )}
      <div className="flex max-w-2xl items-end gap-3 px-4 pt-3">
        <label className="label flex-1">
          Calico's address (the panel polls this)
          <input
            className="field mt-1 font-mono"
            value={url}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => void setPanelUrl()}
        >
          Set URL
        </button>
      </div>
      <div className="flex gap-3 px-4 pt-3">
        <button type="button" className="btn" onClick={() => void sendToken()}>
          {info.webhookToken ? "Send webhook token" : "Clear the panel's token"}
        </button>
        <button type="button" className="btn" onClick={() => void reboot()}>
          Reboot panel
        </button>
      </div>
      {notice ? (
        <p role="status" className="px-4 pt-2 text-muted">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
