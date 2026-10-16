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
    const fetchFn = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        void init;
        if (u === RELEASES_URL) return reply([rel("fw-v0.3.0")], u);
        return reply(good(), u);
      },
    );
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
