import { ago } from "./time";

/** How old the newest update has to be before the dashboard mentions it. */
export const STALE_AFTER_MS = 30 * 60_000;

/**
 * A short line for when nothing has come in for a while, empty while things are
 * fresh. The dashboard shows it so a quiet desk does not look like a working one.
 */
export function staleUpdateText(
  events: readonly { at: string }[],
  now = Date.now(),
): string {
  const times = events
    .map((e) => new Date(e.at).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return "No updates yet";
  const newest = Math.max(...times);
  if (now - newest < STALE_AFTER_MS) return "";
  return `Last update ${ago(new Date(newest).toISOString(), now)}`;
}
