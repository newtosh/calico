import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock("electron", () => ({
  app: { isPackaged: false },
  clipboard: {},
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  },
}));
import { fromAppWindow, registerIpc, type IpcDeps } from "../../src/main/ipc";

const contents = { mainFrame: { name: "top" } };
const appFrame = { sender: contents, senderFrame: contents.mainFrame };
const other = { mainFrame: { name: "other top" } };
const foreign = { sender: other, senderFrame: other.mainFrame };
const subframe = { sender: contents, senderFrame: { name: "iframe" } };

function deps(window: { mainFrame: unknown } | null = contents) {
  const networks = {
    list: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    confirmPush: vi.fn(() => ({ ok: true as const })),
    release: vi.fn(() => ({
      ok: true as const,
      password: "fake-pass",
      token: "fake-token",
    })),
    endPush: vi.fn(),
  };
  const d = {
    info: vi.fn(),
    boundPort: () => null,
    adoptPort: vi.fn(),
    relaySetup: {} as IpcDeps["relaySetup"],
    botNote: () => null,
    networks,
    dismissAddress: vi.fn(),
    firmware: {
      checkNow: vi.fn(async () => ({
        ok: true as const,
        release: {} as never,
      })),
      setCheck: vi.fn(),
      dismiss: vi.fn(),
      panelSeen: vi.fn(),
    },
    askPush: vi.fn<IpcDeps["askPush"]>(async () => true),
    appContents: () => window,
  } satisfies IpcDeps;
  registerIpc(d);
  return d;
}

const call = (channel: string, event: unknown, ...args: unknown[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(event, ...args);
};

beforeEach(() => handlers.clear());

describe("fromAppWindow", () => {
  it("accepts only the top frame of the app's own window", () => {
    expect(fromAppWindow(appFrame, contents)).toBe(true);
    expect(fromAppWindow(foreign, contents)).toBe(false);
    expect(fromAppWindow(subframe, contents)).toBe(false);
    expect(fromAppWindow(appFrame, null)).toBe(false);
    expect(
      fromAppWindow({ sender: contents, senderFrame: null }, contents),
    ).toBe(false);
    // Each half of the check holds on its own.
    expect(
      fromAppWindow(
        { sender: other, senderFrame: contents.mainFrame },
        contents,
      ),
    ).toBe(false);
    expect(fromAppWindow({ sender: null, senderFrame: undefined }, null)).toBe(
      false,
    );
  });
});

describe("push channels", () => {
  it("confirm-push asks the person, then hands the SSIDs to the vault", async () => {
    const d = deps();
    await expect(
      call("networks:confirm-push", appFrame, ["Home"]),
    ).resolves.toEqual({ ok: true });
    expect(d.askPush).toHaveBeenCalledWith(["Home"]);
    expect(d.networks.confirmPush).toHaveBeenCalledWith(["Home"]);
  });

  it("confirm-push stops when the person declines the native dialog", async () => {
    const d = deps();
    d.askPush.mockResolvedValueOnce(false);
    await expect(
      call("networks:confirm-push", appFrame, ["Home"]),
    ).resolves.toMatchObject({ ok: false });
    expect(d.networks.confirmPush).not.toHaveBeenCalled();
  });

  it("confirm-push of nothing needs no dialog because no password can leave", async () => {
    const d = deps();
    await call("networks:confirm-push", appFrame, []);
    expect(d.askPush).not.toHaveBeenCalled();
    expect(d.networks.confirmPush).toHaveBeenCalledWith([]);
  });

  it("release returns the vault's one-shot release", () => {
    const d = deps();
    expect(call("networks:release", appFrame, "Home")).toEqual({
      ok: true,
      password: "fake-pass",
      token: "fake-token",
    });
    expect(d.networks.release).toHaveBeenCalledWith("Home");
  });

  it("end-push ends the push", () => {
    const d = deps();
    call("networks:end-push", appFrame);
    expect(d.networks.endPush).toHaveBeenCalledOnce();
  });

  const channels: [string, keyof IpcDeps["networks"], unknown[]][] = [
    ["networks:confirm-push", "confirmPush", [["Home"]]],
    ["networks:release", "release", ["Home"]],
    ["networks:end-push", "endPush", []],
  ];
  const strangers: [string, unknown, { mainFrame: unknown } | null][] = [
    ["another window", foreign, contents],
    ["a subframe of the app window", subframe, contents],
    ["any sender while no window is open", appFrame, null],
  ];
  for (const [channel, method, args] of channels)
    for (const [who, event, window] of strangers)
      it(`${channel} refuses ${who} without touching the vault`, async () => {
        const d = deps(window);
        const result = await call(channel, event, ...args);
        expect(d.askPush).not.toHaveBeenCalled();
        expect(result).toMatchObject({ ok: false });
        expect(result).not.toHaveProperty("password");
        for (const fn of Object.values(d.networks))
          expect(fn).not.toHaveBeenCalled();
        expect(d.networks[method]).not.toHaveBeenCalled();
      });
});

describe("address banner", () => {
  it("dismiss-address is Not now", () => {
    const d = deps();
    call("calico:dismiss-address", appFrame);
    expect(d.dismissAddress).toHaveBeenCalledOnce();
  });
});

describe("firmware channels", () => {
  it("passes strict values to the watcher and ignores anything else", async () => {
    const d = deps();
    expect(await call("firmware:check-now", appFrame)).toBeUndefined();
    expect(d.firmware.checkNow).toHaveBeenCalledOnce();
    call("firmware:set-check", appFrame, true);
    call("firmware:set-check", appFrame, "true");
    call("firmware:set-check", appFrame, 1);
    expect(d.firmware.setCheck).toHaveBeenCalledTimes(1);
    expect(d.firmware.setCheck).toHaveBeenCalledWith(true);
    call("firmware:dismiss", appFrame, "0.3.0");
    call("firmware:dismiss", appFrame, { v: "0.3.0" });
    expect(d.firmware.dismiss).toHaveBeenCalledTimes(1);
    call("firmware:panel-seen", appFrame, "0.2.0");
    call("firmware:panel-seen", appFrame, 7);
    call("firmware:panel-seen", appFrame, "x".repeat(100));
    expect(d.firmware.panelSeen).toHaveBeenCalledTimes(1);
    expect(d.firmware.panelSeen).toHaveBeenCalledWith("0.2.0");
  });
});
