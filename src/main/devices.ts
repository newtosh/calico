import { type BrowserWindow, ipcMain } from "electron";
import type { Candidate } from "../shared/ipc";

/** Electron has no device picker UI. Forward candidates to the renderer and wait for its choice. */
export function wireDevicePickers(win: BrowserWindow): void {
  const contents = win.webContents;
  const session = contents.session;
  let bleCallback: ((id: string) => void) | null = null;
  let serialCallback: ((id: string) => void) | null = null;

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
    const list: Candidate[] = ports.map((p) => ({
      id: p.portId,
      name: p.displayName || p.portName,
    }));
    contents.send("device:serial-candidates", list);
  });
  ipcMain.on("device:serial-choose", (_event, id: unknown) => {
    serialCallback?.(typeof id === "string" ? id : "");
    serialCallback = null;
  });

  const allowed = new Set(["serial", "clipboard-sanitized-write"]);
  session.setPermissionCheckHandler(
    (wc, permission) => wc === contents && allowed.has(permission),
  );
  session.setDevicePermissionHandler(
    (details) => details.deviceType === "serial",
  );
}
