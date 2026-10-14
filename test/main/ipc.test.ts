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
  it("confirm-push hands the SSIDs to the vault", () => {
    const d = deps();
    expect(call("networks:confirm-push", appFrame, ["Home"])).toEqual({
      ok: true,
    });
    expect(d.networks.confirmPush).toHaveBeenCalledWith(["Home"]);
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
      it(`${channel} refuses ${who} without touching the vault`, () => {
        const d = deps(window);
        const result = call(channel, event, ...args);
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
