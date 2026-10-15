import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BadInput,
  defaultConfig,
  loadConfig,
  notifyHeader,
  notifyUrl,
  panelPublicView,
  publicView,
  relayPublicView,
  saveConfig,
  type CalicoConfig,
} from "../../src/server/config";
import { createCompanionServer } from "../../src/server/http";
import {
  KEYRING_CHANGED,
  NO_KEYRING,
  NOTIFY_BACKOFF_MS,
  NOTIFY_RETRIES,
  NOTIFY_TIMEOUT_MS,
  OutboundNotifier,
  PLAINTEXT_KEYRING,
  notifyHeaders,
  notifyPublicView,
  type NotifyBox,
  type NotifyPayload,
} from "../../src/server/notify";
import { DeskStore, isoSeconds } from "../../src/server/store";

const KEY = "sender-key-do-not-leak";
const URL = "https://hooks.example/calico";

function box(backend = "gnome_libsecret", available = true): NotifyBox {
  return {
    backend: () => backend,
    available: () => available,
    encrypt: (text) => Buffer.from(`sealed:${text}`),
    decrypt: (sealed) => {
      const text = sealed.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not sealed here");
      return text.slice("sealed:".length);
    },
  };
}

function harness(fetchImpl?: typeof fetch, secrets: NotifyBox = box()) {
  let now = 1_700_000_000_000;
  let current = defaultConfig();
  let seq = 0;
  const posts: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const notify = new OutboundNotifier({
    getConfig: () => current,
    box: secrets,
    version: "9.9.9",
    id: () => `id-${++seq}`,
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    timeoutMs: 30,
    fetch:
      fetchImpl ??
      (async (url, init) => {
        posts.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 204 });
      }),
  });
  const arm = (patch: Record<string, unknown> = {}) => {
    current = notify.apply(current, { url: URL, key: KEY, ...patch });
  };
  return {
    notify,
    posts,
    sleeps,
    arm,
    get current() {
      return current;
    },
    set current(next: CalicoConfig) {
      current = next;
    },
    at: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function body(post: { init: RequestInit } | undefined): NotifyPayload {
  if (!post) throw new Error("no post");
  return JSON.parse(String(post.init.body)) as NotifyPayload;
}

function headers(
  post: { init: RequestInit } | undefined,
): Record<string, string> {
  if (!post) throw new Error("no post");
  return post.init.headers as Record<string, string>;
}

describe("notify headers and payloads", () => {
  it("sends Authorization: Bearer by default, and the raw key under a custom name", () => {
    expect(notifyHeaders("", KEY, "9.9.9")).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "calico/9.9.9",
      Authorization: `Bearer ${KEY}`,
    });
    expect(notifyHeaders("X-Calico-Key", KEY, "0.1.12")).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "calico/0.1.12",
      "X-Calico-Key": KEY,
    });
    expect(notifyHeaders("", "", "9.9.9")).not.toHaveProperty("Authorization");
  });

  it("posts calico.online with the battery when the panel has reported one", async () => {
    const h = harness();
    h.arm();
    const at = isoSeconds(new Date(h.at()));
    h.notify.notePoll(h.at() - 180_000, {
      pct: 81,
      charging: true,
      external: true,
      at: h.at(),
    });
    await h.notify.settled();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]?.url).toBe(URL);
    expect(h.posts[0]?.init.method).toBe("POST");
    expect(h.posts[0]?.init.redirect).toBe("manual");
    expect(headers(h.posts[0])).toMatchObject({
      "Content-Type": "application/json",
      "User-Agent": "calico/9.9.9",
      Authorization: `Bearer ${KEY}`,
    });
    const raw = String(h.posts[0]?.init.body);
    expect(raw).toBe(
      JSON.stringify({
        type: "calico.online",
        id: "id-1",
        at,
        offline_seconds: 180,
        battery: { pct: 81, charging: true, external: true },
      }),
    );
    expect(raw).not.toContain('"at":' + h.at());
  });

  it("sends a null battery when none is known, and a custom header with the raw key", async () => {
    const h = harness();
    h.arm({ header: "X-Calico-Key" });
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(headers(h.posts[0])["X-Calico-Key"]).toBe(KEY);
    expect(headers(h.posts[0]).Authorization).toBeUndefined();
    expect(body(h.posts[0])).toMatchObject({ battery: null });
  });
});

describe("online threshold", () => {
  it("stays quiet on the first poll and fires once the gap reaches the threshold", async () => {
    const h = harness();
    h.arm();
    h.notify.notePoll(null, null);
    h.advance(10_000);
    h.notify.notePoll(h.at() - 10_000, null);
    h.advance(169_000);
    h.notify.notePoll(h.at() - 169_000, null);
    await h.notify.settled();
    expect(h.posts).toHaveLength(0);

    h.advance(11_000);
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(h.posts).toHaveLength(1);
    expect(body(h.posts[0])).toMatchObject({
      type: "calico.online",
      id: "id-1",
      offline_seconds: 180,
    });
  });

  it("does not fire one millisecond under the threshold", async () => {
    const h = harness();
    h.arm();
    const started = h.at();
    h.notify.notePoll(null, null);
    h.advance(180_000 - 1);
    h.notify.notePoll(started, null);
    await h.notify.settled();
    expect(h.posts).toHaveLength(0);
  });

  it("does not send online just because a URL was saved", async () => {
    const h = harness();
    h.notify.notePoll(null, null);
    h.arm();
    h.advance(2_000);
    h.notify.notePoll(h.at() - 2_000, null);
    await h.notify.settled();
    expect(h.posts).toHaveLength(0);
  });

  it("returns before the POST finishes", async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const h = harness(() => pending);
    h.arm();
    const started = Date.now();
    h.notify.notePoll(h.at() - 180_000, null);
    expect(Date.now() - started).toBeLessThan(200);
    release(new Response(null, { status: 204 }));
    await h.notify.settled();
    expect(h.notify.view(h.current).last).toMatchObject({
      ok: true,
      status: 204,
    });
  });
});

describe("needs_you.dismissed", () => {
  function watching() {
    const h = harness();
    h.arm();
    const store = new DeskStore({
      now: () => new Date("2026-10-14T20:41:00Z"),
      onDismissed: (ids, at) => h.notify.dismissed(ids, at),
    });
    return { h, store };
  }

  it("sends one POST for a named dismiss and one per agent on dismiss-all", async () => {
    const { h, store } = watching();
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "one",
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "b2",
      message: "two",
    });
    store.applyEvent({ type: "agent.launched", agent_id: "c3" });
    store.dismiss("a1");
    await h.notify.settled();
    expect(h.posts).toHaveLength(1);
    expect(String(h.posts[0]?.init.body)).toBe(
      JSON.stringify({
        type: "needs_you.dismissed",
        id: "id-1",
        agent_id: "a1",
        at: "2026-10-14T20:41:00Z",
      }),
    );
    expect(store.status().agents.find((a) => a.id === "b2")?.attention).toBe(
      true,
    );

    store.dismiss();
    await h.notify.settled();
    expect(h.posts).toHaveLength(2);
    expect(body(h.posts[1])).toEqual({
      type: "needs_you.dismissed",
      id: "id-2",
      agent_id: "b2",
      at: "2026-10-14T20:41:00Z",
    });
  });

  it("sends nothing when nothing was cleared", async () => {
    const { h, store } = watching();
    store.dismiss();
    store.dismiss("nobody");
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "one",
    });
    store.dismiss("zz");
    await h.notify.settled();
    expect(h.posts).toHaveLength(0);
    expect(store.status().agents.find((a) => a.id === "a1")?.attention).toBe(
      true,
    );
  });

  it("still clears attention when the notifier throws", () => {
    const store = new DeskStore({
      onDismissed: () => {
        throw new Error("notifier bug");
      },
    });
    store.applyEvent({
      type: "agent.needs_you",
      agent_id: "a1",
      message: "one",
    });
    store.dismiss("a1");
    expect(store.status().agents[0]?.attention).toBe(false);
  });
});

describe("delivery retries", () => {
  async function attempts(fetchImpl: typeof fetch) {
    const h = harness(fetchImpl);
    h.arm();
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    return h;
  }

  it("retries a network error, 429, and 5xx twice, with backoff", async () => {
    const calls = { n: 0 };
    const h = await attempts(async () => {
      calls.n += 1;
      if (calls.n === 1) throw new Error(`connect ${KEY}`);
      if (calls.n === 2) return new Response(null, { status: 503 });
      return new Response(null, { status: 204 });
    });
    expect(calls.n).toBe(3);
    expect(h.sleeps).toEqual([...NOTIFY_BACKOFF_MS]);
    expect(h.notify.view(h.current).last).toMatchObject({
      ok: true,
      status: 204,
      error: "",
      type: "calico.online",
    });
    expect(JSON.stringify(h.notify.view(h.current))).not.toContain(KEY);
  });

  it.each([429, 500, 502])(
    "stops after two retries of HTTP %i",
    async (status) => {
      let n = 0;
      const h = await attempts(async () => {
        n += 1;
        return new Response("no", { status });
      });
      expect(n).toBe(NOTIFY_RETRIES + 1);
      expect(h.sleeps).toEqual([...NOTIFY_BACKOFF_MS]);
      expect(h.notify.view(h.current).last).toMatchObject({
        ok: false,
        status,
        error: `HTTP ${status}`,
      });
    },
  );

  it.each([400, 401, 403, 404, 418])(
    "does not retry HTTP %i",
    async (status) => {
      let n = 0;
      const h = await attempts(async () => {
        n += 1;
        return new Response(KEY, { status });
      });
      expect(n).toBe(1);
      expect(h.sleeps).toEqual([]);
      expect(h.notify.view(h.current).last).toMatchObject({
        ok: false,
        status,
        error: `HTTP ${status}`,
      });
      expect(h.notify.view(h.current).last?.error).not.toContain(KEY);
    },
  );

  it("times out and retries, and the default timeout is 5 seconds", async () => {
    expect(NOTIFY_TIMEOUT_MS).toBe(5_000);
    let n = 0;
    const h = await attempts((_url, init) => {
      n += 1;
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const err = new Error("The operation was aborted");
          err.name = "TimeoutError";
          reject(err);
        };
        if (!signal) {
          fail();
          return;
        }
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      });
    });
    expect(n).toBe(3);
    expect(h.notify.view(h.current).last).toMatchObject({
      ok: false,
      status: null,
      error: "timed out",
    });
  });
});

describe("sender key", () => {
  const logs: string[] = [];
  afterEach(() => {
    logs.length = 0;
    vi.restoreAllMocks();
  });

  function spyLogs(): void {
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((part) => String(part)).join(" "));
      });
  }

  it("seals the key, refuses a missing keyring, and validates the patch", () => {
    spyLogs();
    const h = harness();
    const saved = h.notify.apply(defaultConfig(), {
      url: `${URL}/`,
      key: KEY,
      header: "Authorization",
      offline_seconds: "240",
    });
    expect(saved.notify_url).toBe(`${URL}/`);
    expect(saved.notify_header).toBe("");
    expect(saved.notify_offline_seconds).toBe(240);
    expect(saved.notify_key).not.toBe(KEY);
    expect(Buffer.from(saved.notify_key, "base64").toString("utf8")).toBe(
      `sealed:${KEY}`,
    );
    const path = join(
      mkdtempSync(join(tmpdir(), "calico-notify-")),
      "config.json",
    );
    saveConfig(path, saved);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(KEY);
    expect(loadConfig(path).config.notify_key).toBe(saved.notify_key);

    const kept = h.notify.apply(saved, { offline_seconds: 300 });
    expect(kept.notify_key).toBe(saved.notify_key);
    expect(h.notify.apply(saved, { url: URL, key: "" }).notify_key).toBe("");
    expect(h.notify.apply(saved, { clear: true })).toMatchObject({
      notify_url: "",
      notify_key: "",
      notify_header: "",
      notify_offline_seconds: 240,
    });

    expect(() =>
      harness(undefined, box("basic_text")).notify.apply(defaultConfig(), {
        url: URL,
        key: KEY,
      }),
    ).toThrow(PLAINTEXT_KEYRING);
    expect(() =>
      harness(undefined, box("unknown", false)).notify.apply(defaultConfig(), {
        url: URL,
        key: KEY,
      }),
    ).toThrow(NO_KEYRING);
    for (const patch of [
      { url: "ftp://x", key: KEY },
      { url: "http://user@h", key: KEY },
      { url: "http://hooks.example/calico", key: KEY },
      { url: "https://h/#x", key: KEY },
      { url: URL, header: "Content-Type", key: KEY },
      { url: URL, header: "Host", key: KEY },
      { key: KEY },
      { url: URL, header: "Bad Name", key: KEY },
      { url: URL, offline_seconds: 1, key: KEY },
      { url: URL, key: "has space" },
    ]) {
      let message = "";
      try {
        h.notify.apply(defaultConfig(), patch);
      } catch (err) {
        message = err instanceof BadInput ? err.message : String(err);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(KEY);
    }
    expect(notifyUrl("http://127.0.0.1:9/hook")).toBe(
      "http://127.0.0.1:9/hook",
    );
    expect(notifyHeader("X-Calico-Key")).toBe("X-Calico-Key");
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("records a keyring failure without the key and without posting", async () => {
    spyLogs();
    const h = harness();
    h.current = {
      ...defaultConfig(),
      notify_url: URL,
      notify_key: "not-valid-ciphertext",
    };
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(h.posts).toHaveLength(0);
    expect(h.notify.view(h.current).last).toMatchObject({
      ok: false,
      error: KEYRING_CHANGED,
    });
    expect(JSON.stringify(h.notify.view(h.current))).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("keeps the key out of logs and out of the public HTTP views", async () => {
    spyLogs();
    const secrets = box();
    let current = defaultConfig();
    const notify = new OutboundNotifier({
      getConfig: () => current,
      box: secrets,
      version: "9.9.9",
      sleep: async () => undefined,
      fetch: async () => {
        throw new Error(`socket hang up ${KEY}`);
      },
    });
    current = notify.apply(defaultConfig(), { url: URL, key: KEY });
    const sealed = current.notify_key;
    notify.notePoll(Date.now() - 180_000, null);
    await notify.settled();
    const { server } = createCompanionServer({
      store: new DeskStore(),
      notify,
      getConfig: () => current,
      setConfig: (next) => {
        current = next;
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const paths = ["/api/config", "/api/panel", "/api/relay", "/api/notify"];
      const texts = await Promise.all(
        paths.map(async (path) => (await fetch(base + path)).text()),
      );
      const put = await fetch(`${base}/api/notify`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: URL, key: KEY, offline_seconds: 180 }),
      });
      texts.push(await put.text());
      const all = texts.join("\n") + JSON.stringify(notify.view(current));
      expect(all).not.toContain(KEY);
      expect(all).not.toContain(sealed);
      expect(JSON.stringify(publicView(current, true))).not.toContain(KEY);
      expect(JSON.stringify(panelPublicView(current))).not.toContain(KEY);
      expect(JSON.stringify(relayPublicView(current))).not.toContain(KEY);
      expect(JSON.stringify(notifyPublicView(current, null))).not.toContain(
        KEY,
      );
      expect(notify.view(current).url).toBe("https://hooks.example/\u2026");
      expect(texts[3]).not.toContain("/calico");
      expect(notify.view(current).last?.error).toBe("network error");
      expect(logs.join("\n")).not.toContain(KEY);
    } finally {
      server.close();
    }
  });
});

describe("dismiss does not wait on the webhook", () => {
  it("answers POST /api/dismiss before the webhook returns", async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let current = defaultConfig();
    const notify = new OutboundNotifier({
      getConfig: () => current,
      box: box(),
      version: "9.9.9",
      fetch: () => pending,
    });
    current = notify.apply(current, { url: URL, key: KEY });
    const store = new DeskStore({
      onDismissed: (ids, at) => notify.dismissed(ids, at),
    });
    const { server } = createCompanionServer({
      store,
      notify,
      getConfig: () => current,
      setConfig: (next) => {
        current = next;
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      store.applyEvent({
        type: "agent.needs_you",
        agent_id: "a1",
        message: "one",
      });
      const started = Date.now();
      const res = await fetch(`${base}/api/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: "a1" }),
      });
      expect(res.status).toBe(204);
      expect(Date.now() - started).toBeLessThan(500);
      expect(store.status().needs_you).toBe(false);
      release(new Response(null, { status: 204 }));
      await notify.settled();
      expect(notify.view(current).last).toMatchObject({
        ok: true,
        type: "needs_you.dismissed",
      });
    } finally {
      server.close();
    }
  });
});

describe("address change, retries, and the public view", () => {
  it("drops the sealed key when a URL-only patch names a new host", () => {
    const h = harness();
    const saved = h.notify.apply(defaultConfig(), { url: URL, key: KEY });
    const moved = h.notify.apply(saved, {
      url: "https://other.example/hook",
    });
    expect(moved.notify_url).toBe("https://other.example/hook");
    expect(moved.notify_key).toBe("");
    expect(h.notify.view(moved).key_set).toBe(false);
    expect(h.notify.apply(saved, { url: URL }).notify_key).toBe(
      saved.notify_key,
    );
    expect(h.notify.apply(saved, { header: "X-Calico-Key" }).notify_key).toBe(
      saved.notify_key,
    );
    const replaced = h.notify.apply(saved, {
      url: "https://other.example/hook",
      key: "next-key",
    });
    expect(replaced.notify_key).not.toBe("");
    expect(replaced.notify_key).not.toBe(saved.notify_key);
  });

  it("masks a path or query and keeps a bare origin", () => {
    const view = (url: string) =>
      notifyPublicView({ ...defaultConfig(), notify_url: url }, null).url;
    expect(view(URL)).toBe("https://hooks.example/\u2026");
    expect(view("https://hooks.example/calico?token=1")).toBe(
      "https://hooks.example/\u2026",
    );
    expect(view("https://hooks.example/")).toBe("https://hooks.example/");
    expect(view("https://hooks.example")).toBe("https://hooks.example");
  });

  it("keeps one id across retries and honors Retry-After on 429", async () => {
    let n = 0;
    const bodies: string[] = [];
    const h = harness(async (_url, init) => {
      bodies.push(String(init?.body));
      n += 1;
      if (n === 1)
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "4" },
        });
      return new Response(null, { status: 204 });
    });
    h.arm();
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(n).toBe(2);
    expect(h.sleeps).toEqual([4_000]);
    expect(
      bodies.map((text) => (JSON.parse(text) as { id: string }).id),
    ).toEqual(["id-1", "id-1"]);
  });

  it("caps a long Retry-After at 30 seconds and falls back when it is unusable", async () => {
    let n = 0;
    const h = harness(async () => {
      n += 1;
      const header = n === 1 ? "90" : "soon";
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": header },
      });
    });
    h.arm();
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(h.sleeps).toEqual([30_000, 2_000]);
  });

  it("waits until an HTTP-date Retry-After", async () => {
    const h = harness(
      async () =>
        new Response(null, {
          status: 429,
          headers: {
            "Retry-After": new Date(1_700_000_000_000 + 5_000).toUTCString(),
          },
        }),
    );
    h.arm();
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(h.sleeps[0]).toBe(5_000);
  });

  it("records a redirect as final", async () => {
    let n = 0;
    const h = harness(async () => {
      n += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://elsewhere.example/hook" },
      });
    });
    h.arm();
    h.notify.notePoll(h.at() - 180_000, null);
    await h.notify.settled();
    expect(n).toBe(1);
    expect(h.sleeps).toEqual([]);
    expect(h.notify.view(h.current).last).toMatchObject({
      ok: false,
      status: 302,
      error: "HTTP 302",
    });
  });

  it("keeps an earlier failure when a later send succeeds", async () => {
    let n = 0;
    const h = harness(async () => {
      n += 1;
      return new Response(null, { status: n === 1 ? 400 : 204 });
    });
    h.arm();
    h.notify.dismissed(["a1", "b2"], "2026-10-14T20:41:00Z");
    await h.notify.settled();
    const view = h.notify.view(h.current);
    expect(view.recent).toHaveLength(2);
    expect(view.last?.ok).toBe(true);
    expect(view.recent.some((delivery) => !delivery.ok)).toBe(true);
  });

  it("opens the key only after notePoll has returned", async () => {
    let pollReturned = false;
    const secrets = box();
    const real = secrets.decrypt;
    secrets.decrypt = (sealed) => {
      if (!pollReturned) throw new Error("decrypt ran inside notePoll");
      return real(sealed);
    };
    const h = harness(undefined, secrets);
    h.arm();
    h.notify.notePoll(h.at() - 180_000, null);
    pollReturned = true;
    await h.notify.settled();
    expect(h.posts).toHaveLength(1);
    expect(headers(h.posts[0]).Authorization).toBe(`Bearer ${KEY}`);
  });
});
