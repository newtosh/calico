import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";

export function autostartPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "autostart", "calico.desktop");
}

// Desktop Entry spec, Exec key: these characters need the argument quoted.
const RESERVED = /[\s"'\\<>~|&;$*?#()`]/;

function execArg(arg: string): string {
  // % starts a field code, so a literal one is doubled even when unquoted.
  const text = arg.replace(/%/g, "%%");
  if (!RESERVED.test(arg)) return text;
  // Inside quotes " ` $ and \ take a backslash, and the file format then
  // doubles every backslash.
  const escaped = text.replace(/[\\"`$]/g, (c) =>
    c === "\\" ? "\\\\\\\\" : `\\\\${c}`,
  );
  return `"${escaped}"`;
}

export function desktopEntry(exec: string): string {
  const quoted = execArg(exec);
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Calico",
    "Comment=Desk panel companion",
    `Exec=${quoted} --hidden`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** Only installed builds have a stable executable path to start at login. */
export function autostartAvailable(): boolean {
  return process.platform === "linux" && app.isPackaged;
}

export function isAutostart(): boolean {
  return existsSync(autostartPath());
}

export function setAutostart(on: boolean): boolean {
  if (!autostartAvailable()) return false;
  const path = autostartPath();
  if (!on) {
    rmSync(path, { force: true });
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, desktopEntry(process.env.APPIMAGE ?? process.execPath));
  return true;
}
