import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("launches, serves status, and renders the dashboard", async () => {
  const userData = mkdtempSync(join(tmpdir(), "calico-e2e-"));
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, CALICO_USER_DATA: userData },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("navigation", { name: "Views" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
    // The e2e tsconfig has no DOM types, so reach the bridge through globalThis.
    const info = await page.evaluate(() =>
      (
        globalThis as unknown as {
          calico: { info(): Promise<{ serverUrl: string | null }> };
        }
      ).calico.info(),
    );
    expect(info.serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const status = await (await fetch(`${info.serverUrl}/api/status`)).json();
    expect(status.phase).toBe("idle");
  } finally {
    await app.close();
  }
});
