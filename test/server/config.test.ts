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
  mergeRelay,
  relayPublicView,
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

  it.each([12345, null, true, ["t"]])(
    "refuses a non-string webhook_token %j instead of turning auth off",
    (value) => {
      const path = file();
      const text = JSON.stringify({ webhook_token: value });
      writeFileSync(path, text);
      expect(() => loadConfig(path)).toThrow(ConfigError);
      expect(() => loadConfig(path)).toThrow("webhook_token");
      expect(readFileSync(path, "utf8")).toBe(text);
    },
  );

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

describe("running timeout", () => {
  it("defaults to the Python companion's 120 seconds", () => {
    expect(defaultConfig().running_timeout_seconds).toBe(120);
  });

  it("is read from the config file, and a missing key means the default", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ running_timeout_seconds: 600 }));
    expect(loadConfig(path).config.running_timeout_seconds).toBe(600);
    const other = file();
    writeFileSync(other, JSON.stringify({ port: 8787 }));
    expect(loadConfig(other).config.running_timeout_seconds).toBe(120);
  });

  it.each([29, 3601, "soon", null, 1.5])(
    "refuses %j in the file and names the key",
    (value) => {
      const path = file();
      writeFileSync(path, JSON.stringify({ running_timeout_seconds: value }));
      expect(() => loadConfig(path)).toThrow(ConfigError);
      expect(() => loadConfig(path)).toThrow("running_timeout_seconds");
    },
  );

  it("changes through a patch and is bounded there too", () => {
    const { config } = mergeConfig(defaultConfig(), {
      running_timeout_seconds: 600,
    });
    expect(config.running_timeout_seconds).toBe(600);
    expect(() =>
      mergeConfig(defaultConfig(), { running_timeout_seconds: 10 }),
    ).toThrow(BadInput);
  });

  it("stays out of the public view the panel contract covers, unless asked", () => {
    const config = { ...defaultConfig(), running_timeout_seconds: 600 };
    expect(publicView(config)).not.toHaveProperty("running_timeout_seconds");
    expect(publicView(config, true).running_timeout_seconds).toBe(600);
  });
});

describe("relay settings", () => {
  it("round-trips through the file", () => {
    const path = file();
    const config = {
      ...defaultConfig(),
      relay_url: "https://r.example/inbox",
      relay_token: "tok",
      relay_cursor: "41",
    };
    saveConfig(path, config);
    expect(loadConfig(path).config).toEqual(config);
  });

  it("defaults to no relay", () => {
    expect(relayPublicView(defaultConfig())).toEqual({
      url: "",
      token_set: false,
    });
  });

  it("stores the address without trailing slashes, and starts from the top", () => {
    const merged = mergeRelay(
      { ...defaultConfig(), relay_cursor: "9" },
      { url: "https://r.example/inbox//", token: "tok" },
    );
    expect(merged).toMatchObject({
      relay_url: "https://r.example/inbox",
      relay_token: "tok",
      relay_cursor: "",
    });
  });

  it("never shows the token", () => {
    const merged = mergeRelay(defaultConfig(), {
      url: "https://r.example/inbox",
      token: "tok",
    });
    expect(relayPublicView(merged)).toEqual({
      url: "https://r.example/inbox",
      token_set: true,
    });
  });

  it("accepts plain http only for this computer", () => {
    const set = (url: string) =>
      mergeRelay(defaultConfig(), { url, token: "t" }).relay_url;
    expect(set("http://127.0.0.1:2586/calico")).toBe(
      "http://127.0.0.1:2586/calico",
    );
    expect(set("http://localhost:2586/calico")).toBe(
      "http://localhost:2586/calico",
    );
    expect(() => set("http://ntfy.example/calico")).toThrow(BadInput);
  });

  it.each([
    { url: "ftp://h/t", token: "t" },
    { url: "https://", token: "t" },
    { url: "https://u:p@h/t", token: "t" },
    { url: "https://h/t", token: "" },
    { url: "https://h/t" },
    { token: "t" },
    { url: 5, token: "t" },
    { url: "https://h/t u", token: "t" },
    { url: "https://h/t#frag", token: "t" },
    { url: "https://h/t?x=1", token: "t" },
    { url: "https://h/t", token: "a b" },
  ])("rejects %j", (patch) => {
    expect(() => mergeRelay(defaultConfig(), patch)).toThrow(BadInput);
  });

  it("turns the relay off and forgets its token", () => {
    const on = mergeRelay(defaultConfig(), {
      url: "https://r.example/inbox",
      token: "tok",
    });
    expect(mergeRelay(on, { clear: true })).toMatchObject({
      relay_url: "",
      relay_token: "",
      relay_cursor: "",
    });
  });

  it("keeps the cursor when the same relay is saved again", () => {
    const on = {
      ...defaultConfig(),
      relay_url: "https://r.example/inbox",
      relay_token: "tok",
      relay_cursor: "41",
    };
    expect(
      mergeRelay(on, { url: "https://r.example/inbox", token: "tok" })
        .relay_cursor,
    ).toBe("41");
  });
});
