import { ipcMain } from "electron";
import type { CalicoInfo } from "../shared/ipc";
import { autostartAvailable, isAutostart, setAutostart } from "./autostart";

export interface IpcDeps {
  info(): CalicoInfo;
  boundPort(): number | null;
  adoptPort(): void;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle("calico:info", () => deps.info());
  ipcMain.handle("calico:adopt-port", () => deps.adoptPort());
  ipcMain.handle("calico:set-autostart", (_e, on: unknown) =>
    autostartAvailable() ? setAutostart(on === true) : false,
  );
}

export function autostartState(): CalicoInfo["autostart"] {
  return { enabled: isAutostart(), available: autostartAvailable() };
}
