import { clipboard, Menu, nativeImage, Tray } from "electron";
import trayIcon from "../../resources/tray.png?asset";

export interface TrayActions {
  open(): void;
  quit(): void;
}

let tray: Tray | null = null;

export function createTray(actions: TrayActions): void {
  tray = new Tray(nativeImage.createFromPath(trayIcon));
  tray.setToolTip("Calico");
  tray.on("click", actions.open);
  updateTray(actions, null, null);
}

/** lanUrl is null while the server is down. drift names the port the panel expects. */
export function updateTray(
  actions: TrayActions,
  lanUrl: string | null,
  drift: number | null,
): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: "Open Calico", click: actions.open },
  ];
  if (lanUrl)
    items.push({
      label: `Copy ${lanUrl}`,
      click: () => clipboard.writeText(lanUrl),
    });
  if (drift !== null)
    items.push({ label: `Panel expects port ${drift}`, enabled: false });
  items.push({ type: "separator" }, { label: "Quit", click: actions.quit });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
