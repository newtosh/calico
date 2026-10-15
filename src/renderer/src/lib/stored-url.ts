import { fetchPanel, putPanel } from "./api";

const trim = (url: string) => url.replace(/\/+$/, "");

/**
 * Calico's stored address (Settings > Panel push) is what every status poll tells the panel to
 * use. After the address was written to the panel over Bluetooth, move a stored copy to match so
 * a poll does not keep offering the old one. It never creates an address that is not stored.
 * Returns "" or a note for the person. The Bluetooth write must not fail because of this.
 */
export async function keepStoredAddress(url: string): Promise<string> {
  try {
    const stored = await fetchPanel();
    if (!stored.url || trim(stored.url) === trim(url)) return "";
    await putPanel({ url });
    return "";
  } catch (err) {
    return `Calico's saved address was not updated: ${reason(err)}. Set it under Panel push.`;
  }
}

function reason(err: unknown): string {
  const text = err instanceof Error ? err.message : "failed";
  if (/\b400\b/.test(text)) return "Calico did not accept that address";
  return text.replace(/[.\s]+$/, "");
}
