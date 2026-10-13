import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadSnapshot,
  saveSnapshot,
  writeAtomic,
} from "../../src/server/state-file";
import type { Snapshot } from "../../src/server/store";

// Plants a symlink at the tmp path right after writeAtomic clears it, as a racing process could.
const race = vi.hoisted(() => ({
  link: null as { tmp: string; target: string } | null,
}));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    rmSync: (...args: Parameters<typeof fs.rmSync>) => {
      fs.rmSync(...args);
      if (race.link) {
        fs.symlinkSync(race.link.target, race.link.tmp);
        race.link = null;
      }
    },
  };
});

const dir = () => mkdtempSync(join(tmpdir(), "calico-state-"));

const sample: Snapshot = {
  unread: 1,
  events: [
    {
      id: "e1",
      type: "note",
      agent_id: "",
      title: "",
      message: "hi",
      source: "manual",
      at: "2026-10-07T12:00:00Z",
      color: "",
      shape: "",
      icon: "",
    },
  ],
  agents: [
    {
      id: "a1",
      title: "A",
      status: "running",
      updated_at: "2026-10-07T12:00:00Z",
      color: "",
      shape: "",
      icon: "",
      attention: true,
      message: "q",
      source: "grok-bot",
    },
  ],
};

describe("state file", () => {
  it("returns null when the file is missing", () => {
    expect(loadSnapshot(join(dir(), "state.json"))).toBeNull();
  });

  it("round-trips with mode 600 and no temp file left", () => {
    const path = join(dir(), "nested", "state.json");
    saveSnapshot(path, sample);
    expect(loadSnapshot(path)).toEqual(sample);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("moves a corrupt file aside and starts empty", () => {
    const path = join(dir(), "state.json");
    writeFileSync(path, "{not json");
    expect(loadSnapshot(path)).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(`${path}.bad`, "utf8")).toBe("{not json");
  });

  it("moves a wrong-shaped file aside", () => {
    const path = join(dir(), "state.json");
    writeFileSync(path, JSON.stringify({ events: "nope" }));
    expect(loadSnapshot(path)).toBeNull();
    expect(existsSync(`${path}.bad`)).toBe(true);
  });

  it("coerces unknown agent status to idle", () => {
    const path = join(dir(), "state.json");
    const raw = {
      ...sample,
      agents: [{ ...sample.agents[0], status: "needs_you" }],
    };
    writeFileSync(path, JSON.stringify(raw));
    expect(loadSnapshot(path)?.agents[0]?.status).toBe("idle");
  });

  it("loads a snapshot saved before agents carried a source", () => {
    const path = join(dir(), "state.json");
    const old: Record<string, unknown> = { ...sample.agents[0] };
    delete old.source;
    writeFileSync(path, JSON.stringify({ ...sample, agents: [old] }));
    expect(loadSnapshot(path)?.agents[0]?.source).toBe("");
  });
});

describe("writeAtomic", () => {
  it("writes 0600 even over a stale world-readable temp file", () => {
    const path = join(dir(), "networks.json");
    writeFileSync(`${path}.tmp`, "old");
    chmodSync(`${path}.tmp`, 0o644);
    writeAtomic(path, "{}");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("writes 0600 when it replaces an older world-readable file", () => {
    const path = join(dir(), "networks.json");
    writeFileSync(path, "old");
    chmodSync(path, 0o644);
    writeAtomic(path, "{}");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("{}");
  });

  it("does not follow a symlink planted at the tmp path after it is cleared", () => {
    const d = dir();
    const path = join(d, "networks.json");
    const target = join(d, "elsewhere");
    writeFileSync(target, "keep");
    race.link = { tmp: `${path}.tmp`, target };
    expect(() => writeAtomic(path, "{}")).toThrow(/EEXIST/);
    expect(readFileSync(target, "utf8")).toBe("keep");
  });
});
