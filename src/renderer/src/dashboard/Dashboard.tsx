import { useCallback, useEffect, useState } from "react";
import { type DeskStatus, fetchStatus, postDismiss } from "../lib/api";
import {
  agentSource,
  loadFilter,
  matchesFilter,
  saveFilter,
  type SourceFilter,
} from "../lib/sources";
import { AgentRows } from "./AgentRows";
import { EmptyAgents } from "./EmptyAgents";
import { EventRows } from "./EventRows";
import { InjectBar } from "./InjectBar";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { SourceToggle } from "./SourceToggle";
import { ErrorNote } from "../shell/ErrorNote";

export function Dashboard({
  serverUrl,
  webhookUrl,
  onSetup,
}: {
  serverUrl: string;
  webhookUrl: string | null;
  onSetup: () => void;
}) {
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [filter, setFilter] = useState<SourceFilter>(loadFilter);
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

  const events = status?.events ?? [];
  const everyAgent = status?.agents ?? [];
  const sourceOfAgent = (agent: DeskStatus["agents"][number]) =>
    agentSource(agent, events);
  const agents = everyAgent.filter((a) =>
    matchesFilter(sourceOfAgent(a), filter),
  );
  const shownEvents = events.filter((e) => matchesFilter(e.source, filter));
  const counts: Record<SourceFilter, number> = {
    combined: everyAgent.length,
    grok: everyAgent.filter((a) => matchesFilter(sourceOfAgent(a), "grok"))
      .length,
    cursor: everyAgent.filter((a) => matchesFilter(sourceOfAgent(a), "cursor"))
      .length,
  };
  const running = agents.filter((a) => a.status !== "idle").length;
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
          {running}/{agents.length} active
        </span>
        {error ? (
          <span role="alert">
            <ErrorNote>{error}</ErrorNote>
          </span>
        ) : null}
      </div>
      <SourceToggle
        value={filter}
        counts={counts}
        onChange={(next) => {
          setFilter(next);
          saveFilter(next);
        }}
      />
      <h2 className="section-title">Agents</h2>
      {agents.length === 0 ? (
        <EmptyAgents
          filter={filter}
          webhookUrl={webhookUrl}
          onSetup={onSetup}
        />
      ) : (
        <AgentRows
          agents={agents}
          events={events}
          showSource={filter === "combined"}
        />
      )}
      <h2 className="section-title">Events</h2>
      <EventRows events={shownEvents} />
      <InjectBar onSent={() => void refresh()} />
    </div>
  );
}
