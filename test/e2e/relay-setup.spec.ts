import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";

/** A stand-in for dash.cloudflare.com, the Cloudflare API, and the new Worker. */
async function fakeCloudflare(refuseUpload = false) {
  const calls: string[] = [];
  let secrets = "";
  const body = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c: Buffer) => (data += c.toString("latin1")));
      req.on("end", () => resolve(data));
    });
  const server = createServer((req, res) => {
    void body(req).then((text) => {
      const url = new URL(req.url ?? "/", "http://x");
      const key = `${req.method} ${url.pathname}`;
      calls.push(key);
      const ok = (result: unknown) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ success: true, result }));
      if (key === "GET /oauth2/auth") {
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", "code-1");
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        res.writeHead(302, { location: back.toString() }).end();
      } else if (key === "POST /oauth2/token")
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      else if (key === "POST /oauth2/revoke") res.writeHead(200).end("{}");
      else if (key === "GET /api/accounts") ok([{ id: "a1", name: "Me" }]);
      else if (key === "GET /api/accounts/a1/workers/subdomain")
        ok({ subdomain: "me" });
      else if (key === "GET /api/accounts/a1/workers/scripts") ok([]);
      else if (key === "PUT /api/accounts/a1/workers/scripts/calico-relay") {
        if (refuseUpload)
          res.writeHead(403, { "content-type": "application/json" }).end(
            JSON.stringify({
              success: false,
              errors: [{ message: "Authentication error" }],
            }),
          );
        else {
          secrets = text;
          ok({});
        }
      } else if (
        key === "POST /api/accounts/a1/workers/scripts/calico-relay/subdomain"
      )
        ok({});
      else if (key === "DELETE /api/accounts/a1/workers/scripts/calico-relay")
        ok(null);
      else if (key === "GET /inbox/json")
        res
          .writeHead(
            /^Bearer read_/.test(req.headers.authorization ?? "") ? 200 : 403,
          )
          .end();
      else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, secrets: () => secrets, close: () => server.close() };
}

async function launch(base: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ["out/main/index.js"],
    env: {
      ...process.env,
      CALICO_USER_DATA: mkdtempSync(join(tmpdir(), "calico-e2e-setup-")),
      CALICO_FIRMWARE_CHECK: "0",
      CALICO_CF_AUTH_URL: `${base}/oauth2/auth`,
      CALICO_CF_TOKEN_URL: `${base}/oauth2/token`,
      CALICO_CF_REVOKE_URL: `${base}/oauth2/revoke`,
      CALICO_CF_API_URL: `${base}/api`,
      CALICO_CF_WORKERS_ORIGIN: base,
    },
  });
}

/** The real browser would follow Cloudflare's redirect back to calico. Do that without opening one. */
async function standInForBrowser(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      void fetch(url);
    };
  });
}

test("sets up a relay with Cloudflare, ends on a result, and returns to Settings connected", async () => {
  test.setTimeout(90_000);
  const cf = await fakeCloudflare();
  const app = await launch(cf.base);
  try {
    await standInForBrowser(app);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Connectivity" }).click();
    await page.getByRole("button", { name: /Set up with Cloudflare/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Workers Admin/)).toBeVisible();
    await dialog.getByRole("button", { name: /Continue in browser/ }).click();
    await expect(dialog.getByText("Your relay is on")).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByRole("button", { name: /Copy for Grok Bot/ }).click();
    await expect(dialog.getByText("Copied.")).toBeVisible();
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(clip).toMatch(/Send token: send_[0-9a-f]{48}/);
    expect(clip).toMatch(/User-Agent/);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(cf.base + "/inbox")).toBeVisible();
    expect(cf.calls).toContain("POST /oauth2/revoke");
    expect(cf.calls).not.toContain(
      "DELETE /api/accounts/a1/workers/scripts/calico-relay",
    );
    // The window never held a token.
    expect(await page.content()).not.toMatch(
      /send_[0-9a-f]{48}|read_[0-9a-f]{48}/,
    );
  } finally {
    await app.close();
    cf.close();
  }
});

test("a refused upload says what failed, leaves nothing behind, and returns to Not set up", async () => {
  test.setTimeout(90_000);
  const cf = await fakeCloudflare(true);
  const app = await launch(cf.base);
  try {
    await standInForBrowser(app);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Connectivity" }).click();
    await page.getByRole("button", { name: /Set up with Cloudflare/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Continue in browser/ }).click();
    await expect(dialog.getByText(/Authentication error/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      dialog.getByText(/Nothing is left in your account/),
    ).toBeVisible();
    expect(cf.calls).toContain("POST /oauth2/revoke");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(
      page.getByRole("button", { name: /Set up with Cloudflare/ }),
    ).toBeVisible();
  } finally {
    await app.close();
    cf.close();
  }
});
