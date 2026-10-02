import { useState } from "react";
import { injectBody, postWebhook } from "../api";

interface InjectPanelProps {
  onSent: () => void;
}

const ACTIONS: Array<{ type: string; label: string }> = [
  { type: "agent.launched", label: "Launch" },
  { type: "agent.finished", label: "Finish" },
  { type: "agent.needs_you", label: "Needs you" },
  { type: "note", label: "Note" },
];

export function InjectPanel({ onSent }: InjectPanelProps) {
  const [agentId, setAgentId] = useState("demo");
  const [message, setMessage] = useState("Check the desk");
  const [error, setError] = useState("");

  async function send(type: string): Promise<void> {
    setError("");
    try {
      await postWebhook(injectBody(type, agentId, message));
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "inject failed");
    }
  }

  return (
    <section className="rounded-lg bg-panel p-4">
      <h2 className="text-sm tracking-[0.16em] text-muted uppercase">
        Inject test event
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-muted">
          Agent id
          <input
            className="mt-1 w-full rounded bg-ink px-3 py-2 text-paper"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          />
        </label>
        <label className="text-sm text-muted">
          Message
          <input
            className="mt-1 w-full rounded bg-ink px-3 py-2 text-paper"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action.type}
            type="button"
            className="rounded bg-ink px-3 py-2 text-sm"
            onClick={() => void send(action.type)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-sm text-alert">{error}</p> : null}
    </section>
  );
}
