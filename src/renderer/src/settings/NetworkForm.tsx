import { useEffect, useRef, useState } from "react";
import type {
  NetworkInput,
  NetworksState,
  SavedNetwork,
} from "../../../shared/ipc";
import type { DeviceLink } from "../device/commands";
import { ScanSelect } from "../device/ScanSelect";
import { ErrorNote } from "../shell/ErrorNote";

export function NetworkForm({
  link,
  editing,
  onSaved,
  onCancel,
}: {
  link: DeviceLink | null;
  editing: SavedNetwork | null;
  onSaved: (state: NetworksState) => void;
  onCancel: () => void;
}) {
  const [ssid, setSsid] = useState(editing?.ssid ?? "");
  const [url, setUrl] = useState(editing?.url ?? "");
  // null is untouched, so an edit keeps what is saved.
  const [pass, setPass] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(editing ? !editing.password_set : false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Add lands on SSID, Edit on the first field that can change.
  useEffect(() => {
    box.current
      ?.querySelector<HTMLInputElement>("input:not(:disabled)")
      ?.focus();
  }, []);

  async function save() {
    setError("");
    const needsPass = !open && !editing?.password_set;
    if (needsPass && !pass)
      return setError("Type the network's password, or choose Open network.");
    const input: NetworkInput = {
      ssid,
      url,
      edit: editing !== null,
      ...(open ? { password: "" } : pass ? { password: pass } : {}),
      ...(token !== null ? { token } : {}),
    };
    setSaving(true);
    const state = await window.calico.networksSave(input);
    setSaving(false);
    if (state.error) return setError(state.error);
    // The form unmounts here, which drops the typed password and token.
    onSaved(state);
  }

  return (
    <div ref={box} className="max-w-2xl px-4 pt-3">
      <div className="grid grid-cols-2 items-end gap-3">
        <label className="label">
          SSID
          <input
            className="field mt-1"
            value={ssid}
            disabled={editing !== null}
            onChange={(e) => setSsid(e.target.value)}
          />
        </label>
        {editing ? (
          <span />
        ) : (
          <div className="flex items-end gap-3">
            <ScanSelect
              link={link}
              value={ssid}
              onPick={setSsid}
              onError={setError}
            />
          </div>
        )}
        <label className="label">
          Password
          <input
            type="password"
            autoComplete="off"
            className="field mt-1"
            value={pass ?? ""}
            disabled={open}
            placeholder={editing?.password_set ? "Set. Type to replace" : ""}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
          />
          Open network (no password)
        </label>
        <label className="label">
          Companion URL for this network
          <input
            className="field mt-1 font-mono"
            value={url}
            placeholder="Default URL"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="label">
          Token for this network
          <input
            type="password"
            autoComplete="off"
            className="field mt-1"
            value={token ?? ""}
            placeholder={editing?.token_set ? "Set" : "Default token"}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      {!editing ? (
        <p className="pt-2 text-muted">
          {link
            ? "For a hidden network, type its name."
            : "Connect the panel on the Device page to scan for networks. For a hidden network, type its name."}
        </p>
      ) : null}
      <div className="flex gap-3 pt-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !ssid}
          onClick={() => void save()}
        >
          Save network
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
    </div>
  );
}
