import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelSeen } from "../../src/server/http";
import type { LocalAddress } from "../../src/main/panel-address";
import type { CalicoInfo } from "../../src/shared/ipc";

// Boots the real main process (src/main/index.ts) against fake Electron, a fake server and fake
// network interfaces, then drives it through what it registered.
type Handler = (event: unknown, ...args: unknown[]) => unknown;
interface FakeContents {
  mainFrame: object;
}
const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  resume: [] as (() => void)[],
  onPanelPoll: null as ((seen: PanelSeen) => void) | null,
  windows: [] as { webContents: FakeContents }[],
  addrs: [] as LocalAddress[],
  userData: "",
  now: 1_000_000,
  errors: [] as string[],
}));

vi.mock("electron", () => {
  class BrowserWindow {
    static getAllWindows = () => h.windows;
    webContents = {
      mainFrame: {},
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
    };
    on = vi.fn();
    once = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    loadFile = vi.fn(async () => undefined);
    loadURL = vi.fn(async () => undefined);
    isDestroyed = () => false;
    constructor() {
      h.windows.push(this);
    }
  }
  return {
    app: {
      setPath: vi.fn(),
      getPath: () => h.userData,
      commandLine: { appendSwitch: vi.fn() },
      isPackaged: false,
      requestSingleInstanceLock: () => true,
      on: vi.fn(),
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
      exit: vi.fn(),
    },
    BrowserWindow,
    clipboard: {},
    dialog: {
      showMessageBox: vi.fn(async () => ({ response: 1 })),
      showErrorBox: (title: string, text: string) =>
        h.errors.push(`${title}: ${text}`),
    },
    ipcMain: {
      handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn),
      on: vi.fn(),
    },
    powerMonitor: {
      on: (event: string, cb: () => void) => {
        if (event === "resume") h.resume.push(cb);
      },
    },
    safeStorage: {
      getSelectedStorageBackend: () => "gnome_libsecret",
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(`sealed:${text}`),
      decryptString: (sealed: Buffer) => sealed.toString().slice(7),
    },
    shell: { openExternal: vi.fn() },
  };
});
vi.mock("../../resources/icon.png?asset", () => ({ default: "icon.png" }));
vi.mock("../../src/server/http", () => ({
  createCompanionServer: (deps: {
    onPanelPoll?: (seen: PanelSeen) => void;
  }) => {
    h.onPanelPoll = deps.onPanelPoll ?? null;
    return {
      server: { close: vi.fn() },
      stats: {
        lastPanelPoll: null,
        panelBattery: null,
        webhook: { accepted: null, refused: { count: 0, last: null } },
      },
    };
  },
}));
vi.mock("../../src/server/port", async (original) => ({
  ...(await original<typeof import("../../src/server/port")>()),
  listenWithFallback: async () => 4242,
}));
vi.mock("../../src/server/cursor-poll", async (original) => ({
  ...(await original<typeof import("../../src/server/cursor-poll")>()),
  startCursorPoll: () => () => undefined,
}));
vi.mock("../../src/server/relay", async (original) => ({
  ...(await original<typeof import("../../src/server/relay")>()),
  startRelayPoll: () => () => undefined,
}));
vi.mock("../../src/main/autostart", async (original) => ({
  ...(await original<typeof import("../../src/main/autostart")>()),
  initAutostartOnce: vi.fn(),
}));
vi.mock("../../src/main/tray", () => ({
  createTray: vi.fn(),
  updateTray: vi.fn(),
}));
vi.mock("../../src/main/devices", () => ({ wireDevicePickers: vi.fn() }));
vi.mock("../../src/main/panel-address", async (original) => ({
  ...(await original<typeof import("../../src/main/panel-address")>()),
  localAddresses: () => h.addrs,
}));

const seen: PanelSeen = { from: "192.168.4.50", via: "192.168.4.30" };
const wifi = (address: string): LocalAddress => ({
  iface: "wlan0",
  address,
  cidr: `${address}/24`,
  virtual: false,
});
const seenPath = () => join(h.userData, "panel-seen.json");

function call(channel: string, event: unknown, ...args: unknown[]): unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(event, ...args);
}
const info = () => call("calico:info", {}) as CalicoInfo;
const poll = (s: PanelSeen) => {
  if (!h.onPanelPoll) throw new Error("onPanelPoll not wired");
  h.onPanelPoll(s);
};

async function boot(): Promise<void> {
  vi.resetModules();
  await import("../../src/main/index");
  await vi.waitFor(() => expect(h.handlers.has("calico:info")).toBe(true));
  expect(h.errors).toEqual([]);
}

beforeEach(() => {
  h.handlers.clear();
  h.resume = [];
  h.onPanelPoll = null;
  h.windows = [];
  h.addrs = [wifi("192.168.4.30")];
  h.errors = [];
  h.now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => h.now);
  h.userData = mkdtempSync(join(tmpdir(), "calico-main-"));
  process.env.CALICO_USER_DATA = h.userData;
  process.env.CALICO_FIRMWARE_CHECK = "0";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CALICO_USER_DATA;
  delete process.env.CALICO_FIRMWARE_CHECK;
  vi.useRealTimers();
  rmSync(h.userData, { recursive: true, force: true });
});

describe("panel-seen.json", () => {
  it("is written only when a poll comes from somewhere new, mode 0600", async () => {
    await boot();
    poll(seen);
    expect(statSync(seenPath()).mode & 0o777).toBe(0o600);
    rmSync(seenPath());
    poll(seen);
    expect(existsSync(seenPath())).toBe(false);
    poll({ ...seen, via: "192.168.4.31" });
    expect(existsSync(seenPath())).toBe(true);
  });

  it("is loaded at start, so a restart on a new address offers it", async () => {
    writeFileSync(seenPath(), JSON.stringify(seen));
    h.addrs = [wifi("192.168.4.31")];
    await boot();
    expect(info().addressChange).toBeNull();
    h.now += 60_000;
    expect(info().addressChange).toEqual({ url: "http://192.168.4.31:4242" });
  });

  it("a corrupt file starts with no history", async () => {
    writeFileSync(seenPath(), "{not json");
    h.addrs = [wifi("192.168.4.31")];
    await boot();
    h.now += 60_000;
    expect(info().addressChange).toBeNull();
  });
});

describe("address banner", () => {
  async function offering(): Promise<void> {
    await boot();
    poll(seen);
    h.addrs = [wifi("192.168.4.31")];
    h.now += 60_000;
    expect(info().addressChange).toEqual({ url: "http://192.168.4.31:4242" });
  }

  it("a wake restarts the silence", async () => {
    await offering();
    expect(h.resume).toHaveLength(1);
    h.resume.forEach((cb) => cb());
    expect(info().addressChange).toBeNull();
    h.now += 60_000;
    expect(info().addressChange).not.toBeNull();
  });

  it("Not now hides it", async () => {
    await offering();
    call("calico:dismiss-address", {});
    expect(info().addressChange).toBeNull();
  });
});

describe("push channels", () => {
  const fromApp = () => {
    const wc = h.windows[0]?.webContents;
    if (!wc) throw new Error("no window");
    return { sender: wc, senderFrame: wc.mainFrame };
  };

  async function confirmed(): Promise<void> {
    await boot();
    call(
      "networks:save",
      {},
      {
        ssid: "Home",
        url: "http://192.168.4.30:4242",
        edit: false,
        password: "fake-pass-1",
        token: "fake-token",
      },
    );
  }

  it("release a saved password once to the app window", async () => {
    await confirmed();
    await expect(
      call("networks:confirm-push", fromApp(), ["Home"]),
    ).resolves.toEqual({ ok: true });
    expect(call("networks:release", fromApp(), "Home")).toEqual({
      ok: true,
      password: "fake-pass-1",
      token: "fake-token",
    });
    expect(call("networks:release", fromApp(), "Home")).toMatchObject({
      ok: false,
    });
  });

  it("end-push stops the release", async () => {
    await confirmed();
    await call("networks:confirm-push", fromApp(), ["Home"]);
    call("networks:end-push", fromApp());
    expect(call("networks:release", fromApp(), "Home")).toMatchObject({
      ok: false,
    });
  });

  it("refuse another webContents and a subframe", async () => {
    await confirmed();
    const wc = fromApp().sender;
    const stranger = { mainFrame: {} };
    for (const event of [
      { sender: stranger, senderFrame: stranger.mainFrame },
      { sender: wc, senderFrame: {} },
    ]) {
      await expect(
        call("networks:confirm-push", event, ["Home"]),
      ).resolves.toMatchObject({ ok: false });
      await call("networks:confirm-push", fromApp(), ["Home"]);
      expect(call("networks:release", event, "Home")).toMatchObject({
        ok: false,
      });
      call("networks:end-push", event);
      // The refused calls changed nothing: the app window still holds its one release.
      expect(call("networks:release", fromApp(), "Home")).toMatchObject({
        ok: true,
      });
    }
  });
});

describe("firmware watcher", () => {
  const freshProfile = {
    status: "unknown",
    panel: null,
    latest: null,
    checkedAt: null,
    lastError: "",
    check: true,
    dismissed: false,
    belowMinimum: false,
  };

  it("CALICO_FIRMWARE_CHECK=0 never reaches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    await boot();
    expect(info().firmware).toEqual(freshProfile);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports what a stored firmware.json says", async () => {
    const latest = {
      version: "0.3.0",
      minApp: "0.1.13",
      notesUrl: "https://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
    };
    writeFileSync(
      join(h.userData, "firmware.json"),
      JSON.stringify({
        check: false,
        dismissed: "",
        latest,
        checkedAt: 1234,
        panel: { fw: "0.2.0", at: 5 },
      }),
    );
    await boot();
    expect(info().firmware).toMatchObject({
      check: false,
      latest,
      checkedAt: 1234,
      panel: "0.2.0",
      status: "available",
      dismissed: false,
    });
  });

  it("without it, the first check follows startup", async () => {
    delete process.env.CALICO_FIRMWARE_CHECK;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    await boot();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
