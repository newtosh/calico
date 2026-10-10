import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("collects what agents sent while calico was away, with the time they sent it", async () => {
  test.setTimeout(90_000);
  const hoursAgo = (h: number) => Math.floor(Date.now() / 1000) - h * 3600;
  const message = (id: string, time: number, body: object) =>
    JSON.stringify({
      id,
      time,
      event: "message",
      topic: "inbox",
      message: JSON.stringify(body),
    });
  const seen: string[] = [];
  const relay = createServer((req, res) => {
    seen.push(`${req.headers.authorization} ${req.url}`);
    if (req.headers.authorization !== "Bearer read-tok") {
      res.writeHead(403).end();
      return;
    }
    res
      .writeHead(200, {
        "x-relay-requests-today": "5",
        "x-relay-budget": "60000",
      })
      .end(
        [
          message("1", hoursAgo(3), {
            type: "agent.launched",
            agent_id: "old-run",
          }),
          message("2", hoursAgo(1), {
            type: "agent.needs_you",
            agent_id: "asker",
            message: "Pick one",
          }),
        ].join("\n") + "\n",
      );
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const port = (relay.address() as AddressInfo).port;
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: {
      ...process.env,
      CALICO_USER_DATA: mkdtempSync(join(tmpdir(), "calico-e2e-relay-")),
    },
  });
  try {
    const page = await app.firstWindow();
    const info = await page.evaluate(() =>
      (
        globalThis as unknown as {
          calico: { info(): Promise<{ serverUrl: string }> };
        }
      ).calico.info(),
    );
    const api = (path: string, init?: RequestInit) =>
      fetch(info.serverUrl + path, init);
    await api("/api/relay", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `http://127.0.0.1:${port}/inbox`,
        token: "read-tok",
      }),
    });
    await expect
      .poll(
        async () =>
          (
            (await (await api("/api/status")).json()) as {
              agents: { id: string; status: string }[];
            }
          ).agents.map((a) => `${a.id}:${a.status}`),
        { timeout: 40_000 },
      )
      .toEqual(["asker:needs_you", "old-run:idle"]);
    const shown = (await (await api("/api/relay")).json()) as {
      status: { ok: boolean; applied: number; used: number };
    };
    expect(shown.status).toMatchObject({ ok: true, applied: 2, used: 5 });
    expect(seen[0]).toBe("Bearer read-tok /inbox/json?poll=1&since=all");
    // The saved cursor means the next read asks only for what is new.
    await expect
      .poll(() => seen.length, { timeout: 40_000 })
      .toBeGreaterThan(1);
    expect(seen[1]).toContain("since=2");
  } finally {
    await app.close();
    relay.close();
  }
});
