import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import type { PanelSeen } from "../server/http";
import { writeAtomic } from "../server/state-file";

/** One IPv4 address on this computer. */
export interface LocalAddress {
  iface: string;
  address: string;
  /** "192.168.4.30/24", or null when the OS gave no netmask. */
  cidr: string | null;
  /** A VPN, tunnel, container or VM network: never offered over a LAN address. */
  virtual: boolean;
}

/** How long the panel must be silent before the banner may show. */
export const SILENCE_MS = 60_000;

// Not this computer's own LAN: Docker and Podman bridges, VM and container networks, and VPN
// tunnels (Tailscale, WireGuard, ZeroTier, OpenVPN).
const VIRTUAL =
  /^(docker|br-|veth|virbr|vnet|vmnet|vboxnet|podman|cni|flannel|lxc|lxd|tailscale|tun|tap|wg|zt|utun)/i;

const toInt = (ip: string): number =>
  ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);

export function inSubnet(ip: string, cidr: string): boolean {
  const [net, size] = cidr.split("/");
  const bits = Number(size);
  if (!net || !isIPv4(ip) || !isIPv4(net)) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const span = 2 ** (32 - bits);
  return Math.floor(toInt(ip) / span) === Math.floor(toInt(net) / span);
}

const linkLocal = (ip: string) => inSubnet(ip, "169.254.0.0/16");
// Carrier-grade NAT: Tailscale gives its addresses from here.
const cgnat = (ip: string) => inSubnet(ip, "100.64.0.0/10");
const privateLan = (ip: string) =>
  inSubnet(ip, "10.0.0.0/8") ||
  inSubnet(ip, "172.16.0.0/12") ||
  inSubnet(ip, "192.168.0.0/16");

export function localAddresses(
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): LocalAddress[] {
  return Object.entries(ifaces).flatMap(([iface, list]) =>
    (list ?? [])
      .filter(
        (i) => i.family === "IPv4" && !i.internal && !linkLocal(i.address),
      )
      .map((i) => ({
        iface,
        address: i.address,
        cidr: i.cidr ?? null,
        virtual: VIRTUAL.test(iface) || cgnat(i.address),
      })),
  );
}

/**
 * The address to give the panel: one on the subnet the panel polled from, else the first private
 * LAN address, else the first LAN one. Never a VPN, tunnel or container address. Null when there
 * is no LAN address.
 */
export function pickAddress(
  addrs: LocalAddress[],
  panelFrom: string | null,
): string | null {
  const lan = addrs.filter((a) => !a.virtual);
  const near = panelFrom
    ? lan.find((a) => a.cidr !== null && inSubnet(panelFrom, a.cidr))
    : undefined;
  return (
    (near ?? lan.find((a) => privateLan(a.address)) ?? lan[0])?.address ?? null
  );
}

/**
 * When to show "Calico's address may have changed". The panel's last poll arrived on `via`.
 * Once that address is gone from this computer and the panel has been silent for SILENCE_MS, it
 * offers an address the panel can reach. A panel that is simply off, with the address still here,
 * shows nothing.
 */
export class AddressWatch {
  /** Silence counts from the latest of app start, the last poll, and the last wake. */
  private since: number;
  private dismissed = false;

  constructor(
    private last: PanelSeen | null,
    private readonly now: () => number,
  ) {
    this.since = now();
  }

  /** A poll arrived. True when it came from somewhere new, so the caller saves it. */
  polled(seen: PanelSeen): boolean {
    const changed =
      this.last?.from !== seen.from || this.last?.via !== seen.via;
    this.last = seen;
    this.since = this.now();
    this.dismissed = false;
    return changed;
  }

  /** The computer woke from sleep: the panel has had no chance to poll yet. */
  woke(): void {
    this.since = this.now();
  }

  /** "Not now": quiet until the panel polls again or the app restarts. */
  dismiss(): void {
    this.dismissed = true;
  }

  /** The address to offer, or null when there is no reason to show the banner. */
  check(addrs: LocalAddress[]): string | null {
    const last = this.last;
    // A self-assigned address is not one the panel can be reached on, and localAddresses drops it,
    // so it would always look gone: treat it as no history.
    if (!last || linkLocal(last.via) || this.now() - this.since < SILENCE_MS)
      return null;
    if (addrs.some((a) => a.address === last.via)) return null;
    if (this.dismissed) return null;
    return pickAddress(addrs, last.from);
  }
}

/** The last poll's addresses, kept so a restart on a new address still shows the banner. */
export function loadSeen(path: string): PanelSeen | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { from, via } = value as Record<string, unknown>;
    return typeof from === "string" &&
      typeof via === "string" &&
      isIPv4(from) &&
      isIPv4(via)
      ? { from, via }
      : null;
  } catch {
    return null;
  }
}

/** Best effort: a failed write only means a restart forgets where the panel last polled. */
export function saveSeen(path: string, seen: PanelSeen): void {
  try {
    writeAtomic(path, `${JSON.stringify(seen)}\n`);
  } catch {
    // Not worth failing the panel's poll over.
  }
}
