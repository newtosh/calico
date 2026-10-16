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
