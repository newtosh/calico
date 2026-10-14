import { useEffect, useRef, useState } from "react";
import type { DeviceLink, PanelNet } from "./commands";
import { ErrorNote } from "../shell/ErrorNote";

/** What the panel itself has saved. Forget acts on the panel only, never on Settings. */
export function PanelNetworks({ link }: { link: DeviceLink }) {
  const [nets, setNets] = useState<PanelNet[] | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The opener's ssid, or null when nothing should take focus.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [closed, setClosed] = useState(0);

  // After the confirmation closes, focus its opener, or the heading when the
  // row is gone, so keyboard focus never falls to the body.
  useEffect(() => {
    if (closed === 0) return;
    // Compare in JS: an SSID may hold quotes that would break a selector.
    const el = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-focus]") ?? [],
    ).find((e) => e.dataset.focus === returnTo);
    (el && !(el as HTMLButtonElement).disabled ? el : heading.current)?.focus();
  }, [closed, returnTo]);

  function close(ssid: string) {
    setForgetting(null);
    setReturnTo(ssid);
    setClosed((n) => n + 1);
  }

  async function read() {
    setBusy(true);
    setError("");
    const reply = await link.send({ op: "nets" });
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    setNets(reply.nets ?? []);
  }

  async function forget(ssid: string) {
    setBusy(true);
    setError("");
    const reply = await link.send({ op: "forget", ssid });
    if (!reply.ok) {
      setBusy(false);
      return setError(reply.error);
    }
    await read();
    close(ssid);
  }

  return (
    <section ref={root}>
      <h2 ref={heading} tabIndex={-1} className="section-title">
        Networks on the panel
      </h2>
      <p className="max-w-2xl px-4 text-muted">
        The panel keeps up to 8 networks and never sends their passwords back.
        Forgetting one here removes it from the panel only. The panel stays on
        its current network until it restarts.
      </p>
      <div className="flex gap-3 px-4 pt-3">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void read()}
        >
          {busy ? "Asking the panel" : nets ? "Refresh" : "Show networks"}
        </button>
      </div>
      {nets && nets.length === 0 ? (
        <p className="px-4 pt-2 text-muted">No networks saved on the panel.</p>
      ) : null}
      {nets && nets.length > 0 ? (
        <ul aria-label="Networks on the panel" className="max-w-2xl px-4 pt-2">
          {nets.map((n) => (
            <li
              key={n.ssid}
              className="flex items-center gap-3 border-b border-stroke/40 py-2"
            >
              <span title={n.ssid} className="min-w-0 flex-1 truncate">
                {n.ssid}
              </span>
              <span className="text-muted">
                {n.has_url ? "Own URL" : "Default URL"}
              </span>
              <span className="text-muted">
                {n.has_token ? "Own token" : "Default token"}
              </span>
              <button
                type="button"
                className="btn"
                aria-label={`Forget ${n.ssid} on the panel`}
                data-focus={n.ssid}
                disabled={busy || forgetting !== null}
                onClick={() => setForgetting(n.ssid)}
              >
                Forget on the panel
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {forgetting ? (
        <div className="max-w-2xl px-4 pt-2">
          <div className="border border-amber/60 bg-surface p-3">
            <p className="text-amber">
              Forget {forgetting} on the panel? It will not join this network
              again until it is set up again. Settings keeps its copy.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void forget(forgetting)}
              >
                Forget network
              </button>
              <button
                type="button"
                className="btn"
                autoFocus
                disabled={busy}
                onClick={() => close(forgetting)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
    </section>
  );
}
