import { fetchPanel, putPanel } from "./api";

const trim = (url: string) => url.replace(/\/+$/, "");

/**
 * Calico's stored address (Settings > Panel push) is what every status poll tells the panel to
 * use. After the address was written to the panel over Bluetooth, move a stored copy to match so
 * a poll does not keep offering the old one. It never creates an address that is not stored.
 * Returns "" or a note for the person: the Bluetooth write already succeeded and must not fail.
 */
export async function keepStoredAddress(url: string): Promise<string> {
  try {
    const stored = await fetchPanel();
    if (!stored.url || trim(stored.url) === trim(url)) return "";
    await putPanel({ url });
    return "";
  } catch (err) {
    const why = err instanceof Error ? err.message : "failed";
    return `The saved address in Settings was not updated: ${why}. Set it under Panel push.`;
  }
}
