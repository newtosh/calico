import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import {
  BadInput,
  type CalicoConfig,
  mergeConfig,
  mergePanel,
  panelPublicView,
  panelStatusField,
  publicView,
} from "./config";
import {
  COLOR_LIMIT,
  clipShape,
  clipText,
  type DeskStore,
  type EventIn,
  FRAME_MAX,
  ICON_LIMIT,
  StoreError,
} from "./store";

const JSON_MAX = 1024 * 1024;
const POST_PATHS = new Set([
  "/api/webhook/grok-bot",
  "/api/dismiss",
  "/api/unread/dismiss",
  "/api/frame/request",
  "/api/frame",
]);

export interface ServerDeps {
  store: DeskStore;
  getConfig(): CalicoConfig;
  setConfig(next: CalicoConfig): void;
}

export interface ServerStats {
  lastPanelPoll: number | null;
}

/** JSON with non-ASCII escaped as \uXXXX, matching Python's json.dumps. The firmware decodes these. */
export function asciiJson(payload: unknown): string {
  return JSON.stringify(payload).replace(
    /[\u0080-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("::ffff:127.")
  );
}

function pyStr(value: unknown, fallback = ""): string {
  if (value === undefined) return fallback;
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function eventIn(payload: Record<string, unknown>): EventIn {
  return {
    type: pyStr(payload.type),
    agent_id: pyStr(payload.agent_id),
    title: pyStr(payload.title),
    message: pyStr(payload.message),
    source: pyStr(payload.source, "grok-bot"),
    color: clipText(payload.color, COLOR_LIMIT),
    shape: clipShape(payload.shape),
    icon: clipText(payload.icon, ICON_LIMIT),
  };
}

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
): void {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(bytes.length),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(bytes);
}

function json(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
): void {
  send(res, status, asciiJson(payload), "application/json");
}

function empty(res: http.ServerResponse): void {
  send(res, 204, "", "text/plain");
}

async function readBody(
  req: http.IncomingMessage,
  limit: number,
): Promise<Buffer | "too_big"> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) {
    req.resume();
    return "too_big";
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) {
      req.resume();
      return "too_big";
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson(
  req: http.IncomingMessage,
): Promise<Record<string, unknown> | null | "too_big"> {
  const raw = await readBody(req, JSON_MAX);
  if (raw === "too_big") return raw;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8") || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createCompanionServer(deps: ServerDeps): {
  server: http.Server;
  stats: ServerStats;
} {
  const stats: ServerStats = { lastPanelPoll: null };
  const { store } = deps;

  function allowed(req: http.IncomingMessage): boolean {
    const expected = deps.getConfig().webhook_token;
    if (!expected) return true;
    const got = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(`Bearer ${expected}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const path = new URL(req.url ?? "/", "http://calico").pathname;
    const method = req.method ?? "GET";

    if (method === "OPTIONS") return empty(res);

    if (method === "GET") {
      if (path === "/api/frame") {
        const frame = store.frame();
        return frame
          ? send(res, 200, frame, "image/bmp")
          : json(res, 404, { error: "not found" });
      }
      if (path === "/api/status") {
        if (!isLoopback(req.socket.remoteAddress))
          stats.lastPanelPoll = Date.now();
        const body = store.status();
        const panel = panelStatusField(deps.getConfig());
        // First key: the panel buffer is 16 KB and drops the tail.
        return json(res, 200, panel ? { panel, ...body } : body);
      }
      if (path === "/api/panel")
        return json(res, 200, panelPublicView(deps.getConfig()));
      if (path === "/api/config")
        return json(res, 200, publicView(deps.getConfig()));
      return json(res, 404, { error: "not found" });
    }

    if (method === "POST") {
      if (!POST_PATHS.has(path)) return json(res, 404, { error: "not found" });
      if (!allowed(req)) return json(res, 401, { error: "unauthorized" });
      if (path === "/api/dismiss") {
        const raw = await readBody(req, JSON_MAX);
        if (raw === "too_big") return json(res, 413, { error: "too large" });
        let agentId = "";
        if (raw.length) {
          let payload: unknown;
          try {
            payload = JSON.parse(raw.toString("utf8"));
          } catch {
            return json(res, 400, { error: "bad json" });
          }
          if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
          ) {
            return json(res, 400, { error: "bad json" });
          }
          const id = (payload as Record<string, unknown>).agent_id;
          agentId = typeof id === "string" ? id : "";
        }
        store.dismiss(agentId);
        return empty(res);
      }
      if (path === "/api/unread/dismiss") {
        store.clearUnread();
        return empty(res);
      }
      if (path === "/api/frame/request") {
        store.requestFrame();
        return empty(res);
      }
      if (path === "/api/frame") {
        const kind = (req.headers["content-type"] ?? "")
          .split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (kind !== "image/bmp")
          return json(res, 415, { error: "bmp required" });
        const raw = await readBody(req, FRAME_MAX);
        if (raw === "too_big") return json(res, 413, { error: "too large" });
        const saved = store.saveFrame(raw);
        if (saved === "too_big") return json(res, 413, { error: "too large" });
        if (saved !== "ok") return json(res, 400, { error: "bad bmp" });
        return empty(res);
      }
      const payload = await readJson(req);
      if (payload === "too_big") return json(res, 413, { error: "too large" });
      if (payload === null) return json(res, 400, { error: "bad json" });
      try {
        return json(res, 201, store.applyEvent(eventIn(payload)));
      } catch (err) {
        if (err instanceof StoreError)
          return json(res, 400, { error: "bad event" });
        throw err;
      }
    }

    if (method === "PUT") {
      if (path !== "/api/config" && path !== "/api/panel")
        return json(res, 404, { error: "not found" });
      if (!allowed(req)) return json(res, 401, { error: "unauthorized" });
      const payload = await readJson(req);
      if (payload === "too_big") return json(res, 413, { error: "too large" });
      if (payload === null) return json(res, 400, { error: "bad json" });
      if (path === "/api/panel") {
        try {
          deps.setConfig(mergePanel(deps.getConfig(), payload));
        } catch (err) {
          if (err instanceof BadInput)
            return json(res, 400, { error: "bad panel" });
          throw err;
        }
        return json(res, 200, panelPublicView(deps.getConfig()));
      }
      try {
        const { config, restart } = mergeConfig(deps.getConfig(), payload);
        deps.setConfig(config);
        return json(res, 200, {
          ...publicView(config),
          restart_required: restart,
        });
      } catch (err) {
        if (err instanceof BadInput)
          return json(res, 400, { error: "bad config" });
        throw err;
      }
    }

    return json(res, 404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.destroy();
    });
  });
  return { server, stats };
}
