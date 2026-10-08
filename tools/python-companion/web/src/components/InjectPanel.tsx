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
  const [color, setColor] = useState("");
  const [shape, setShape] = useState("");
  const [icon, setIcon] = useState("");
  const [error, setError] = useState("");

  async function send(type: string): Promise<void> {
    setError("");
    try {
      await postWebhook(
        injectBody(type, agentId, message, { color, shape, icon }),
      );
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "inject failed");
    }
  }

  return (
    <section className="desk-card">
      <h2 className="desk-kicker">Inject test event</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="desk-label">
          Agent id
          <input
            className="desk-field"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Message
          <input
            className="desk-field"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Color
          <input
            className="desk-field"
            value={color}
            placeholder="#c45c26"
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Shape
          <input
            className="desk-field"
            value={shape}
            placeholder="circle, square, diamond, triangle"
            onChange={(event) => setShape(event.target.value)}
          />
        </label>
        <label className="desk-label">
          Icon
          <input
            className="desk-field"
            value={icon}
            placeholder="name or https://…"
            onChange={(event) => setIcon(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action.type}
            type="button"
            className={`desk-button ${action.type === "agent.needs_you" ? "text-alert" : ""}`}
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
