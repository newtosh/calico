const PART = /^(0|[1-9]\d{0,5})$/;

export type Semver = [number, number, number];

/** Plain X.Y.Z, ASCII digits, no leading zeros, each part under a million. Anything else is null. */
export function parseSemver(value: unknown): Semver | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every((p) => PART.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

export const isSemver = (value: unknown): value is string =>
  parseSemver(value) !== null;

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new RangeError("compareSemver needs two X.Y.Z versions");
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
