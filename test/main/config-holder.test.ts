import { describe, expect, it, vi } from "vitest";
import { ConfigHolder } from "../../src/main/config-holder";
import { defaultConfig } from "../../src/server/config";

describe("ConfigHolder", () => {
  it("holds the new config once it is written", () => {
    const write = vi.fn();
    const h = new ConfigHolder(defaultConfig(), write);
    const next = { ...defaultConfig(), relay_url: "https://r/inbox" };
    h.set(next);
    expect(write).toHaveBeenCalledWith(next);
    expect(h.get()).toBe(next);
  });

  it("keeps the old config when the write fails, so nothing points at a Worker that is about to be deleted", () => {
    const first = defaultConfig();
    const h = new ConfigHolder(first, () => {
      throw new Error("ENOSPC");
    });
    expect(() => h.set({ ...first, relay_url: "https://r/inbox" })).toThrow(
      "ENOSPC",
    );
    expect(h.get()).toBe(first);
  });
});
