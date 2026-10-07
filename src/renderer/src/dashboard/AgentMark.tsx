import { agentMark } from "../lib/api";

export function AgentMark({ color, shape }: { color: string; shape: string }) {
  const mark = agentMark(color, shape);
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden="true">
      {mark.shape === "square" ? (
        <rect x="2" y="2" width="12" height="12" rx="2" fill={mark.color} />
      ) : mark.shape === "diamond" ? (
        <path d="M8 1 15 8 8 15 1 8Z" fill={mark.color} />
      ) : mark.shape === "triangle" ? (
        <path d="M8 2 15 14H1Z" fill={mark.color} />
      ) : (
        <circle cx="8" cy="8" r="6.5" fill={mark.color} />
      )}
    </svg>
  );
}
