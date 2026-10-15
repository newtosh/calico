import type { ServerErrorInfo } from "../../../shared/ipc";
import { ErrorNote } from "./ErrorNote";

export function ServerErrorPanel({ error }: { error: ServerErrorInfo }) {
  return (
    <section role="alert" className="m-4 border border-red/60 bg-surface p-4">
      <p className="font-medium">
        <ErrorNote>Calico's server is not running.</ErrorNote>
      </p>
      <p className="mt-1 text-muted">
        Ports {error.first} to {error.last} are all in use, so the panel and
        agent webhooks cannot reach Calico. Panel setup over USB and Bluetooth
        still works.
      </p>
      <p className="mt-2 text-muted">
        Close whatever holds those ports, then quit and reopen Calico from the
        tray.
      </p>
      {error.holders.length ? (
        <p className="mt-2 font-mono text-xs">
          Port {error.first}: {error.holders.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
