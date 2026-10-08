import { useEffect, useState } from "react";
import { fetchPanel, type PanelPush, putPanel } from "../lib/api";

export function PanelSection() {
  const [panel, setPanel] = useState<PanelPush | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchPanel()
      .then((p) => {
        setPanel(p);
        setUrl(p.url);
      })
      .catch((err: unknown) =>
        setNotice(
          err instanceof Error ? err.message : "Could not load panel push",
        ),
      );
  }, []);

  async function apply(patch: Parameters<typeof putPanel>[0]) {
    try {
      const saved = await putPanel(patch);
      setPanel(saved);
      setUrl(saved.url);
      setToken(null);
      setNotice(
        patch.clear
          ? "Cleared."
          : "Saved. The panel applies it on its next successful poll.",
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <section>
      <h2 className="section-title">Panel push</h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        Sends a companion URL and token to the panel through its status poll.
        Use this when the panel is already online. For a panel that is offline,
        use Device.
      </p>
      <div className="grid max-w-2xl grid-cols-2 gap-3 px-4">
        <label className="label">
          Companion URL
          <input
            className="field mt-1 font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="label">
          Panel token
          <input
            type="password"
            className="field mt-1"
            value={token ?? ""}
            placeholder={panel?.token_set ? "Set" : "Not set"}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void apply({ url, ...(token !== null ? { token } : {}) })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="btn"
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
