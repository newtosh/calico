import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/server/config";
import {
  fetchRelay,
  nextDelaySeconds,
  RelayState,
  pollRelayOnce,
  type RelayGet,
  type RelayReply,
  startRelayPoll,
} from "../../src/server/relay";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DeskStore } from "../../src/server/store";

const NOW = new Date("2026-10-10T12:00:00Z");
const relay = { url: "https://r.example/inbox", token: "read-tok", cursor: "" };

function line(id: string, body: unknown, time = 1760083200) {
  return JSON.stringify({
    id,
    time,
    event: "message",
    topic: "inbox",
    message: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function reply(lines: string[], extra: Partial<RelayReply> = {}): RelayReply {
  return {
    status: 200,
    headers: {},
    body: lines.map((l) => `${l}\n`).join(""),
    ...extra,
  };
}

function setup(answer: RelayReply | Error) {
  const store = new DeskStore({ now: () => NOW });
  const get = vi.fn<RelayGet>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { store, get };
}

describe("pollRelayOnce", () => {
  it("asks for everything the first time and sends the read token", async () => {
    const { store, get } = setup(reply([]));
    await pollRelayOnce(store, relay, get);
    expect(get).toHaveBeenCalledWith(
      "https://r.example/inbox/json?poll=1&since=all",
      "read-tok",
    );
  });

  it("resumes after the saved cursor", async () => {
    const { store, get } = setup(reply([]));
    await pollRelayOnce(store, { ...relay, cursor: "41" }, get);
    expect(get.mock.calls[0]?.[0]).toBe(
      "https://r.example/inbox/json?poll=1&since=41",
    );
  });

  it("applies each message with the time it was sent and moves the cursor", async () => {
    const { store, get } = setup(
      reply([
        line("7", { type: "agent.launched", agent_id: "a1", title: "Build" }),
        line("8", { type: "agent.needs_you", agent_id: "a1", message: "Ok?" }),
      ]),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({
      ok: true,
      applied: 2,
      refused: 0,
      cursor: "8",
    });
    expect(store.status().agents[0]).toMatchObject({
      id: "a1",
      attention: true,
      updated_at: "2025-10-10T08:00:00Z",
    });
  });

  it("does not show a long-gone launch as running", async () => {
    const { store, get } = setup(
      reply([line("1", { type: "agent.launched", agent_id: "a1" })]),
    );
    await pollRelayOnce(store, relay, get);
    expect(store.status().phase).toBe("idle");
  });

  it("counts a bad message as refused and still moves past it", async () => {
    const { store, get } = setup(
      reply([
        line("1", "not json"),
        line("2", { type: "mystery", agent_id: "a1" }),
        line("3", { type: "agent.launched", agent_id: "a1" }),
      ]),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({
      ok: true,
      applied: 1,
      refused: 2,
      cursor: "3",
    });
  });

  it("ignores ntfy's open and keepalive lines", async () => {
    const { store, get } = setup(
      reply([
        JSON.stringify({ id: "x", event: "open", topic: "inbox" }),
        JSON.stringify({ id: "y", event: "keepalive", topic: "inbox" }),
      ]),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({ ok: true, applied: 0, refused: 0, cursor: "" });
  });

  it("applies a repeated id once", async () => {
    const body = { type: "agent.needs_you", agent_id: "a1", message: "Q" };
    const { store, get } = setup(reply([line("5", body), line("5", body)]));
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({ applied: 1 });
  });

  it("names a rejected token", async () => {
    const { store, get } = setup(reply([], { status: 403 }));
    const out = await pollRelayOnce(store, { ...relay, cursor: "9" }, get);
    expect(out).toEqual({
      ok: false,
      error: "The relay rejected the read token (HTTP 403).",
    });
  });

  it("reports the wait the relay asks for when it is over its budget", async () => {
    const { store, get } = setup(
      reply([], { status: 429, headers: { "retry-after": "3600" } }),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({ ok: false, retryAfterSeconds: 3600 });
  });

  it("reports an unreachable relay without throwing", async () => {
    const { store, get } = setup(new Error("fetch failed"));
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toEqual({
      ok: false,
      error: "Could not reach the relay: fetch failed.",
    });
  });

  it("passes the daily usage through", async () => {
    const { store, get } = setup(
      reply([], {
        headers: { "x-relay-requests-today": "212", "x-relay-budget": "60000" },
      }),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({ ok: true, used: 212, budget: 60000 });
  });
});

describe("nextDelaySeconds", () => {
  const ok = { ok: true as const, applied: 0, refused: 0, cursor: "" };

  it("polls every 15 s while all is well", () => {
    expect(nextDelaySeconds(ok, 0)).toBe(15);
  });

  it("slows to 60 s once 80 percent of the daily budget is used", () => {
    expect(nextDelaySeconds({ ...ok, used: 47999, budget: 60000 }, 0)).toBe(15);
    expect(nextDelaySeconds({ ...ok, used: 48000, budget: 60000 }, 0)).toBe(60);
  });

  it("doubles after each failure, up to 5 minutes", () => {
    const bad = { ok: false as const, error: "x" };
    expect(nextDelaySeconds(bad, 1)).toBe(30);
    expect(nextDelaySeconds(bad, 2)).toBe(60);
    expect(nextDelaySeconds(bad, 9)).toBe(300);
  });

  it("obeys Retry-After, within one hour", () => {
    const wait = (s: number) => ({
      ok: false as const,
      error: "x",
      retryAfterSeconds: s,
    });
    expect(nextDelaySeconds(wait(1), 1)).toBe(15);
    expect(nextDelaySeconds(wait(1800), 1)).toBe(1800);
    expect(nextDelaySeconds(wait(99999), 1)).toBe(3600);
  });
});

describe("startRelayPoll", () => {
  const configured = {
    ...defaultConfig(),
    relay_url: "https://r.example/inbox",
    relay_token: "tok",
  };

  it("saves the cursor and reads again after the delay", async () => {
    vi.useFakeTimers();
    try {
      const store = new DeskStore({ now: () => NOW });
      const get = vi.fn<RelayGet>(async () =>
        reply([line("4", { type: "agent.launched", agent_id: "a1" })]),
      );
      const saved: string[] = [];
      let config = configured;
      const stop = startRelayPoll(
        store,
        () => config,
        (cursor) => {
          saved.push(cursor);
          config = { ...config, relay_cursor: cursor };
        },
        undefined,
        get,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(saved).toEqual(["4"]);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(get).toHaveBeenCalledTimes(2);
      expect(get.mock.calls[1]?.[0]).toContain("since=4");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without a relay, and picks one up when it is set", async () => {
    vi.useFakeTimers();
    try {
      const store = new DeskStore({ now: () => NOW });
      const get = vi.fn<RelayGet>(async () => reply([]));
      let config = defaultConfig();
      const stop = startRelayPoll(
        store,
        () => config,
        () => undefined,
        undefined,
        get,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(get).not.toHaveBeenCalled();
      config = configured;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(get).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when asked", async () => {
    vi.useFakeTimers();
    try {
      const store = new DeskStore({ now: () => NOW });
      const get = vi.fn<RelayGet>(async () => reply([]));
      const stop = startRelayPoll(
        store,
        () => configured,
        () => undefined,
        undefined,
        get,
      );
      await vi.advanceTimersByTimeAsync(0);
      stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a message that cannot be applied", () => {
  it("is refused when its time is out of range, not thrown", async () => {
    const { store, get } = setup(
      reply([
        line("1", { type: "agent.launched", agent_id: "a1" }, 1e20),
        line("2", { type: "agent.launched", agent_id: "a2" }),
      ]),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({
      ok: true,
      applied: 1,
      refused: 1,
      cursor: "2",
    });
  });

  it("is refused when the store throws", async () => {
    const { store, get } = setup(
      reply([line("1", { type: "agent.launched", agent_id: "a1" })]),
    );
    vi.spyOn(store, "applyReplayed").mockImplementation(() => {
      throw new Error("disk full");
    });
    const out = await pollRelayOnce(store, relay, get, () => undefined);
    expect(out).toMatchObject({
      ok: true,
      applied: 0,
      refused: 1,
      cursor: "1",
    });
  });

  it("is refused when it has no id, since the cursor could not pass it", async () => {
    const row = JSON.stringify({
      time: 1760083200,
      event: "message",
      message: JSON.stringify({ type: "agent.launched", agent_id: "a1" }),
    });
    const { store, get } = setup(reply([row]));
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({ ok: true, applied: 0, refused: 1 });
  });

  it("does not count a replay the store dropped as applied", async () => {
    const { store, get } = setup(
      reply([
        line("1", { type: "agent.finished", agent_id: "a1" }, 1760083200),
        line("2", { type: "agent.launched", agent_id: "a1" }, 1760083100),
      ]),
    );
    const out = await pollRelayOnce(store, relay, get);
    expect(out).toMatchObject({
      ok: true,
      applied: 1,
      refused: 0,
      cursor: "2",
    });
  });
});

describe("startRelayPoll when things go wrong", () => {
  const configured = {
    ...defaultConfig(),
    relay_url: "https://r.example/inbox",
    relay_token: "tok",
  };

  it("keeps polling after the cursor cannot be saved", async () => {
    vi.useFakeTimers();
    try {
      const store = new DeskStore({ now: () => NOW });
      const get = vi.fn<RelayGet>(async () =>
        reply([line("4", { type: "agent.launched", agent_id: "a1" })]),
      );
      const stop = startRelayPoll(
        store,
        () => configured,
        () => {
          throw new Error("read-only disk");
        },
        undefined,
        get,
        () => undefined,
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(get.mock.calls.length).toBeGreaterThan(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not write one relay's cursor onto another", async () => {
    vi.useFakeTimers();
    try {
      const store = new DeskStore({ now: () => NOW });
      let release: (r: RelayReply) => void = () => undefined;
      const get = vi.fn<RelayGet>(
        () => new Promise<RelayReply>((resolve) => (release = resolve)),
      );
      let config = configured;
      const saved: string[] = [];
      const stop = startRelayPoll(
        store,
        () => config,
        (c) => saved.push(c),
        undefined,
        get,
      );
      await vi.advanceTimersByTimeAsync(0);
      config = { ...configured, relay_url: "https://other.example/inbox" };
      release(reply([line("99", { type: "agent.launched", agent_id: "a1" })]));
      await vi.advanceTimersByTimeAsync(0);
      expect(saved).toEqual([]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls a newly connected relay within seconds, even after a long wait", async () => {
    vi.useFakeTimers();
    try {
      const store = new DeskStore({ now: () => NOW });
      const get = vi.fn<RelayGet>(async () =>
        reply([], { status: 429, headers: { "retry-after": "3600" } }),
      );
      const state = new RelayState();
      let config = configured;
      const stop = startRelayPoll(
        store,
        () => config,
        () => undefined,
        state,
        get,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(get).toHaveBeenCalledTimes(1);
      config = { ...configured, relay_token: "new-token" };
      get.mockImplementation(async () => reply([]));
      await vi.advanceTimersByTimeAsync(6_000);
      expect(get).toHaveBeenCalledTimes(2);
      expect(state.snapshot(true).ok).toBe(true);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fetchRelay", () => {
  it("does not follow a redirect", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/inbox/json")
        res.writeHead(302, { Location: "/elsewhere" }).end();
      else res.writeHead(200).end("followed");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        fetchRelay(`http://127.0.0.1:${port}/inbox/json`, "t"),
      ).rejects.toThrow();
      expect(hits).toEqual(["/inbox/json"]);
    } finally {
      server.close();
    }
  });
});
