import { useEffect, useState } from "react";
import { fetchPanel, putPanel, type PanelPush } from "../api";

export function PanelPushForm() {
  const [panel, setPanel] = useState<PanelPush | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [tokenEdited, setTokenEdited] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetchPanel()
      .then((loaded) => {
        setPanel(loaded);
        setUrl(loaded.url);
      })
      .catch((err: unknown) => {
        setNotice(err instanceof Error ? err.message : "panel failed");
      });
  }, []);

  function showError(err: unknown): void {
    const message = err instanceof Error ? err.message : "panel failed";
    if (message.includes("401")) {
      setNotice("Unauthorized. Enter the browser token above, then try again.");
      return;
    }
    setNotice(message);
  }

  async function save(): Promise<void> {
    setNotice("");
    try {
      const saved = await putPanel({
        url,
        ...(tokenEdited ? { token } : {}),
      });
      setPanel(saved);
      setUrl(saved.url);
      setToken("");
      setTokenEdited(false);
      setNotice(
        "Stored on the companion. The panel writes NVS and restarts on its next successful status poll. Wi-Fi is unchanged. If the panel shows link down, this is waiting and has not been applied.",
      );
    } catch (err) {
      showError(err);
    }
  }

  async function clear(): Promise<void> {
    setNotice("");
    try {
      const saved = await putPanel({ clear: true });
      setPanel(saved);
      setUrl("");
      setToken("");
      setTokenEdited(false);
      setNotice(
        "Cleared. Status no longer carries a panel token. Values already in NVS stay until the next push or an on-device save.",
      );
    } catch (err) {
      showError(err);
    }
  }

  return (
    <section className="rounded-lg bg-panel p-4">
      <h2 className="text-sm tracking-[0.16em] text-muted uppercase">
        Panel config
      </h2>
      <p className="mt-2 text-sm text-muted">
        LAN path for the companion URL and bearer token after the board is on
        Wi-Fi. The panel picks this up from the status poll it already makes.
        SSID and Wi-Fi password stay on the device.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-muted">
          Companion URL
          <input
            className="mt-1 w-full rounded bg-ink px-3 py-2 text-paper"
            value={url}
            placeholder="http://192.168.4.30:8787"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="text-sm text-muted">
          Panel bearer token
          <input
            type="password"
            className="mt-1 w-full rounded bg-ink px-3 py-2 text-paper"
            value={token}
            placeholder={panel?.token_set ? "Token is set" : "Not set"}
            onChange={(event) => {
              setToken(event.target.value);
              setTokenEdited(true);
            }}
          />
        </label>
      </div>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          className="rounded bg-ink px-3 py-2 text-sm"
          onClick={() => void save()}
        >
          Save to panel
        </button>
        <button
          type="button"
          className="rounded bg-ink px-3 py-2 text-sm"
          onClick={() => void clear()}
        >
          Clear
        </button>
      </div>
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
