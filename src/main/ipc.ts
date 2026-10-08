import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { ipcMain } from "electron";
import type { CalicoInfo } from "../shared/ipc";
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
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle("calico:info", () => deps.info());
  ipcMain.handle("calico:adopt-port", () => deps.adoptPort());
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
