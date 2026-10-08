import { useState } from "react";
import { injectBody, postWebhook } from "../lib/api";
import { ErrorNote } from "../shell/ErrorNote";

const TYPES = [
  "agent.launched",
  "agent.needs_you",
  "agent.finished",
  "note",
] as const;

export function InjectBar({ onSent }: { onSent: () => void }) {
  const [agentId, setAgentId] = useState("demo");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function send(type: string) {
    try {
      await postWebhook(injectBody(type, agentId, message));
      setError("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    }
  }

  return (
    <details className="border-t border-stroke/40">
      <summary className="section-title cursor-pointer">Test events</summary>
      <div className="flex flex-wrap items-end gap-3 px-4 pb-4">
        <label className="label">
          Agent id
          <input
            className="field mt-1 w-40"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          />
        </label>
        <label className="label flex-1">
          Message
          <input
            className="field mt-1"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className="btn"
            onClick={() => void send(type)}
          >
            {type.replace("agent.", "")}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="px-4 pb-3">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
    </details>
  );
}
