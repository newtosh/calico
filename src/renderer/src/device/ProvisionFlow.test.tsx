// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import type { Cmd, DeviceLink, Reply } from "./commands";
import { OLD_FIRMWARE } from "./ble";
import { ProvisionFlow } from "./ProvisionFlow";

const info = {
  lanUrls: [],
  webhookToken: "",
} as unknown as CalicoInfo;

beforeEach(() => {
  Object.assign(window, {
    calico: { adoptPort: vi.fn(async () => undefined) },
  });
});
afterEach(cleanup);

function setup(nets?: Reply) {
  const sent: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push(cmd);
      if (cmd.op === "nets" && nets) return nets;
      return { ok: true };
    },
    close() {},
  };
  const onReboot = vi.fn(async () => undefined);
  render(<ProvisionFlow info={info} link={link} onReboot={onReboot} />);
  fireEvent.change(screen.getByLabelText("Or type an SSID"), {
    target: { value: "home" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "placeholder-pass" },
  });
  return { sent, onReboot };
}

describe("ProvisionFlow", () => {
  it("sends the plain two-field wifi when no own URL or token is given", async () => {
    const { sent, onReboot } = setup();
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
    expect(sent).toContainEqual({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass",
    });
  });

  it("sends this network's own URL and token with wifi", async () => {
    const { sent, onReboot } = setup();
    fireEvent.change(
      screen.getByLabelText("Calico's address on this network"),
      {
        target: { value: "http://10.0.0.8:8787" },
      },
    );
    fireEvent.change(screen.getByLabelText("Token for this network"), {
      target: { value: "placeholder-token" },
    });
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
    expect(sent).toContainEqual({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass",
      url: "http://10.0.0.8:8787",
      token: "placeholder-token",
    });
    expect(
      (screen.getByLabelText("Token for this network") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("keeps the own fields typed-only and masked", async () => {
    setup();
    for (const label of [
      "Calico's address on this network",
      "Token for this network",
    ]) {
      expect(screen.getByLabelText(label).getAttribute("autocomplete")).toBe(
        "off",
      );
    }
    expect(
      screen.getByLabelText("Token for this network").getAttribute("type"),
    ).toBe("password");
  });

  it("refuses a bad own URL at once, before the panel tests the network", async () => {
    const { sent } = setup();
    fireEvent.change(
      screen.getByLabelText("Calico's address on this network"),
      {
        target: { value: "10.0.0.8:8787" },
      },
    );
    fireEvent.click(screen.getByText("Test and save"));
    expect((await screen.findByRole("status")).textContent).toContain(
      "http://",
    );
    expect(sent).toEqual([]);
  });

  it("sends an own token on its own, with an empty URL", async () => {
    const { sent, onReboot } = setup();
    fireEvent.change(screen.getByLabelText("Token for this network"), {
      target: { value: "placeholder-token" },
    });
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
    expect(sent).toContainEqual({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass",
      url: "",
      token: "placeholder-token",
    });
  });

  it("says empty own fields keep what the network has, and how to clear them", () => {
    setup();
    expect(
      screen.getByText(
        "Leave both empty to keep what this network already has. To clear them, forget the network on the panel and set it up again.",
      ),
    ).toBeTruthy();
  });

  const eight = Array.from({ length: 8 }, (_, i) => ({
    ssid: "n" + i,
    has_url: false,
    has_token: false,
  }));

  async function ownUrlClick() {
    fireEvent.change(
      screen.getByLabelText("Calico's address on this network"),
      {
        target: { value: "http://10.0.0.8:8787" },
      },
    );
    fireEvent.click(screen.getByText("Test and save"));
  }

  it("says at once when the panel has no networks command and an own URL is set", async () => {
    const { sent } = setup({ ok: false, error: OLD_FIRMWARE });
    await ownUrlClick();
    expect((await screen.findByRole("status")).textContent).toContain(
      OLD_FIRMWARE,
    );
    expect(sent.some((c) => c.op === "verify")).toBe(false);
  });

  it("still sets up plain Wi-Fi on firmware without the networks command", async () => {
    const { onReboot } = setup({ ok: false, error: OLD_FIRMWARE });
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
  });

  it("refuses a ninth network on a full panel before the test", async () => {
    const { sent } = setup({ ok: true, nets: eight });
    fireEvent.click(screen.getByText("Test and save"));
    expect((await screen.findByRole("status")).textContent).toContain(
      "The panel already has 8 networks. Forget one under Networks on the panel, then try again.",
    );
    expect(sent.some((c) => c.op === "verify")).toBe(false);
  });

  it("allows a network already on a full panel", async () => {
    const full = [
      { ssid: "home", has_url: false, has_token: false },
      ...eight.slice(1),
    ];
    const { onReboot } = setup({ ok: true, nets: full });
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
  });

  it("carries on when the networks read fails", async () => {
    const { onReboot } = setup({ ok: false, error: "Bluetooth: gone" });
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
  });
});
