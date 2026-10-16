import type { CalicoConfig } from "../../server/config";
import type { RelaySetupView, RelayStepState } from "../../shared/ipc";
import {
  SetupError,
  type SetupProgress,
  type SetupResult,
  type SetupStep,
} from "./setup";

export type StepState = RelayStepState;
export type SetupView = RelaySetupView;

const STEPS: SetupStep[] = ["sign-in", "upload", "address", "check", "save"];

const fresh = () =>
  Object.fromEntries(STEPS.map((s) => [s, "pending"])) as Record<
    SetupStep,
    StepState
  >;

/** Owns one setup at a time, so a double click or a second window cannot start another. */
export class RelaySetupService {
  private current: SetupView = { phase: "idle" };
  private steps = fresh();
  private abort: AbortController | null = null;
  private listeners = new Set<(view: SetupView) => void>();
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly run: (
      signal: AbortSignal,
      report: (progress: SetupProgress) => void,
    ) => Promise<SetupResult>,
    /** False when a relay is already connected: setup would overwrite it. */
    private readonly allowed: () => boolean = () => true,
  ) {}

  view(): SetupView {
    return this.current;
  }

  subscribe(cb: (view: SetupView) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(view: SetupView): void {
    this.current = view;
    // A window that closed must not turn a finished setup into a failure.
    for (const cb of this.listeners) {
      try {
        cb(view);
      } catch {
        /* nobody is listening */
      }
    }
  }

  start(): Promise<void> {
    if (this.current.phase === "running") return Promise.resolve();
    if (!this.allowed()) {
      this.set({
        phase: "failed",
        step: "sign-in",
        message:
          "A relay is already connected. Disconnect it before setting up another.",
        cleanedUp: true,
        cancelled: false,
      });
      return Promise.resolve();
    }
    this.running = this.go();
    return this.running;
  }

  /** Resolves once a running setup, including its cleanup, has ended. */
  settled(): Promise<void> {
    return this.running;
  }

  private async go(): Promise<void> {
    this.steps = fresh();
    const controller = new AbortController();
    this.abort = controller;
    this.set({ phase: "running", steps: { ...this.steps } });
    try {
      const out = await this.run(controller.signal, (p) => {
        this.steps[p.step] = p.state;
        this.set({ phase: "running", steps: { ...this.steps } });
      });
      this.set({ phase: "done", url: out.url, revoked: out.revoked });
    } catch (err) {
      const e = err instanceof SetupError ? err : null;
      this.set({
        phase: "failed",
        step: e?.step ?? this.failedStep(),
        message:
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong.",
        cleanedUp: e?.cleanedUp ?? true,
        cancelled: e?.cancelled ?? false,
        helpUrl: e?.helpUrl,
      });
    } finally {
      this.abort = null;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Closes a finished or failed setup. A running one must be cancelled first. */
  dismiss(): void {
    if (this.current.phase !== "running") this.set({ phase: "idle" });
  }

  private failedStep(): SetupStep {
    return (
      STEPS.find(
        (s) => this.steps[s] === "failed" || this.steps[s] === "active",
      ) ?? "sign-in"
    );
  }
}

/** The text "Copy for Grok Bot" puts on the clipboard. Built in main so the token stays out of the window. */
export function botNote(url: string, sendToken: string): string {
  return [
    `Relay address: ${url}`,
    `Send token: ${sendToken}`,
    "",
    "Post each agent event to the address as JSON, with the header",
    `Authorization: Bearer ${sendToken}`,
    "and a User-Agent header of your own (Cloudflare turns away Python's default Python-urllib).",
  ].join("\n");
}

/** The config once setup has made a relay: calico reads with the read token and keeps the send token for the bot. */
export function withMadeRelay(
  config: CalicoConfig,
  made: Pick<SetupResult, "url" | "readToken" | "sendToken">,
): CalicoConfig {
  return {
    ...config,
    relay_url: made.url,
    relay_token: made.readToken,
    relay_send_token: made.sendToken,
    relay_cursor: "",
  };
}
