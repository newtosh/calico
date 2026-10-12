import type { RelaySetupView } from "../../../shared/ipc";

/** The four nodes of the setup stepper: Confirm, Sign in, Set up, Done. */
export const STAGES = ["Confirm", "Sign in", "Set up", "Done"] as const;

export function stage(view: RelaySetupView): {
  at: 1 | 2 | 3 | 4;
  failed: boolean;
} {
  switch (view.phase) {
    case "idle":
      return { at: 1, failed: false };
    case "done":
      return { at: 4, failed: false };
    case "failed":
      return { at: view.step === "sign-in" ? 2 : 3, failed: true };
    case "running":
      return {
        at: view.steps["sign-in"] === "done" ? 3 : 2,
        failed: false,
      };
  }
}
