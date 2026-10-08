import { useEffect, useState } from "react";
import { type CursorInfo, fetchCursor } from "../lib/api";
import { ago } from "../lib/time";
import { ErrorNote } from "../shell/ErrorNote";

export function CursorStatus() {
  const [status, setStatus] = useState<CursorInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchCursor()
        .then((next) => alive && setStatus(next))
        .catch(() => undefined);
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!status) return null;
  return (
    <p role="status" className="max-w-2xl px-4 pb-1">
      {!status.configured ? (
        <span className="text-muted">
          Cursor polling is off. Add a Cursor API key above to list your Cursor
          agents.
        </span>
      ) : status.ok === null ? (
        <span className="text-amber">Waiting for the first poll.</span>
      ) : status.ok ? (
        <span className="text-sage">
          Polling works: {status.agents}{" "}
          {status.agents === 1 ? "agent" : "agents"},{" "}
          {ago(status.last_poll_at ?? "")}.
        </span>
      ) : (
        <ErrorNote>{status.error}</ErrorNote>
      )}
    </p>
  );
}
