import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FirewallKind } from "../shared/ipc";

export type Exec = (
  file: string,
  args: string[],
  timeoutMs?: number,
) => Promise<{ code: number; stdout: string }>;

export const execFileP: Exec = (file, args, timeoutMs = 120_000) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stdout: `${stdout}${stderr}` });
    });
  });

export function validPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

export async function detectFirewall(exec: Exec): Promise<FirewallKind> {
  for (const kind of ["ufw", "firewalld", "nftables"] as const) {
    const { stdout } = await exec("systemctl", ["is-active", kind]);
    if (stdout.trim() === "active") return kind;
  }
  return "none";
}

export function firewallFix(kind: FirewallKind, port: number): string[] | null {
  if (!validPort(port)) return null;
  if (kind === "ufw")
    return ["ufw", "allow", `${port}/tcp`, "comment", "calico"];
  if (kind === "firewalld") {
    return [
      "sh",
      "-c",
      `firewall-cmd --permanent --add-port=${port}/tcp && firewall-cmd --reload`,
    ];
  }
  return null;
}

export function displayCommand(argv: string[]): string {
  if (argv[0] === "sh" && argv[1] === "-c")
    return `sudo sh -c '${argv[2] ?? ""}'`;
  return argv.join(" ");
}

export function serialGroup(osRelease: string): "uucp" | "dialout" {
  const ids = [...osRelease.matchAll(/^(?:ID|ID_LIKE)=(.*)$/gm)].flatMap((m) =>
    (m[1] ?? "").replace(/"/g, "").split(/\s+/),
  );
  return ids.includes("arch") ? "uucp" : "dialout";
}

export function serialFix(group: string, user: string): string[] {
  return ["usermod", "-aG", group, user];
}

/**
 * A cdc_acm tty keeps its termios across closes, and esptool, idf.py and
 * pyserial leave it at VMIN=0 VTIME=0. Chromium reads right after opening and
 * treats the resulting zero-byte read as a disconnect ("The device has been
 * lost"). Returns the stty arguments that put the port back to waiting reads,
 * or null for anything that is not a USB serial node.
 */
export function serialReadFix(portName: string): string[] | null {
  if (!/^tty(ACM|USB)\d+$/.test(portName)) return null;
  return ["-F", `/dev/${portName}`, "min", "1", "time", "0"];
}

/** Best effort: never rejects, so the picker callback always fires. */
export async function prepareSerial(
  portName: string,
  exec: Exec = execFileP,
): Promise<void> {
  const args = serialReadFix(portName);
  if (!args) return;
  try {
    await exec("stty", args, 2000);
  } catch {
    // Open the port as it is.
  }
}

export function deniedSerialPorts(devDir = "/dev"): string[] {
  let names: string[];
  try {
    names = readdirSync(devDir).filter((n) => /^tty(ACM|USB)\d+$/.test(n));
  } catch {
    return [];
  }
  return names
    .map((n) => join(devDir, n))
    .filter((path) => {
      try {
        accessSync(path, constants.R_OK | constants.W_OK);
        return false;
      } catch {
        return true;
      }
    });
}

export function parseSsHolders(stdout: string): string[] {
  return [...stdout.matchAll(/\("([^"]+)",pid=(\d+)/g)].map(
    (m) => `${m[1]} (pid ${m[2]})`,
  );
}

export async function portHolders(port: number, exec: Exec): Promise<string[]> {
  if (!validPort(port)) return [];
  const { stdout } = await exec("ss", ["-ltnpH", `sport = :${port}`]);
  return parseSsHolders(stdout);
}
