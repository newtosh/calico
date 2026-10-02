import type { DeskEvent } from "../api";

interface EventListProps {
  events: DeskEvent[];
}

export function EventList({ events }: EventListProps) {
  return (
    <section className="rounded-lg bg-panel p-4">
      <h2 className="text-sm tracking-[0.16em] text-muted uppercase">Events</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-muted">No events yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id}>
              <p className="text-sm text-muted">
                {event.at} · {event.type} · {event.source}
              </p>
              <p>{event.title || event.message || event.agent_id}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
