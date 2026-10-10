// Starts the real Worker in a local workerd through `wrangler dev`, so the tests
// run against the same runtime Cloudflare uses, including Durable Object SQLite.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function newState() {
  return mkdtempSync(join(tmpdir(), "calico-relay-"));
}

export function dropState(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** `vars` are passed as --var, so a variable left out is genuinely unset. */
export async function startRelay({ state, vars }) {
  const port = await freePort();
  const args = ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", state];
  for (const [key, value] of Object.entries(vars)) args.push("--var", `${key}:${value}`);
  const child = spawn("npx", args, { cwd: ROOT, detached: true, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    // wrangler starts workerd as a child, so end the whole group.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    await sleep(1500);
  };
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/v1/health`)).status === 200) return { base, stop };
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  await stop();
  throw new Error("the relay did not start within 60 s");
}
