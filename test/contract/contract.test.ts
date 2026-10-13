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

// Where calico deliberately says more than the Python companion did. The recording stays
// exactly as captured, so it is still the Python companion's word. A divergence is matched by
// the whole request (method, path, body) and status, not by position, so a regenerated
// fixture cannot let a different request through, and each one must be used exactly once.
const KNOWN_DIVERGENCES = [
  {
    // A token-only panel push says a URL is needed, where Python said "bad panel".
    method: "PUT",
    path: "/api/panel",
    body: { token: "t" },
    status: 400,
    json: { error: "a panel URL is required" },
  },
];

describe("frozen HTTP contract", () => {
  it("matches the Python companion step for step, including key order", async () => {
    let config: CalicoConfig = { ...defaultConfig(), webhook_token: "secret" };
    const { server } = createCompanionServer({
      // The capture ran inside one second, so every timestamp ties. A real
      // clock can cross a second boundary mid-run and reorder agents.
      store: new DeskStore({ now: () => new Date("2026-01-01T00:00:00Z") }),
      getConfig: () => config,
      setConfig: (next) => {
        config = next;
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const used = new Set<(typeof KNOWN_DIVERGENCES)[number]>();
    try {
      for (const [index, recorded] of fixture.steps.entries()) {
        const { step, ...recordedResponse } = recorded;
        const divergence = KNOWN_DIVERGENCES.find(
          (d) =>
            d.method === step.method &&
            d.path === step.path &&
            d.status === recordedResponse.status &&
            JSON.stringify(d.body) === JSON.stringify(step.json),
        );
        if (divergence) used.add(divergence);
        const expected = divergence
          ? { ...recordedResponse, json: divergence.json }
          : recordedResponse;
        const actual = await replay(base, step);
        expect(
          `${index} ${step.method} ${step.path} ${JSON.stringify(normalize(actual))}`,
        ).toBe(
          `${index} ${step.method} ${step.path} ${JSON.stringify(normalize(expected))}`,
        );
      }
      // A divergence nobody hit is a stale one: fail so it gets removed.
      expect(used.size).toBe(KNOWN_DIVERGENCES.length);
    } finally {
      server.close();
    }
  });
});
