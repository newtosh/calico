import { useRef, useState } from "react";
import { ErrorNote } from "../shell/ErrorNote";
import type { DeviceLink } from "./commands";
import {
  buildPlan,
  planSize,
  planSteps,
  type PushPlan,
  type PushStep,
  runPush,
} from "./push-plan";
import { PushPlanDialog } from "./PushPlanDialog";

export const NOTHING_TO_PUSH =
  "Nothing to push: no networks are saved on this computer or on the panel.";

export function pushedAll(n: number): string {
  return `Sent ${n} ${n === 1 ? "change" : "changes"} to the panel. It restarts to use them.`;
}

export function pushStopped(
  done: number,
  total: number,
  error: string,
): string {
  return `Stopped after ${done} of ${total} changes. ${error} The panel keeps what was already sent and was not restarted. Connect again and push again to finish.`;
}

const stepText = (step: PushStep) =>
  step.op === "forget" ? `removing ${step.ssid}` : `sending ${step.net.ssid}`;

/**
 * Push to panel: reads the panel's list, shows the plan, and writes only after the person
 * confirms it. The outcome goes to `onFinished`, which outlives this section: a dropped link
 * unmounts it mid-push.
 */
export function PushNetworks({
  link,
  onFinished,
}: {
  link: DeviceLink;
  onFinished: (message: string, reboot: boolean) => void;
}) {
  const [reading, setReading] = useState(false);
  const [plan, setPlan] = useState<PushPlan | null>(null);
  const [removeCurrent, setRemoveCurrent] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const opener = useRef<HTMLButtonElement>(null);

  async function open() {
    setReading(true);
    setError("");
    setNotice("");
    try {
      const vault = await window.calico.networksList();
      if (vault.error) return setError(vault.error);
      // Without the current network a removal could cut the panel off, so status must read.
      const status = await link.send({ op: "status" });
      if (!status.ok) return setError(status.error);
      // The nets read is the old-firmware and stale-cache check: no password is released before it.
      const nets = await link.send({ op: "nets" });
      if (!nets.ok) return setError(nets.error);
      const next = buildPlan(
        vault.networks,
        nets.nets ?? [],
        status.info?.ssid ?? "",
      );
      if (planSize(next) === 0) return setNotice(NOTHING_TO_PUSH);
      setRemoveCurrent(false);
      setPlan(next);
    } finally {
      setReading(false);
    }
  }

  function cancel() {
    void window.calico.networksEndPush();
    setPlan(null);
    setError("");
  }

  async function confirm() {
    if (!plan) return;
    const { steps, error: refused } = planSteps(plan, removeCurrent);
    if (refused) return setError(refused);
    setError("");
    const ssids = steps.flatMap((s) => (s.op === "wifi" ? [s.net.ssid] : []));
    // endPush runs on every path, so main stops releasing passwords even when something throws.
    try {
      const confirmed = await window.calico.networksConfirmPush(ssids);
      if (!confirmed.ok) return setError(confirmed.error);
      setProgress("Starting the push.");
      const result = await runPush(
        link,
        steps,
        (ssid) => window.calico.networksRelease(ssid),
        (i, step) =>
          setProgress(`Step ${i + 1} of ${steps.length}: ${stepText(step)}`),
      );
      setPlan(null);
      if (result.error)
        onFinished(pushStopped(result.done, result.total, result.error), false);
      else onFinished(pushedAll(result.total), result.total > 0);
    } catch (e) {
      setPlan(null);
      const why =
        e instanceof Error ? e.message : "The push stopped unexpectedly.";
      onFinished(pushStopped(0, steps.length, why), false);
    } finally {
      setProgress("");
      await window.calico.networksEndPush().catch(() => undefined);
    }
  }

  const shown = plan
    ? planSteps(plan, removeCurrent)
    : { steps: [], error: "" };
  return (
    <section>
      <h2 className="section-title">Push saved networks</h2>
      <p className="max-w-2xl px-4 text-muted">
        Makes the panel's networks match Settings: adds and updates the saved
        ones and removes the rest. You see the plan first, and nothing changes
        until you confirm it.
      </p>
      <div className="flex gap-3 px-4 pt-3">
        <button
          ref={opener}
          type="button"
          className="btn"
          disabled={reading}
          onClick={() => void open()}
        >
          {reading ? "Reading the panel" : "Push to panel"}
        </button>
      </div>
      {notice ? (
        <p role="status" className="px-4 pt-2 text-muted">
          {notice}
        </p>
      ) : null}
      {error && !plan ? (
        <p role="alert" className="px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
      {plan ? (
        <PushPlanDialog
          plan={plan}
          removeCurrent={removeCurrent}
          onRemoveCurrent={setRemoveCurrent}
          progress={progress}
          error={error || shown.error}
          count={shown.steps.length}
          opener={opener}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      ) : null}
    </section>
  );
}
