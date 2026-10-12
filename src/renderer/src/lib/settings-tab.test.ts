// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTab, saveTab } from "./settings-tab";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("remembered settings tab", () => {
  it("opens on Agents when nothing was saved", () => {
    expect(loadTab()).toBe("agents");
  });

  it("returns the saved tab", () => {
    saveTab("connectivity");
    expect(loadTab()).toBe("connectivity");
    saveTab("app");
    expect(loadTab()).toBe("app");
  });

  it("ignores a value it does not know", () => {
    localStorage.setItem("calico.settingsTab", "panel");
    expect(loadTab()).toBe("agents");
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadTab()).toBe("agents");
    expect(() => saveTab("app")).not.toThrow();
  });
});
