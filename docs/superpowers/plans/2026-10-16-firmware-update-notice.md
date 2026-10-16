# Firmware Update Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calico checks GitHub's public releases list for a newer panel firmware, compares it with the panel's firmware, and shows a banner and a Panel page line. It never changes the panel.

**Architecture:** A main-process module fetches and validates the newest `fw-v*` release and its `firmware.json`. A small watcher persists the result in the profile, schedules a check on launch and every 12 hours, and computes one `FirmwareInfo` for `CalicoInfo`. The window only draws it. Task 7 (separable) makes the panel report its version in its status poll so Calico needs no Bluetooth connection to know it.

**Tech Stack:** TypeScript, Electron 44 main process, React 19, Vitest, ESP-IDF C for Task 7.

**Spec:** `docs/superpowers/specs/2026-10-16-firmware-update-notice-design.md`

## Global Constraints

- One unauthenticated `GET https://api.github.com/repos/newtosh/calico/releases?per_page=30` with `Accept: application/vnd.github+json` and `User-Agent: Calico/<version>`. Nothing about the person or the panel is sent. Then one `GET` of that release's `firmware.json`.
- Keep only releases that are not drafts, not pre-releases, with a tag matching `^fw-v(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$` and a `firmware.json` asset. Take the highest by semver, never by date.
- Manifest checks: `version` equals the tag's version; `min_app` is `X.Y.Z`; `artifact` is exactly `ginger-<version>-app.bin`; `sha256` is 64 lowercase hex; `size` is an integer from 1 to 8 MiB; `notes_url` is exactly `https://github.com/newtosh/calico/releases/tag/fw-v<version>`.
- Limits: 10 s timeout, 1 MiB for the list, 16 KiB for the manifest, `https` only, final host `github.com`, `api.github.com` or `*.githubusercontent.com`.
- Schedule: about 10 s after launch, then every 12 hours while Calico runs. The off switch (default on) stops scheduled checks. **Check now** always works. Turning the switch on starts a check.
- A failed check is silent in the banner and never clears a known update. The last good result and its time are saved.
- A panel `fw` that is not `X.Y.Z` (a git hash, `unknown`) counts as older than every release, never "current".
- `MIN_FIRMWARE` is `0.2.0`. Status values: `unknown`, `current`, `available`, `needs_calico`.
- State lives in `firmware.json` in the profile, written by main only, not in `config.json` (`config.json` is the server's file with a contract test and a PUT API; these are window preferences).
- Words: "Calico" is the desktop app, "the panel" is the hardware (`docs/terminology.md`). A test (`test/terminology.test.ts`) guards this.
- No wireless updates, no download or flashing, nothing sent to the panel in Tasks 1 to 6. Minimize em-dashes. No Claude session links in PR bodies.

## Review Focus

- A list with `fw-v0.10.0`, `fw-v0.9.0`, an `app-v` release, a draft, a pre-release and a newer-dated lower version must pick `0.10.0` (numeric order, not text or date). (Task 2)
- A manifest whose `notes_url` points anywhere else, uses another scheme, or carries a different version must be refused. (Task 2)
- Offline, a 403 rate limit, a bad manifest and a redirect to another host must leave the last good result and show no error banner. (Tasks 2, 3)
- A panel on a git hash or `unknown` is never "current". A panel newer than the latest release is "current". (Task 3)
- With the switch off, no scheduled traffic. **Check now** still works. Turning it on checks. (Task 3)

## File Structure

- Create `src/shared/semver.ts`, `src/shared/firmware.ts`: version parse and compare, constants.
- Create `src/main/firmware-releases.ts`: list, pick, fetch, validate.
- Create `src/main/firmware-state.ts`: the file, the status function, `FirmwareWatch`.
- Modify `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`: the types, four IPC channels, wiring.
- Create `src/renderer/src/lib/firmware.ts`, `src/renderer/src/shell/FirmwareBanner.tsx`, `src/renderer/src/device/PanelFirmware.tsx`, `src/renderer/src/settings/FirmwareSection.tsx`; modify `App.tsx`, `DeviceView.tsx`, `LinkActions.tsx`, `SettingsView.tsx`.
- Tests beside each. Docs: `README.md`, `docs/review-rules.md`.
- Task 7: `src/server/panel-firmware.ts`, `src/server/http.ts`, `firmware/main/power.c`, `firmware/main/power.h`, `firmware/main/net.c`, `firmware/host/test_power.c`.

---

### Task 1: Versions and constants

**Files:**

- Create: `src/shared/semver.ts`, `src/shared/firmware.ts`
- Test: `test/shared/semver.test.ts`

**Interfaces:**

- Produces: `parseSemver(value: unknown): [number, number, number] | null`, `isSemver(value: unknown): value is string`, `compareSemver(a: string, b: string): -1 | 0 | 1` (throws `RangeError` on a non-semver), and constants `FIRMWARE_REPO`, `MIN_FIRMWARE`, `FIRMWARE_TAG`, `CHECK_DELAY_MS`, `CHECK_EVERY_MS`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compareSemver, isSemver, parseSemver } from "../../src/shared/semver";

describe("semver", () => {
  it("parses plain X.Y.Z only", () => {
    expect(parseSemver("0.2.0")).toEqual([0, 2, 0]);
    expect(parseSemver("10.20.30")).toEqual([10, 20, 30]);
    for (const bad of [
      "0.2",
      "v0.2.0",
      "0.2.0-rc1",
      "01.2.3",
      "0.2.0\n",
      " 0.2.0",
      "1.2.3.4",
      "٣.٢.٠",
      "9999999.0.0",
      "886dd11",
      "unknown",
      "",
      null,
      42,
    ])
      expect(parseSemver(bad)).toBeNull();
    expect(isSemver("1.0.0")).toBe(true);
    expect(isSemver("1.0")).toBe(false);
  });

  it("compares numerically, not as text", () => {
    expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
    expect(compareSemver("0.9.0", "0.10.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.2.1", "0.2.0")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
  });

  it("refuses to compare something that is not a version", () => {
    expect(() => compareSemver("886dd11", "0.2.0")).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run test/shared/semver.test.ts`
Expected: FAIL, cannot find `../../src/shared/semver`.

- [ ] **Step 3: Implement**

`src/shared/semver.ts`:

```ts
const PART = /^(0|[1-9]\d{0,5})$/;

export type Semver = [number, number, number];

/** Plain X.Y.Z, ASCII digits, no leading zeros, each part under a million. Anything else is null. */
export function parseSemver(value: unknown): Semver | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every((p) => PART.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

export const isSemver = (value: unknown): value is string =>
  parseSemver(value) !== null;

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new RangeError("compareSemver needs two X.Y.Z versions");
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
```

`src/shared/firmware.ts`:

```ts
/** Where firmware releases are published. */
export const FIRMWARE_REPO = "newtosh/calico";
/** The first versioned panel firmware. A panel below it is out of date whatever is released. */
export const MIN_FIRMWARE = "0.2.0";
export const FIRMWARE_TAG =
  /^fw-v(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
/** The first check waits so startup never does. */
export const CHECK_DELAY_MS = 10_000;
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm vitest run test/shared/semver.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/semver.ts src/shared/firmware.ts test/shared/semver.test.ts
git commit -m "Add strict version parsing and the firmware constants"
```

---

### Task 2: Find the newest firmware release

**Files:**

- Create: `src/main/firmware-releases.ts`
- Modify: `src/shared/ipc.ts` (add `FirmwareRelease` only; the rest of the types come in Task 4)
- Test: `test/main/firmware-releases.test.ts`

**Interfaces:**

- Consumes: `FIRMWARE_REPO`, `FIRMWARE_TAG` (Task 1), `compareSemver`, `isSemver`.
- Produces: `interface FirmwareRelease { version: string; minApp: string; notesUrl: string }` (in `src/shared/ipc.ts`), `pickRelease(list: unknown): { tag: string; version: string } | null`, `validateManifest(raw: unknown, version: string): FirmwareRelease | null`, `type CheckResult = { ok: true; release: FirmwareRelease } | { ok: false; error: string }`, `fetchLatestFirmware(fetchFn: typeof fetch, calicoVersion: string): Promise<CheckResult>`, `RELEASES_URL`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  fetchLatestFirmware,
  pickRelease,
  RELEASES_URL,
  validateManifest,
} from "../../src/main/firmware-releases";

const asset = (name: string) => ({ name, browser_download_url: "x" });
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: "2026-10-01T00:00:00Z",
  assets: [asset("firmware.json")],
  ...extra,
});

const good = (version = "0.3.0") => ({
  version,
  min_app: "0.1.13",
  artifact: `ginger-${version}-app.bin`,
  sha256: "a".repeat(64),
  size: 1_926_272,
  notes_url: `https://github.com/newtosh/calico/releases/tag/fw-v${version}`,
});

describe("pickRelease", () => {
  it("takes the highest version by number, not by text or date", () => {
    const list = [
      rel("fw-v0.9.0", { published_at: "2026-12-01T00:00:00Z" }),
      rel("fw-v0.10.0", { published_at: "2026-01-01T00:00:00Z" }),
      rel("app-v0.1.15"),
      rel("fw-v0.11.0", { draft: true }),
      rel("fw-v0.12.0", { prerelease: true }),
      rel("fw-v0.13.0-rc1"),
      rel("fw-v0.14.0", { assets: [asset("ginger-0.14.0-app.bin")] }),
    ];
    expect(pickRelease(list)).toEqual({ tag: "fw-v0.10.0", version: "0.10.0" });
  });

  it("returns null for anything that is not a list of firmware releases", () => {
    expect(pickRelease(null)).toBeNull();
    expect(pickRelease({})).toBeNull();
    expect(pickRelease([])).toBeNull();
    expect(pickRelease([rel("app-v0.1.15"), "x", null, 3])).toBeNull();
    expect(pickRelease([{ tag_name: "fw-v1.0.0" }])).toBeNull();
  });

  it("refuses huge version numbers", () => {
    expect(pickRelease([rel("fw-v9999999.0.0")])).toBeNull();
  });
});

describe("validateManifest", () => {
  it("accepts the published shape and keeps only what the window needs", () => {
    expect(validateManifest(good(), "0.3.0")).toEqual({
      version: "0.3.0",
      minApp: "0.1.13",
      notesUrl: "https://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
    });
  });

  it.each([
    ["a different version", { version: "0.3.1" }],
    ["a bad min_app", { min_app: "0.1" }],
    ["another artifact", { artifact: "evil.bin" }],
    ["a short hash", { sha256: "abc" }],
    ["an uppercase hash", { sha256: "A".repeat(64) }],
    ["a zero size", { size: 0 }],
    ["an oversized image", { size: 9 * 1024 * 1024 }],
    ["a fractional size", { size: 1.5 }],
    ["another notes host", { notes_url: "https://evil.example/fw-v0.3.0" }],
    ["a javascript notes url", { notes_url: "javascript:alert(1)" }],
    [
      "notes for another version",
      { notes_url: "https://github.com/newtosh/calico/releases/tag/fw-v0.2.0" },
    ],
  ])("refuses %s", (_name, patch) => {
    expect(validateManifest({ ...good(), ...patch }, "0.3.0")).toBeNull();
  });

  it("refuses a manifest that is not an object", () => {
    for (const bad of [null, [], "x", 1])
      expect(validateManifest(bad, "0.3.0")).toBeNull();
  });
});

function reply(body: unknown, url: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("fetchLatestFirmware", () => {
  const manifestUrl = (tag: string) =>
    `https://github.com/newtosh/calico/releases/download/${tag}/firmware.json`;

  it("lists releases, then fetches the manifest of the best one", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === RELEASES_URL) return reply([rel("fw-v0.3.0")], u);
      return reply(good(), u);
    });
    const out = await fetchLatestFirmware(fetchFn as typeof fetch, "0.1.15");
    expect(out).toEqual({
      ok: true,
      release: {
        version: "0.3.0",
        minApp: "0.1.13",
        notesUrl: "https://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
      },
    });
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Calico/0.1.15",
      },
    });
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe(manifestUrl("fw-v0.3.0"));
    // Nothing else goes out: no token, no cookies, no body.
    for (const [, init] of fetchFn.mock.calls) {
      expect(JSON.stringify(init)).not.toMatch(/authorization|cookie|body/i);
    }
  });

  it.each([
    [
      "offline",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["a rate limit", async (u: string) => reply("{}", u, 403)],
    ["a server error", async (u: string) => reply("{}", u, 500)],
    ["bad JSON", async (u: string) => reply("not json", u)],
  ])("fails quietly on %s", async (_name, impl) => {
    const out = await fetchLatestFirmware(
      impl as unknown as typeof fetch,
      "0.1.15",
    );
    expect(out.ok).toBe(false);
  });

  it("fails when the list has no firmware release", async () => {
    const f = async (u: string | URL | Request) =>
      reply([rel("app-v0.1.15")], String(u));
    const out = await fetchLatestFirmware(f as typeof fetch, "0.1.15");
    expect(out).toEqual({ ok: false, error: "no firmware release found" });
  });

  it("fails on an invalid manifest", async () => {
    const f = async (u: string | URL | Request) =>
      String(u) === RELEASES_URL
        ? reply([rel("fw-v0.3.0")], String(u))
        : reply({ ...good(), notes_url: "https://evil.example" }, String(u));
    const out = await fetchLatestFirmware(f as typeof fetch, "0.1.15");
    expect(out.ok).toBe(false);
  });

  it("refuses a redirect to another host or to plain http", async () => {
    for (const final of [
      "https://evil.example/x.json",
      "http://github.com/x.json",
    ]) {
      const f = async (u: string | URL | Request) =>
        String(u) === RELEASES_URL
          ? reply([rel("fw-v0.3.0")], String(u))
          : reply(good(), final);
      expect((await fetchLatestFirmware(f as typeof fetch, "0.1.15")).ok).toBe(
        false,
      );
    }
  });

  it("refuses an oversized list or manifest", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const f = async (u: string | URL | Request) => reply(big, String(u));
    expect((await fetchLatestFirmware(f as typeof fetch, "0.1.15")).ok).toBe(
      false,
    );
    const g = async (u: string | URL | Request) =>
      String(u) === RELEASES_URL
        ? reply([rel("fw-v0.3.0")], String(u))
        : reply("x".repeat(16 * 1024 + 1), String(u));
    expect((await fetchLatestFirmware(g as typeof fetch, "0.1.15")).ok).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run test/main/firmware-releases.test.ts`
Expected: FAIL, cannot find the module.

- [ ] **Step 3: Implement**

Add to `src/shared/ipc.ts` (near the other panel types):

```ts
/** What Calico keeps of a firmware release: the version, the oldest Calico it needs, its notes page. */
export interface FirmwareRelease {
  version: string;
  minApp: string;
  notesUrl: string;
}
```

`src/main/firmware-releases.ts`:

```ts
import { FIRMWARE_REPO, FIRMWARE_TAG } from "../shared/firmware";
import type { FirmwareRelease } from "../shared/ipc";
import { compareSemver, isSemver } from "../shared/semver";

export const RELEASES_URL = `https://api.github.com/repos/${FIRMWARE_REPO}/releases?per_page=30`;
const LIST_MAX = 1024 * 1024;
const MANIFEST_MAX = 16 * 1024;
const IMAGE_MAX = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const HOSTS =
  /^(github\.com|api\.github\.com|[a-z0-9-]+\.githubusercontent\.com)$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type CheckResult =
  { ok: true; release: FirmwareRelease } | { ok: false; error: string };

/** The highest firmware release by version number. Drafts, pre-releases and look-alike tags never count. */
export function pickRelease(
  list: unknown,
): { tag: string; version: string } | null {
  if (!Array.isArray(list)) return null;
  let best: { tag: string; version: string } | null = null;
  for (const item of list as unknown[]) {
    if (!isObject(item) || item.draft !== false || item.prerelease !== false)
      continue;
    const tag = item.tag_name;
    const m = typeof tag === "string" ? FIRMWARE_TAG.exec(tag) : null;
    if (!m || typeof tag !== "string") continue;
    const assets = Array.isArray(item.assets) ? (item.assets as unknown[]) : [];
    if (!assets.some((a) => isObject(a) && a.name === "firmware.json"))
      continue;
    const version = `${m[1]}.${m[2]}.${m[3]}`;
    if (!best || compareSemver(version, best.version) > 0)
      best = { tag, version };
  }
  return best;
}

/** Only fields that pass are kept. A manifest is data to show, never something to run. */
export function validateManifest(
  raw: unknown,
  version: string,
): FirmwareRelease | null {
  if (!isObject(raw)) return null;
  const notesUrl = `https://github.com/${FIRMWARE_REPO}/releases/tag/fw-v${version}`;
  const size = raw.size;
  if (
    raw.version !== version ||
    !isSemver(raw.min_app) ||
    raw.artifact !== `ginger-${version}-app.bin` ||
    typeof raw.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(raw.sha256) ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > IMAGE_MAX ||
    raw.notes_url !== notesUrl
  )
    return null;
  return { version, minApp: raw.min_app, notesUrl };
}

async function getText(
  fetchFn: typeof fetch,
  url: string,
  accept: string,
  max: number,
  agent: string,
): Promise<string> {
  const res = await fetchFn(url, {
    headers: { Accept: accept, "User-Agent": agent },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const final = new URL(res.url || url);
  if (final.protocol !== "https:" || !HOSTS.test(final.hostname))
    throw new Error("the answer came from an unexpected address");
  const text = await res.text();
  if (text.length > max) throw new Error("the answer was too large");
  return text;
}

export async function fetchLatestFirmware(
  fetchFn: typeof fetch,
  calicoVersion: string,
): Promise<CheckResult> {
  const agent = `Calico/${calicoVersion}`;
  try {
    const list: unknown = JSON.parse(
      await getText(
        fetchFn,
        RELEASES_URL,
        "application/vnd.github+json",
        LIST_MAX,
        agent,
      ),
    );
    const picked = pickRelease(list);
    if (!picked) return { ok: false, error: "no firmware release found" };
    const url = `https://github.com/${FIRMWARE_REPO}/releases/download/${picked.tag}/firmware.json`;
    const raw: unknown = JSON.parse(
      await getText(fetchFn, url, "application/json", MANIFEST_MAX, agent),
    );
    const release = validateManifest(raw, picked.version);
    return release
      ? { ok: true, release }
      : { ok: false, error: "the release manifest is not valid" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "the check failed",
    };
  }
}
```

- [ ] **Step 4: Run it, then typecheck and lint**

Run: `pnpm vitest run test/main/firmware-releases.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. Run `npx prettier --write` on the two new files first if lint complains.

- [ ] **Step 5: Commit**

```bash
git add src/main/firmware-releases.ts src/shared/ipc.ts test/main/firmware-releases.test.ts
git commit -m "Find and validate the newest panel firmware release"
```

---

### Task 3: The watcher: state, status, schedule

**Files:**

- Create: `src/main/firmware-state.ts`
- Modify: `src/shared/ipc.ts` (add `FirmwareStatus` and `FirmwareInfo`)
- Test: `test/main/firmware-state.test.ts`

**Interfaces:**

- Consumes: `fetchLatestFirmware`'s `CheckResult` (Task 2), `compareSemver`, `isSemver`, `MIN_FIRMWARE`, `CHECK_DELAY_MS`, `CHECK_EVERY_MS`, `writeAtomic` from `../server/state-file`.
- Produces: in `src/shared/ipc.ts` `type FirmwareStatus = "unknown" | "current" | "available" | "needs_calico"` and `interface FirmwareInfo { status: FirmwareStatus; panel: string | null; latest: FirmwareRelease | null; checkedAt: number | null; lastError: string; check: boolean; dismissed: boolean; belowMinimum: boolean }`; in `firmware-state.ts` `interface FirmwareFile`, `loadFirmwareFile(path): FirmwareFile`, `saveFirmwareFile(path, file): void`, `firmwareStatus(panel, latest, calicoVersion): { status: FirmwareStatus; belowMinimum: boolean }`, and `class FirmwareWatch` with `start()`, `stop()`, `checkNow(): Promise<CheckResult>`, `setCheck(on: boolean): void`, `dismiss(version: string): void`, `panelSeen(fw: string): void`, `view(polledFw?: string | null): FirmwareInfo`.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FirmwareFile,
  FirmwareWatch,
  firmwareStatus,
  loadFirmwareFile,
  saveFirmwareFile,
} from "../../src/main/firmware-state";
import type { CheckResult } from "../../src/main/firmware-releases";
import { CHECK_DELAY_MS, CHECK_EVERY_MS } from "../../src/shared/firmware";
import type { FirmwareRelease } from "../../src/shared/ipc";

const v030: FirmwareRelease = {
  version: "0.3.0",
  minApp: "0.1.13",
  notesUrl: "https://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
};

describe("firmwareStatus", () => {
  it("is unknown without a release or without a panel version", () => {
    expect(firmwareStatus("0.2.0", null, "0.1.15").status).toBe("unknown");
    expect(firmwareStatus(null, v030, "0.1.15").status).toBe("unknown");
  });

  it("is current at or above the latest, and available below it", () => {
    expect(firmwareStatus("0.3.0", v030, "0.1.15").status).toBe("current");
    expect(firmwareStatus("0.4.0", v030, "0.1.15").status).toBe("current");
    expect(firmwareStatus("0.2.0", v030, "0.1.15").status).toBe("available");
  });

  it("treats a git hash or unknown as older than every release", () => {
    expect(firmwareStatus("886dd11", v030, "0.1.15").status).toBe("available");
    expect(firmwareStatus("unknown", v030, "0.1.15").status).toBe("available");
  });

  it("asks for a newer Calico first when the firmware needs one", () => {
    const needs = { ...v030, minApp: "0.2.0" };
    expect(firmwareStatus("0.2.0", needs, "0.1.15").status).toBe(
      "needs_calico",
    );
    expect(firmwareStatus("0.2.0", needs, "0.2.0").status).toBe("available");
  });

  it("flags a panel below the first versioned firmware, even with nothing released", () => {
    expect(firmwareStatus("886dd11", null, "0.1.15").belowMinimum).toBe(true);
    expect(firmwareStatus("0.1.0", null, "0.1.15").belowMinimum).toBe(true);
    expect(firmwareStatus("0.2.0", null, "0.1.15").belowMinimum).toBe(false);
    expect(firmwareStatus(null, null, "0.1.15").belowMinimum).toBe(false);
  });
});

describe("the saved file", () => {
  it("round-trips, and a damaged or hostile file falls back field by field", () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-"));
    const path = join(dir, "firmware.json");
    const file: FirmwareFile = {
      check: false,
      dismissed: "0.3.0",
      latest: v030,
      checkedAt: 123,
      panel: { fw: "0.2.0", at: 99 },
    };
    saveFirmwareFile(path, file);
    expect(loadFirmwareFile(path)).toEqual(file);
    writeFileSync(path, "not json");
    expect(loadFirmwareFile(path).check).toBe(true);
    writeFileSync(
      path,
      JSON.stringify({
        check: "yes",
        dismissed: 5,
        latest: {
          version: "0.3.0",
          minApp: "x",
          notesUrl: "https://evil.example",
        },
        checkedAt: "now",
        panel: { fw: "<script>", at: -1 },
      }),
    );
    expect(loadFirmwareFile(path)).toEqual({
      check: true,
      dismissed: "",
      latest: null,
      checkedAt: null,
      panel: null,
    });
    expect(loadFirmwareFile(join(dir, "missing.json")).check).toBe(true);
  });

  it("does not throw when it cannot save", () => {
    expect(() =>
      saveFirmwareFile("/nonexistent-dir/x/firmware.json", {
        check: true,
        dismissed: "",
        latest: null,
        checkedAt: null,
        panel: null,
      }),
    ).not.toThrow();
  });
});

describe("FirmwareWatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const empty = (): FirmwareFile => ({
    check: true,
    dismissed: "",
    latest: null,
    checkedAt: null,
    panel: null,
  });

  function make(
    results: CheckResult[],
    file: FirmwareFile = empty(),
    calicoVersion = "0.1.15",
  ) {
    const check = vi.fn(
      async () => results.shift() ?? { ok: false as const, error: "none" },
    );
    const save = vi.fn();
    const watch = new FirmwareWatch({
      file,
      save,
      check,
      now: Date.now,
      calicoVersion,
    });
    return { watch, check, save, file };
  }
  const ok = (release = v030): CheckResult => ({ ok: true, release });

  it("checks once after the launch delay and then every 12 hours", async () => {
    const { watch, check } = make([ok(), ok(), ok()]);
    watch.start();
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(3);
    watch.stop();
  });

  it("never checks on a schedule while the switch is off, but Check now works", async () => {
    const { watch, check } = make([ok()], { ...empty(), check: false });
    watch.start();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(check).not.toHaveBeenCalled();
    expect((await watch.checkNow()).ok).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("turning the switch off stops the schedule, and turning it on checks soon", async () => {
    const { watch, check, save } = make([ok(), ok()]);
    watch.start();
    watch.setCheck(false);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(check).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    watch.setCheck(true);
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it("keeps the last good result, and the time, when a later check fails", async () => {
    vi.setSystemTime(1_000_000);
    const { watch } = make([ok(), { ok: false, error: "GitHub answered 403" }]);
    await watch.checkNow();
    const first = watch.view("0.2.0");
    expect(first.latest).toEqual(v030);
    expect(first.checkedAt).toBe(1_000_000);
    expect(first.status).toBe("available");
    vi.setSystemTime(2_000_000);
    await watch.checkNow();
    const after = watch.view("0.2.0");
    expect(after.latest).toEqual(v030);
    expect(after.checkedAt).toBe(1_000_000);
    expect(after.status).toBe("available");
    expect(after.lastError).toBe("GitHub answered 403");
  });

  it("clears the error after a good check, and does not overlap two checks", async () => {
    const { watch, check } = make([{ ok: false, error: "offline" }, ok()]);
    await watch.checkNow();
    expect(watch.view().lastError).toBe("offline");
    const a = watch.checkNow();
    const b = watch.checkNow();
    await Promise.all([a, b]);
    expect(check).toHaveBeenCalledTimes(2);
    expect(watch.view().lastError).toBe("");
  });

  it("remembers Not now for one version only", async () => {
    const { watch } = make([
      ok(),
      ok({
        ...v030,
        version: "0.3.1",
        notesUrl: v030.notesUrl.replace("0.3.0", "0.3.1"),
      }),
    ]);
    await watch.checkNow();
    expect(watch.view("0.2.0").dismissed).toBe(false);
    watch.dismiss("0.3.0");
    expect(watch.view("0.2.0").dismissed).toBe(true);
    await watch.checkNow();
    expect(watch.view("0.2.0").dismissed).toBe(false);
    watch.dismiss("9.9.9");
    expect(watch.view("0.2.0").dismissed).toBe(false);
  });

  it("learns the panel's firmware from a connection, accepts only sane values, and prefers a live poll", () => {
    vi.setSystemTime(5_000);
    const { watch, save } = make([]);
    watch.panelSeen("0.2.0");
    expect(watch.view().panel).toBe("0.2.0");
    expect(save).toHaveBeenCalledTimes(1);
    watch.panelSeen("0.2.0");
    expect(save).toHaveBeenCalledTimes(1);
    for (const bad of ["", "x".repeat(40), "<script>", "a b"])
      watch.panelSeen(bad);
    expect(watch.view().panel).toBe("0.2.0");
    expect(watch.view("0.2.1").panel).toBe("0.2.1");
  });

  it("reports the whole picture in view()", async () => {
    const { watch } = make([ok()]);
    await watch.checkNow();
    expect(watch.view("886dd11")).toMatchObject({
      status: "available",
      belowMinimum: true,
      check: true,
      panel: "886dd11",
      latest: v030,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run test/main/firmware-state.test.ts`
Expected: FAIL, cannot find the module.

- [ ] **Step 3: Implement**

Add to `src/shared/ipc.ts`:

```ts
export type FirmwareStatus =
  "unknown" | "current" | "available" | "needs_calico";

/** What the window needs to draw the firmware notice. */
export interface FirmwareInfo {
  status: FirmwareStatus;
  /** The panel's firmware as last seen: a version, a git hash, or null when never seen. */
  panel: string | null;
  /** The newest release, or null before the first good check. */
  latest: FirmwareRelease | null;
  /** Epoch ms of the last good check. */
  checkedAt: number | null;
  /** Why the last check failed, "" after a good one. */
  lastError: string;
  /** Scheduled checks are on. */
  check: boolean;
  /** "Not now" was pressed for the latest version. */
  dismissed: boolean;
  /** The panel is below the first versioned firmware. */
  belowMinimum: boolean;
}
```

`src/main/firmware-state.ts`:

```ts
import { readFileSync } from "node:fs";
import { writeAtomic } from "../server/state-file";
import {
  CHECK_DELAY_MS,
  CHECK_EVERY_MS,
  FIRMWARE_REPO,
  MIN_FIRMWARE,
} from "../shared/firmware";
import type {
  FirmwareInfo,
  FirmwareRelease,
  FirmwareStatus,
} from "../shared/ipc";
import { compareSemver, isSemver } from "../shared/semver";
import type { CheckResult } from "./firmware-releases";

export interface FirmwareFile {
  check: boolean;
  /** The version "Not now" was pressed for, or "". */
  dismissed: string;
  latest: FirmwareRelease | null;
  checkedAt: number | null;
  panel: { fw: string; at: number } | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const FW_TEXT = /^[0-9A-Za-z._-]{1,32}$/;
const emptyFile = (): FirmwareFile => ({
  check: true,
  dismissed: "",
  latest: null,
  checkedAt: null,
  panel: null,
});

function storedRelease(raw: unknown): FirmwareRelease | null {
  if (!isObject(raw) || !isSemver(raw.version) || !isSemver(raw.minApp))
    return null;
  const notes = `https://github.com/${FIRMWARE_REPO}/releases/tag/fw-v${raw.version}`;
  return raw.notesUrl === notes
    ? { version: raw.version, minApp: raw.minApp, notesUrl: notes }
    : null;
}

/** Each field is checked on its own, so one bad value never costs the rest. */
export function loadFirmwareFile(path: string): FirmwareFile {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return emptyFile();
  }
  if (!isObject(data)) return emptyFile();
  const file = emptyFile();
  if (typeof data.check === "boolean") file.check = data.check;
  if (typeof data.dismissed === "string" && isSemver(data.dismissed))
    file.dismissed = data.dismissed;
  file.latest = storedRelease(data.latest);
  if (typeof data.checkedAt === "number" && data.checkedAt >= 0)
    file.checkedAt = data.checkedAt;
  const p = data.panel;
  if (
    isObject(p) &&
    typeof p.fw === "string" &&
    FW_TEXT.test(p.fw) &&
    typeof p.at === "number" &&
    p.at >= 0
  )
    file.panel = { fw: p.fw, at: p.at };
  return file;
}

/** Best effort: a failed write only means this launch forgets what it learned. */
export function saveFirmwareFile(path: string, file: FirmwareFile): void {
  try {
    writeAtomic(path, `${JSON.stringify(file)}\n`);
  } catch {
    // Not worth stopping Calico for.
  }
}

/**
 * Where the panel stands. A panel version that is not X.Y.Z (a git hash, "unknown") predates
 * versions and counts as older than every release, so it is never "current".
 */
export function firmwareStatus(
  panel: string | null,
  latest: FirmwareRelease | null,
  calicoVersion: string,
): { status: FirmwareStatus; belowMinimum: boolean } {
  const known = panel !== null && panel !== "";
  const belowMinimum =
    known && (!isSemver(panel) || compareSemver(panel, MIN_FIRMWARE) < 0);
  if (!known || !latest) return { status: "unknown", belowMinimum };
  const older = !isSemver(panel) || compareSemver(panel, latest.version) < 0;
  if (!older) return { status: "current", belowMinimum };
  const needsNewer =
    isSemver(calicoVersion) && compareSemver(calicoVersion, latest.minApp) < 0;
  return {
    status: needsNewer ? "needs_calico" : "available",
    belowMinimum,
  };
}

export interface WatchOptions {
  file: FirmwareFile;
  save: (file: FirmwareFile) => void;
  check: () => Promise<CheckResult>;
  now: () => number;
  calicoVersion: string;
}

/** Owns the firmware notice's state and schedule. Main only. */
export class FirmwareWatch {
  private lastError = "";
  private launch: NodeJS.Timeout | null = null;
  private every: NodeJS.Timeout | null = null;
  private inflight: Promise<CheckResult> | null = null;

  constructor(private readonly o: WatchOptions) {}

  /** The first check waits, so startup never does. Does nothing while the switch is off. */
  start(): void {
    if (!this.o.file.check || this.launch || this.every) return;
    this.launch = setTimeout(() => {
      this.launch = null;
      void this.checkNow();
      this.every = setInterval(() => void this.checkNow(), CHECK_EVERY_MS);
      this.every.unref();
    }, CHECK_DELAY_MS);
    this.launch.unref();
  }

  stop(): void {
    if (this.launch) clearTimeout(this.launch);
    if (this.every) clearInterval(this.every);
    this.launch = null;
    this.every = null;
  }

  /** Always runs, switch or not: the person asked. One at a time. */
  checkNow(): Promise<CheckResult> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<CheckResult> {
    const result = await this.o.check();
    if (result.ok) {
      this.o.file.latest = result.release;
      this.o.file.checkedAt = this.o.now();
      this.lastError = "";
      this.o.save(this.o.file);
    } else {
      this.lastError = result.error;
    }
    return result;
  }

  setCheck(on: boolean): void {
    this.o.file.check = on;
    this.o.save(this.o.file);
    this.stop();
    if (on) this.start();
  }

  /** "Not now", remembered for that version only. */
  dismiss(version: string): void {
    if (this.o.file.latest?.version !== version) return;
    this.o.file.dismissed = version;
    this.o.save(this.o.file);
  }

  /** The firmware version the Panel page read over Bluetooth or USB. */
  panelSeen(fw: string): void {
    if (!FW_TEXT.test(fw)) return;
    if (this.o.file.panel?.fw === fw) return;
    this.o.file.panel = { fw, at: this.o.now() };
    this.o.save(this.o.file);
  }

  /** `polledFw` is what the panel's own status poll reported, newer than anything saved. */
  view(polledFw: string | null = null): FirmwareInfo {
    const panel = polledFw ?? this.o.file.panel?.fw ?? null;
    const { latest } = this.o.file;
    const { status, belowMinimum } = firmwareStatus(
      panel,
      latest,
      this.o.calicoVersion,
    );
    return {
      status,
      panel,
      latest,
      checkedAt: this.o.file.checkedAt,
      lastError: this.lastError,
      check: this.o.file.check,
      dismissed: latest !== null && this.o.file.dismissed === latest.version,
      belowMinimum,
    };
  }
}
```

- [ ] **Step 4: Run it, then typecheck and lint**

Run: `pnpm vitest run test/main/firmware-state.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/firmware-state.ts src/shared/ipc.ts test/main/firmware-state.test.ts
git commit -m "Keep the firmware notice's state, status and schedule in one watcher"
```

---

### Task 4: Wire it into main, IPC and the preload bridge

**Files:**

- Modify: `src/shared/ipc.ts` (add `firmware: FirmwareInfo` to `CalicoInfo`, four methods to `CalicoApi`), `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `test/main/ipc.test.ts`, `test/main/index.test.ts`, the e2e launcher env

**Interfaces:**

- Consumes: `FirmwareWatch`, `loadFirmwareFile`, `saveFirmwareFile` (Task 3), `fetchLatestFirmware` (Task 2).
- Produces: `CalicoInfo.firmware: FirmwareInfo`; `CalicoApi.firmwareCheckNow(): Promise<void>`, `firmwareSetCheck(on: boolean): Promise<void>`, `firmwareDismiss(version: string): Promise<void>`, `firmwarePanelSeen(fw: string): Promise<void>`; IPC channels `firmware:check-now`, `firmware:set-check`, `firmware:dismiss`, `firmware:panel-seen`; the env var `CALICO_FIRMWARE_CHECK=0` turns the scheduled check off for tests and e2e.

- [ ] **Step 1: Write the failing tests**

In `test/main/ipc.test.ts`, add `firmware` to the `deps()` fake and a block:

```ts
describe("firmware channels", () => {
  it("passes strict values to the watcher and ignores anything else", async () => {
    const d = deps();
    await call("firmware:check-now", appFrame);
    expect(d.firmware.checkNow).toHaveBeenCalledOnce();
    call("firmware:set-check", appFrame, true);
    call("firmware:set-check", appFrame, "true");
    call("firmware:set-check", appFrame, 1);
    expect(d.firmware.setCheck).toHaveBeenCalledTimes(1);
    expect(d.firmware.setCheck).toHaveBeenCalledWith(true);
    call("firmware:dismiss", appFrame, "0.3.0");
    call("firmware:dismiss", appFrame, { v: "0.3.0" });
    expect(d.firmware.dismiss).toHaveBeenCalledTimes(1);
    call("firmware:panel-seen", appFrame, "0.2.0");
    call("firmware:panel-seen", appFrame, 7);
    call("firmware:panel-seen", appFrame, "x".repeat(100));
    expect(d.firmware.panelSeen).toHaveBeenCalledTimes(1);
    expect(d.firmware.panelSeen).toHaveBeenCalledWith("0.2.0");
  });
});
```

(`deps()` gets `firmware: { checkNow: vi.fn(async () => ({ ok: true as const, release: ... })), setCheck: vi.fn(), dismiss: vi.fn(), panelSeen: vi.fn() }` with `release` any valid object.)

In `test/main/index.test.ts`, assert that `info()` carries `firmware` with `check: true`, `status: "unknown"`, `latest: null` for a fresh profile, and that no network call is made when `CALICO_FIRMWARE_CHECK=0` is set (set it in that test file's setup, before the module under test runs; spy on `globalThis.fetch` and expect it not to be called after advancing timers by 20 s).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run test/main/ipc.test.ts test/main/index.test.ts`
Expected: FAIL (`firmware` missing from deps, no channels).

- [ ] **Step 3: Implement**

`src/shared/ipc.ts`: add `firmware: FirmwareInfo;` to `CalicoInfo` (after `addressChange`), and to `CalicoApi`:

```ts
  /** Look for a newer panel firmware now, whatever the switch says. The result arrives in info(). */
  firmwareCheckNow(): Promise<void>;
  /** The Settings switch for scheduled checks. */
  firmwareSetCheck(on: boolean): Promise<void>;
  /** "Not now" on the firmware banner, for that version only. */
  firmwareDismiss(version: string): Promise<void>;
  /** The firmware version the Panel page just read from the panel. */
  firmwarePanelSeen(fw: string): Promise<void>;
```

`src/main/ipc.ts`: add to `IpcDeps`:

```ts
firmware: Pick<
  FirmwareWatch,
  "checkNow" | "setCheck" | "dismiss" | "panelSeen"
>;
```

and handlers (import `type { FirmwareWatch } from "./firmware-state"`):

```ts
ipcMain.handle("firmware:check-now", async () => {
  await deps.firmware.checkNow();
});
ipcMain.handle("firmware:set-check", (_e, on: unknown) => {
  if (on === true || on === false) deps.firmware.setCheck(on);
});
ipcMain.handle("firmware:dismiss", (_e, version: unknown) => {
  if (typeof version === "string") deps.firmware.dismiss(version);
});
ipcMain.handle("firmware:panel-seen", (_e, fw: unknown) => {
  if (typeof fw === "string" && fw.length <= 32) deps.firmware.panelSeen(fw);
});
```

`src/preload/index.ts`: add

```ts
  firmwareCheckNow: () => ipcRenderer.invoke("firmware:check-now"),
  firmwareSetCheck: (on) => ipcRenderer.invoke("firmware:set-check", on),
  firmwareDismiss: (version) => ipcRenderer.invoke("firmware:dismiss", version),
  firmwarePanelSeen: (fw) => ipcRenderer.invoke("firmware:panel-seen", fw),
```

`src/main/index.ts`: next to the other profile files add `const firmwarePath = join(userData, "firmware.json");`, create the watcher before `registerIpc` and start it after the server is up:

```ts
const firmware = new FirmwareWatch({
  file: loadFirmwareFile(firmwarePath),
  save: (f) => saveFirmwareFile(firmwarePath, f),
  check: () => fetchLatestFirmware(fetch, version),
  now: Date.now,
  calicoVersion: version,
});
// Tests and e2e set CALICO_FIRMWARE_CHECK=0 so they never reach the network.
if (process.env.CALICO_FIRMWARE_CHECK !== "0") firmware.start();
```

Pass `firmware` into `registerIpc({...})`, add `firmware: firmware.view(null),` to the object `info()` returns (Task 7 changes `null` to the polled version), and call `firmware.stop()` where the other timers are stopped on quit. Find the e2e launcher (`grep -rn CALICO_USER_DATA test/e2e`) and add `CALICO_FIRMWARE_CHECK: "0"` to the environment it launches Electron with.

- [ ] **Step 4: Run everything**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: all pass. The window does not use `firmware` yet; every existing fixture that builds a `CalicoInfo` needs `firmware` added (typecheck names them): use `firmware: { status: "unknown", panel: null, latest: null, checkedAt: null, lastError: "", check: true, dismissed: false, belowMinimum: false }`.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "Run the firmware watcher in main and expose it to the window"
```

---

### Task 5: The notice, the Panel page line and the switch

**Files:**

- Create: `src/renderer/src/lib/firmware.ts`, `src/renderer/src/shell/FirmwareBanner.tsx`, `src/renderer/src/device/PanelFirmware.tsx`, `src/renderer/src/settings/FirmwareSection.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/device/DeviceView.tsx`, `src/renderer/src/device/LinkActions.tsx`, `src/renderer/src/settings/SettingsView.tsx`
- Test: a `.test.tsx` beside each new component, `LinkActions.test.tsx`, `App.test.tsx`

**Interfaces:**

- Consumes: `CalicoInfo.firmware` and the four `window.calico.firmware*` methods (Task 4).
- Produces: `panelLabel(fw: string | null): string`, `<FirmwareBanner info />`, `<PanelFirmware info />`, `<FirmwareSection info />`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/firmware.test.ts`:

```ts
import { expect, it } from "vitest";
import { panelLabel } from "./firmware";

it("names what the panel reports, never showing a raw hash as a version", () => {
  expect(panelLabel("0.2.0")).toBe("firmware 0.2.0");
  expect(panelLabel("886dd11")).toBe("an unversioned build");
  expect(panelLabel("unknown")).toBe("an unversioned build");
  expect(panelLabel(null)).toBe("an unknown version");
});
```

`src/renderer/src/shell/FirmwareBanner.test.tsx` (happy-dom; stub `window.calico`):

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalicoInfo, FirmwareInfo } from "../../../shared/ipc";
import { FirmwareBanner } from "./FirmwareBanner";

const latest = {
  version: "0.3.0",
  minApp: "0.1.13",
  notesUrl: "https://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
};
const fw = (patch: Partial<FirmwareInfo>): CalicoInfo =>
  ({
    firmware: {
      status: "available",
      panel: "0.2.0",
      latest,
      checkedAt: 1,
      lastError: "",
      check: true,
      dismissed: false,
      belowMinimum: false,
      ...patch,
    },
  }) as unknown as CalicoInfo;

let dismiss: ReturnType<typeof vi.fn>;
beforeEach(() => {
  dismiss = vi.fn(async () => undefined);
  Object.assign(window, { calico: { firmwareDismiss: dismiss } });
});
afterEach(cleanup);

it("announces an available update politely, with release notes and Not now", () => {
  render(<FirmwareBanner info={fw({})} />);
  const banner = screen.getByRole("status");
  expect(banner.getAttribute("aria-live")).toBe("polite");
  expect(banner.textContent).toContain("Panel firmware 0.3.0 is available");
  expect(banner.textContent).toContain("This panel has firmware 0.2.0");
  const link = screen.getByRole("link", { name: "Release notes" });
  expect(link.getAttribute("href")).toBe(latest.notesUrl);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noreferrer");
  expect(document.activeElement).toBe(document.body);
});

it("says to update Calico first when the firmware needs a newer one, with no flash steps", () => {
  render(
    <FirmwareBanner
      info={fw({
        status: "needs_calico",
        latest: { ...latest, minApp: "0.2.0" },
      })}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "needs Calico 0.2.0 or later. Update Calico first, then the panel.",
  );
});

it("shows nothing when current, unknown, dismissed or without a release", () => {
  for (const patch of [
    { status: "current" as const },
    { status: "unknown" as const },
    { dismissed: true },
    { latest: null },
  ]) {
    const { container } = render(<FirmwareBanner info={fw(patch)} />);
    expect(container.textContent).toBe("");
    cleanup();
  }
});

it("Not now hides the banner at once and tells main which version", () => {
  render(<FirmwareBanner info={fw({})} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(dismiss).toHaveBeenCalledWith("0.3.0");
  expect(screen.queryByRole("status")).toBeNull();
});
```

`PanelFirmware.test.tsx`: renders "Panel firmware" with the panel's version and "0.3.0 is available" / "up to date" / "Not checked yet" / "Last checked <time>" / "could not check" (from `lastError`, shown as plain text, not an alert), a below-minimum line ("older than the first versioned firmware"), "Automatic checks are off." when `check` is false, and **Check now** calls `firmwareCheckNow` and disables itself while it runs.

`FirmwareSection.test.tsx`: a checkbox labelled "Check for panel firmware updates", checked from `info.firmware.check`, calls `firmwareSetCheck(false)` when unticked, and a sentence that says it contacts GitHub's public releases list and sends nothing about you or your panel.

`LinkActions.test.tsx`: after the status read succeeds with `fw: "0.2.0"`, `firmwarePanelSeen("0.2.0")` is called once; a failed read does not call it.

`App.test.tsx`: with `firmware.status === "available"` the banner text is on the dashboard page too.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/renderer`
Expected: FAIL on the missing modules and wiring.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/firmware.ts`:

```ts
import { isSemver } from "../../../shared/semver";

/** What to call the panel's firmware in a sentence. A git hash is not shown as a version. */
export function panelLabel(fw: string | null): string {
  if (fw === null || fw === "") return "an unknown version";
  return isSemver(fw) ? `firmware ${fw}` : "an unversioned build";
}
```

`FirmwareBanner.tsx` (same family as `AddressBanner`: polite status, no focus change):

```tsx
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { panelLabel } from "../lib/firmware";

export function FirmwareBanner({ info }: { info: CalicoInfo }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const fw = info.firmware;
  const latest = fw.latest;
  if (
    !latest ||
    fw.dismissed ||
    hidden === latest.version ||
    (fw.status !== "available" && fw.status !== "needs_calico")
  )
    return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-start gap-3 border-b border-amber/60 bg-surface px-4 py-3"
    >
      <span className="min-w-0 text-amber">
        {fw.status === "available"
          ? `Panel firmware ${latest.version} is available. This panel has ${panelLabel(fw.panel)}.`
          : `Panel firmware ${latest.version} needs Calico ${latest.minApp} or later. Update Calico first, then the panel.`}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <a
          className="btn"
          href={latest.notesUrl}
          target="_blank"
          rel="noreferrer"
        >
          Release notes
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setHidden(latest.version);
            void window.calico.firmwareDismiss(latest.version);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
```

`PanelFirmware.tsx`:

```tsx
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { panelLabel } from "../lib/firmware";

function summary(fw: CalicoInfo["firmware"]): string {
  const { latest } = fw;
  if (fw.panel === null)
    return "The panel's firmware version is not known yet.";
  if (fw.status === "current")
    return `Panel ${panelLabel(fw.panel)} is up to date.`;
  if (latest && fw.status === "available")
    return `Panel firmware ${latest.version} is available. This panel has ${panelLabel(fw.panel)}.`;
  if (latest && fw.status === "needs_calico")
    return `Panel firmware ${latest.version} needs Calico ${latest.minApp} or later. Update Calico first, then the panel.`;
  return `This panel has ${panelLabel(fw.panel)}. No release information yet.`;
}

export function PanelFirmware({ info }: { info: CalicoInfo }) {
  const fw = info.firmware;
  const [busy, setBusy] = useState(false);
  async function checkNow() {
    setBusy(true);
    try {
      await window.calico.firmwareCheckNow();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2 className="section-title">Panel firmware</h2>
      <p className="px-4">{summary(fw)}</p>
      {fw.belowMinimum ? (
        <p className="px-4 text-muted">
          This panel runs firmware older than the first versioned release.
        </p>
      ) : null}
      <p className="px-4 text-muted">
        {fw.checkedAt === null
          ? "Not checked yet."
          : `Last checked ${new Date(fw.checkedAt).toLocaleString()}.`}
        {fw.lastError ? ` Could not check: ${fw.lastError}.` : ""}
        {fw.check ? "" : " Automatic checks are off."}
      </p>
      <div className="px-4 pt-2">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void checkNow()}
        >
          {busy ? "Checking" : "Check now"}
        </button>
      </div>
    </section>
  );
}
```

`PanelFirmware.test.tsx` (happy-dom, the same `fw()` fixture builder as the banner test) asserts: an available update shows "Panel firmware 0.3.0 is available. This panel has firmware 0.2.0."; a current one shows "Panel firmware 0.2.0 is up to date."; `panel: null` shows "The panel's firmware version is not known yet."; `belowMinimum` shows the older-than-first-release line; `checkedAt: null` shows "Not checked yet."; a `lastError` shows "Could not check: <reason>." as plain text with no `role="alert"`; `check: false` shows "Automatic checks are off."; and **Check now** calls `firmwareCheckNow` once, is disabled while the promise is pending (use a promise you resolve by hand), and comes back after.

`FirmwareSection.tsx` (pattern of `AutostartSection`): checkbox state seeded from `info.firmware.check`, `onChange` calls `void window.calico.firmwareSetCheck(e.target.checked)`; text under it: "Calico asks GitHub's public releases list for a newer panel firmware when it starts and every 12 hours. Nothing about you or your panel is sent."

Wiring: in `App.tsx` render `{info ? <FirmwareBanner info={info} /> : null}` right after the `AddressBanner`; in `DeviceView.tsx` render `<PanelFirmware info={info} />` once, above the connected and disconnected branches so it shows either way (read the file for its props: it already receives `info`); in `SettingsView.tsx` render `<FirmwareSection info={info} />` next to `AutostartSection` (find where it is rendered); in `LinkActions.tsx`'s `refresh`, after `if (reply.ok && reply.info) setPanelInfo(reply.info)` add `void window.calico.firmwarePanelSeen(reply.info.fw)` when `reply.info.fw` is a non-empty string.

- [ ] **Step 4: Run everything**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm vitest run test/terminology.test.ts`
Expected: PASS. `npx prettier --write` the new files first.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "Show the firmware notice, the Panel page line and the switch"
```

---

### Task 6: Docs

**Files:**

- Modify: `README.md`, `docs/review-rules.md`

**Interfaces:**

- Consumes: the finished behavior.
- Produces: the terminology guard still passes.

- [ ] **Step 1: Write the docs**

In `README.md` add a short "Panel firmware updates" paragraph near the Panel page text: Calico checks GitHub's public releases list when it starts and every 12 hours for a newer `fw-v*` release, compares it with the panel's firmware, and shows a banner and a line on the Panel page. It sends nothing about you or your panel. The switch is in Settings. Flash steps are in `firmware/README.md` under "Releasing"; Calico does not flash.

In `docs/review-rules.md` add a rule: **Outbound firmware check.** `src/main/firmware-releases.ts` is the only code that contacts GitHub for firmware. GET only, no token, no identifiers beyond `User-Agent: Calico/<version>`, `https` and GitHub hosts only, size and time limits, every returned field validated, `notes_url` exact, nothing downloaded or run, nothing sent to the panel.

- [ ] **Step 2: Run the guard and format**

Run: `pnpm vitest run test/terminology.test.ts && npx prettier --check README.md docs/review-rules.md`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/review-rules.md
git commit -m "Document the firmware update notice and its limits"
```

---

### Task 7: The panel reports its version in its poll (separable)

This changes firmware, so it ships as its own release (`fw-v0.2.1`) and needs one flash. Everything before it works without it, by reading the version over Bluetooth or USB.

**Files:**

- Create: `src/server/panel-firmware.ts`
- Modify: `src/server/http.ts` (stats and the status branch), `src/main/index.ts` (use the polled version), `firmware/main/power.c`, `firmware/main/power.h`, `firmware/main/net.c`, `firmware/VERSION`, `firmware/RELEASE.json`
- Test: `test/server/panel-firmware.test.ts`, `test/server/http.test.ts`, `firmware/host/test_power.c`, `firmware/scripts/test_fw_version.py` (version unchanged assertions only if they pin `0.2.0`)

**Interfaces:**

- Consumes: `isSemver` (Task 1), `FirmwareWatch.view(polledFw)` (Task 3).
- Produces: `parsePanelFirmware(params: URLSearchParams): string | null`, `recordPanelFirmware(stats, params, now): void`, `stats.panelFirmware: { fw: string; at: number } | null`; C `int status_query(const power_reading_t *r, const char *fw, char *out, size_t cap)`.

- [ ] **Step 1: Write the failing tests**

`test/server/panel-firmware.test.ts`:

```ts
import { expect, it } from "vitest";
import {
  parsePanelFirmware,
  recordPanelFirmware,
} from "../../src/server/panel-firmware";

const q = (s: string) => new URLSearchParams(s);

it("accepts only a plain version", () => {
  expect(parsePanelFirmware(q("fw=0.2.1"))).toBe("0.2.1");
  for (const bad of [
    "fw=886dd11",
    "fw=0.2",
    "fw=0.2.1-rc1",
    "fw=",
    "bat=5",
    "fw=0.2.1%0A",
    "fw=" + "9".repeat(40),
  ])
    expect(parsePanelFirmware(q(bad))).toBeNull();
});

it("keeps the last valid report and never replaces it with a bad one", () => {
  const stats = { panelFirmware: null as { fw: string; at: number } | null };
  recordPanelFirmware(stats, q("fw=0.2.1"), 100);
  recordPanelFirmware(stats, q("fw=bogus"), 200);
  expect(stats.panelFirmware).toEqual({ fw: "0.2.1", at: 100 });
});
```

In `test/server/http.test.ts` add: a non-loopback `GET /api/status?bat=81&chg=1&ext=1&fw=0.2.1` records `stats.panelFirmware`; the same from loopback does not; and the response body and key order are unchanged (the frozen contract).

`firmware/host/test_power.c`, new checks next to the existing query ones:

```c
    {
        char q[48];
        power_reading_t r = {.present = 1, .percent = 81, .charging = 1, .external = 1};
        power_reading_t none = {.present = 0};
        check(status_query(&r, "0.2.1", q, sizeof q) > 0 &&
                  strcmp(q, "?bat=81&chg=1&ext=1&fw=0.2.1") == 0,
              "fw rides after the battery");
        check(status_query(&none, "0.2.1", q, sizeof q) > 0 && strcmp(q, "?fw=0.2.1") == 0,
              "fw alone starts the query");
        check(status_query(&r, "886dd11", q, sizeof q) > 0 && strcmp(q, "?bat=81&chg=1&ext=1") == 0,
              "a git hash is not sent");
        check(status_query(&r, "unknown", q, sizeof q) > 0 && strcmp(q, "?bat=81&chg=1&ext=1") == 0,
              "unknown is not sent");
        check(status_query(&none, "unknown", q, sizeof q) == 0 && q[0] == '\0',
              "nothing to send is an empty query");
        check(status_query(&r, "10.20.30", q, sizeof q) > 0 &&
                  strcmp(q, "?bat=81&chg=1&ext=1&fw=10.20.30") == 0,
              "a long version fits");
        check(status_query(&r, "0.2.1", q, 8) == 0 && q[0] == '\0', "a tiny buffer is safe");
        check(status_query(&r, NULL, q, sizeof q) > 0 && strcmp(q, "?bat=81&chg=1&ext=1") == 0,
              "no version is fine");
    }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run test/server && firmware/host/run.sh`
Expected: FAIL (missing module; `status_query` undeclared).

- [ ] **Step 3: Implement**

`src/server/panel-firmware.ts`:

```ts
import { isSemver } from "../shared/semver";

/** The panel adds &fw=<version> to its status poll. Anything but a plain X.Y.Z is ignored. */
export function parsePanelFirmware(params: URLSearchParams): string | null {
  const fw = params.get("fw");
  return fw !== null && isSemver(fw) ? fw : null;
}

/** Keeps the last valid report. A malformed one never replaces it. */
export function recordPanelFirmware(
  stats: { panelFirmware: { fw: string; at: number } | null },
  params: URLSearchParams,
  now: number,
): void {
  const fw = parsePanelFirmware(params);
  if (fw) stats.panelFirmware = { fw, at: now };
}
```

In `src/server/http.ts`: add `panelFirmware: null` to the stats object next to `panelBattery`, and in the non-loopback branch of `GET /api/status` call `recordPanelFirmware(stats, params, Date.now())` next to `recordPanelBattery`. Change the body and key order of nothing. In `src/main/index.ts` change `firmware.view(null)` to `firmware.view(stats.panelFirmware?.fw ?? null)`.

`firmware/main/power.h`: declare

```c
/* The status poll's query: the battery readings, then &fw=<version> when fw is a plain X.Y.Z
 * (digits and dots, at most 11 characters). A git hash or "unknown" is not sent. Returns the
 * length, 0 with an empty string when there is nothing to send or the buffer is too small. */
int status_query(const power_reading_t *r, const char *fw, char *out, size_t cap);
```

`firmware/main/power.c`:

```c
static int fw_is_version(const char *fw) {
    int dots = 0;
    size_t i;
    size_t n = fw ? strlen(fw) : 0;
    if (n < 5 || n > 11) {
        return 0;
    }
    for (i = 0; i < n; i++) {
        if (fw[i] == '.') {
            dots++;
        } else if (fw[i] < '0' || fw[i] > '9') {
            return 0;
        }
    }
    return dots == 2 && fw[0] != '.' && fw[n - 1] != '.' && strstr(fw, "..") == NULL;
}

int status_query(const power_reading_t *r, const char *fw, char *out, size_t cap) {
    int n = 0;
    int m;
    if (cap == 0) {
        return 0;
    }
    out[0] = '\0';
    n = power_query(r, out, cap);
    if (fw_is_version(fw)) {
        m = snprintf(out + n, cap - (size_t)n, "%cfw=%s", n > 0 ? '&' : '?', fw);
        if (m < 0 || (size_t)(n + m) >= cap) {
            out[0] = '\0';
            return 0;
        }
        n += m;
    }
    return n;
}
```

(`power.c` needs `<string.h>`.) In `firmware/main/net.c` `net_fetch_status`: enlarge `suffix[48]` to `suffix[64]` and `query[32]` to `query[48]`, and replace `power_query(&reading, query, sizeof query);` with `status_query(&reading, DESK_FW_VERSION, query, sizeof query);`, adding the same `#ifndef DESK_FW_VERSION` fallback as `ble_link.c`. A change in `net.c` is small, but internal RAM is tight: these are stack buffers in the poll task, 32 bytes more, so check the poll task's stack high-water mark in the hardware pass.

Release: bump `firmware/VERSION` and `firmware/RELEASE.json` `version` to `0.2.1` (`min_app` stays `0.1.13`: an older Calico simply ignores the new query parameter), and update any test that pins `0.2.0` as the shipped version.

- [ ] **Step 4: Run everything**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && firmware/host/run.sh && (cd firmware/scripts && python3 -m pytest -q --deselect test_ble_provision.py::test_wifi_join_and_glass_scan_use_psram_stacks)` and a full ESP-IDF build in a clean worktree (`idf.py set-target esp32s3 && idf.py build`).
Expected: all pass, the build completes.

- [ ] **Step 5: Commit**

```bash
git add src/server src/main/index.ts firmware test
git commit -m "Report the panel's firmware version in its status poll"
```

---

### Task 8: Owner check (owner required)

Not for an executor. One checklist, one reply, after Tasks 1 to 6 are in a Calico release and, for Task 7, after the `fw-v0.2.1` release is flashed.

1. **Banner:** with a newer `fw-v*` release published (or temporarily with the panel on an older version), Calico shows "Panel firmware … is available" on every page, **Release notes** opens the right GitHub page, and **Not now** hides it until the next release.
2. **Panel page:** shows the panel's version, "up to date" or "available", the last check time, and **Check now** works.
3. **Settings:** the switch turns scheduled checks off; with it off, nothing contacts GitHub on launch (check with `ss -tn | grep api.github` or the network monitor), and **Check now** still works.
4. **Offline:** unplug the network and restart Calico. A known update still shows, and no error banner appears.
5. **Task 7 only:** after flashing `fw-v0.2.1`, with Bluetooth and USB disconnected, the Panel page shows the panel's version within a minute of the panel polling. The boot log still shows the DMA budget (largest internal DMA at least 53248 after NimBLE, internal free at least 16000 at the IP).

## Self-review

- **Spec coverage:** the release check, the manifest validation, the limits and the host allow-list (Task 2); the schedule, the off switch, **Check now**, persistence and the dismissal (Task 3); the status values, `MIN_FIRMWARE`, git-hash panels and `needs_calico` (Tasks 1 and 3); the banner, the Panel page line and the Settings switch (Task 5); the wiring and the privacy limits (Task 4, Task 6 docs); learning the version over a connection (Task 5, `LinkActions`) and from the poll (Task 7). Out of scope: flashing, downloading, wireless updates.
- **Placeholder scan:** none. Task 5's `PanelFirmware.tsx` and its test are described by exact behavior and text, not full code; the implementer writes them from the cases listed.
- **Names:** `FirmwareRelease`, `FirmwareInfo`, `FirmwareStatus`, `FirmwareWatch`, `CheckResult`, `fetchLatestFirmware`, `pickRelease`, `validateManifest`, `firmwareStatus`, `panelLabel`, `status_query`, `recordPanelFirmware` and the four `firmware*` API methods are used the same way in every task.
- **Deviation from the spec, deliberate:** state lives in `firmware.json` in the profile and not in `config.json` (the spec said `config.json`), because `config.json` is the server's file with a contract test and an HTTP API.
