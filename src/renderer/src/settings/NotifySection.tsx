import { useEffect, useState } from "react";
import {
  fetchNotify,
  putNotify,
  type NotifyDelivery,
  type NotifyInfo,
  type NotifyPatch,
} from "../lib/api";
import { ago } from "../lib/time";
import { parseWhole } from "../lib/whole";

function line(delivery: NotifyDelivery): string {
  const what = delivery.type === "calico.online" ? "Panel online" : "Dismissed";
  const when = ago(delivery.at);
  if (delivery.ok) return `${what} sent ${when}.`;
  const why = delivery.status ? `HTTP ${delivery.status}` : delivery.error;
  return `${what} failed (${why}) ${when}.`;
}

export function NotifySection() {
  const [info, setInfo] = useState<NotifyInfo | null>(null);
  const [url, setUrl] = useState("");
  const [header, setHeader] = useState("");
  const [offline, setOffline] = useState("180");
  const [key, setKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeErr, setNoticeErr] = useState(false);
  const [saving, setSaving] = useState(false);

  function say(text: string, err = false) {
    setNotice(text);
    setNoticeErr(err);
  }

  function fill(next: NotifyInfo) {
    setInfo(next);
    setUrl("");
    setHeader(next.header === "Authorization" ? "" : next.header);
    setOffline(String(next.offline_seconds));
  }

  useEffect(() => {
    let on = true;
    const load = (form: boolean) => {
      fetchNotify()
        .then((next) => {
          if (!on) return;
          if (form) fill(next);
          else setInfo(next);
        })
        .catch((err: unknown) => {
          if (on)
            say(
              err instanceof Error ? err.message : "Could not load settings",
              true,
            );
        });
    };
    load(true);
    const id = window.setInterval(() => load(false), 5000);
    return () => {
      on = false;
      window.clearInterval(id);
    };
  }, []);

  async function apply(patch: NotifyPatch) {
    setSaving(true);
    say("");
    try {
      fill(await putNotify(patch));
      setKey(null);
      say(patch.clear ? "Cleared." : "Saved.");
    } catch (err) {
      say(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const seconds = parseWhole(offline, 30, 86400);
    if (seconds === null)
      return say(
        "Offline threshold must be a whole number of seconds from 30 to 86400.",
        true,
      );
    const typed = url.trim();
    if (!typed && !info?.url)
      return say("A webhook address is required, http or https.", true);
    void apply({
      ...(typed ? { url: typed } : {}),
      header,
      offline_seconds: seconds,
      ...(key !== null ? { key } : {}),
    });
  }

  const address = url.trim() || info?.url || "";
  const keyWillSend = key !== null ? key !== "" : Boolean(info?.key_set);
  const httpKey = address.startsWith("http://") && keyWillSend;
  const older = (info?.recent ?? []).filter(
    (item) =>
      !info?.last ||
      item.at !== info.last.at ||
      item.type !== info.last.type ||
      item.ok !== info.last.ok ||
      item.error !== info.last.error,
  );

  return (
    <section>
      <h2 className="section-title">Outbound webhook</h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        Calico POSTs here when the panel polls again after being quiet, and when
        a needs-you is dismissed.
      </p>
      <div className="grid max-w-2xl grid-cols-2 gap-3 px-4">
        <div className="col-span-2">
          <label className="label">
            Webhook address
            <input
              className="field mt-1 font-mono"
              value={url}
              placeholder="https://example.com/calico"
              aria-describedby="notify-url-hint"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <p id="notify-url-hint" className="pt-1 text-muted">
            https, or http on localhost, a private address, .local, or a
            Tailscale name. Leave this blank to keep the saved address.
          </p>
        </div>
        <div>
          <label className="label">
            Sender key
            <input
              type="password"
              className="field mt-1"
              autoComplete="off"
              value={key ?? ""}
              placeholder={info?.key_set ? "Set" : "Not set"}
              aria-describedby="notify-key-hint"
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <p id="notify-key-hint" className="pt-1 text-muted">
            The sender key is sealed with the system keyring and never shown
            again.
          </p>
        </div>
        <div>
          <label className="label">
            Header name
            <input
              className="field mt-1 font-mono"
              value={header}
              placeholder="Authorization"
              aria-describedby="notify-header-hint"
              onChange={(e) => setHeader(e.target.value)}
            />
          </label>
          <p id="notify-header-hint" className="pt-1 text-muted">
            Blank sends Authorization: Bearer and the key. A custom name sends
            the raw key.
          </p>
        </div>
        <div>
          <label className="label">
            Offline threshold seconds
            <input
              className="field mt-1"
              inputMode="numeric"
              value={offline}
              aria-describedby="notify-offline-hint"
              onChange={(e) => setOffline(e.target.value)}
            />
          </label>
          <p id="notify-offline-hint" className="pt-1 text-muted">
            How long Calico can go without hearing the panel. Default 180
            seconds.
          </p>
        </div>
      </div>
      {info?.url ? (
        <p className="max-w-2xl px-4 pt-2 text-muted">
          Saved address <span className="font-mono">{info.url}</span>
        </p>
      ) : null}
      <p
        id="notify-http-warning"
        role="status"
        className="max-w-2xl px-4 pt-2 text-amber"
      >
        {httpKey
          ? "Plain http sends the sender key in the clear. Use https on a public network."
          : ""}
      </p>
      <p role="status" className="max-w-2xl px-4 pt-2 text-muted">
        {info?.last ? line(info.last) : "Nothing sent yet."}
      </p>
      {older.length > 0 ? (
        <ul className="max-w-2xl px-8 text-muted">
          {older.map((item, index) => (
            <li key={`${item.at}-${item.type}-${index}`}>{line(item)}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving || !info?.key_set}
          onClick={() => void apply({ key: "" })}
        >
          Remove key
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() => void apply({ clear: true })}
        >
          Clear
        </button>
        <span
          id="notify-notice"
          role={noticeErr ? "alert" : "status"}
          className={noticeErr ? "text-amber" : "text-muted"}
        >
          {notice}
        </span>
      </div>
    </section>
  );
}
