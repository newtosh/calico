import { useCallback, useEffect, useState } from "react";
import { fetchStatus, postDismiss, type DeskStatus } from "../api";
import { AgentList } from "./AgentList";
import { EventList } from "./EventList";
import { InjectPanel } from "./InjectPanel";
import { NeedsYouBanner } from "./NeedsYouBanner";
import { ConfigForm } from "./ConfigForm";
import { RequestToken } from "./RequestToken";

export function StatusDashboard() {
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [error, setError] = useState("");
  const [dismissError, setDismissError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "status failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function dismiss(): Promise<void> {
    try {
      await postDismiss();
      setDismissError("");
      await refresh();
    } catch (err) {
      setDismissError(err instanceof Error ? err.message : "dismiss failed");
    }
  }

  const phase = status?.phase ?? "idle";
  const phaseClass =
    phase === "needs_you"
      ? "text-alert"
      : phase === "running"
        ? "text-run"
        : "text-muted";

  return (
    <div className="flex flex-col gap-6">
      <NeedsYouBanner status={status} onDismiss={() => void dismiss()} />
      {dismissError ? (
        <p className="text-sm text-alert">{dismissError}</p>
      ) : null}
      <RequestToken />
      <section className="rounded-lg bg-panel p-4">
        <p className="text-sm tracking-[0.16em] text-muted uppercase">Phase</p>
        <p className={`mt-1 text-4xl font-semibold ${phaseClass}`}>
          {phase.replace("_", " ")}
        </p>
        <p className="mt-4 text-sm text-muted">Last event</p>
        <p className="text-lg">
          {status?.last_event?.title ||
            status?.last_event?.message ||
            "Nothing yet."}
        </p>
        {error ? <p className="mt-2 text-sm text-alert">{error}</p> : null}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <AgentList agents={status?.agents ?? []} />
        <EventList events={status?.events ?? []} />
      </div>
      <InjectPanel onSent={() => void refresh()} />
      <ConfigForm />
    </div>
  );
}
