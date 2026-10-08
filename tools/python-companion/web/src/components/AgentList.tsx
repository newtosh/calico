import { agentIconUrl, agentMark, type DeskAgent } from "../api";

interface AgentListProps {
  agents: DeskAgent[];
}

export function AgentList({ agents }: AgentListProps) {
  return (
    <section className="desk-card">
      <h2 className="desk-kicker">Agents</h2>
      {agents.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No agents yet.</p>
      ) : (
        <ul className="mt-2">
          {agents.map((agent) => {
            const iconUrl = agentIconUrl(agent.icon);
            const mark = agentMark(agent.color, agent.shape);
            const shapeClass =
              mark.shape === "square"
                ? "h-4 w-4 rounded-sm"
                : mark.shape === "diamond"
                  ? "h-3 w-3 rotate-45 rounded-sm"
                  : mark.shape === "triangle"
                    ? "mark-triangle h-4 w-4"
                    : "h-4 w-4 rounded-full";
            return (
              <li
                key={agent.id}
                className="flex items-center justify-between gap-3 border-b border-edge/40 py-2 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <span
                      className={`block ${shapeClass}`}
                      style={{ backgroundColor: mark.color }}
                    />
                  </span>
                  {iconUrl ? (
                    <img
                      src={iconUrl}
                      alt=""
                      className="h-4 w-4 shrink-0 object-cover"
                    />
                  ) : agent.icon ? (
                    <span className="shrink-0 text-xs text-muted">
                      {agent.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="font-medium">
                      {agent.title || agent.id}
                    </span>
                    <span className="ml-2 text-sm text-muted">{agent.id}</span>
                  </span>
                </span>
                <span
                  className={`shrink-0 text-xs font-medium tracking-wide uppercase ${
                    agent.status === "needs_you"
                      ? "text-alert"
                      : agent.status === "running"
                        ? "text-run"
                        : "text-muted"
                  }`}
                >
                  {agent.status.replaceAll("_", " ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
