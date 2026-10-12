import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { clipboard, ipcMain } from "electron";
import type { CalicoInfo } from "../shared/ipc";
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
}

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
    if (text) clipboard.writeText(text);
    return text !== null;
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
