import { useCallback, useEffect, useState } from "react";
import { type DeskStatus, fetchStatus, postDismiss } from "../lib/api";
import { AgentRows } from "./AgentRows";
import { EventRows } from "./EventRows";
import { InjectBar } from "./InjectBar";
import { NeedsYouStrip } from "./NeedsYouStrip";

export function Dashboard({ serverUrl }: { serverUrl: string }) {
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [refresh, serverUrl]);

  const running = status?.agents.filter((a) => a.status !== "idle").length ?? 0;
  return (
    <div className="flex flex-col">
      {status ? (
        <NeedsYouStrip
          status={status}
          onDismiss={() => void postDismiss().then(refresh)}
        />
      ) : null}
      <div className="flex items-baseline gap-4 px-4 pt-4">
        <h1 className="text-lg font-medium capitalize">
          {(status?.phase ?? "idle").replace("_", " ")}
        </h1>
        <span className="text-muted">
          {running}/{status?.agents.length ?? 0} active
        </span>
        {error ? <span className="text-red">{error}</span> : null}
      </div>
      <h2 className="section-title">Agents</h2>
      <AgentRows agents={status?.agents ?? []} />
      <h2 className="section-title">Events</h2>
      <EventRows events={status?.events ?? []} />
      <InjectBar onSent={() => void refresh()} />
    </div>
  );
}
