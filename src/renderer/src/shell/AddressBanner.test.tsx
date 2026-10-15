// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import { NO_STATUS, ownUrl, sameUrl } from "../device/address-update";
import type { Cmd, DeviceLink, PanelNet, Reply } from "../device/commands";
import { AddressBanner, NO_PANEL, SILENT } from "./AddressBanner";

const TARGET = "http://192.168.4.30:8787";
const OLD = "This panel did not offer that feature. Flash the latest firmware.";

const connect =
  vi.fn<
    (
      onClosed: () => void,
      onPairing: () => void,
      peerName: string,
    ) => Promise<DeviceLink>
  >();
vi.mock("../device/ble", () => ({
  connectBle: (onClosed: () => void, onPairing: () => void, peer: string) =>
    connect(onClosed, onPairing, peer),
}));

const info = {
  port: 8787,
  hostname: "test-host",
  addressChange: { url: TARGET },
} as unknown as CalicoInfo;

let api: {
  info: ReturnType<typeof vi.fn>;
  adoptPort: ReturnType<typeof vi.fn>;
  dismissAddress: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  api = {
    info: vi.fn(async () => ({ ...info, lastPanelPoll: Date.now() + 60_000 })),
    adoptPort: vi.fn(async () => undefined),
    dismissAddress: vi.fn(async () => undefined),
  };
  Object.assign(window, { calico: api });
  connect.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function panel(
  opts: {
    ssid?: string;
    url?: string;
    nets?: PanelNet[];
    reply?: (cmd: Cmd) => Reply | undefined;
  } = {},
) {
  const sent: Cmd[] = [];
  const close = vi.fn();
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push(cmd);
      const custom = opts.reply?.(cmd);
      if (custom) return custom;
      if (cmd.op === "status")
        return {
          ok: true,
          info: {
            name: "ginger",
            fw: "1",
            ssid: opts.ssid ?? "home",
            url: opts.url ?? "http://192.168.4.20:8787",
            token: "set",
          },
        };
      if (cmd.op === "nets") return { ok: true, nets: opts.nets ?? [] };
      return { ok: true };
    },
    close,
  };
  connect.mockResolvedValue(link);
  return { sent, close };
}

function show(link: DeviceLink | null = null) {
  return render(
    <AddressBanner info={info} link={link} onOpenDevice={() => undefined} />,
  );
}

describe("AddressBanner", () => {
  it("shows nothing without an address change", () => {
    const { container } = render(
      <AddressBanner
        info={{ ...info, addressChange: null }}
        link={null}
        onOpenDevice={() => undefined}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("is a polite status that does not take focus when it appears", () => {
    show();
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.textContent).toContain(TARGET);
    expect(document.activeElement).toBe(document.body);
  });

  it("connects inside the click, writes only the URL, reboots, waits for the first poll and releases the link", async () => {
    const { sent, close } = panel();
    show();
    expect(screen.getByText(/Calico's address may have changed/)).toBeTruthy();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    // Web Bluetooth only opens its picker inside the click: no await may come first.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0]?.[2]).toBe("test-host");
    expect(
      await screen.findByText("Panel online.", undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(sent).toEqual([
      { op: "status" },
      { op: "nets" },
      { op: "url", value: TARGET },
      { op: "reboot" },
    ]);
    expect(api.adoptPort).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("disables its buttons while working and says when to confirm a pairing code", async () => {
    const { sent } = panel({ url: TARGET });
    const link = await connect(
      () => undefined,
      () => undefined,
      "",
    );
    let release: () => void = () => undefined;
    connect.mockImplementation(
      (_closed, onPairing) =>
        new Promise((resolve) => {
          onPairing();
          release = () => resolve(link);
        }),
    );
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect(
      await screen.findByText(
        "Confirm the code on the panel and in the system dialog.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByText("Update over Bluetooth") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByText("Not now") as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () => release());
    expect((await screen.findByRole("alert")).textContent).toBe(
      sameUrl(TARGET),
    );
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
  });

  it("writes nothing when the panel's network has its own URL", async () => {
    const { sent, close } = panel({
      nets: [{ ssid: "home", has_url: true, has_token: false }],
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(ownUrl("home"));
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    expect(close).toHaveBeenCalled();
  });

  it("writes when another network has its own URL", async () => {
    const { sent } = panel({
      nets: [{ ssid: "cabin", has_url: true, has_token: false }],
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    await waitFor(() => expect(sent.map((c) => c.op)).toContain("reboot"));
  });

  it("writes nothing when the panel already has that URL", async () => {
    const { sent } = panel({ url: TARGET });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      sameUrl(TARGET),
    );
    expect(sent.some((c) => c.op === "url" || c.op === "reboot")).toBe(false);
  });

  it("old firmware without nets gets the firmware message and nothing is written", async () => {
    const { sent, close } = panel({
      reply: (cmd) =>
        cmd.op === "nets" ? { ok: false, error: OLD } : undefined,
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(OLD);
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    expect(close).toHaveBeenCalled();
  });

  it("a failed status read shows the link's error and writes nothing", async () => {
    const { sent } = panel({
      reply: (cmd) =>
        cmd.op === "status" ? { ok: false, error: OLD } : undefined,
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(OLD);
    expect(sent.map((c) => c.op)).toEqual(["status"]);
  });

  it("a status without the panel's settings writes nothing", async () => {
    const { sent } = panel({
      reply: (cmd) => (cmd.op === "status" ? { ok: true } : undefined),
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(NO_STATUS);
    expect(sent.some((c) => c.op === "url" || c.op === "reboot")).toBe(false);
  });

  it("a failed URL write does not reboot", async () => {
    const { sent, close } = panel({
      reply: (cmd) =>
        cmd.op === "url" ? { ok: false, error: "Bluetooth: gone" } : undefined,
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Bluetooth: gone",
    );
    expect(sent.some((c) => c.op === "reboot")).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  it("a retry after an error writes the address offered now, not the first one", async () => {
    const NEXT = "http://192.168.4.31:8787";
    panel({
      reply: (cmd) =>
        cmd.op === "url" ? { ok: false, error: "Bluetooth: gone" } : undefined,
    });
    const { rerender } = show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    await screen.findByRole("alert");
    rerender(
      <AddressBanner
        info={{ ...info, addressChange: { url: NEXT } }}
        link={null}
        onOpenDevice={() => undefined}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(NEXT);
    const { sent } = panel();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    await waitFor(() =>
      expect(sent).toContainEqual({ op: "url", value: NEXT }),
    );
  });

  it("a link that throws is released and the button comes back", async () => {
    const { close } = panel({
      reply: () => {
        throw new Error("boom");
      },
    });
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe("boom");
    expect(close).toHaveBeenCalled();
    expect(
      (screen.getByText("Update over Bluetooth") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("a cancelled picker or a panel that is off says what to check", async () => {
    connect.mockRejectedValue(
      Object.assign(new Error("User cancelled"), { name: "NotFoundError" }),
    );
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(NO_PANEL);
    expect(screen.getByText("Update over Bluetooth")).toBeTruthy();
  });

  it("a failed pairing shows the connect helper's own message", async () => {
    connect.mockRejectedValue(new Error("Pairing did not finish."));
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pairing did not finish.",
    );
  });

  it("a panel that never polls after the restart says so and offers a retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.info.mockImplementation(async () => info);
    panel();
    show();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    await screen.findByText(/Waiting up to 30 s/);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await screen.findByRole("alert")).textContent).toBe(SILENT);
    expect(
      (screen.getByText("Update over Bluetooth") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("Not now hides it and tells main", async () => {
    const { container } = show();
    fireEvent.click(screen.getByText("Not now"));
    expect(api.dismissAddress).toHaveBeenCalled();
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("Not now hides it only until main reports again", async () => {
    const { container, rerender } = show();
    fireEvent.click(screen.getByText("Not now"));
    await waitFor(() => expect(container.textContent).toBe(""));
    rerender(
      <AddressBanner
        info={{ ...info }}
        link={null}
        onOpenDevice={() => undefined}
      />,
    );
    expect(container.textContent).toContain(TARGET);
  });

  it("with a link already open, sends the person to the Panel page", () => {
    const onOpenDevice = vi.fn();
    const open: DeviceLink = {
      kind: "ble",
      send: async () => ({ ok: true }),
      close() {},
    };
    render(
      <AddressBanner info={info} link={open} onOpenDevice={onOpenDevice} />,
    );
    fireEvent.click(screen.getByText("Update on the Panel page"));
    expect(onOpenDevice).toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(screen.queryByText("Update over Bluetooth")).toBeNull();
  });
});
