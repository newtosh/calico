import { describe, expect, it } from "vitest";
import type { RelaySetupView } from "../../../shared/ipc";
import { stage } from "./relay-setup";

const running = (over: Record<string, string>): RelaySetupView => ({
  phase: "running",
  steps: {
    "sign-in": "pending",
    upload: "pending",
    address: "pending",
    check: "pending",
    save: "pending",
    ...over,
  } as Extract<RelaySetupView, { phase: "running" }>["steps"],
});

describe("stage", () => {
  it("starts at Confirm", () => {
    expect(stage({ phase: "idle" })).toEqual({ at: 1, failed: false });
  });

  it("is on Sign in while the browser is open", () => {
    expect(stage(running({ "sign-in": "active" }))).toEqual({
      at: 2,
      failed: false,
    });
  });

  it("is on Set up once signed in, through every later step", () => {
    expect(stage(running({ "sign-in": "done", upload: "active" })).at).toBe(3);
    expect(
      stage(running({ "sign-in": "done", upload: "done", check: "active" })).at,
    ).toBe(3);
  });

  it("is on Done when setup finished", () => {
    expect(stage({ phase: "done", url: "u", revoked: true })).toEqual({
      at: 4,
      failed: false,
    });
  });

  it("marks the node where it failed", () => {
    const failed = (step: "sign-in" | "upload" | "save"): RelaySetupView => ({
      phase: "failed",
      step,
      message: "x",
      cleanedUp: true,
      cancelled: false,
    });
    expect(stage(failed("sign-in"))).toEqual({ at: 2, failed: true });
    expect(stage(failed("upload"))).toEqual({ at: 3, failed: true });
    expect(stage(failed("save"))).toEqual({ at: 3, failed: true });
  });
});
