import type { DeviceLink } from "./commands";

export const NO_STATUS =
  "Could not read the panel's settings, so nothing was written. Connect again.";

export function ownUrl(ssid: string): string {
  return `The panel is on ${ssid}, which has its own companion URL saved on the panel, so a new default address would not change where it polls. Edit ${ssid} in Settings, then push networks from the Device page.`;
}

export function sameUrl(url: string): string {
  return `The panel already polls ${url}. It may be off its network, or a firewall may block it. See Panel not connecting on the Device page.`;
}

/**
 * The banner's one-click fix: writes the panel's default companion URL and reboots it. Writes no
 * password and no token. Reads status and nets first and writes nothing when that would not help:
 * a network with its own URL on the panel wins for that network (R6), and old firmware without
 * nets gets the link's OLD_FIRMWARE error.
 */
export async function updatePanelAddress(
  link: DeviceLink,
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await link.send({ op: "status" });
  if (!status.ok) return status;
  if (!status.info) return { ok: false, error: NO_STATUS };
  const nets = await link.send({ op: "nets" });
  if (!nets.ok) return nets;
  const { ssid } = status.info;
  if (nets.nets?.some((n) => n.ssid === ssid && n.has_url))
    return { ok: false, error: ownUrl(ssid) };
  if (status.info.url === url) return { ok: false, error: sameUrl(url) };
  const wrote = await link.send({ op: "url", value: url });
  if (!wrote.ok) return wrote;
  const reboot = await link.send({ op: "reboot" });
  if (!reboot.ok) return reboot;
  return { ok: true };
}
