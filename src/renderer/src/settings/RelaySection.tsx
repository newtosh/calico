import { useCallback, useEffect, useState } from "react";
import { fetchRelay, putRelay, type RelayInfo } from "../lib/api";
import { ago } from "../lib/time";
import { ErrorNote } from "../shell/ErrorNote";

type Step = "idle" | "form" | "disconnect" | "working";

const REJECTED =
  "That address or token was not accepted. Use an https address, or http for this computer, and a token with no spaces.";

function Status({ relay }: { relay: RelayInfo }) {
  const { status } = relay;
  if (status.ok === null)
    return <span className="text-amber">Waiting for the first check.</span>;
  if (status.ok)
    return (
      <span className="text-sage">
        Connected, checked {ago(status.last_poll_at ?? "")}.
      </span>
    );
  return (
    <span>
      <ErrorNote>
        {status.error} calico keeps trying, and anything agents sent is waiting
        safely on the relay.
      </ErrorNote>
    </span>
  );
}

export function RelaySection() {
  const [relay, setRelay] = useState<RelayInfo | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      fetchRelay()
        .then(setRelay)
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  async function apply(patch: Parameters<typeof putRelay>[0]) {
    setStep("working");
    setError("");
    try {
      await putRelay(patch);
      setToken("");
      setUrl("");
      setStep("idle");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message === "relay rejected" ? REJECTED : message);
      setStep(patch.clear ? "disconnect" : "form");
    }
  }

  if (!relay) return null;
  const connected = relay.url !== "";
  const { status } = relay;
  return (
    <section>
      <h2 className="section-title">Relay</h2>
      <div className="max-w-2xl px-4">
        {connected ? (
          <>
            <div className="flex items-center gap-3 py-2">
              <span className="w-32 shrink-0 text-muted">Address</span>
              <code className="min-w-0 flex-1 break-all font-mono text-xs">
                {relay.url}
              </code>
            </div>
            <p role="status" className="pb-1">
              <Status relay={relay} />
            </p>
            {status.ok && status.refused > 0 ? (
              <p className="text-amber">
                {status.refused}{" "}
                {status.refused === 1 ? "message was" : "messages were"} refused
                at the last check.
              </p>
            ) : null}
            {status.used !== null && status.budget !== null ? (
              <p className="text-muted">
                Used today: {status.used.toLocaleString("en-US")} of{" "}
                {status.budget.toLocaleString("en-US")} requests.
              </p>
            ) : null}
          </>
        ) : (
          <p className="pb-2 text-muted">
            A relay holds what cloud agents send while this computer is asleep
            or on another network, and calico collects it when it is back. Use
            one you already run, such as a self-hosted ntfy.
          </p>
        )}
      </div>
      <div className="px-4 pt-2">
        {step === "idle" && !connected ? (
          <button type="button" className="btn" onClick={() => setStep("form")}>
            Connect an existing relay…
          </button>
        ) : null}
        {step === "idle" && connected ? (
          <button
            type="button"
            className="btn"
            onClick={() => setStep("disconnect")}
          >
            Disconnect…
          </button>
        ) : null}
        {step === "form" || (step === "working" && !connected) ? (
          <div className="grid max-w-2xl grid-cols-2 gap-3">
            <label className="label">
              Relay address
              <input
                className="field mt-1 font-mono"
                value={url}
                placeholder="https://relay.example/inbox"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="label">
              Read token
              <input
                type="password"
                className="field mt-1"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <div className="col-span-2 flex gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={step === "working" || !url || !token}
                onClick={() => void apply({ url, token })}
              >
                Connect
              </button>
              <button
                type="button"
                className="btn"
                disabled={step === "working"}
                onClick={() => {
                  setStep("idle");
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {step === "disconnect" || (step === "working" && connected) ? (
          <div className="max-w-2xl border border-amber/60 bg-surface p-3">
            <p className="text-amber">
              calico stops reading this relay and forgets its token. Updates
              already on the relay stay there. Agents that post to it are not
              affected.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={step === "working"}
                onClick={() => void apply({ clear: true })}
              >
                Disconnect relay
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
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-2xl px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
    </section>
  );
}
