import { mkdtempSync, readFileSync } from "node:fs";
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
    const status = (await (
      await fetch(`${info.serverUrl}/api/status`)
    ).json()) as { phase: string };
    expect(status.phase).toBe("idle");
    // The renderer must reach the server itself, not just render its shell.
    await fetch(`${info.serverUrl}/api/webhook/grok-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent.launched",
        agent_id: "smoke",
        title: "Smoke agent",
      }),
    });
    await expect(page.getByText("Smoke agent").first()).toBeVisible();
    // The source toggle narrows to Cursor, where this Grok Bot agent is absent.
    await expect(
      page.getByRole("radiogroup", { name: "Show agents from" }),
    ).toBeVisible();
    await page.getByRole("radio", { name: /^Cursor/ }).click();
    await expect(page.getByText(/No Cursor agents yet/)).toBeVisible();
    await page.getByRole("radio", { name: /^Combined/ }).click();
    await expect(page.getByText("Smoke agent").first()).toBeVisible();
    // Settings shows this release's version, not Electron's.
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText(`Calico ${version}`)).toBeVisible();

    // Saving a new port takes effect on restart. The panel is still pointed at
    // the port calico is on, so the drift banner must stay away.
    // Settings fills the field when its first load lands. Typing before that
    // gets overwritten and the save becomes a no-op.
    await expect(page.getByLabel("Port")).not.toHaveValue("");
    await page.getByLabel("Port").fill("9001");
    await page
      .getByRole("button", { name: "Save", exact: true })
      .first()
      .click();
    await expect(page.getByText(/Saved\. Quit and reopen/)).toBeVisible();
    // Two polls of the info bridge (2 s each), so a banner would have shown.
    await page.waitForTimeout(4500);
    await expect(page.getByText(/The panel is set to port/)).toHaveCount(0);

    // Permission requests are denied unless the app asked for them.
    const notifications = await page.evaluate(() =>
      (
        globalThis as unknown as {
          Notification: { requestPermission(): Promise<string> };
        }
      ).Notification.requestPermission(),
    );
    expect(notifications).toBe("denied");
  } finally {
    await app.close();
  }
});
