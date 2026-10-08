import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { configureApi, putConfig, putPanel } from "../lib/api";
import { newWebhookToken } from "../lib/token";
import { webhookUrl } from "../lib/webhook";
import { ErrorNote } from "../shell/ErrorNote";

type Step = "idle" | "confirm" | "working";

function Copy({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function AgentUpdatesSection({ info }: { info: CalicoInfo }) {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");

  const webhook = webhookUrl(info);
  if (!webhook)
    return (
      <section>
        <h2 className="section-title">Agent updates</h2>
        <p className="max-w-2xl px-4 text-muted">
          calico&apos;s server is not running, so nothing can post updates. Fix
          the notice at the top first.
        </p>
      </section>
    );
  const auth = info.webhookToken ? ' -H "Authorization: Bearer <token>"' : "";
  const example = `curl -X POST ${webhook} -H "Content-Type: application/json"${auth} -d '{"type":"agent.launched","agent_id":"desky","title":"Desky","message":"hello"}'`;

  async function apply() {
    if (!info.serverUrl) return;
    setError("");
    setNote("");
    setStep("working");
    const next = newWebhookToken();
    try {
      await putConfig({ webhook_token: next });
    } catch (err) {
      setStep("confirm");
      return setError(err instanceof Error ? err.message : "Save failed");
    }
    // calico now requires the new token on every write, including the next call.
    configureApi(info.serverUrl, next);
    setToken(next);
    setStep("idle");
    // The panel reads the same token for its dismiss taps.
    const lan = info.lanUrls[0];
    if (!lan)
      return setNote("Saved. No LAN address, so the panel was not updated.");
    try {
      await putPanel({ url: lan, token: next });
      setNote("Saved, and sent to the panel on its next poll.");
    } catch (err) {
      setNote(
        `Saved, but the panel was not updated: ${err instanceof Error ? err.message : "failed"}. Push it from Panel push below.`,
      );
    }
  }

  return (
    <section>
      <h2 className="section-title">Agent updates</h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        Point Grok Bot routines (such as desky) and other agents at this
        address. calico shows whatever they post. Cursor agents come from
        polling instead, set up above.
      </p>
      <div className="flex max-w-2xl items-center gap-3 px-4">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">
          {webhook}
        </code>
        <Copy label="Copy webhook URL" text={webhook} />
      </div>
      <p className="max-w-2xl px-4 pt-2">
        {info.webhookToken
          ? "A token is set. Posts must send it as a Bearer header."
          : "No token is set, so anyone on your network can post events."}
      </p>
      <pre className="mx-4 mt-2 max-w-2xl overflow-x-auto border border-stroke bg-field px-3 py-2 font-mono text-xs whitespace-pre-wrap">
        {example}
      </pre>
      <div className="px-4 pt-3">
        {step === "idle" ? (
          <button
            type="button"
            className="btn"
            onClick={() => setStep("confirm")}
          >
            {info.webhookToken ? "Replace the token…" : "Set a token…"}
          </button>
        ) : (
          <div className="max-w-2xl border border-amber/60 bg-surface p-3">
            <p className="text-amber">
              Routines that post without the new token will get 401 until you
              update them. calico also sends it to the panel for its dismiss
              taps.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={step === "working"}
                onClick={() => void apply()}
              >
                Generate and apply
              </button>
              <button
                type="button"
                className="btn"
                disabled={step === "working"}
                onClick={() => setStep("idle")}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {error ? (
        <p role="alert" className="px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
      {token ? (
        <div className="max-w-2xl px-4 pt-3">
          <p className="text-muted">
            Your new token. It is shown once, so copy it into your routines now.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <code
              data-testid="new-token"
              className="min-w-0 flex-1 break-all font-mono text-xs"
            >
              {token}
            </code>
            <Copy label="Copy token" text={token} />
          </div>
          {note ? <p className="pt-2 text-muted">{note}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
