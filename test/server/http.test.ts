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

describe("running timeout over HTTP", () => {
  it("is shown on detail only, so the panel contract is unchanged", async () => {
    const { base } = await start({ running_timeout_seconds: 600 });
    const plain = (await (await fetch(`${base}/api/config`)).json()) as Record<
      string,
      unknown
    >;
    const detail = (await (
      await fetch(`${base}/api/config?detail=1`)
    ).json()) as Record<string, unknown>;
    expect(plain).not.toHaveProperty("running_timeout_seconds");
    expect(detail.running_timeout_seconds).toBe(600);
  });

  it("is changed with PUT /api/config and refuses nonsense", async () => {
    const { base } = await start();
    const put = (body: unknown) =>
      fetch(`${base}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await put({ running_timeout_seconds: 900 })).status).toBe(200);
    const detail = (await (
      await fetch(`${base}/api/config?detail=1`)
    ).json()) as Record<string, unknown>;
    expect(detail.running_timeout_seconds).toBe(900);
    expect((await put({ running_timeout_seconds: 5 })).status).toBe(400);
  });
});

describe("webhook activity", () => {
  const post = (
    base: string,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}/api/webhook/grok-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });

  it("starts with nothing received and nothing refused", async () => {
    const { stats } = await start();
    expect(stats.webhook.accepted).toBeNull();
    expect(stats.webhook.refused).toEqual({ count: 0, last: null });
  });

  it("remembers when and from where the last event was accepted", async () => {
    const { base, stats } = await start();
    const before = Date.now();
    expect(
      (await post(base, '{"type":"agent.launched","agent_id":"a1"}')).status,
    ).toBe(201);
    expect(stats.webhook.accepted?.from).toBe("127.0.0.1");
    expect(stats.webhook.accepted?.at).toBeGreaterThanOrEqual(before);
    expect(stats.webhook.refused.count).toBe(0);
  });

  it("counts a wrong or missing token as unauthorized", async () => {
    const { base, stats } = await start({ webhook_token: "s3cret" });
    expect((await post(base, "{}")).status).toBe(401);
    expect(
      (await post(base, "{}", { Authorization: "Bearer nope" })).status,
    ).toBe(401);
    expect(stats.webhook.refused.count).toBe(2);
    expect(stats.webhook.refused.last).toMatchObject({
      reason: "unauthorized",
      from: "127.0.0.1",
    });
    expect(stats.webhook.accepted).toBeNull();
  });

  it("counts a bad body, a bad event, and an oversized body", async () => {
    const { base, stats } = await start();
    expect((await post(base, "not json")).status).toBe(400);
    expect(stats.webhook.refused.last?.reason).toBe("bad_json");
    expect((await post(base, '{"type":"nope","agent_id":"a1"}')).status).toBe(
      400,
    );
    expect(stats.webhook.refused.last?.reason).toBe("bad_event");
    expect((await post(base, "x".repeat(1024 * 1024 + 10))).status).toBe(413);
    expect(stats.webhook.refused.last?.reason).toBe("too_large");
    expect(stats.webhook.refused.count).toBe(3);
  });

  it("counts a request that carries a browser origin", async () => {
    const { base, stats } = await start();
    expect(
      await withOrigin(`${base}/api/status`, "GET", "https://evil.example"),
    ).toBe(403);
    expect(stats.webhook.refused.count).toBe(1);
    expect(stats.webhook.refused.last?.reason).toBe("forbidden_origin");
  });

  it("does not count ordinary reads or a missing path", async () => {
    const { base, stats } = await start();
    await fetch(`${base}/api/status`);
    await fetch(`${base}/api/config`);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect(stats.webhook.refused.count).toBe(0);
  });

  it("does not count a bad frame upload, which is not a refused update", async () => {
    const { base, stats } = await start();
    const frame = (type: string, body: string) =>
      fetch(`${base}/api/frame`, {
        method: "POST",
        headers: { "Content-Type": type },
        body,
      });
    expect((await frame("text/plain", "x")).status).toBe(415);
    expect((await frame("image/bmp", "not a bitmap")).status).toBe(400);
    expect(stats.webhook.refused.count).toBe(0);
  });

  it("keeps request bodies and tokens out of what it remembers", async () => {
    const { base, stats } = await start({ webhook_token: "s3cret" });
    await post(base, '{"secret":"hunter2"}', { Authorization: "Bearer guess" });
    const kept = JSON.stringify(stats.webhook);
    expect(kept).not.toContain("hunter2");
    expect(kept).not.toContain("guess");
    expect(kept).not.toContain("s3cret");
  });
});
