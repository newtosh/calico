import { useEffect, useState } from "react";
import { fetchConfig, type PublicConfig, putConfig } from "../lib/api";

export function ConfigSection() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [port, setPort] = useState("");
  const [poll, setPoll] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const loaded = await fetchConfig();
    setConfig(loaded);
    setPort(String(loaded.port));
    setPoll(String(loaded.cursor_poll_seconds));
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
