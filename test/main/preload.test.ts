import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => h.exposed.set(key, api),
  },
  ipcRenderer: { invoke: h.invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
import "../../src/preload/index";
import type { CalicoApi } from "../../src/shared/ipc";

const api = h.exposed.get("calico") as CalicoApi;

describe("preload", () => {
  it("exposes only window.calico, with exactly the known methods", () => {
    expect([...h.exposed.keys()]).toEqual(["calico"]);
    expect(Object.keys(api).sort()).toEqual(
      [
        "info",
        "onBleCandidates",
        "chooseBle",
        "onSerialCandidates",
        "chooseSerial",
        "firewall",
        "serialAccess",
        "runFix",
        "portHolders",
        "adoptPort",
        "setAutostart",
        "relaySetupView",
        "relaySetupStart",
        "relaySetupCancel",
        "relaySetupDismiss",
        "onRelaySetup",
        "relayCopyForBot",
        "networksList",
        "networksSave",
        "networksRemove",
        "networksConfirmPush",
        "networksRelease",
        "networksEndPush",
        "dismissAddress",
      ].sort(),
    );
  });

  it.each([
    [
      "networksConfirmPush",
      ["Home", "Cafe"],
      ["networks:confirm-push", ["Home", "Cafe"]],
    ],
    ["networksRelease", "Home", ["networks:release", "Home"]],
    ["networksEndPush", undefined, ["networks:end-push"]],
    ["dismissAddress", undefined, ["calico:dismiss-address"]],
  ] as const)("%s invokes its channel", (method, arg, expected) => {
    h.invoke.mockClear();
    const fn = api[method] as (a: unknown) => unknown;
    void fn(arg);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith(...expected);
  });
});
