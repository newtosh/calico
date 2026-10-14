import { Dialog } from "@base-ui/react/dialog";
import { type RefObject, useRef } from "react";
import { ErrorNote } from "../shell/ErrorNote";
import type { PushPlan } from "./push-plan";

interface Props {
  plan: PushPlan;
  removeCurrent: boolean;
  onRemoveCurrent: (on: boolean) => void;
  /** Non-empty while the push runs: what is being sent now. */
  progress: string;
  error: string;
  /** The writes Push will make, 0 when the plan is refused. */
  count: number;
  opener: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The push plan. A destructive confirmation: nothing is written until Push is pressed. */
export function PushPlanDialog({
  plan,
  removeCurrent,
  onRemoveCurrent,
  progress,
  error,
  count,
  opener,
  onConfirm,
  onCancel,
}: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const running = progress !== "";
  const removesCurrent =
    plan.current !== "" && plan.remove.includes(plan.current);
  const sections: [string, string[]][] = [
    ["Add", plan.add.map((n) => n.ssid)],
    ["Update, sent again", plan.update.map((n) => n.ssid)],
    ["Remove from the panel", plan.remove.filter((s) => s !== plan.current)],
  ];
  return (
    <Dialog.Root
      open
      // A stray click or Escape must not stop a push halfway.
      disablePointerDismissal={running}
      onOpenChange={(next) => {
        if (!next && !running) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-glass/80" />
        <Dialog.Popup
          initialFocus={cancel}
          finalFocus={opener}
          className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-stroke bg-surface p-4"
        >
          <Dialog.Title className="mb-2 text-base font-medium">
            Push networks to the panel
          </Dialog.Title>
          <p className="mb-3 text-muted">
            Calico sends each saved network's password, URL and token from this
            computer, then restarts the panel. The panel cannot send its
            passwords back, so a network only on the panel cannot be copied
            here.
          </p>
          {sections
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <div key={title} className="mb-3">
                <h3 className="text-muted">{title}</h3>
                <ul aria-label={title}>
                  {list.map((ssid) => (
                    <li
                      key={ssid}
                      title={ssid}
                      className="truncate border-b border-stroke/40 py-1"
                    >
                      {ssid}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {removesCurrent ? (
            <div className="mb-3 border border-amber/60 p-3">
              <p className="text-amber break-words">
                The panel is on {plan.current} now, and it is not saved on this
                computer. If it is removed and no saved network is in reach, the
                panel cannot reach Calico after it restarts, and only Bluetooth
                or USB can fix that.
              </p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={removeCurrent}
                  disabled={running}
                  onChange={(e) => onRemoveCurrent(e.target.checked)}
                />
                <span className="min-w-0 break-all">
                  Also remove {plan.current}
                </span>
              </label>
            </div>
          ) : null}
          {progress ? (
            <p role="status" className="mb-3 text-amber">
              {progress}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mb-3">
              <ErrorNote>{error}</ErrorNote>
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running || count === 0}
              onClick={onConfirm}
            >
              {running
                ? "Pushing"
                : count === 0
                  ? "Nothing to push"
                  : `Push ${count} ${count === 1 ? "change" : "changes"}`}
            </button>
            <button
              ref={cancel}
              type="button"
              className="btn"
              disabled={running}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
