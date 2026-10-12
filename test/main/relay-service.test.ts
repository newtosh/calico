import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/server/config";
import {
  botNote,
  withMadeRelay,
  RelaySetupService,
  type SetupView,
} from "../../src/main/relay/service";
import { SetupError, type SetupResult } from "../../src/main/relay/setup";

const result: SetupResult = {
  url: "https://calico-relay.me.workers.dev/inbox",
  sendToken: "send_x",
  readToken: "read_x",
  accountId: "a1",
  workerName: "calico-relay",
  revoked: true,
};

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

describe("RelaySetupService", () => {
  it("starts idle", () => {
    const s = new RelaySetupService(async () => result);
    expect(s.view()).toEqual({ phase: "idle" });
  });

  it("shows each step as it moves and ends on done without any token", async () => {
    const seen: SetupView[] = [];
    const s = new RelaySetupService(async (_signal, report) => {
      report({ step: "sign-in", state: "active" });
      report({ step: "sign-in", state: "done" });
      return result;
    });
    s.subscribe((v) => seen.push(v));
    await s.start();
    const running = seen.find(
      (v) => v.phase === "running" && v.steps["sign-in"] === "active",
    );
    expect(running).toMatchObject({
      steps: { "sign-in": "active", upload: "pending" },
    });
    expect(s.view()).toEqual({
      phase: "done",
      url: result.url,
      revoked: true,
    });
    expect(JSON.stringify(seen)).not.toMatch(/send_x|read_x/);
  });

  it("ignores a second start while one is running", async () => {
    const g = gate();
    const run = vi.fn(async () => {
      await g.wait;
      return result;
    });
    const s = new RelaySetupService(run);
    const first = s.start();
    await s.start();
    g.open();
    await first;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("turns a failure into a view with the step and the message", async () => {
    const s = new RelaySetupService(async () => {
      throw new SetupError("upload", "Cloudflare said no.", true);
    });
    await s.start();
    expect(s.view()).toEqual({
      phase: "failed",
      step: "upload",
      message: "Cloudflare said no.",
      cleanedUp: true,
      cancelled: false,
    });
  });

  it("explains an unexpected error without leaking more than its message", async () => {
    const s = new RelaySetupService(async () => {
      throw new Error("boom");
    });
    await s.start();
    expect(s.view()).toMatchObject({ phase: "failed", message: "boom" });
  });

  it("cancel aborts the run it started", async () => {
    let signal: AbortSignal | undefined;
    const g = gate();
    const s = new RelaySetupService(async (sig) => {
      signal = sig;
      await g.wait;
      throw new SetupError("sign-in", "Setup was cancelled.", true, true);
    });
    const run = s.start();
    s.cancel();
    expect(signal?.aborted).toBe(true);
    g.open();
    await run;
    expect(s.view()).toMatchObject({ phase: "failed", cancelled: true });
  });

  it("dismiss returns a finished setup to idle and lets a new one start", async () => {
    const run = vi.fn(async () => result);
    const s = new RelaySetupService(run);
    await s.start();
    s.dismiss();
    expect(s.view()).toEqual({ phase: "idle" });
    await s.start();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("will not dismiss while running", async () => {
    const g = gate();
    const s = new RelaySetupService(async () => {
      await g.wait;
      return result;
    });
    const run = s.start();
    s.dismiss();
    expect(s.view().phase).toBe("running");
    g.open();
    await run;
  });

  it("stops telling a listener that unsubscribed", async () => {
    const cb = vi.fn();
    const s = new RelaySetupService(async () => result);
    s.subscribe(cb)();
    await s.start();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("botNote", () => {
  it("gives the address, the send token, and the User-Agent advice", () => {
    const text = botNote(result.url, "send_x");
    expect(text).toContain(result.url);
    expect(text).toContain("send_x");
    expect(text).toMatch(/User-Agent/);
    expect(text).not.toContain("read_");
  });
});

describe("withMadeRelay", () => {
  it("points calico at the new relay with its read token, and keeps the send token for the bot", () => {
    const next = withMadeRelay(
      { ...defaultConfig(), relay_cursor: "9", port: 9000 },
      result,
    );
    expect(next).toMatchObject({
      relay_url: result.url,
      relay_token: "read_x",
      relay_send_token: "send_x",
      relay_cursor: "",
      port: 9000,
    });
  });
});
