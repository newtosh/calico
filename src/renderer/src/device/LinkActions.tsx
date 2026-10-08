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
  const [desk, setDesk] = useState<DeskInfo | null>(null);
  const [url, setUrl] = useState(info.lanUrls[0] ?? "");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const reply = await link.send({ op: "status" });
    if (reply.ok && reply.info) setDesk(reply.info);
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
    setNotice("URL saved on the desk. It applies after a reboot.");
    await refresh();
  }

  async function sendToken() {
    const reply = await link.send({ op: "token", value: info.webhookToken });
    setNotice(
      reply.ok
        ? info.webhookToken
          ? "Token sent."
          : "Token cleared on the desk."
        : reply.error,
    );
    await refresh();
  }

  async function reboot() {
    setNotice("Rebooting the desk.");
    await onReboot();
  }

  return (
    <section>
      <h2 className="section-title">Desk</h2>
      {desk ? (
        <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-y-1 px-4">
          <dt className="text-muted">Firmware</dt>
          <dd>{desk.fw || "unknown"}</dd>
          <dt className="text-muted">Wi-Fi</dt>
          <dd>{desk.ssid || "none"}</dd>
          <dt className="text-muted">Companion</dt>
          <dd className="font-mono">{desk.url || "none"}</dd>
          <dt className="text-muted">Token</dt>
          <dd>{desk.token}</dd>
        </dl>
      ) : (
        <p className="px-4 text-muted">Reading the desk.</p>
      )}
      <div className="flex max-w-2xl items-end gap-3 px-4 pt-3">
        <label className="label flex-1">
          Companion URL for the desk
          <input
            className="field mt-1 font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
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
          {info.webhookToken ? "Send webhook token" : "Clear desk token"}
        </button>
        <button type="button" className="btn" onClick={() => void reboot()}>
          Reboot desk
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
