import { useEffect, useState } from "react";
import { fetchConfig, type PublicConfig, putConfig } from "../lib/api";

export function ConfigSection() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [port, setPort] = useState("");
  const [poll, setPoll] = useState("");
  const [runningFor, setRunningFor] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const loaded = await fetchConfig();
    setConfig(loaded);
    setPort(String(loaded.port));
    setPoll(String(loaded.cursor_poll_seconds));
    setRunningFor(String(loaded.running_timeout_seconds));
  };

  useEffect(() => {
    load().catch((err: unknown) =>
      setNotice(err instanceof Error ? err.message : "Could not load settings"),
    );
  }, []);

  async function save() {
    try {
      const { restart_required } = await putConfig({
        port: Number(port),
        cursor_poll_seconds: Number(poll),
        running_timeout_seconds: Number(runningFor),
        ...(token !== null ? { webhook_token: token } : {}),
        ...(apiKey !== null ? { cursor_api_key: apiKey } : {}),
      });
      setToken(null);
      setApiKey(null);
      await load();
      setNotice(
        restart_required
          ? "Saved. Quit and reopen calico to use the new port."
          : "Saved.",
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <section>
      <h2 className="section-title">Companion</h2>
      <div className="grid max-w-2xl grid-cols-2 gap-3 px-4">
        <label className="label">
          Port
          <input
            className="field mt-1"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="label">
          Cursor poll seconds
          <input
            className="field mt-1"
            inputMode="numeric"
            value={poll}
            onChange={(e) => setPoll(e.target.value)}
          />
        </label>
        <div className="col-span-2">
          <label className="label">
            Running timeout seconds
            <input
              className="field mt-1"
              inputMode="numeric"
              aria-describedby="running-timeout-hint"
              value={runningFor}
              onChange={(e) => setRunningFor(e.target.value)}
            />
          </label>
          <p id="running-timeout-hint" className="mt-1 text-xs text-muted">
            How long a bot stays Running without an update, from 30 to 3600. Set
            it above how often your routines ping: Grok Bot routines run at most
            every 5 minutes, so use 360 or more.
          </p>
        </div>
        <label className="label">
          Webhook token
          <input
            type="password"
            className="field mt-1"
            value={token ?? ""}
            placeholder={
              config?.webhook_token_set
                ? "Set (type to replace, clear to remove)"
                : "Not set"
            }
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label className="label">
          Cursor API key
          <input
            type="password"
            className="field mt-1"
            value={apiKey ?? ""}
            placeholder={config?.cursor_api_key_set ? "Set" : "Not set"}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
        >
          Save
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
