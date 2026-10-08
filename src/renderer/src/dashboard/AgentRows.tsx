import type { DeskAgent } from "../lib/api";
import { AgentMark } from "./AgentMark";

const STATUS_CLASS: Record<string, string> = {
  needs_you: "text-amber",
  running: "text-sage",
};

export function AgentRows({ agents }: { agents: DeskAgent[] }) {
  if (agents.length === 0)
    return (
      <p className="px-4 py-3 text-muted">
        No agents yet. They appear when a webhook or the Cursor poll reports
        one.
      </p>
    );
  return (
    <ul>
      {agents.map((agent) => (
        <li
          key={agent.id}
          className={`row ${agent.attention ? "bg-selected/60" : ""}`}
        >
          <AgentMark color={agent.color} shape={agent.shape} />
          <span className="shrink-0 font-medium">
            {agent.title || agent.id}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {agent.message}
          </span>
          <span
            className={`shrink-0 text-xs uppercase ${STATUS_CLASS[agent.status] ?? "text-muted"}`}
          >
            {agent.status.replaceAll("_", " ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
