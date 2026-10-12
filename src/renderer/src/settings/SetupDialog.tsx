import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import type {
  RelaySetupStep,
  RelaySetupView,
  RelayStepState,
} from "../../../shared/ipc";
import { stage } from "../lib/relay-setup";
import { useCopy } from "../lib/use-copy";
import { ErrorNote } from "../shell/ErrorNote";
import { Stepper } from "./Stepper";

const LABELS: Record<RelaySetupStep, string> = {
  "sign-in": "Signed in to Cloudflare",
  upload: "Uploading the relay",
  address: "Turning on its address (up to 40 seconds)",
  check: "Checking that it answers",
  save: "Saving it and revoking access",
};
const WORKING: RelaySetupStep[] = ["upload", "address", "check", "save"];

const MARK: Record<RelayStepState, string> = {
  pending: "·",
  active: "…",
  done: "✓",
  failed: "!",
};

export function SetupDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<RelaySetupView>({ phase: "idle" });
  const [copied, copy, resetCopied] = useCopy();
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.calico.relaySetupView().then((v) => live && setView(v));
    const off = window.calico.onRelaySetup(setView);
    return () => {
      live = false;
      off();
    };
  }, [open]);

  // A new step unmounts the button that had focus, so land on its title.
  useEffect(() => {
    if (open) title.current?.focus();
  }, [open, view.phase]);

  const { at, failed } = stage(view);
  const saving = view.phase === "running" && view.steps.save !== "pending";

  function finish() {
    if (view.phase === "done" || view.phase === "failed")
      void window.calico.relaySetupDismiss();
    setView({ phase: "idle" });
    resetCopied();
    onClose();
  }

  // Escape and the backdrop are Cancel: they stop a running setup, and close anything else.
  function dismiss() {
    if (view.phase === "running") void window.calico.relaySetupCancel();
    else finish();
  }

  return (
    <Dialog.Root
      open={open}
      // A stray click must not abort a sign-in. Escape and Cancel still do.
      disablePointerDismissal={view.phase === "running"}
      onOpenChange={(next) => !next && dismiss()}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-glass/80" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 w-[30rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 border border-stroke bg-surface p-4">
          <Stepper at={at} failed={failed} />
          {view.phase === "idle" ? (
            <>
              <Dialog.Title
                ref={title}
                tabIndex={-1}
                className="mb-2 text-base font-medium outline-none"
              >
                Set up a relay with Cloudflare
              </Dialog.Title>
              <p className="mb-2">Here is exactly what calico will do:</p>
              <ol className="mb-2 list-decimal space-y-1 pl-5">
                <li>
                  Open your browser so you can sign in to Cloudflare. calico
                  never sees your password.
                </li>
                <li>
                  Ask for one permission, <strong>Workers Admin</strong>. It is
                  the smallest one Cloudflare has that allows uploading a
                  Worker.
                </li>
                <li>
                  Deploy a Worker called <code>calico-relay</code> to your
                  account, with two secret tokens.
                </li>
                <li>Check that it answers, then revoke its own access.</li>
              </ol>
              <p className="mb-3 text-muted">
                The relay stays in your account. You can delete it there at any
                time.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void window.calico.relaySetupStart()}
                >
                  Continue in browser
                </button>
                <button type="button" className="btn" onClick={finish}>
                  Cancel
                </button>
              </div>
            </>
          ) : null}

          {view.phase === "running" ? (
            <>
              <Dialog.Title
                ref={title}
                tabIndex={-1}
                className="mb-2 text-base font-medium outline-none"
              >
                {view.steps["sign-in"] === "done"
                  ? "Setting up your relay"
                  : "Sign in to Cloudflare"}
              </Dialog.Title>
              {view.steps["sign-in"] !== "done" ? (
                <p className="mb-3">
                  Waiting for you in the browser. This continues by itself once
                  you approve.
                </p>
              ) : (
                <ul role="status" className="mb-3 space-y-1">
                  {WORKING.map((s) => (
                    <li key={s} className="flex gap-2">
                      <span aria-hidden className="w-4 text-center">
                        {MARK[view.steps[s]]}
                      </span>
                      <span
                        className={
                          view.steps[s] === "pending" ? "text-muted" : undefined
                        }
                      >
                        {LABELS[s]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={() => void window.calico.relaySetupCancel()}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : null}

          {view.phase === "done" ? (
            <>
              <Dialog.Title
                ref={title}
                tabIndex={-1}
                className="mb-2 text-base font-medium outline-none"
              >
                Your relay is on
              </Dialog.Title>
              <p className="mb-1 text-muted">Address</p>
              <code className="mb-3 block break-all font-mono text-xs">
                {view.url}
              </code>
              {view.revoked ? null : (
                <p className="mb-3">
                  <ErrorNote>
                    calico could not revoke its access. It lapses within an
                    hour, or you can remove it under Cloudflare's connected
                    apps.
                  </ErrorNote>
                </p>
              )}
              <div className="flex items-center gap-3">
                <button type="button" className="btn" onClick={copy}>
                  Copy for Grok Bot
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={finish}
                >
                  Done
                </button>
                <span role="status" className="text-sage">
                  {copied}
                </span>
              </div>
            </>
          ) : null}

          {view.phase === "failed" ? (
            <>
              <Dialog.Title
                ref={title}
                tabIndex={-1}
                className="mb-2 text-base font-medium outline-none"
              >
                {view.cancelled
                  ? "Setup was cancelled"
                  : "Setup did not finish"}
              </Dialog.Title>
              <p className="mb-2">
                <ErrorNote>{view.message}</ErrorNote>
              </p>
              {view.cleanedUp ? (
                <p className="mb-3 text-muted">
                  Nothing is left in your account.
                </p>
              ) : null}
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void window.calico.relaySetupStart()}
                >
                  Try again
                </button>
                <button type="button" className="btn" onClick={finish}>
                  Close
                </button>
              </div>
            </>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
