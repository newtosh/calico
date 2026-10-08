import type { DeskEvent } from "../api";

interface EventListProps {
  events: DeskEvent[];
}

export function EventList({ events }: EventListProps) {
  return (
    <section className="desk-card">
      <h2 className="desk-kicker">Events</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No events yet.</p>
      ) : (
        <ul className="mt-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="border-b border-edge/40 py-2 last:border-b-0"
            >
              <p className="text-xs text-muted">
                {event.at}
                {" · "}
                <span
                  className={
                    event.type === "agent.needs_you"
                      ? "text-alert"
                      : event.type === "agent.launched"
                        ? "text-run"
                        : "text-muted"
                  }
                >
                  {event.type}
                </span>
                {" · "}
                {event.source}
              </p>
              <p className="mt-0.5">
                {event.title || event.message || event.agent_id}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
