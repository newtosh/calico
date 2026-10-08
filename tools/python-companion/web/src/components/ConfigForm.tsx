import { useEffect, useState } from "react";
import {
  fetchConfig,
  putConfig,
  rememberToken,
  type PublicConfig,
} from "../api";

export function ConfigForm() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState("8787");
  const [sqlitePath, setSqlitePath] = useState("");
  const [pollSeconds, setPollSeconds] = useState("30");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [tokenEdited, setTokenEdited] = useState(false);
  const [keyEdited, setKeyEdited] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetchConfig()
      .then((loaded) => {
        setConfig(loaded);
        setHost(loaded.bind_host);
        setPort(String(loaded.bind_port));
        setSqlitePath(loaded.sqlite_path);
        setPollSeconds(String(loaded.cursor_poll_seconds));
      })
      .catch((err: unknown) => {
        setNotice(err instanceof Error ? err.message : "config failed");
      });
  }, []);

  async function save(): Promise<void> {
    setNotice("");
    try {
      await putConfig({
        bind_host: host,
        bind_port: Number(port),
        sqlite_path: sqlitePath,
        cursor_poll_seconds: Number(pollSeconds),
        ...(tokenEdited ? { webhook_token: token } : {}),
        ...(keyEdited ? { cursor_api_key: apiKey } : {}),
      });
      if (tokenEdited) {
        rememberToken(token);
      }
      const loaded = await fetchConfig();
      setConfig(loaded);
      setToken("");
      setApiKey("");
      setTokenEdited(false);
      setKeyEdited(false);
      setNotice("Saved. Host, port, and sqlite path apply on the next start.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "save failed");
    }
  }

  return (
    <section className="desk-card">
      <h2 className="desk-kicker">Companion config</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="desk-label">
          Bind host
          <input
            className="desk-field"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Bind port
          <input
            className="desk-field"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        <label className="desk-label">
          SQLite path
          <input
            className="desk-field"
            value={sqlitePath}
            onChange={(event) => setSqlitePath(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Cursor poll seconds
          <input
            className="desk-field"
            value={pollSeconds}
            onChange={(event) => setPollSeconds(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Webhook bearer token
          <input
            type="password"
            className="desk-field"
            value={token}
            placeholder={config?.webhook_token_set ? "Token is set" : "Not set"}
            onChange={(event) => {
              setToken(event.target.value);
              setTokenEdited(true);
            }}
          />
        </label>
        <label className="desk-label">
          Cursor API key
          <input
            type="password"
            className="desk-field"
            value={apiKey}
            placeholder={config?.cursor_api_key_set ? "Key is set" : "Not set"}
            onChange={(event) => {
              setApiKey(event.target.value);
              setKeyEdited(true);
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="desk-button mt-3"
        onClick={() => void save()}
      >
        Save
      </button>
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
