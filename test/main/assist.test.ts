import { describe, expect, it } from "vitest";
import {
  detectFirewall,
  displayCommand,
  type Exec,
  firewallFix,
  parseSsHolders,
  serialFix,
  serialGroup,
  serialReadFix,
  validPort,
} from "../../src/main/assist";

const fakeExec =
  (active: string[]): Exec =>
  async (_file, args) => ({
    code: active.includes(args[1] ?? "") ? 0 : 3,
    stdout: active.includes(args[1] ?? "") ? "active\n" : "inactive\n",
  });

describe("firewall assist", () => {
  it("detects the active firewall", async () => {
    expect(await detectFirewall(fakeExec(["ufw"]))).toBe("ufw");
    expect(await detectFirewall(fakeExec(["firewalld"]))).toBe("firewalld");
    expect(await detectFirewall(fakeExec(["nftables"]))).toBe("nftables");
    expect(await detectFirewall(fakeExec([]))).toBe("none");
  });

  it("builds fixes only from a valid port", () => {
    expect(firewallFix("ufw", 8787)).toEqual([
      "ufw",
      "allow",
      "8787/tcp",
      "comment",
      "calico",
    ]);
    expect(firewallFix("firewalld", 8788)).toEqual([
      "sh",
      "-c",
      "firewall-cmd --permanent --add-port=8788/tcp && firewall-cmd --reload",
    ]);
    expect(firewallFix("nftables", 8787)).toBeNull();
    expect(firewallFix("ufw", 0)).toBeNull();
    expect(firewallFix("ufw", 8787.5)).toBeNull();
  });

  it("displays commands for copying", () => {
    expect(
      displayCommand(["sudo", "ufw", "allow", "8787/tcp", "comment", "calico"]),
    ).toBe("sudo ufw allow 8787/tcp comment calico");
    expect(displayCommand(["sh", "-c", "a && b"])).toBe("sudo sh -c 'a && b'");
  });
});

describe("serial assist", () => {
  it("picks the distro's group", () => {
    expect(
      serialGroup('NAME="CachyOS Linux"\nID=cachyos\nID_LIKE=arch\n'),
    ).toBe("uucp");
    expect(serialGroup("ID=arch\n")).toBe("uucp");
    expect(serialGroup('ID=ubuntu\nID_LIKE="debian"\n')).toBe("dialout");
    expect(serialGroup("")).toBe("dialout");
    expect(serialFix("uucp", "jonn")).toEqual([
      "usermod",
      "-aG",
      "uucp",
      "jonn",
    ]);
  });
});

describe("port holders", () => {
  it("parses ss output", () => {
    const out =
      'LISTEN 0 511 0.0.0.0:8787 0.0.0.0:* users:(("python3",pid=4242,fd=3))\n';
    expect(parseSsHolders(out)).toEqual(["python3 (pid 4242)"]);
    expect(parseSsHolders("")).toEqual([]);
  });

  it("validates ports from IPC", () => {
    expect(validPort(8787)).toBe(true);
    expect(validPort("8787")).toBe(false);
    expect(validPort(70000)).toBe(false);
  });
});

describe("serial read fix", () => {
  it("resets VMIN and VTIME so Chromium's first read waits instead of seeing EOF", () => {
    expect(serialReadFix("ttyACM0")).toEqual([
      "-F",
      "/dev/ttyACM0",
      "min",
      "1",
      "time",
      "0",
    ]);
    expect(serialReadFix("ttyUSB12")?.[1]).toBe("/dev/ttyUSB12");
  });

  it("refuses anything that is not a USB serial node", () => {
    for (const name of [
      "",
      "ttyS0",
      "../etc/passwd",
      "ttyACM0; rm -rf",
      "ttyACM",
      "null",
    ])
      expect(serialReadFix(name)).toBeNull();
  });
});
