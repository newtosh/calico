import { useEffect, useState } from "react";
import type { FirewallInfo, FixResult } from "../../../shared/ipc";

export function FirewallAssist({ port }: { port: number | null }) {
  const [fw, setFw] = useState<FirewallInfo | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);

  useEffect(() => {
    void window.calico.firewall().then(setFw);
  }, []);

  if (!fw) return <p className="px-4 text-muted">Checking for a firewall.</p>;
  return (
    <section className="border-t border-stroke/40">
      <h2 className="section-title">Panel cannot reach calico</h2>
      {fw.kind === "none" ? (
        <p className="max-w-2xl px-4 text-muted">
          No firewall service is active here. Check that the panel and this
          computer are on the same network, and that the router does not isolate
          wireless clients.
        </p>
      ) : fw.command ? (
        <div className="px-4">
          <p className="max-w-2xl text-muted">
            {fw.kind} is active and may be blocking TCP port {port}. This
            command allows it:
          </p>
          <pre className="mt-2 max-w-2xl border border-stroke bg-field px-3 py-2 font-mono text-xs">
            {fw.command}
          </pre>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn"
              onClick={() =>
                void navigator.clipboard.writeText(fw.command ?? "")
              }
            >
              Copy
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void window.calico.runFix("firewall").then(setResult)
              }
            >
              Run (asks for your password)
            </button>
          </div>
        </div>
      ) : (
        <p className="max-w-2xl px-4 text-muted">
          {fw.kind} is active. Allow inbound TCP port {port} from your LAN in
          its ruleset, then reboot the desk.
        </p>
      )}
      {result ? (
        <p
          role="status"
          className={`px-4 pt-2 ${result.ok ? "text-sage" : "text-red"}`}
        >
          {result.output}
        </p>
      ) : null}
    </section>
  );
}
