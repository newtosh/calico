import { describe, expect, it } from "vitest";
import { panelOnlineSince } from "./panel-online";

describe("panelOnlineSince", () => {
  it("needs a poll after the reboot", () => {
    expect(panelOnlineSince(null, 1000)).toBe(false);
    expect(panelOnlineSince(900, 1000)).toBe(false);
    expect(panelOnlineSince(1500, 1000)).toBe(true);
  });
});
