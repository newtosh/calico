import { expect, it } from "vitest";
import { panelLabel } from "./firmware";

it("names what the panel reports, never showing a raw hash as a version", () => {
  expect(panelLabel("0.2.0")).toBe("firmware 0.2.0");
  expect(panelLabel("886dd11")).toBe("an unversioned build");
  expect(panelLabel("unknown")).toBe("an unversioned build");
  expect(panelLabel(null)).toBe("an unknown version");
});
