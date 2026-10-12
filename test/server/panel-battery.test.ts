import { describe, expect, it } from "vitest";
import type { PanelBatteryInfo } from "../../src/shared/ipc";
import {
  parsePanelBattery,
  recordPanelBattery,
} from "../../src/server/panel-battery";

const q = (s: string) => new URLSearchParams(s);

describe("parsePanelBattery", () => {
  it("reads a full, valid report", () => {
    expect(parsePanelBattery(q("bat=81&chg=1&ext=1"))).toEqual({
      pct: 81,
      charging: true,
      external: true,
    });
    expect(parsePanelBattery(q("bat=0&chg=0&ext=0"))).toEqual({
      pct: 0,
      charging: false,
      external: false,
    });
    expect(parsePanelBattery(q("bat=100&chg=0&ext=1"))?.pct).toBe(100);
  });

  it("has nothing when the panel sent nothing", () => {
    expect(parsePanelBattery(q(""))).toBeNull();
    expect(parsePanelBattery(q("detail=1"))).toBeNull();
  });

  it("ignores a partial set", () => {
    expect(parsePanelBattery(q("bat=81"))).toBeNull();
    expect(parsePanelBattery(q("bat=81&chg=1"))).toBeNull();
    expect(parsePanelBattery(q("chg=1&ext=1"))).toBeNull();
  });

  it("ignores values out of range or not plain integers", () => {
    for (const bad of [
      "bat=101&chg=0&ext=0",
      "bat=-1&chg=0&ext=0",
      "bat=8.5&chg=0&ext=0",
      "bat=abc&chg=0&ext=0",
      "bat=&chg=0&ext=0",
      "bat=1e2&chg=0&ext=0",
      "bat=0081&chg=0&ext=0",
      "bat=81&chg=2&ext=0",
      "bat=81&chg=0&ext=yes",
    ])
      expect(parsePanelBattery(q(bad)), bad).toBeNull();
  });
});

describe("recordPanelBattery", () => {
  const stats = (): { panelBattery: PanelBatteryInfo | null } => ({
    panelBattery: null,
  });

  it("stores a valid report with the time it arrived", () => {
    const s = stats();
    recordPanelBattery(s, q("bat=81&chg=1&ext=0"), 5_000);
    expect(s.panelBattery).toEqual({
      pct: 81,
      charging: true,
      external: false,
      at: 5_000,
    });
  });

  it("keeps the previous report when a later one is malformed", () => {
    const s = stats();
    recordPanelBattery(s, q("bat=81&chg=1&ext=0"), 5_000);
    recordPanelBattery(s, q("bat=999&chg=1&ext=0"), 6_000);
    recordPanelBattery(s, q("bat=50"), 7_000);
    recordPanelBattery(s, q(""), 8_000);
    expect(s.panelBattery?.pct).toBe(81);
    expect(s.panelBattery?.at).toBe(5_000);
  });

  it("replaces it with a newer valid one", () => {
    const s = stats();
    recordPanelBattery(s, q("bat=81&chg=1&ext=0"), 5_000);
    recordPanelBattery(s, q("bat=80&chg=0&ext=0"), 9_000);
    expect(s.panelBattery).toMatchObject({ pct: 80, at: 9_000 });
  });
});
