import { join } from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import {
  ConfigError,
  type CalicoConfig,
  loadConfig,
  saveConfig,
} from "../server/config";
import { version } from "../../package.json";
import { startCursorPoll } from "../server/cursor-poll";
import { createCompanionServer } from "../server/http";
import {
  lanUrls,
  listenWithFallback,
  PortsBusyError,
  resolvePort,
} from "../server/port";
import { loadSnapshot, saveSnapshot } from "../server/state-file";
import { DeskStore } from "../server/store";
import type { CalicoInfo, ServerErrorInfo } from "../shared/ipc";
import { execFileP, portHolders } from "./assist";
import { autostartAvailable, setAutostart } from "./autostart";
import { wireDevicePickers } from "./devices";
import { autostartState, registerIpc } from "./ipc";
import { createTray, type TrayActions, updateTray } from "./tray";

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
  const save = (next: CalicoConfig) => {
    config = next;
    saveConfig(configPath, config);
  };

  const store = new DeskStore({
    snapshot: loadSnapshot(statePath),
    onChange: (s) => saveSnapshot(statePath, s),
  });
  const { server, stats } = createCompanionServer({
    store,
    getConfig: () => config,
    setConfig: save,
    // Dev serves the renderer over http, so it sends an Origin. Packaged builds load file:// and send none.
    allowedOrigins:
      !app.isPackaged && process.env.ELECTRON_RENDERER_URL
        ? [new URL(process.env.ELECTRON_RENDERER_URL).origin]
        : [],
  });

  let bound: number | null = null;
  let serverError: ServerErrorInfo | null = null;
  try {
    bound = await listenWithFallback(server, "0.0.0.0", config.port);
    if (resolvePort(loaded.existed, config.port, bound).persist)
      save({ ...config, port: bound });
  } catch (err) {
    if (!(err instanceof PortsBusyError)) throw err;
    serverError = {
      first: err.first,
      last: err.last,
      holders: await portHolders(err.first, execFileP),
    };
  }
  if (!loaded.existed && autostartAvailable()) setAutostart(true);

  const stopPoll = startCursorPoll(store, () => config);

  const info = (): CalicoInfo => ({
    serverUrl: bound ? `http://127.0.0.1:${bound}` : null,
    port: bound,
    expectedPort: config.port,
    lanUrls: bound ? lanUrls(bound) : [],
    lastPanelPoll: stats.lastPanelPoll,
    webhookToken: config.webhook_token,
    serverError,
    autostart: autostartState(),
    // app.getVersion() returns Electron's version when launched from the entry file.
    version,
  });

  registerIpc({
    info,
    boundPort: () => bound,
    adoptPort: () => {
      if (bound) save({ ...config, port: bound });
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
  const drift = bound !== null && bound !== config.port ? config.port : null;
  updateTray(actions, info().lanUrls[0] ?? null, drift);

  app.on("before-quit", () => {
    quitting = true;
    stopPoll();
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
