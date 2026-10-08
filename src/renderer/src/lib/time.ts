export function localTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleTimeString(undefined, { hourCycle: "h23" });
}
