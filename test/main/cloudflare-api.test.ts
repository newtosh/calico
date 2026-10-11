import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CloudflareApi, CloudflareError } from "../../src/main/cloudflare/api";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

interface Call {
  method: string;
  path: string;
  auth: string;
  type: string;
  body: Buffer;
}

type Reply = { status?: number; body: unknown };

async function fake(replies: Record<string, Reply>) {
  const calls: Call[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = req.url ?? "";
      calls.push({
        method: req.method ?? "",
        path,
        auth: String(req.headers.authorization ?? ""),
        type: String(req.headers["content-type"] ?? ""),
        body: Buffer.concat(chunks),
      });
      const reply = replies[`${req.method} ${path.split("?")[0]}`];
      res
        .writeHead(reply?.status ?? 404, { "content-type": "application/json" })
        .end(
          JSON.stringify(
            reply?.body ?? {
              success: false,
              errors: [{ code: 7003, message: "no route" }],
            },
          ),
        );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const api = new CloudflareApi(
    "tok-secret",
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  return { api, calls };
}

const ok = (result: unknown) => ({
  status: 200,
  body: { success: true, errors: [], result },
});

describe("CloudflareApi", () => {
  it("lists accounts with the bearer token", async () => {
    const { api, calls } = await fake({
      "GET /accounts": ok([
        { id: "a1", name: "Me" },
        { id: "a2", name: "Team" },
      ]),
    });
    expect(await api.accounts()).toEqual([
      { id: "a1", name: "Me" },
      { id: "a2", name: "Team" },
    ]);
    expect(calls[0]?.auth).toBe("Bearer tok-secret");
  });

  it("reads the workers.dev name", async () => {
    const { api } = await fake({
      "GET /accounts/a1/workers/subdomain": ok({ subdomain: "jon-xo" }),
    });
    expect(await api.subdomain("a1")).toBe("jon-xo");
  });

  it("says there is none when the account never picked one", async () => {
    const { api } = await fake({
      "GET /accounts/a1/workers/subdomain": {
        status: 404,
        body: {
          success: false,
          errors: [{ code: 10007, message: "not found" }],
        },
      },
    });
    expect(await api.subdomain("a1")).toBeNull();
  });

  it("knows whether a Worker of that name exists", async () => {
    const { api } = await fake({
      "GET /accounts/a1/workers/scripts": ok([
        { id: "other" },
        { id: "calico-relay" },
      ]),
    });
    expect(await api.scriptExists("a1", "calico-relay")).toBe(true);
    expect(await api.scriptExists("a1", "nope")).toBe(false);
  });

  it("uploads the Worker with its Durable Object, migration, variables and secrets", async () => {
    const { api, calls } = await fake({
      "PUT /accounts/a1/workers/scripts/calico-relay": ok({}),
    });
    await api.uploadWorker("a1", "calico-relay", {
      source: "export default {}; // worker",
      vars: { TOPIC: "inbox", MAX_MESSAGES: "200" },
      secrets: { SEND_TOKEN: "send_x", READ_TOKEN: "read_y" },
      durableObject: { binding: "INBOX", className: "Inbox" },
    });
    const call = calls[0];
    expect(call?.type).toMatch(/^multipart\/form-data/);
    const text = call?.body.toString("utf8") ?? "";
    expect(text).toContain("export default {}; // worker");
    const meta = JSON.parse(
      /name="metadata"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1] ?? "{}",
    ) as {
      main_module: string;
      bindings: {
        type: string;
        name: string;
        text?: string;
        class_name?: string;
      }[];
      migrations: { new_tag: string; new_sqlite_classes: string[] };
    };
    expect(meta.main_module).toBe("index.js");
    expect(meta.migrations).toEqual({
      new_tag: "v1",
      new_sqlite_classes: ["Inbox"],
    });
    const by = (name: string) => meta.bindings.find((b) => b.name === name);
    expect(by("INBOX")).toMatchObject({
      type: "durable_object_namespace",
      class_name: "Inbox",
    });
    expect(by("TOPIC")).toMatchObject({ type: "plain_text", text: "inbox" });
    expect(by("SEND_TOKEN")).toMatchObject({
      type: "secret_text",
      text: "send_x",
    });
    expect(by("READ_TOKEN")).toMatchObject({
      type: "secret_text",
      text: "read_y",
    });
  });

  it("turns on the workers.dev address for one Worker", async () => {
    const { api, calls } = await fake({
      "POST /accounts/a1/workers/scripts/calico-relay/subdomain": ok({
        enabled: true,
      }),
    });
    await api.enableSubdomain("a1", "calico-relay");
    expect(JSON.parse(calls[0]?.body.toString("utf8") ?? "{}")).toEqual({
      enabled: true,
      previews_enabled: false,
    });
  });

  it("deletes a Worker, forcing past its Durable Object", async () => {
    const { api, calls } = await fake({
      "DELETE /accounts/a1/workers/scripts/calico-relay": ok(null),
    });
    await api.deleteWorker("a1", "calico-relay");
    expect(calls[0]?.path).toContain("force=true");
  });

  it("counts a Worker that is already gone as deleted", async () => {
    const { api } = await fake({
      "DELETE /accounts/a1/workers/scripts/calico-relay": {
        status: 404,
        body: { success: false, errors: [{ message: "not found" }] },
      },
    });
    await expect(
      api.deleteWorker("a1", "calico-relay"),
    ).resolves.toBeUndefined();
  });

  it("raises Cloudflare's own words, and never the token", async () => {
    const { api } = await fake({
      "GET /accounts": {
        status: 403,
        body: {
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
        },
      },
    });
    const err = await api.accounts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudflareError);
    expect((err as CloudflareError).status).toBe(403);
    expect((err as CloudflareError).message).toContain("Authentication error");
    expect((err as CloudflareError).message).not.toContain("tok-secret");
  });

  it("raises a plain error when Cloudflare cannot be reached", async () => {
    const api = new CloudflareApi("t", "http://127.0.0.1:1");
    await expect(api.accounts()).rejects.toMatchObject({ status: 0 });
  });
});
