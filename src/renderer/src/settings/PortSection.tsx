import { useEffect, useState } from "react";
import { fetchConfig, putConfig } from "../lib/api";
import { parseWhole } from "../lib/whole";

export function PortSection() {
  const [port, setPort] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchConfig()
      .then((loaded) => setPort(String(loaded.port)))
      .catch((err: unknown) =>
        setNotice(
          err instanceof Error ? err.message : "Could not load settings",
        ),
      );
  }, []);

  async function save() {
    // The server refuses a bad number outright, so check here.
    const portNumber = parseWhole(port, 1, 65535);
    if (portNumber === null)
      return setNotice("Port must be a whole number from 1 to 65535.");
    try {
      const { restart_required } = await putConfig({ port: portNumber });
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
      <h2 className="section-title">Companion port</h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        The port the panel and your agents reach calico on. A change takes
        effect after calico restarts.
      </p>
      <div className="flex max-w-2xl items-end gap-3 px-4">
        <label className="label w-40">
          Port
          <input
            className="field mt-1"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
        >
          Save port
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
