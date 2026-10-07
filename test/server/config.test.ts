import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BadInput,
  ConfigError,
  defaultConfig,
  loadConfig,
  mergeConfig,
  mergePanel,
  panelStatusField,
  publicView,
  saveConfig,
} from "../../src/server/config";

const file = () =>
  join(mkdtempSync(join(tmpdir(), "calico-config-")), "config.json");

describe("config file", () => {
  it("uses defaults when missing", () => {
    expect(loadConfig(file())).toEqual({
      config: defaultConfig(),
      existed: false,
    });
  });

  it("saves with mode 600 and loads back", () => {
    const path = file();
    const config = { ...defaultConfig(), port: 8790, webhook_token: "s" };
    saveConfig(path, config);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig(path)).toEqual({ config, existed: true });
  });

  it("refuses corrupt config and leaves the file", () => {
    const path = file();
    writeFileSync(path, "{oops");
    expect(() => loadConfig(path)).toThrow(ConfigError);
    expect(() => loadConfig(path)).toThrow(path);
    expect(readFileSync(path, "utf8")).toBe("{oops");
  });

  it("refuses an out-of-range port", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ port: 70000 }));
    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it("masks secrets in the public view", () => {
    expect(publicView({ ...defaultConfig(), webhook_token: "x" })).toEqual({
      port: 8787,
      cursor_poll_seconds: 30,
      webhook_token_set: true,
      cursor_api_key_set: false,
    });
  });
});

describe("mergeConfig", () => {
  it("keeps an omitted secret", () => {
    const current = { ...defaultConfig(), webhook_token: "keep" };
    expect(
      mergeConfig(current, { cursor_poll_seconds: 60 }).config.webhook_token,
    ).toBe("keep");
  });

  it.each([0, 70000, "abc", true, 1.5])("rejects port %s", (port) => {
    expect(() => mergeConfig(defaultConfig(), { port })).toThrow(BadInput);
  });

  it("flags a port change as needing a restart", () => {
    expect(mergeConfig(defaultConfig(), { port: "8790" })).toMatchObject({
      config: { port: 8790 },
      restart: true,
    });
    expect(
      mergeConfig(defaultConfig(), { cursor_poll_seconds: 10 }).restart,
    ).toBe(false);
  });
});

describe("mergePanel", () => {
  it("stores url and token and strips trailing slashes", () => {
    const merged = mergePanel(defaultConfig(), {
      url: "http://192.168.4.30:8787//",
      token: "desk-secret",
    });
    expect(panelStatusField(merged)).toEqual({
      url: "http://192.168.4.30:8787",
      token: "desk-secret",
    });
  });

  it("requires a url before a token", () => {
    expect(() => mergePanel(defaultConfig(), { token: "t" })).toThrow(BadInput);
  });

  it.each([
    { ssid: "home" },
    { password: "x", url: "http://h" },
    { url: "ftp://h" },
    { url: "http://" },
    { url: "http://user@h" },
    { url: "http://:80" },
    { url: "http://h", token: "has space" },
    { url: "http://h", token: 'has"quote' },
    { url: `http://${"h".repeat(130)}` },
  ])("rejects %j", (patch) => {
    expect(() => mergePanel(defaultConfig(), patch)).toThrow(BadInput);
  });

  it("clears both fields", () => {
    const set = mergePanel(defaultConfig(), { url: "http://h", token: "t" });
    expect(panelStatusField(mergePanel(set, { clear: true }))).toBeNull();
  });
});
