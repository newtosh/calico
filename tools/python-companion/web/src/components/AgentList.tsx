import type { DeskAgent } from "../api";

interface AgentListProps {
  agents: DeskAgent[];
}

export function AgentList({ agents }: AgentListProps) {
  return (
    <section className="rounded-lg bg-panel p-4">
      <h2 className="text-sm tracking-[0.16em] text-muted uppercase">Agents</h2>
      {agents.length === 0 ? (
        <p className="mt-3 text-muted">No agents yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="flex items-baseline justify-between gap-3"
            >
              <span>
                <span className="font-medium">{agent.title || agent.id}</span>
                <span className="ml-2 text-sm text-muted">{agent.id}</span>
              </span>
              <span
                className={
                  agent.status === "running" ? "text-run" : "text-muted"
                }
              >
                {agent.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
