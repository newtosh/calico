import { useEffect, useRef, useState } from "react";
import type { NetworksState, SavedNetwork } from "../../../shared/ipc";
import { NETWORKS_MAX } from "../../../shared/panel-fields";
import type { DeviceLink } from "../device/commands";
import { ErrorNote } from "../shell/ErrorNote";
import { NetworkForm } from "./NetworkForm";

const EMPTY: NetworksState = { networks: [], error: "", notice: "" };

export function NetworksSection({ link }: { link: DeviceLink | null }) {
  const [state, setState] = useState<NetworksState>(EMPTY);
  // null: no form. "new": adding. A network: editing it.
  const [form, setForm] = useState<SavedNetwork | "new" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The opener's data-focus key, or null when nothing should take focus.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [closed, setClosed] = useState(0);

  useEffect(() => {
    void window.calico.networksList().then((next) => {
      setState(next);
      setLoaded(true);
    });
  }, []);

  // After a form or confirmation closes, focus its opener, or the heading
  // when that control is gone, so keyboard focus never falls to the body.
  useEffect(() => {
    if (closed === 0) return;
    // Compare in JS: an SSID may hold quotes that would break a selector.
    const el = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-focus]") ?? [],
    ).find((e) => e.dataset.focus === returnTo);
    (el && !(el as HTMLButtonElement).disabled ? el : heading.current)?.focus();
  }, [closed, returnTo]);

  function close(opener: string) {
    setReturnTo(opener);
    setClosed((n) => n + 1);
  }

  async function remove(ssid: string) {
    setState(await window.calico.networksRemove(ssid));
    setRemoving(null);
    close(`remove:${ssid}`);
  }

  const opener = (f: SavedNetwork | "new") =>
    f === "new" ? "add" : `edit:${f.ssid}`;
  const full = state.networks.length >= NETWORKS_MAX;
  return (
    <section ref={root}>
      <h2 ref={heading} tabIndex={-1} className="section-title">
        Wi-Fi networks
      </h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        The networks the panel can join, kept on this computer. Passwords are
        locked with the system keyring and never shown again. Saving here does
        not change the panel: to set up the panel now, use Device.
      </p>
      {state.notice ? (
        <p role="status" className="max-w-2xl px-4 pb-2 text-amber">
          {state.notice}
        </p>
      ) : null}
      {!loaded ? (
        <p className="px-4 text-muted">Loading networks</p>
      ) : state.networks.length === 0 ? (
        <p className="px-4 text-muted">No networks saved.</p>
      ) : (
        <ul aria-label="Saved networks" className="max-w-2xl px-4">
          {state.networks.map((n) => (
            <li
              key={n.ssid}
              className="flex items-center gap-3 border-b border-stroke/40 py-2"
            >
              <span title={n.ssid} className="min-w-0 flex-1 truncate">
                {n.ssid}
              </span>
              <span className="min-w-0 shrink-[3] truncate font-mono text-xs text-muted">
                {n.url || "Default URL"}
              </span>
              <span className="text-muted">
                {n.password_set ? "Password set" : "No password"}
              </span>
              <button
                type="button"
                className="btn"
                aria-label={`Edit ${n.ssid}`}
                data-focus={`edit:${n.ssid}`}
                disabled={form !== null}
                onClick={() => {
                  setRemoving(null);
                  setForm(n);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Remove ${n.ssid}`}
                data-focus={`remove:${n.ssid}`}
                disabled={form !== null}
                onClick={() => setRemoving(n.ssid)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing ? (
        <div className="max-w-2xl px-4 pt-2">
          <div className="border border-amber/60 bg-surface p-3">
            <p className="text-amber">
              Remove {removing} and its password from this computer? The panel
              keeps it until you forget it there, on the Device page.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void remove(removing)}
              >
                Remove network
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const ssid = removing;
                  setRemoving(null);
                  close(`remove:${ssid}`);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {form ? (
        <NetworkForm
          key={form === "new" ? "" : form.ssid}
          link={link}
          editing={form === "new" ? null : form}
          onSaved={(next) => {
            setState(next);
            setForm(null);
            close(opener(form));
          }}
          onCancel={() => {
            setForm(null);
            close(opener(form));
          }}
        />
      ) : (
        <div className="flex items-center gap-3 px-4 pt-3">
          <button
            type="button"
            className="btn"
            data-focus="add"
            disabled={full || !loaded}
            onClick={() => {
              setRemoving(null);
              setForm("new");
            }}
          >
            Add network
          </button>
          {full ? (
            <span className="text-muted">
              The panel holds {NETWORKS_MAX} networks. Remove one to add
              another.
            </span>
          ) : null}
        </div>
      )}
      {state.error && !form ? (
        <p role="alert" className="max-w-2xl px-4 pt-2">
          <ErrorNote>{state.error}</ErrorNote>
        </p>
      ) : null}
    </section>
  );
}
