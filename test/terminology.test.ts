import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

function files(dir: string, ext: RegExp): string[] {
  return (readdirSync(join(root, dir), { recursive: true }) as string[])
    .filter((f) => ext.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

function hits(paths: string[], banned: RegExp[]): string[] {
  const found: string[] = [];
  for (const path of paths) {
    readFileSync(join(root, path), "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const re of banned)
          if (re.test(line)) found.push(`${path}:${i + 1} ${line.trim()}`);
      });
  }
  return found;
}

// docs/terminology.md explains why each word is retired.
const SOURCE = [/\bdesk\b/i, /(?<!python-)\bcompanion\b/i, /\bDevice\b/];
const DOCS = [
  /(?<!python-)\bcompanion\b/i,
  /\bthe desk\b/i,
  /\bDevice (page|setup|tab)\b/,
];

describe("terminology", () => {
  it("keeps the retired words out of the app's source", () => {
    expect(hits(files("src", /\.tsx?$/), SOURCE)).toEqual([]);
  });

  it("keeps them out of the docs", () => {
    const docs = [
      "README.md",
      "CONTRIBUTING.md",
      "firmware/README.md",
      "docs/review-rules.md",
      "docs/usb-console-protocol.md",
    ];
    expect(hits(docs, DOCS)).toEqual([]);
  });

  it("catches a retired word in JSX text and in a template literal", () => {
    const sample = ["<dt>Companion</dt>", "`The desk did not answer`"];
    for (const line of sample)
      expect(SOURCE.some((re) => re.test(line))).toBe(true);
  });
});
