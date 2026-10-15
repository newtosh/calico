// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoApi, CalicoInfo } from "../../shared/ipc";
import { App } from "./App";
import type { DeviceLink } from "./device/commands";

const OFFER = "http://192.168.4.30:8787";

const link: DeviceLink = {
  kind: "ble",
  send: async (cmd) =>
    cmd.op === "status"
      ? {
          ok: true,
          info: { name: "ginger", fw: "1", ssid: "", url: "", token: "none" },
        }
      : { ok: true },
  close() {},
};
vi.mock("./device/ble", () => ({ connectBle: async () => link }));
vi.mock("./device/usb", () => ({ connectUsb: vi.fn() }));

const base: CalicoInfo = {
  serverUrl: null,
  port: 8787,
  expectedPort: 8787,
  lanUrls: ["http://192.168.1.2:8787"],
  lastPanelPoll: null,
  panelBattery: null,
  webhookToken: "",
  webhook: { accepted: null, refused: { count: 0, last: null } },
  serverError: null,
  autostart: { enabled: false, available: false },
  version: "0.0.0-test",
  hostname: "test-host",
  addressChange: { url: OFFER },
} as unknown as CalicoInfo;

let dismissAddress: ReturnType<typeof vi.fn>;
let current: CalicoInfo;

beforeEach(() => {
  dismissAddress = vi.fn(async () => undefined);
  current = base;
  // Anything else App's views call resolves to nothing; on* subscriptions return an unsubscribe.
  window.calico = new Proxy(
    { info: async () => current, dismissAddress },
    {
      get: (target, key: string) =>
        key in target
          ? target[key as keyof typeof target]
          : key.startsWith("on")
            ? () => () => undefined
            : async () => undefined,
    },
  ) as unknown as CalicoApi;
});
afterEach(cleanup);

describe("App address banner wiring", () => {
  it("shows the banner from CalicoInfo.addressChange and Not now tells main", async () => {
    render(<App />);
    expect(
      await screen.findByText(/The panel's address may have changed/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Not now"));
    expect(dismissAddress).toHaveBeenCalled();
  });

  it("with a link open, the banner opens the Panel page at the offered address", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Panel" }));
    fireEvent.click(await screen.findByText("Connect over Bluetooth"));
    await screen.findByText(/Connected over Bluetooth/);
    fireEvent.click(screen.getByText("Dashboard"));
    await act(async () => undefined);
    expect(
      screen.queryByLabelText("Calico's address (the panel polls this)"),
    ).toBeNull();
    fireEvent.click(screen.getByText("Update on the Panel page"));
    expect(
      (
        (await screen.findByLabelText(
          "Calico's address (the panel polls this)",
        )) as HTMLInputElement
      ).value,
    ).toBe(OFFER);
  });

  it("on the Panel page with a link open, the URL field follows a new offer", async () => {
    current = { ...base, addressChange: null };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Panel" }));
    fireEvent.click(await screen.findByText("Connect over Bluetooth"));
    const field = (await screen.findByLabelText(
      "Calico's address (the panel polls this)",
    )) as HTMLInputElement;
    expect(field.value).toBe("http://192.168.1.2:8787");
    current = base;
    await screen.findByText(/The panel's address may have changed/, undefined, {
      timeout: 3000,
    });
    fireEvent.click(screen.getByText("Update on the Panel page"));
    expect(field.value).toBe(OFFER);
  });
});
