import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, type CalicoConfig } from "../../src/server/config";
import {
  asciiJson,
  createCompanionServer,
  isLoopback,
} from "../../src/server/http";
import { DeskStore } from "../../src/server/store";

let close: (() => void) | null = null;
afterEach(() => close?.());

async function start(config: Partial<CalicoConfig> = {}) {
  let current: CalicoConfig = { ...defaultConfig(), ...config };
  const store = new DeskStore();
  const { server, stats } = createCompanionServer({
    store,
    getConfig: () => current,
    setConfig: (next) => {
      current = next;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  close = () => server.close();
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    store,
    stats,
  };
}

describe("companion server", () => {
  it("escapes non-ASCII like Python", async () => {
    const { base } = await start();
    await fetch(`${base}/api/webhook/grok-bot`, {
      method: "POST",
      body: JSON.stringify({
        type: "agent.launched",
        agent_id: "c3",
        title: "Café ✓ 🙂",
      }),
    });
    const raw = Buffer.from(
      await (await fetch(`${base}/api/status`)).arrayBuffer(),
    );
    expect(raw.every((byte) => byte < 0x80)).toBe(true);
    const text = raw.toString("ascii");
    expect(text).toContain("Caf\\u00e9 \\u2713 \\ud83d\\ude42");
  });

  it("keeps panel first and capture before agents", async () => {
    const { base, store } = await start({
      panel_url: "http://192.168.4.30:8787",
      panel_token: "t",
    });
    for (let i = 0; i < 60; i++)
      store.applyEvent({
        type: "agent.launched",
        agent_id: `a${i}`,
        message: "x".repeat(100),
      });
    store.requestFrame();
    const text = await (await fetch(`${base}/api/status`)).text();
    expect(text.startsWith('{"panel":')).toBe(true);
    expect(text.indexOf('"capture"')).toBeLessThan(text.indexOf('"agents"'));
    expect(text.indexOf('"capture"')).toBeLessThan(200);
  });

  it("does not count loopback polls as the panel", async () => {
    const { base, stats } = await start();
    await fetch(`${base}/api/status`);
    expect(stats.lastPanelPoll).toBeNull();
  });

  it("rejects an oversized JSON body with 413", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/webhook/grok-bot`, {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  it("classifies loopback addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("192.168.4.30")).toBe(false);
    expect(isLoopback("::ffff:192.168.4.30")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it("asciiJson leaves ASCII alone", () => {
    expect(asciiJson({ a: "plain", b: 1 })).toBe('{"a":"plain","b":1}');
  });
});
