import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, type CalicoConfig } from "../../src/server/config";
import {
  asciiJson,
  createCompanionServer,
  isLoopback,
} from "../../src/server/http";
import type { CursorStatus } from "../../src/server/cursor-poll";
import { DeskStore } from "../../src/server/store";

let close: (() => void) | null = null;
afterEach(() => close?.());

async function start(
  config: Partial<CalicoConfig> = {},
  allowedOrigins: string[] = [],
  cursorStatus?: () => CursorStatus,
) {
  let current: CalicoConfig = { ...defaultConfig(), ...config };
  const store = new DeskStore();
  const { server, stats } = createCompanionServer({
    store,
    allowedOrigins,
    ...(cursorStatus ? { cursorStatus } : {}),
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

// fetch() treats Origin as a forbidden header, so send it with node:http.
function withOrigin(
  url: string,
  method: string,
  origin: string,
  body = "",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("browser origins", () => {
  it("refuses any request a web page makes, including preflights", async () => {
    const { base } = await start();
    for (const origin of ["https://evil.example", "null"]) {
      expect(await withOrigin(`${base}/api/status`, "GET", origin)).toBe(403);
      expect(await withOrigin(`${base}/api/panel`, "OPTIONS", origin)).toBe(
        403,
      );
      expect(
        await withOrigin(
          `${base}/api/panel`,
          "PUT",
          origin,
          JSON.stringify({ url: "http://attacker:1" }),
        ),
      ).toBe(403);
    }
    const panel = (await (await fetch(`${base}/api/panel`)).json()) as {
      url: string;
    };
    expect(panel.url).toBe("");
  });

  it("serves the dev renderer's own origin", async () => {
    const { base } = await start({}, ["http://localhost:5173"]);
    expect(
      await withOrigin(`${base}/api/status`, "GET", "http://localhost:5173"),
    ).toBe(200);
  });
});

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

describe("GET /api/cursor", () => {
  it("serves the poll status the app supplies", async () => {
    const status = {
      configured: true,
      last_poll_at: "2026-10-07T12:00:00Z",
      ok: true,
      agents: 2,
      error: "",
    };
    const { base } = await start({}, [], () => status);
    const res = await fetch(`${base}/api/cursor`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
  });

  it("answers with an empty status when no poller is wired", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/api/cursor`)).json()).toEqual({
      configured: false,
      last_poll_at: null,
      ok: null,
      agents: 0,
      error: "",
    });
  });
});

describe("GET /api/status?detail=1", () => {
  it("adds each agent's source for the app, and only then", async () => {
    const { base, store } = await start();
    store.applyEvent({
      type: "agent.launched",
      agent_id: "g1",
      title: "Desky",
    });
    const plain = (await (await fetch(`${base}/api/status`)).json()) as {
      agents: Record<string, unknown>[];
    };
    const detail = (await (
      await fetch(`${base}/api/status?detail=1`)
    ).json()) as {
      agents: Record<string, unknown>[];
    };
    expect(plain.agents[0]).not.toHaveProperty("source");
    expect(detail.agents[0]?.source).toBe("grok-bot");
  });
});
