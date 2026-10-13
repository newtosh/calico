import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { CalicoApi, Candidate, RelaySetupView } from "../shared/ipc";

function subscribe(
  channel: string,
  cb: (list: Candidate[]) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, list: Candidate[]) => cb(list);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: CalicoApi = {
  info: () => ipcRenderer.invoke("calico:info"),
  onBleCandidates: (cb) => subscribe("device:ble-candidates", cb),
  chooseBle: (id) => ipcRenderer.send("device:ble-choose", id),
  onSerialCandidates: (cb) => subscribe("device:serial-candidates", cb),
  chooseSerial: (id) => ipcRenderer.send("device:serial-choose", id),
  firewall: () => ipcRenderer.invoke("calico:firewall"),
  serialAccess: () => ipcRenderer.invoke("calico:serial-access"),
  runFix: (fix) => ipcRenderer.invoke("calico:run-fix", fix),
  portHolders: (port) => ipcRenderer.invoke("calico:port-holders", port),
  adoptPort: () => ipcRenderer.invoke("calico:adopt-port"),
  setAutostart: (on) => ipcRenderer.invoke("calico:set-autostart", on),
  relaySetupView: () => ipcRenderer.invoke("relay:setup-view"),
  relaySetupStart: () => ipcRenderer.invoke("relay:setup-start"),
  relaySetupCancel: () => ipcRenderer.invoke("relay:setup-cancel"),
  relaySetupDismiss: () => ipcRenderer.invoke("relay:setup-dismiss"),
  onRelaySetup: (cb) => {
    const handler = (_event: IpcRendererEvent, view: RelaySetupView) =>
      cb(view);
    ipcRenderer.on("relay:setup-changed", handler);
    return () => ipcRenderer.off("relay:setup-changed", handler);
  },
  relayCopyForBot: () => ipcRenderer.invoke("relay:copy-bot"),
  networksList: () => ipcRenderer.invoke("networks:list"),
  networksSave: (input) => ipcRenderer.invoke("networks:save", input),
  networksRemove: (ssid) => ipcRenderer.invoke("networks:remove", ssid),
};

contextBridge.exposeInMainWorld("calico", api);
