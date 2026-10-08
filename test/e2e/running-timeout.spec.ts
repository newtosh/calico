import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("the running timeout applies live, in both directions", async () => {
  test.setTimeout(90_000);
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: {
      ...process.env,
      CALICO_USER_DATA: mkdtempSync(join(tmpdir(), "calico-e2e-ttl-")),
    },
  });
  try {
    const page = await app.firstWindow();
    // The e2e tsconfig has no DOM types, so reach the bridge through globalThis.
    const info = await page.evaluate(() =>
      (
        globalThis as unknown as {
          calico: { info(): Promise<{ serverUrl: string }> };
        }
      ).calico.info(),
    );
    const api = (path: string, init?: RequestInit) =>
      fetch(info.serverUrl + path, init);
    const json = { "Content-Type": "application/json" };
    const status = async () =>
      (
        (await (await api("/api/status")).json()) as {
          agents: { id: string; status: string }[];
        }
      ).agents.find((a) => a.id === "slow-routine")?.status;

    // The shortest allowed timeout, so the agent ages out in about 30 seconds.
    await api("/api/config", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ running_timeout_seconds: 30 }),
    });
    await api("/api/webhook/grok-bot", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        type: "agent.launched",
        agent_id: "slow-routine",
        title: "Slow routine",
      }),
    });
    expect(await status()).toBe("running");
    await page.waitForTimeout(32_000);
    expect(await status()).toBe("idle");

    // A longer timeout takes effect at once, with no restart and no new ping.
    await api("/api/config", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ running_timeout_seconds: 600 }),
    });
    expect(await status()).toBe("running");
  } finally {
    await app.close();
  }
});
