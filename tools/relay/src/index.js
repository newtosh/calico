// Calico relay: a one-person mailbox. Anything with the send token can drop a short message
// in; the owner, holding the read token, picks up what is waiting. It speaks the part of the
// ntfy protocol Calico needs, so the app's client works against this or a self-hosted ntfy.
//
// No accounts and no database to run: two secrets set at deploy time are the only identity.
// One Durable Object keeps a rolling window (the newest MAX_MESSAGES, none older than
// TTL_SECONDS), and refuses politely once a daily request budget is spent, so the free
// plan's limits are never what stops it.
import { DurableObject } from "cloudflare:workers";

// Bumped when the deployed behaviour changes, so the app can tell an old relay and offer an update.
const VERSION = 1;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

// Compare digests, not the secrets themselves, so neither length nor content leaks by timing.
async function sameSecret(got, want) {
  if (!want) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(got)),
    crypto.subtle.digest("SHA-256", enc.encode(want)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/health") return json({ healthy: true, version: VERSION });
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]{1,64})(\/json)?$/);
    if (!match || match[1] !== env.TOPIC) return json({ code: 404, error: "not found" }, 404);
    const want = { POST: env.SEND_TOKEN, GET: env.READ_TOKEN }[request.method];
    if (want === undefined) return json({ code: 405, error: "method not allowed" }, 405);
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return json({ code: 401, error: "unauthorized" }, 401);
    // A send token cannot read and a read token cannot send: each only matches its own method.
    if (!(await sameSecret(header.slice(7), want))) return json({ code: 403, error: "forbidden" }, 403);
    const inbox = env.INBOX.get(env.INBOX.idFromName(env.TOPIC));
    return inbox.handle(request.method, url.searchParams.get("since"), request.method === "POST" ? await request.text() : "", env.TOPIC);
  },
};

const secondsUntilMidnightUtc = (now) => Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now) / 1000));

export class Inbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, body TEXT NOT NULL)");
    // Counted in memory: an approximate guard, and it costs no storage writes.
    this.day = "";
    this.requests = 0;
  }

  num(name, fallback) {
    const n = Number(this.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  // Drop what has aged out or fallen off the end. Writes only when there is something to drop.
  prune(nowSec) {
    const ttl = this.num("TTL_SECONDS", 86400);
    const max = this.num("MAX_MESSAGES", 200);
    const [{ old }] = this.sql.exec("SELECT COUNT(*) AS old FROM messages WHERE time <= ?", nowSec - ttl).toArray();
    if (old > 0) this.sql.exec("DELETE FROM messages WHERE time <= ?", nowSec - ttl);
    const [{ extra }] = this.sql.exec("SELECT MAX(COUNT(*) - ?, 0) AS extra FROM messages", max).toArray();
    if (extra > 0) this.sql.exec("DELETE FROM messages WHERE seq IN (SELECT seq FROM messages ORDER BY seq ASC LIMIT ?)", extra);
  }

  message(row, topic) {
    return { id: String(row.seq), time: row.time, expires: row.time + this.num("TTL_SECONDS", 86400), event: "message", topic, message: row.body };
  }

  handle(method, sinceParam, body, topic) {
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.requests = 0;
    }
    const budget = this.num("DAILY_REQUEST_BUDGET", 60000);
    this.requests += 1;
    const used = { "x-relay-requests-today": String(this.requests), "x-relay-budget": String(budget) };
    if (this.requests > budget)
      return json({ code: 42901, error: "daily budget reached, try again after 00:00 UTC" }, 429, { ...used, "retry-after": String(secondsUntilMidnightUtc(now)) });

    if (method === "POST") {
      if (new TextEncoder().encode(body).length > this.num("MAX_BODY_BYTES", 4096)) return json({ code: 41301, error: "message too large" }, 413, used);
      if (!body.trim()) return json({ code: 40001, error: "empty message" }, 400, used);
      const { seq } = this.sql.exec("INSERT INTO messages (time, body) VALUES (?, ?) RETURNING seq", nowSec, body).one();
      this.prune(nowSec);
      return json(this.message({ seq, time: nowSec, body }, topic), 200, used);
    }

    // GET: everything after `since` (an id from an earlier read, or "all"), oldest first.
    this.prune(nowSec);
    const since = sinceParam ?? "all";
    const after = since === "all" ? 0 : Number(since);
    if (!Number.isInteger(after) || after < 0) return json({ code: 40002, error: "bad since" }, 400, used);
    const rows = this.sql.exec("SELECT seq, time, body FROM messages WHERE seq > ? ORDER BY seq ASC", after).toArray();
    return new Response(rows.map((r) => JSON.stringify(this.message(r, topic))).join("\n") + (rows.length ? "\n" : ""), {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", ...used },
    });
  }
}
