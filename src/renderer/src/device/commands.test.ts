import { describe, expect, it } from "vitest";
import desk from "../../../../firmware/main/ble_desk.h?raw";
import store from "../../../../firmware/main/wifi_store.h?raw";
import {
  describeProbeFailure,
  FieldError,
  infoFromKv,
  NETWORKS_MAX,
  PASS_MAX,
  parseKv,
  parseNets,
  parseProbe,
  parseScan,
  secretsOf,
  SSID_MAX,
  timeoutFor,
  TOKEN_MAX,
  URL_MAX,
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
    { op: "wifi", ssid: "home", pass: "", url: "ftp://x" },
    { op: "wifi", ssid: "home", pass: "", token: "t".repeat(128) },
    { op: "wifi", ssid: "home", pass: "placeholder-pass\n" },
    { op: "forget", ssid: "" },
    { op: "forget", ssid: "s".repeat(33) },
  ] as const)("rejects %j", (cmd) => {
    expect(() => validateCmd(cmd)).toThrow(FieldError);
  });

  it.each([
    { op: "url", value: "http://192.168.4.20:8787" },
    { op: "token", value: "" },
    { op: "verify", ssid: "home", pass: "" },
    { op: "verify", ssid: "café", pass: "12345678" },
    { op: "status" },
    { op: "wifi", ssid: "home", pass: "placeholder-pass", url: "", token: "" },
    { op: "wifi", ssid: "home", pass: "", url: "http://10.0.0.8:8787" },
    { op: "nets" },
    { op: "forget", ssid: "home" },
  ] as const)("accepts %j", (cmd) => {
    expect(() => validateCmd(cmd)).not.toThrow();
  });

  it("counts bytes, not characters", () => {
    expect(() =>
      validateCmd({ op: "wifi", ssid: "é".repeat(17), pass: "" }),
    ).toThrow(FieldError);
  });

  it("counts emoji SSIDs in bytes", () => {
    const signal = "\u{1F4F6}";
    expect(() =>
      validateCmd({ op: "forget", ssid: signal.repeat(8) }),
    ).not.toThrow();
    expect(() => validateCmd({ op: "forget", ssid: signal.repeat(9) })).toThrow(
      FieldError,
    );
  });

  it("never puts the refused value in the message", () => {
    try {
      validateCmd({
        op: "wifi",
        ssid: "home",
        pass: "placeholder-pass\n",
        token: "placeholder-token",
      });
    } catch (err) {
      expect((err as Error).message).not.toContain("placeholder");
      return;
    }
    throw new Error("expected a FieldError");
  });

  it("uses the firmware's limits", () => {
    expect(desk).toContain(`#define BLE_DESK_SSID_MAX ${SSID_MAX}`);
    expect(desk).toContain(`#define BLE_DESK_PASS_MAX ${PASS_MAX}`);
    expect(desk).toContain(`#define BLE_DESK_URL_MAX ${URL_MAX}`);
    expect(desk).toContain(`#define BLE_DESK_TOKEN_MAX ${TOKEN_MAX}`);
    expect(store).toContain(`#define WIFI_NET_MAX ${NETWORKS_MAX}`);
  });
});

describe("parsers", () => {
  it("reads the panel's networks", () => {
    expect(
      parseNets("count=3\n11\thome\n00\tcafe\tcorner\n10\tlab\r\nxx\tbad\n"),
    ).toEqual([
      { ssid: "home", has_url: true, has_token: true },
      { ssid: "cafe\tcorner", has_url: false, has_token: false },
      { ssid: "lab", has_url: true, has_token: false },
    ]);
    expect(parseNets("count=0\n")).toEqual([]);
  });

  it("keeps at most eight networks", () => {
    const rows = Array.from({ length: 10 }, (_, i) => `00\tn${i}`).join("\n");
    expect(parseNets(`count=10\n${rows}\n`)).toHaveLength(8);
  });

  it("treats the network token as a secret", () => {
    expect(
      secretsOf({
        op: "wifi",
        ssid: "home",
        pass: "placeholder-pass",
        token: "placeholder-token",
      }),
    ).toEqual(["placeholder-pass", "placeholder-token"]);
    expect(secretsOf({ op: "wifi", ssid: "open", pass: "" })).toEqual([]);
  });

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
