import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("server boundary", () => {
  it("rejects electron imports in src/server", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      'import { app } from "electron";\nexport const name = app.name;\n',
      { filePath: "src/server/probe.ts" },
    );
    expect(
      result?.messages.some((m) => m.ruleId === "no-restricted-imports"),
    ).toBe(true);
  });

  it("allows electron imports in src/main", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      'import { app } from "electron";\nexport const name = app.name;\n',
      { filePath: "src/main/probe.ts" },
    );
    expect(
      result?.messages.some((m) => m.ruleId === "no-restricted-imports"),
    ).toBe(false);
  });
});
