/** A whole number typed into a field, or null if it is blank, fractional, or outside the range. */
export function parseWhole(
  text: string,
  min: number,
  max: number,
): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}
