import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { clipboard, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { CalicoInfo } from "../shared/ipc";
import type { FirmwareWatch } from "./firmware-state";
import type { NetworkVault } from "./networks";
import type { RelaySetupService } from "./relay/service";
import {
  deniedSerialPorts,
  detectFirewall,
  displayCommand,
  execFileP,
  firewallFix,
  portHolders,
  serialFix,
  serialGroup,
  validPort,
} from "./assist";
import { autostartAvailable, isAutostart, setAutostart } from "./autostart";

const osRelease = () => {
  try {
    return readFileSync("/etc/os-release", "utf8");
  } catch {
    return "";
  }
};

export interface IpcDeps {
  info(): CalicoInfo;
  boundPort(): number | null;
  adoptPort(): void;
  relaySetup: RelaySetupService;
  /** The text for the bot, or null when calico did not make this relay. */
  botNote(): string | null;
  networks: Pick<
    NetworkVault,
    "list" | "save" | "remove" | "confirmPush" | "release" | "endPush"
  >;
  /** "Not now" on the address banner. */
  dismissAddress(): void;
  firmware: Pick<
    FirmwareWatch,
    "checkNow" | "setCheck" | "dismiss" | "panelSeen"
  >;
  /** A native dialog the window cannot draw or click: true only when the person sends them. */
  askPush(ssids: string[]): Promise<boolean>;
  /** The app window's webContents, null while it does not exist. */
  appContents(): { mainFrame: unknown } | null;
}

/** True only for the top frame of the app's own window: no other window or iframe. */
export function fromAppWindow(
  event: { sender: unknown; senderFrame: unknown },
  contents: { mainFrame: unknown } | null,
): boolean {
  return (
    contents !== null &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame
  );
}

const NOT_APP_WINDOW = "Only the Calico window can push networks.";
const PUSH_DECLINED = "The push was cancelled.";

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle("calico:info", () => deps.info());
  ipcMain.handle("calico:adopt-port", () => deps.adoptPort());
  ipcMain.handle("relay:setup-view", () => deps.relaySetup.view());
  // Not awaited: the window follows progress through "relay:setup-changed".
  ipcMain.handle("relay:setup-start", () => void deps.relaySetup.start());
  ipcMain.handle("relay:setup-cancel", () => deps.relaySetup.cancel());
  ipcMain.handle("relay:setup-dismiss", () => deps.relaySetup.dismiss());
  ipcMain.handle("relay:copy-bot", () => {
    const text = deps.botNote();
    if (!text) return false;
    clipboard.writeText(text);
    // The send token should not sit on the clipboard for good.
    setTimeout(() => {
      void (async () => {
        if ((await clipboard.readText()) === text) clipboard.clear();
      })();
    }, 60_000).unref();
    return true;
  });
  // The window sends secrets here and gets back flags only (password_set, token_set).
  ipcMain.handle("networks:list", () => deps.networks.list());
  ipcMain.handle("networks:save", (_e, input: unknown) =>
    deps.networks.save(input),
  );
  ipcMain.handle("networks:remove", (_e, ssid: unknown) =>
    deps.networks.remove(ssid),
  );
  // The one path a saved password takes to the window: once, for an SSID in the plan the person
  // confirmed (NetworkVault.release). An invoke reply, never an event, never logged or kept here.
  const push = <T>(event: IpcMainInvokeEvent, run: () => T) =>
    fromAppWindow(event, deps.appContents())
      ? run()
      : { ok: false as const, error: NOT_APP_WINDOW };
  // A native dialog backs the window's own confirmation, so a compromised page cannot confirm
  // its own plan. An empty plan releases no password and needs no dialog.
  ipcMain.handle("networks:confirm-push", async (e, ssids: unknown) => {
    if (!fromAppWindow(e, deps.appContents()))
      return { ok: false as const, error: NOT_APP_WINDOW };
    const names = Array.isArray(ssids)
      ? ssids.filter((s): s is string => typeof s === "string")
      : [];
    if (names.length > 0 && !(await deps.askPush(names)))
      return { ok: false as const, error: PUSH_DECLINED };
    return deps.networks.confirmPush(ssids);
  });
  ipcMain.handle("networks:release", (e, ssid: unknown) =>
    push(e, () => deps.networks.release(ssid)),
  );
  ipcMain.handle("networks:end-push", (e) =>
    push(e, () => deps.networks.endPush()),
  );
  ipcMain.handle("calico:dismiss-address", () => deps.dismissAddress());
  ipcMain.handle("firmware:check-now", async () => {
    await deps.firmware.checkNow();
  });
  ipcMain.handle("firmware:set-check", (_e, on: unknown) => {
    if (on === true || on === false) deps.firmware.setCheck(on);
  });
  ipcMain.handle("firmware:dismiss", (_e, version: unknown) => {
    if (typeof version === "string") deps.firmware.dismiss(version);
  });
  ipcMain.handle("firmware:panel-seen", (_e, fw: unknown) => {
    if (typeof fw === "string" && fw.length <= 32) deps.firmware.panelSeen(fw);
  });
  ipcMain.handle("calico:set-autostart", (_e, on: unknown) =>
    autostartAvailable() ? setAutostart(on === true) : false,
  );

  ipcMain.handle("calico:firewall", async () => {
    const kind = await detectFirewall(execFileP);
    const port = deps.boundPort();
    const argv = port ? firewallFix(kind, port) : null;
    return {
      kind,
      command: argv
        ? displayCommand(argv[0] === "sh" ? argv : ["sudo", ...argv])
        : null,
    };
  });

  ipcMain.handle("calico:serial-access", () => {
    const group = serialGroup(osRelease());
    return {
      denied: deniedSerialPorts(),
      group,
      command: displayCommand([
        "sudo",
        ...serialFix(group, userInfo().username),
      ]),
    };
  });

  ipcMain.handle("calico:run-fix", async (_e, fix: unknown) => {
    let argv: string[] | null = null;
    if (fix === "firewall") {
      const port = deps.boundPort();
      argv = port ? firewallFix(await detectFirewall(execFileP), port) : null;
    } else if (fix === "serial") {
      argv = serialFix(serialGroup(osRelease()), userInfo().username);
    }
    if (!argv) return { ok: false, output: "Nothing to run for this setup." };
    const { code, stdout } = await execFileP("pkexec", argv);
    return {
      ok: code === 0,
      output:
        stdout.trim() || (code === 0 ? "Done." : `pkexec exited with ${code}.`),
    };
  });

  ipcMain.handle("calico:port-holders", (_e, port: unknown) =>
    validPort(port) ? portHolders(port, execFileP) : [],
  );
}

export function autostartState(): CalicoInfo["autostart"] {
  return { enabled: isAutostart(), available: autostartAvailable() };
}
