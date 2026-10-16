import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { FIRMWARE_HELP_URL } from "../../src/shared/firmware";

it("the help link points at a README section that exists", () => {
  expect(
    FIRMWARE_HELP_URL.startsWith(
      "https://github.com/newtosh/calico/blob/main/firmware/README.md",
    ),
  ).toBe(true);
  expect(FIRMWARE_HELP_URL.endsWith("#releasing")).toBe(true);
  expect(readFileSync("firmware/README.md", "utf8")).toMatch(/^## Releasing$/m);
});
