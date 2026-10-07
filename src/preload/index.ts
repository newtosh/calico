import { contextBridge } from "electron";
import type { CalicoApi } from "../shared/ipc";

const api: CalicoApi = {};
contextBridge.exposeInMainWorld("calico", api);
