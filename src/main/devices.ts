import { type BrowserWindow, ipcMain } from "electron";
import type { Candidate } from "../shared/ipc";
import { execFileP, serialReadFix } from "./assist";

/** Electron has no device picker UI. Forward candidates to the renderer and wait for its choice. */
export function wireDevicePickers(win: BrowserWindow): void {
  const contents = win.webContents;
  const session = contents.session;
  let bleCallback: ((id: string) => void) | null = null;
  let serialCallback: ((id: string) => void) | null = null;
  const serialNames = new Map<string, string>();

  contents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    bleCallback = callback;
    const list: Candidate[] = devices.map((d) => ({
      id: d.deviceId,
      name: d.deviceName || d.deviceId,
    }));
    contents.send("device:ble-candidates", list);
  });
  ipcMain.on("device:ble-choose", (_event, id: unknown) => {
    bleCallback?.(typeof id === "string" ? id : "");
    bleCallback = null;
  });

  session.on("select-serial-port", (event, ports, _wc, callback) => {
    event.preventDefault();
    serialCallback = callback;
    serialNames.clear();
    for (const p of ports) serialNames.set(p.portId, p.portName);
    const list: Candidate[] = ports.map((p) => ({
      id: p.portId,
      name: p.displayName || p.portName,
    }));
    contents.send("device:serial-candidates", list);
  });
  ipcMain.on("device:serial-choose", (_event, id: unknown) => {
    const chosen = typeof id === "string" ? id : "";
    const callback = serialCallback;
    serialCallback = null;
    const fix =
      process.platform === "linux"
        ? serialReadFix(serialNames.get(chosen) ?? "")
        : null;
    // Best effort: if stty is missing or refuses, open the port as it is.
    const ready = fix ? execFileP("stty", fix) : Promise.resolve(undefined);
    void ready.finally(() => callback?.(chosen));
  });

  const allowed = new Set(["serial", "clipboard-sanitized-write"]);
  session.setPermissionCheckHandler(
    (wc, permission) => wc === contents && allowed.has(permission),
  );
  session.setDevicePermissionHandler(
    (details) => details.deviceType === "serial",
  );
}
