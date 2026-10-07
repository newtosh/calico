import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { defaultConfig, type CalicoConfig } from "../../src/server/config";
import { createCompanionServer } from "../../src/server/http";
import { DeskStore } from "../../src/server/store";

interface Step {
  method: string;
  path: string;
  auth?: boolean;
  headers?: Record<string, string>;
  json?: unknown;
  body_b64?: string;
}
interface Recorded {
  step: Step;
  status: number;
  content_type: string;
  cors: string[];
  json?: unknown;
  body_b64?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalize(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v, k)]),
    );
  }
  if (typeof value === "string" && (key === "at" || key === "updated_at"))
    return "<ts>";
  if (typeof value === "string" && key === "id" && UUID.test(value))
    return "<uuid>";
  return value;
}

async function replay(
  base: string,
  step: Step,
): Promise<Omit<Recorded, "step">> {
  const headers: Record<string, string> = { ...(step.headers ?? {}) };
  if (step.auth) headers.Authorization = "Bearer secret";
  let body: string | Buffer | undefined;
  if (step.json !== undefined) {
    body = JSON.stringify(step.json);
    headers["Content-Type"] ??= "application/json";
  } else if (step.body_b64 !== undefined) {
    body = Buffer.from(step.body_b64, "base64");
  }
  const res = await fetch(base + step.path, {
    method: step.method,
    headers,
    body,
  });
  const contentType = res.headers.get("content-type") ?? "";
  const cors = [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
  ].map((h) => res.headers.get(h) ?? "");
  const raw = Buffer.from(await res.arrayBuffer());
  const out: Omit<Recorded, "step"> = {
    status: res.status,
    content_type: contentType,
    cors,
  };
  if (contentType.startsWith("application/json"))
    out.json = JSON.parse(raw.toString("utf8"));
  else if (raw.length) out.body_b64 = raw.toString("base64");
  return out;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/companion.json", import.meta.url), "utf8"),
) as {
  steps: Recorded[];
};

describe("frozen HTTP contract", () => {
  it("matches the Python companion step for step, including key order", async () => {
    let config: CalicoConfig = { ...defaultConfig(), webhook_token: "secret" };
    const { server } = createCompanionServer({
      store: new DeskStore(),
      getConfig: () => config,
      setConfig: (next) => {
        config = next;
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const [index, recorded] of fixture.steps.entries()) {
        const { step, ...expected } = recorded;
        const actual = await replay(base, step);
        expect(
          `${index} ${step.method} ${step.path} ${JSON.stringify(normalize(actual))}`,
        ).toBe(
          `${index} ${step.method} ${step.path} ${JSON.stringify(normalize(expected))}`,
        );
      }
    } finally {
      server.close();
    }
  });
});
