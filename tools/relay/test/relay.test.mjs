import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dropState, newState, sleep, startRelay } from "./harness.mjs";

const SEND = "send_test_token_0123456789abcdef";
const READ = "read_test_token_0123456789abcdef";
const T = "inbox";
const LIMITS = {
  TOPIC: T,
  TTL_SECONDS: "5",
  MAX_MESSAGES: "5",
  MAX_BODY_BYTES: "4096",
  DAILY_REQUEST_BUDGET: "400",
};

const event = (type, id, message) =>
  JSON.stringify({ type, agent_id: id, title: id, message });

function client(base) {
  const req = (method, path, token, body) =>
    fetch(base + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
  const read = async (since = "all") => {
    const res = await req("GET", `/${T}/json?poll=1&since=${since}`, READ);
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      msgs: text.split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    };
  };
  const bodies = (got) => got.msgs.map((m) => JSON.parse(m.message).message);
  return { req, read, bodies };
}

describe("the relay", () => {
  const state = newState();
  let relay;
  let api;

  before(async () => {
    relay = await startRelay({
      state,
      vars: { ...LIMITS, SEND_TOKEN: SEND, READ_TOKEN: READ },
    });
    api = client(relay.base);
  });

  after(async () => {
    await relay?.stop();
    dropState(state);
  });

  describe("who may do what", () => {
    it("refuses an anonymous publish", async () => {
      assert.equal((await api.req("POST", `/${T}`, null, "x")).status, 401);
    });
    it("refuses an anonymous read", async () => {
      assert.equal((await api.req("GET", `/${T}/json?poll=1`, null)).status, 401);
    });
    it("does not let the send token read", async () => {
      assert.equal((await api.req("GET", `/${T}/json?poll=1`, SEND)).status, 403);
    });
    it("does not let the read token publish", async () => {
      assert.equal((await api.req("POST", `/${T}`, READ, "x")).status, 403);
    });
    it("refuses a wrong token", async () => {
      assert.equal((await api.req("POST", `/${T}`, "send_nope", "x")).status, 403);
    });
    it("does not find another topic", async () => {
      assert.equal((await api.req("POST", "/other", SEND, "x")).status, 404);
    });
    it("answers health without credentials, with a version", async () => {
      const res = await api.req("GET", "/v1/health", null);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.healthy, true);
      assert.ok(Number.isInteger(body.version) && body.version >= 1);
    });
  });

  describe("the offline queue", () => {
    const posted = [];
    it("takes three updates from the send token", async () => {
      for (const n of [1, 2, 3]) {
        const res = await api.req("POST", `/${T}`, SEND, event("agent.launched", "spool", `offline ${n}`));
        assert.equal(res.status, 200);
        posted.push(await res.json());
      }
    });
    it("gives a late reader all three, oldest first", async () => {
      assert.deepEqual(api.bodies(await api.read()), ["offline 1", "offline 2", "offline 3"]);
    });
    it("numbers them upward", async () => {
      const ids = (await api.read()).msgs.map((m) => Number(m.id));
      assert.ok(ids[0] < ids[1] && ids[1] < ids[2]);
    });
    it("resumes after an id", async () => {
      assert.deepEqual(api.bodies(await api.read(posted[1].id)), ["offline 3"]);
    });
    it("returns nothing when already at the newest", async () => {
      assert.equal((await api.read(posted[2].id)).msgs.length, 0);
    });
    it("answers 400 for a cursor that is not an id", async () => {
      assert.equal((await api.req("GET", `/${T}/json?poll=1&since=abc`, READ)).status, 400);
    });
    it("stamps each message with the time it arrived", async () => {
      const [first] = (await api.read()).msgs;
      assert.ok(Math.abs(first.time - Date.now() / 1000) < 30);
      assert.equal(first.event, "message");
    });
  });

  describe("sizes", () => {
    it("refuses 5 KB", async () => {
      assert.equal((await api.req("POST", `/${T}`, SEND, "x".repeat(5000))).status, 413);
    });
    it("refuses an empty body", async () => {
      assert.equal((await api.req("POST", `/${T}`, SEND, "  ")).status, 400);
    });
    it("takes 3 KB", async () => {
      assert.equal((await api.req("POST", `/${T}`, SEND, "y".repeat(3000))).status, 200);
    });
  });

  describe("the rolling window", () => {
    it("drops what is older than the window", async () => {
      await sleep(5600);
      assert.equal((await api.read()).msgs.length, 0);
    });
    it("keeps only the newest 5 of a burst of 7", async () => {
      for (let i = 1; i <= 7; i += 1)
        await api.req("POST", `/${T}`, SEND, event("agent.launched", "spool", `burst ${i}`));
      const got = await api.read();
      assert.deepEqual(api.bodies(got), ["burst 3", "burst 4", "burst 5", "burst 6", "burst 7"]);
    });
    it("moves forward and empties", async () => {
      await sleep(5600);
      assert.equal((await api.read()).msgs.length, 0);
    });
    it("does not keep a message a second past its time", async () => {
      await api.req("POST", `/${T}`, SEND, event("agent.launched", "spool", "edge"));
      await sleep(5200);
      assert.equal((await api.read()).msgs.length, 0);
    });
  });

  describe("the daily budget", () => {
    it("reports usage on every answer", async () => {
      const res = await api.req("GET", `/${T}/json?poll=1&since=all`, READ);
      assert.ok(Number(res.headers.get("x-relay-requests-today")) > 0);
      assert.equal(res.headers.get("x-relay-budget"), LIMITS.DAILY_REQUEST_BUDGET);
    });
    it("answers 429 with Retry-After before the limit, for reads and sends", async () => {
      let last;
      for (let i = 0; i < 500; i += 1) {
        last = await api.req("GET", `/${T}/json?poll=1&since=all`, READ);
        if (last.status === 429) break;
      }
      assert.equal(last.status, 429);
      const wait = Number(last.headers.get("retry-after"));
      assert.ok(wait > 0 && wait <= 86400);
      assert.equal((await api.req("POST", `/${T}`, SEND, "x")).status, 429);
    });
    it("still turns away strangers before it counts them", async () => {
      assert.equal((await api.req("POST", `/${T}`, null, "x")).status, 401);
    });
  });
});

describe("a restart", () => {
  it("keeps the queue", async () => {
    const state = newState();
    const vars = { ...LIMITS, TTL_SECONDS: "86400", MAX_MESSAGES: "200", DAILY_REQUEST_BUDGET: "60000", SEND_TOKEN: SEND, READ_TOKEN: READ };
    let relay = await startRelay({ state, vars });
    try {
      let api = client(relay.base);
      assert.equal((await api.req("POST", `/${T}`, SEND, event("agent.launched", "spool", "survives"))).status, 200);
      await relay.stop();
      relay = await startRelay({ state, vars });
      api = client(relay.base);
      assert.deepEqual(api.bodies(await api.read()), ["survives"]);
    } finally {
      await relay.stop();
      dropState(state);
    }
  });
});

describe("a relay set up without its tokens", () => {
  it("answers 405 instead of letting anyone in", async () => {
    const state = newState();
    const relay = await startRelay({ state, vars: { ...LIMITS } });
    try {
      const api = client(relay.base);
      assert.equal((await api.req("POST", `/${T}`, "anything", "x")).status, 405);
      assert.equal((await api.req("GET", `/${T}/json?poll=1`, "anything")).status, 405);
      assert.equal((await api.req("GET", "/v1/health", null)).status, 200);
    } finally {
      await relay.stop();
      dropState(state);
    }
  });
});
