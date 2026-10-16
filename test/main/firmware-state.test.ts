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

  it("rejects a stored release whose notes link is not exactly this release's page", () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-"));
    const path = join(dir, "firmware.json");
    for (const notesUrl of [
      "https://evil.example/releases/tag/fw-v0.3.0",
      "https://github.com/other/repo/releases/tag/fw-v0.3.0",
      "https://github.com/newtosh/calico/releases/tag/fw-v0.2.0",
      "javascript:alert(1)",
      "http://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
    ]) {
      writeFileSync(
        path,
        JSON.stringify({
          latest: { version: "0.3.0", minApp: "0.1.13", notesUrl },
        }),
      );
      expect(loadFirmwareFile(path).latest).toBeNull();
    }
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
    const { watch, file } = make([
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
    expect(file.dismissed).toBe("0.3.0");
  });

  it("ignores Not now before any release is known", () => {
    const { watch, file, save } = make([]);
    watch.dismiss("0.3.0");
    expect(file.dismissed).toBe("");
    expect(save).not.toHaveBeenCalled();
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
