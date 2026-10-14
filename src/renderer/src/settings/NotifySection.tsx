import { useEffect, useState } from "react";
import {
  fetchNotify,
  putNotify,
  type NotifyInfo,
  type NotifyPatch,
} from "../lib/api";
import { parseWhole } from "../lib/whole";

function lastLine(info: NotifyInfo): string {
  const last = info.last;
  if (!last) return "Nothing sent yet.";
  const what = last.type === "calico.online" ? "Panel online" : "Dismissed";
  if (last.ok) return `${what} sent ${last.at}.`;
  const why = last.status ? `HTTP ${last.status}` : last.error;
  return `${what} failed (${why}).`;
}

export function NotifySection() {
  const [info, setInfo] = useState<NotifyInfo | null>(null);
  const [url, setUrl] = useState("");
  const [header, setHeader] = useState("");
  const [offline, setOffline] = useState("180");
  const [key, setKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  function fill(next: NotifyInfo) {
    setInfo(next);
    setUrl(next.url);
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
            setNotice(
              err instanceof Error ? err.message : "Could not load settings",
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
    setNotice("");
    try {
      fill(await putNotify(patch));
      setKey(null);
      setNotice(patch.clear ? "Cleared." : "Saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const seconds = parseWhole(offline, 30, 86400);
    if (seconds === null)
      return setNotice(
        "Offline threshold must be a whole number of seconds from 30 to 86400.",
      );
    if (!url.trim())
      return setNotice("A webhook address is required, http or https.");
    void apply({
      url: url.trim(),
      header,
      offline_seconds: seconds,
      ...(key !== null ? { key } : {}),
    });
  }

  return (
    <section>
      <h2 className="section-title">Outbound webhook</h2>
      <p id="notify-help" className="max-w-2xl px-4 pb-2 text-muted">
        Calico POSTs here when the panel polls again after being quiet, and when
        a needs-you is dismissed. The address is http or https. The sender key
        is sealed with the system keyring and never shown again. Leave the
        header blank to send Authorization: Bearer and the key. A custom header
        name sends the raw key as that header's value, with no Bearer prefix.
        The panel counts as offline after the threshold below, 180 seconds
        unless you change it.
      </p>
      <div className="grid max-w-2xl grid-cols-2 gap-3 px-4">
        <label className="label col-span-2">
          Webhook address
          <input
            className="field mt-1 font-mono"
            value={url}
            placeholder="https://example.com/calico"
            aria-describedby="notify-help"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="label">
          Sender key
          <input
            type="password"
            className="field mt-1"
            autoComplete="off"
            value={key ?? ""}
            placeholder={
              info?.key_set
                ? "Set (type to replace, clear to remove)"
                : "Not set"
            }
            aria-describedby="notify-help"
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className="label">
          Header name
          <input
            className="field mt-1 font-mono"
            value={header}
            placeholder="Authorization"
            aria-describedby="notify-help"
            onChange={(e) => setHeader(e.target.value)}
          />
        </label>
        <label className="label">
          Offline threshold seconds
          <input
            className="field mt-1"
            inputMode="numeric"
            value={offline}
            aria-describedby="notify-help"
            onChange={(e) => setOffline(e.target.value)}
          />
        </label>
      </div>
      <p role="status" className="max-w-2xl px-4 pt-2 text-muted">
        {info ? lastLine(info) : "Loading the last send."}
      </p>
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
          disabled={saving}
          onClick={() => void apply({ clear: true })}
        >
          Clear
        </button>
        {notice ? (
          <span role="status" className="text-muted">
            {notice}
          </span>
        ) : null}
      </div>
    </section>
  );
}
