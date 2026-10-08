import type { DeskEvent } from "../lib/api";
import { localTime } from "../lib/time";

export function EventRows({ events }: { events: DeskEvent[] }) {
  if (events.length === 0)
    return <p className="px-4 py-3 text-muted">No events yet.</p>;
  return (
    <ul>
      {events.map((event) => (
        <li key={event.id} className="row">
          <time className="shrink-0 font-mono text-xs text-muted">
            {localTime(event.at)}
          </time>
          <span
            className={`shrink-0 text-xs ${event.type === "agent.needs_you" ? "text-amber" : "text-muted"}`}
          >
            {event.type}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {event.title || event.message || event.agent_id}
          </span>
          <span className="shrink-0 text-xs text-muted">{event.source}</span>
        </li>
      ))}
    </ul>
  );
}
