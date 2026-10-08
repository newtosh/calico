import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnapshot, saveSnapshot } from "../../src/server/state-file";
import type { Snapshot } from "../../src/server/store";

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
