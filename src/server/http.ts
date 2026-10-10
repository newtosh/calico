import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import {
  BadInput,
  type CalicoConfig,
  mergeConfig,
  mergePanel,
  mergeRelay,
  panelPublicView,
  panelStatusField,
  publicView,
  relayPublicView,
} from "./config";
import type { RefusalReason, WebhookActivity } from "../shared/ipc";
import { type CursorStatus, EMPTY_CURSOR_STATUS } from "./cursor-poll";
import { EMPTY_RELAY_STATUS, type RelayStatus } from "./relay";
import { type DeskStore, eventIn, FRAME_MAX, StoreError } from "./store";

const JSON_MAX = 1024 * 1024;
const PUT_PATHS = new Set(["/api/config", "/api/panel", "/api/relay"]);
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
  /** Cursor polling health, for the app's Settings. Empty when not wired. */
  cursorStatus?(): CursorStatus;
  /** Relay polling health, for the app's Settings. Empty when not wired. */
  relayStatus?(): RelayStatus;
  /** Origins allowed to call the server, such as the dev renderer. */
  allowedOrigins?: string[];
}

export interface ServerStats {
  lastPanelPoll: number | null;
  webhook: WebhookActivity;
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
  const stats: ServerStats = {
    lastPanelPoll: null,
    webhook: { accepted: null, refused: { count: 0, last: null } },
  };
  const { store } = deps;

  const remote = (req: http.IncomingMessage): string => {
    const address = req.socket.remoteAddress ?? "";
    return address.startsWith("::ffff:") ? address.slice(7) : address;
  };

  function refuse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    error: string,
    reason: RefusalReason,
  ): void {
    const { refused } = stats.webhook;
    refused.count += 1;
    refused.last = { at: Date.now(), reason, from: remote(req) };
    json(res, status, { error });
  }

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

    // The panel, agents, and the packaged renderer send no Origin. Browsers
    // always do on cross-origin requests, so this keeps web pages from reading
    // the panel token or re-pointing the panel.
    const origin = req.headers.origin;
    if (origin !== undefined && !deps.allowedOrigins?.includes(origin))
      return refuse(req, res, 403, "forbidden origin", "forbidden_origin");

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
        const detail =
          new URL(req.url ?? "/", "http://calico").searchParams.get(
            "detail",
          ) === "1";
        const body = store.status(detail);
        const panel = panelStatusField(deps.getConfig());
        // First key: the panel buffer is 16 KB and drops the tail.
        return json(res, 200, panel ? { panel, ...body } : body);
      }
      if (path === "/api/panel")
        return json(res, 200, panelPublicView(deps.getConfig()));
      if (path === "/api/config") {
        const detail =
          new URL(req.url ?? "/", "http://calico").searchParams.get(
            "detail",
          ) === "1";
        return json(res, 200, publicView(deps.getConfig(), detail));
      }
      if (path === "/api/relay")
        return json(res, 200, {
          ...relayPublicView(deps.getConfig()),
          status: deps.relayStatus?.() ?? EMPTY_RELAY_STATUS,
        });
      if (path === "/api/cursor")
        return json(res, 200, deps.cursorStatus?.() ?? EMPTY_CURSOR_STATUS);
      return json(res, 404, { error: "not found" });
    }

    if (method === "POST") {
      if (!POST_PATHS.has(path)) return json(res, 404, { error: "not found" });
      if (!allowed(req))
        return refuse(req, res, 401, "unauthorized", "unauthorized");
      if (path === "/api/dismiss") {
        const raw = await readBody(req, JSON_MAX);
        if (raw === "too_big")
          return refuse(req, res, 413, "too large", "too_large");
        let agentId = "";
        if (raw.length) {
          let payload: unknown;
          try {
            payload = JSON.parse(raw.toString("utf8"));
          } catch {
            return refuse(req, res, 400, "bad json", "bad_json");
          }
          if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
          ) {
            return refuse(req, res, 400, "bad json", "bad_json");
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
        if (raw === "too_big")
          return refuse(req, res, 413, "too large", "too_large");
        const saved = store.saveFrame(raw);
        if (saved === "too_big")
          return refuse(req, res, 413, "too large", "too_large");
        if (saved !== "ok") return json(res, 400, { error: "bad bmp" });
        return empty(res);
      }
      const payload = await readJson(req);
      if (payload === "too_big")
        return refuse(req, res, 413, "too large", "too_large");
      if (payload === null)
        return refuse(req, res, 400, "bad json", "bad_json");
      try {
        const stored = store.applyEvent(eventIn(payload));
        stats.webhook.accepted = { at: Date.now(), from: remote(req) };
        return json(res, 201, stored);
      } catch (err) {
        if (err instanceof StoreError)
          return refuse(req, res, 400, "bad event", "bad_event");
        throw err;
      }
    }

    if (method === "PUT") {
      if (!PUT_PATHS.has(path)) return json(res, 404, { error: "not found" });
      if (!allowed(req))
        return refuse(req, res, 401, "unauthorized", "unauthorized");
      const payload = await readJson(req);
      if (payload === "too_big")
        return refuse(req, res, 413, "too large", "too_large");
      if (payload === null)
        return refuse(req, res, 400, "bad json", "bad_json");
      if (path === "/api/relay") {
        try {
          deps.setConfig(mergeRelay(deps.getConfig(), payload));
        } catch (err) {
          if (err instanceof BadInput)
            return json(res, 400, { error: "bad relay" });
          throw err;
        }
        return json(res, 200, relayPublicView(deps.getConfig()));
      }
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
