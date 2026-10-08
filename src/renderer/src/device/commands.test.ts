import { describe, expect, it } from "vitest";
import {
  describeProbeFailure,
  FieldError,
  infoFromKv,
  parseKv,
  parseProbe,
  parseScan,
  secretsOf,
  timeoutFor,
  validateCmd,
} from "./commands";

describe("validateCmd", () => {
  it.each([
    { op: "url", value: "ftp://x" },
    { op: "url", value: "http://" },
    { op: "url", value: `http://${"h".repeat(125)}` },
    { op: "url", value: "http://h\n" },
    { op: "token", value: "t".repeat(128) },
    { op: "wifi", ssid: "", pass: "" },
    { op: "wifi", ssid: "s".repeat(33), pass: "" },
    { op: "verify", ssid: "home", pass: "short" },
    { op: "verify", ssid: "home", pass: "p".repeat(65) },
    { op: "verify", ssid: "ho\0me", pass: "" },
  ] as const)("rejects %j", (cmd) => {
    expect(() => validateCmd(cmd)).toThrow(FieldError);
  });

  it.each([
    { op: "url", value: "http://192.168.4.20:8787" },
    { op: "token", value: "" },
    { op: "verify", ssid: "home", pass: "" },
    { op: "verify", ssid: "café", pass: "12345678" },
    { op: "status" },
  ] as const)("accepts %j", (cmd) => {
    expect(() => validateCmd(cmd)).not.toThrow();
  });

  it("counts bytes, not characters", () => {
    expect(() =>
      validateCmd({ op: "wifi", ssid: "é".repeat(17), pass: "" }),
    ).toThrow(FieldError);
  });
});

describe("parsers", () => {
  it("reads the status body", () => {
    const kv = parseKv(
      "name=ginger\nfw=1.2\nssid=none\nurl=http://h:8787\ntoken=set\n",
    );
    expect(infoFromKv(kv)).toEqual({
      name: "ginger",
      fw: "1.2",
      ssid: "",
      url: "http://h:8787",
      token: "set",
    });
  });

  it("reads a scan and sorts by signal", () => {
    expect(
      parseScan("state=ready\n-70\tfar\n-40\tnear\nbad line\n-50\t\n"),
    ).toEqual({
      state: "ready",
      aps: [
        { rssi: -40, ssid: "near" },
        { rssi: -70, ssid: "far" },
      ],
    });
  });

  it("reads a probe", () => {
    expect(parseProbe("state=fail\nssid=home\nreason=auth\n")).toEqual({
      state: "fail",
      ssid: "home",
      reason: "auth",
    });
    expect(describeProbeFailure("home", "auth")).toBe(
      "Could not join home. The password was rejected. Nothing was saved.",
    );
  });

  it("knows timeouts and secrets", () => {
    expect(timeoutFor({ op: "scan" })).toBe(30_000);
    expect(timeoutFor({ op: "url", value: "http://h" })).toBe(10_000);
    expect(secretsOf({ op: "verify", ssid: "home", pass: "hunter22" })).toEqual(
      ["hunter22"],
    );
    expect(secretsOf({ op: "token", value: "" })).toEqual([]);
  });
});
