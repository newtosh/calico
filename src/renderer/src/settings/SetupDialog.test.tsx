// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelaySetupView } from "../../../shared/ipc";
import { SetupDialog } from "./SetupDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Steps = Extract<RelaySetupView, { phase: "running" }>["steps"];
const steps = (over: Partial<Steps>): Steps => ({
  "sign-in": "pending",
  upload: "pending",
  address: "pending",
  check: "pending",
  save: "pending",
  ...over,
});

function stub(initial: RelaySetupView = { phase: "idle" }) {
  let push: (view: RelaySetupView) => void = () => undefined;
  const api = {
    relaySetupView: vi.fn(async () => initial),
    relaySetupStart: vi.fn(async () => undefined),
    relaySetupCancel: vi.fn(async () => undefined),
    relaySetupDismiss: vi.fn(async () => undefined),
    relayCopyForBot: vi.fn(async () => true),
    onRelaySetup: vi.fn((cb: (view: RelaySetupView) => void) => {
      push = cb;
      return () => undefined;
    }),
  };
  vi.stubGlobal("window", Object.assign(window, { calico: api }));
  return { api, push: (v: RelaySetupView) => act(() => push(v)) };
}

describe("SetupDialog", () => {
  it("says exactly what will happen before it does anything", async () => {
    const { api } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    expect(await screen.findByText(/Workers Admin/)).toBeTruthy();
    expect(screen.getByText(/calico-relay/)).toBeTruthy();
    expect(api.relaySetupStart).not.toHaveBeenCalled();
  });

  it("starts only when the person continues", async () => {
    const { api } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Continue in browser/ }),
    );
    expect(api.relaySetupStart).toHaveBeenCalledTimes(1);
  });

  it("marks the current step for assistive tech", async () => {
    const { push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "running", steps: steps({ "sign-in": "active" }) });
    const current = screen
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Sign in");
    expect(screen.getByText(/Waiting for you in the browser/)).toBeTruthy();
  });

  it("lists the working steps with a label for each wait", async () => {
    const { push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({
      phase: "running",
      steps: steps({ "sign-in": "done", upload: "done", address: "active" }),
    });
    expect(screen.getByRole("status").textContent).toMatch(
      /Turning on its address/,
    );
  });

  it("cancels a running setup", async () => {
    const { api, push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "running", steps: steps({ "sign-in": "active" }) });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.relaySetupCancel).toHaveBeenCalled();
  });

  it("copies for the bot without ever holding a token", async () => {
    const { api, push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({
      phase: "done",
      url: "https://calico-relay.me.workers.dev/inbox",
      revoked: true,
    });
    expect(screen.getByText(/calico-relay\.me\.workers\.dev/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy for Grok Bot/ }));
    expect(api.relayCopyForBot).toHaveBeenCalled();
    expect(await screen.findByText(/Copied/)).toBeTruthy();
  });

  it("warns when the access could not be revoked", async () => {
    const { push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "done", url: "https://x/inbox", revoked: false });
    expect(screen.getByText(/could not revoke/i)).toBeTruthy();
  });

  it("closing a finished setup dismisses it and tells the page", async () => {
    const onClose = vi.fn();
    const { api, push } = stub();
    render(<SetupDialog open onClose={onClose} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "done", url: "https://x/inbox", revoked: true });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(api.relaySetupDismiss).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("names the failed step, says what was cleaned up, and offers try again", async () => {
    const { api, push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({
      phase: "failed",
      step: "upload",
      message: "Cloudflare answered HTTP 403.",
      cleanedUp: true,
      cancelled: false,
    });
    expect(screen.getByText(/HTTP 403/)).toBeTruthy();
    expect(screen.getByText(/Nothing is left in your account/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.relaySetupStart).toHaveBeenCalled();
  });

  it("tells the person to delete the Worker by hand when cleanup failed", async () => {
    const { push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({
      phase: "failed",
      step: "check",
      message: "No answer. calico could not remove the Worker it uploaded.",
      cleanedUp: false,
      cancelled: false,
    });
    expect(screen.queryByText(/Nothing is left in your account/)).toBeNull();
  });

  it("cannot cancel once it is saving", async () => {
    const { push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({
      phase: "running",
      steps: steps({
        "sign-in": "done",
        upload: "done",
        address: "done",
        check: "done",
        save: "active",
      }),
    });
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("moves focus into the new step when the phase changes", async () => {
    const { push } = stub();
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "done", url: "https://x/inbox", revoked: true });
    expect(document.activeElement?.textContent).toBe("Your relay is on");
  });

  it("says when there was nothing to copy", async () => {
    const { api, push } = stub();
    api.relayCopyForBot.mockResolvedValue(false);
    render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "done", url: "https://x/inbox", revoked: true });
    fireEvent.click(screen.getByRole("button", { name: /Copy for Grok Bot/ }));
    expect(await screen.findByText(/Nothing to copy/)).toBeTruthy();
  });

  it("forgets that it copied when the dialog is closed and opened again", async () => {
    const { push } = stub();
    const { rerender } = render(<SetupDialog open onClose={() => undefined} />);
    await screen.findByText(/Workers Admin/);
    push({ phase: "done", url: "https://x/inbox", revoked: true });
    fireEvent.click(screen.getByRole("button", { name: /Copy for Grok Bot/ }));
    await screen.findByText(/Copied/);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    rerender(<SetupDialog open={false} onClose={() => undefined} />);
    rerender(<SetupDialog open onClose={() => undefined} />);
    expect(screen.queryByText(/Copied/)).toBeNull();
  });

  it("picks up a setup already running when the window opens", async () => {
    stub({ phase: "running", steps: steps({ "sign-in": "active" }) });
    render(<SetupDialog open onClose={() => undefined} />);
    expect(
      await screen.findByText(/Waiting for you in the browser/),
    ).toBeTruthy();
  });
});
