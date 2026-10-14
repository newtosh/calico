// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalicoApi, CalicoInfo } from "../../../shared/ipc";
import type { Cmd, DeviceLink, Reply } from "./commands";
import { DeviceView } from "./DeviceView";
import { pushedAll } from "./PushNetworks";

let dropLink: () => void = () => undefined;

// The desk resets on reboot, so the link drops right after the write.
function fakeLink(): DeviceLink {
  return {
    kind: "ble",
    async send(cmd: Cmd): Promise<Reply> {
      if (cmd.op === "status")
        return {
          ok: true,
          info: { name: "desk", fw: "1", ssid: "", url: "", token: "none" },
        };
      if (cmd.op === "reboot") setTimeout(() => dropLink(), 1000);
      return { ok: true };
    },
    close() {},
  };
}

let connectImpl: (
  onClosed: () => void,
  onPairing: () => void,
) => Promise<DeviceLink> = async (onClosed) => {
  dropLink = onClosed;
  return fakeLink();
};

vi.mock("./ble", () => ({
  connectBle: (onClosed: () => void, onPairing: () => void) =>
    connectImpl(onClosed, onPairing),
}));
vi.mock("./usb", () => ({ connectUsb: vi.fn() }));

const info: CalicoInfo = {
  serverUrl: "http://127.0.0.1:8787",
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
  addressChange: null,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness() {
  const [link, setLink] = useState<DeviceLink | null>(null);
  return (
    <DeviceView
      info={info}
      link={link}
      setLink={setLink}
      onLog={() => undefined}
    />
  );
}

async function provision() {
  render(<Harness />);
  fireEvent.click(screen.getByText("Connect over Bluetooth"));
  fireEvent.change(await screen.findByLabelText("Or type an SSID"), {
    target: { value: "home" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter22" },
  });
  fireEvent.click(screen.getByText("Test and save"));
}

describe("DeviceView provisioning", () => {
  it("shows Panel online after the reboot drops the link, without a lost-connection error", async () => {
    window.calico = {
      adoptPort: async () => undefined,
      info: async () => ({ ...info, lastPanelPoll: Date.now() + 60_000 }),
    } as unknown as CalicoApi;

    await provision();

    expect(
      await screen.findByText("Panel online.", undefined, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.queryByText(/Lost the connection/)).toBeNull();
  }, 10_000);

  it("gives up after one 30 s wait, even though the link dropped mid-wait", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.calico = {
      adoptPort: async () => undefined,
      info: async () => info,
    } as unknown as CalicoApi;
    await provision();
    await screen.findByText(/Waiting up to 30 s/);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await screen.findByText(/has not reached calico/)).toBeTruthy();
  });
});

describe("DeviceView push to panel", () => {
  it("keeps the outcome and restarts the panel after a full push", async () => {
    window.calico = {
      info: async () => info,
      networksList: async () => ({
        networks: [
          { ssid: "home", url: "", password_set: true, token_set: true },
        ],
        error: "",
        notice: "",
      }),
      networksConfirmPush: async () => ({ ok: true }),
      networksRelease: async () => ({ ok: true, password: "p", token: "t" }),
      networksEndPush: async () => undefined,
    } as unknown as CalicoApi;
    render(<Harness />);
    fireEvent.click(screen.getByText("Connect over Bluetooth"));
    fireEvent.click(await screen.findByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    expect(await screen.findByText(pushedAll(1))).toBeTruthy();
    expect(await screen.findByText(/Waiting up to 30 s/)).toBeTruthy();
  });
});

describe("DeviceView Bluetooth pairing", () => {
  it("guides while the OS pairs, blocks a second Connect, then shows the error", async () => {
    window.calico = { info: async () => info } as unknown as CalicoApi;
    let fail: (e: Error) => void = () => undefined;
    const saved = connectImpl;
    connectImpl = (_onClosed, onPairing) => {
      onPairing();
      return new Promise((_, reject) => {
        fail = reject;
      });
    };
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText("Connect over Bluetooth"));
      expect(
        await screen.findByText(
          "Confirm the code on the panel and in the system dialog.",
        ),
      ).toBeTruthy();
      expect(
        (screen.getByText("Connect over Bluetooth") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (screen.getByText("Connect over USB") as HTMLButtonElement).disabled,
      ).toBe(true);
      fail(new Error("Pairing did not finish."));
      expect(await screen.findByText("Pairing did not finish.")).toBeTruthy();
      expect(
        screen.queryByText(
          "Confirm the code on the panel and in the system dialog.",
        ),
      ).toBeNull();
      expect(
        (screen.getByText("Connect over Bluetooth") as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    } finally {
      connectImpl = saved;
    }
  });
});
