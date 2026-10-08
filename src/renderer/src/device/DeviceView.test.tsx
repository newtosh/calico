// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalicoApi, CalicoInfo } from "../../../shared/ipc";
import type { Cmd, DeviceLink, Reply } from "./commands";
import { DeviceView } from "./DeviceView";

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

vi.mock("./ble", () => ({
  connectBle: async (onClosed: () => void) => {
    dropLink = onClosed;
    return fakeLink();
  },
}));
vi.mock("./usb", () => ({ connectUsb: vi.fn() }));

const info: CalicoInfo = {
  serverUrl: "http://127.0.0.1:8787",
  port: 8787,
  expectedPort: 8787,
  lanUrls: ["http://192.168.1.2:8787"],
  lastPanelPoll: null,
  webhookToken: "",
  serverError: null,
  autostart: { enabled: false, available: false },
  version: "0.0.0-test",
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
