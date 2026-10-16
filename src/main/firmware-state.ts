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
