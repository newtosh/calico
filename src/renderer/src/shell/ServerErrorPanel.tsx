import type { ServerErrorInfo } from "../../../shared/ipc";

export function ServerErrorPanel({ error }: { error: ServerErrorInfo }) {
  return (
    <section role="alert" className="m-4 border border-red/60 bg-surface p-4">
      <p className="font-medium text-red">
        The companion server is not running.
      </p>
      <p className="mt-1 text-muted">
        Ports {error.first} to {error.last} are all in use, so the panel and
        agent webhooks cannot reach calico. Device setup over USB and Bluetooth
        still works.
      </p>
      <p className="mt-2 text-muted">
        Close whatever holds those ports, then quit and reopen calico from the
        tray.
      </p>
    </section>
  );
}
