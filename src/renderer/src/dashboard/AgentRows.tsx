import type { DeskAgent, DeskEvent } from "../lib/api";
import { agentSource, sourceOf } from "../lib/sources";
import { ago } from "../lib/time";
import { AgentMark } from "./AgentMark";

const STATUS_CLASS: Record<string, string> = {
  needs_you: "text-amber",
  running: "text-sage",
};

export function AgentRows({
  agents,
  events,
  showSource,
}: {
  agents: DeskAgent[];
  events: DeskEvent[];
  showSource: boolean;
}) {
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
          {showSource ? (
            <span className="w-16 shrink-0 text-xs text-muted">
              {sourceOf(agentSource(agent, events)) === "cursor"
                ? "Cursor"
                : "Grok Bot"}
            </span>
          ) : null}
          <span className="w-20 shrink-0 text-right text-xs text-muted">
            {ago(agent.updated_at)}
          </span>
          <span
            className={`w-20 shrink-0 text-right text-xs uppercase ${STATUS_CLASS[agent.status] ?? "text-muted"}`}
          >
            {agent.status.replaceAll("_", " ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
