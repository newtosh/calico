import { hostname } from "node:os";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  powerMonitor,
  safeStorage,
  shell,
} from "electron";
import {
  ConfigError,
  type CalicoConfig,
  loadConfig,
  saveConfig,
} from "../server/config";
import { version } from "../../package.json";
import { NetworkVault } from "./networks";
import {
  AddressWatch,
  loadSeen,
  localAddresses,
  saveSeen,
} from "./panel-address";
import { CursorState, startCursorPoll } from "../server/cursor-poll";
import { RelayState, startRelayPoll } from "../server/relay";
import { createCompanionServer } from "../server/http";
import {
  lanUrls,
  listenWithFallback,
  PanelPort,
  PortsBusyError,
  resolvePort,
} from "../server/port";
import { loadSnapshot, saveSnapshot } from "../server/state-file";
import { DeskStore } from "../server/store";
import type { CalicoInfo, ServerErrorInfo } from "../shared/ipc";
import { execFileP, portHolders } from "./assist";
import { initAutostartOnce } from "./autostart";
import { wireDevicePickers } from "./devices";
import { autostartState, registerIpc } from "./ipc";
import { ConfigHolder } from "./config-holder";
import { botNote, RelaySetupService, withMadeRelay } from "./relay/service";
import { setupRelay } from "./relay/setup";
import { cloudflareSetupDeps } from "./relay/wire";
import { createTray, type TrayActions, updateTray } from "./tray";
import appIcon from "../../resources/icon.png?asset";

if (process.env.CALICO_USER_DATA)
  app.setPath("userData", process.env.CALICO_USER_DATA);

// Electron ships Web Bluetooth disabled on Linux behind this flag.
if (process.platform === "linux")
  app.commandLine.appendSwitch("enable-experimental-web-platform-features");

let win: BrowserWindow | null = null;
let quitting = false;

function showWindow(): void {
  if (!win) win = createWindow();
  win.show();
  win.focus();
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0c0e09",
    title: "Calico",
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  wireDevicePickers(w);
  w.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    w.hide();
  });
  w.webContents.on("will-navigate", (event) => event.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.once("ready-to-show", () => w.show());
  if (process.env.ELECTRON_RENDERER_URL)
    void w.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void w.loadFile(join(__dirname, "../renderer/index.html"));
  return w;
}

async function start(): Promise<void> {
  const userData = app.getPath("userData");
  const configPath = join(userData, "config.json");
  const statePath = join(userData, "state.json");
  const seenPath = join(userData, "panel-seen.json");
  const addressWatch = new AddressWatch(loadSeen(seenPath), Date.now);

  let loaded: { config: CalicoConfig; existed: boolean };
  try {
    loaded = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      dialog.showErrorBox("Calico cannot start", err.message);
      app.exit(1);
      return;
    }
    throw err;
  }
  let config = loaded.config;
  const holder = new ConfigHolder(config, (next) =>
    saveConfig(configPath, next),
  );
  // Write first: a failed write must not leave memory ahead of disk.
  const save = (next: CalicoConfig) => {
    holder.set(next);
    config = holder.get();
  };

  const store = new DeskStore({
    runningTtlMs: () => config.running_timeout_seconds * 1000,
    snapshot: loadSnapshot(statePath),
    onChange: (s) => saveSnapshot(statePath, s),
  });
  const { server, stats } = createCompanionServer({
    store,
    getConfig: () => config,
    setConfig: save,
    // Dev serves the renderer over http, so it sends an Origin. Packaged builds load file:// and send none.
    cursorStatus: () => cursorState.snapshot(config.cursor_api_key !== ""),
    relayStatus: () => relayState.snapshot(config.relay_url !== ""),
    // Saved only when the poll came from somewhere new, not on every poll.
    onPanelPoll: (seen) => {
      if (addressWatch.polled(seen)) saveSeen(seenPath, seen);
    },
    allowedOrigins:
      !app.isPackaged && process.env.ELECTRON_RENDERER_URL
        ? [new URL(process.env.ELECTRON_RENDERER_URL).origin]
        : [],
  });

  const panelPort = new PanelPort(config.port);
  const cursorState = new CursorState();
  const relayState = new RelayState();
  let bound: number | null = null;
  let serverError: ServerErrorInfo | null = null;
  try {
    bound = await listenWithFallback(server, "0.0.0.0", config.port);
    if (resolvePort(loaded.existed, config.port, bound).persist) {
      panelPort.adopt(bound);
      save({ ...config, port: bound });
    }
  } catch (err) {
    if (!(err instanceof PortsBusyError)) throw err;
    serverError = {
      first: err.first,
      last: err.last,
      holders: await portHolders(err.first, execFileP),
    };
  }
  initAutostartOnce(userData);

  const stopCursorPoll = startCursorPoll(store, () => config, cursorState);
  const stopRelayPoll = startRelayPoll(
    store,
    () => config,
    (cursor) => save({ ...config, relay_cursor: cursor }),
    relayState,
  );

  const info = (): CalicoInfo => {
    const offer = bound ? addressWatch.check(localAddresses()) : null;
    return {
      serverUrl: bound ? `http://127.0.0.1:${bound}` : null,
      port: bound,
      expectedPort: panelPort.expected,
      lanUrls: bound ? lanUrls(bound) : [],
      lastPanelPoll: stats.lastPanelPoll,
      panelBattery: stats.panelBattery,
      webhookToken: config.webhook_token,
      webhook: stats.webhook,
      serverError,
      autostart: autostartState(),
      // app.getVersion() returns Electron's version when launched from the entry file.
      version,
      hostname: hostname(),
      addressChange:
        offer && bound ? { url: `http://${offer}:${bound}` } : null,
    };
  };
  // After sleep the panel has had no chance to poll: count its silence from the wake.
  powerMonitor.on("resume", () => addressWatch.woke());

  const relaySetup = new RelaySetupService(
    (signal, report) =>
      setupRelay({
        ...cloudflareSetupDeps(signal),
        report,
        persist: (made) => save(withMadeRelay(config, made)),
      }),
    () => config.relay_url === "",
  );
  relaySetup.subscribe((view) => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.isDestroyed()) w.webContents.send("relay:setup-changed", view);
  });

  // After app ready, so safeStorage knows its backend. Linux is the only target for now.
  const networks = new NetworkVault(join(userData, "networks.json"), {
    backend: () =>
      process.platform === "linux"
        ? safeStorage.getSelectedStorageBackend()
        : "os",
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (sealed) => safeStorage.decryptString(sealed),
  });

  registerIpc({
    networks,
    dismissAddress: () => addressWatch.dismiss(),
    appContents: () => (win && !win.isDestroyed() ? win.webContents : null),
    relaySetup,
    botNote: () =>
      config.relay_url && config.relay_send_token
        ? botNote(config.relay_url, config.relay_send_token)
        : null,
    info,
    boundPort: () => bound,
    adoptPort: () => {
      if (!bound) return;
      panelPort.adopt(bound);
      save({ ...config, port: bound });
      refreshTray();
    },
  });

  const actions: TrayActions = {
    open: showWindow,
    quit: () => {
      quitting = true;
      app.quit();
    },
  };
  createTray(actions);
  const refreshTray = () =>
    updateTray(actions, info().lanUrls[0] ?? null, panelPort.driftFrom(bound));
  refreshTray();

  let closing = false;
  app.on("before-quit", (event) => {
    quitting = true;
    // Give a running setup time to delete its Worker and revoke its access.
    if (!closing && relaySetup.view().phase === "running") {
      closing = true;
      event.preventDefault();
      relaySetup.cancel();
      void Promise.race([
        relaySetup.settled(),
        new Promise((r) => setTimeout(r, 10_000)),
      ]).then(() => app.quit());
      return;
    }
    stopCursorPoll();
    stopRelayPoll();
    server.close();
  });

  if (!process.argv.includes("--hidden")) showWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  // Keep running in the tray with no window open.
  app.on("window-all-closed", () => undefined);
  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      dialog.showErrorBox("Calico failed to start", String(err));
      app.exit(1);
    });
}
