import { mkdtempSync, writeFileSync } from "node:fs";
import { type NetworkInterfaceInfo, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AddressWatch,
  inSubnet,
  loadSeen,
  type LocalAddress,
  localAddresses,
  pickAddress,
  saveSeen,
  SILENCE_MS,
} from "../../src/main/panel-address";

const wifi: LocalAddress = {
  iface: "wlp2s0",
  address: "192.168.4.30",
  cidr: "192.168.4.30/24",
  virtual: false,
};
const wired: LocalAddress = {
  iface: "enp3s0",
  address: "10.0.10.110",
  cidr: "10.0.10.110/24",
  virtual: false,
};
const docker: LocalAddress = {
  iface: "docker0",
  address: "172.17.0.1",
  cidr: "172.17.0.1/16",
  virtual: true,
};
const tailscale: LocalAddress = {
  iface: "tailscale0",
  address: "100.101.102.103",
  cidr: "100.101.102.103/32",
  virtual: true,
};

// The panel last polled 192.168.4.20, an address this computer no longer has.
const seen = { from: "192.168.4.31", via: "192.168.4.20" };

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const v4 = (address: string, cidr: string) => ({
  address,
  cidr,
  netmask: "",
  mac: "",
  family: "IPv4",
  internal: false,
});
const ifaces = (map: Record<string, object[]>) =>
  map as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;

describe("inSubnet", () => {
  it("matches an IPv4 address against a CIDR", () => {
    expect(inSubnet("192.168.4.31", "192.168.4.30/24")).toBe(true);
    expect(inSubnet("192.168.5.31", "192.168.4.30/24")).toBe(false);
    expect(inSubnet("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(inSubnet("100.127.255.255", "100.64.0.0/10")).toBe(true);
    expect(inSubnet("100.128.0.1", "100.64.0.0/10")).toBe(false);
    expect(inSubnet("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(inSubnet("192.168.4.30", "192.168.4.30/32")).toBe(true);
  });

  it("is false for IPv6 or a malformed CIDR", () => {
    expect(inSubnet("fe80::1", "192.168.4.0/24")).toBe(false);
    expect(inSubnet("192.168.4.1", "fe80::/64")).toBe(false);
    expect(inSubnet("192.168.4.1", "192.168.4.0/33")).toBe(false);
    expect(inSubnet("192.168.4.1", "nonsense")).toBe(false);
  });
});

describe("localAddresses", () => {
  it("keeps IPv4 LAN addresses, drops IPv6, loopback and link-local, and marks VPN and container interfaces", () => {
    expect(
      localAddresses(
        ifaces({
          lo: [{ ...v4("127.0.0.1", "127.0.0.1/8"), internal: true }],
          wlp2s0: [
            v4("192.168.4.30", "192.168.4.30/24"),
            { ...v4("fe80::1", "fe80::1/64"), family: "IPv6" },
          ],
          enp3s0: [v4("169.254.10.2", "169.254.10.2/16")],
          docker0: [v4("172.17.0.1", "172.17.0.1/16")],
          "br-1a2b3c": [v4("172.18.0.1", "172.18.0.1/16")],
          tailscale0: [v4("100.101.102.103", "100.101.102.103/32")],
          wg0: [v4("10.8.0.2", "10.8.0.2/24")],
          eth9: [v4("100.70.0.5", "100.70.0.5/10")],
        }),
      ),
    ).toEqual([
      wifi,
      docker,
      {
        iface: "br-1a2b3c",
        address: "172.18.0.1",
        cidr: "172.18.0.1/16",
        virtual: true,
      },
      tailscale,
      { iface: "wg0", address: "10.8.0.2", cidr: "10.8.0.2/24", virtual: true },
      // Carrier-grade NAT is Tailscale's range, whatever the interface is called.
      {
        iface: "eth9",
        address: "100.70.0.5",
        cidr: "100.70.0.5/10",
        virtual: true,
      },
    ]);
  });
});

describe("pickAddress", () => {
  it("uses the address on the subnet the panel polled from", () => {
    expect(pickAddress([wired, wifi], "192.168.4.31")).toBe("192.168.4.30");
  });

  it("with two addresses on the panel's subnet, uses one of those and never docker", () => {
    const wiredSame: LocalAddress = {
      iface: "enp3s0",
      address: "192.168.4.40",
      cidr: "192.168.4.40/24",
      virtual: false,
    };
    expect(pickAddress([docker, wiredSame, wifi], "192.168.4.31")).toBe(
      "192.168.4.40",
    );
  });

  it("with no history, uses the first LAN address", () => {
    expect(pickAddress([docker, tailscale, wired, wifi], null)).toBe(
      "10.0.10.110",
    );
  });

  it("gives a panel outside every local subnet the first LAN address", () => {
    expect(pickAddress([wired, wifi], "192.168.9.50")).toBe("10.0.10.110");
  });

  it("never offers a VPN or container address over a LAN one", () => {
    expect(pickAddress([tailscale, docker, wifi], "100.101.0.9")).toBe(
      "192.168.4.30",
    );
    expect(pickAddress([docker, tailscale], null)).toBeNull();
    expect(pickAddress([], "192.168.4.31")).toBeNull();
  });

  it("prefers a private address over a public one, and a missing netmask never matches", () => {
    const routed: LocalAddress = {
      iface: "eth0",
      address: "203.0.113.5",
      cidr: "203.0.113.5/24",
      virtual: false,
    };
    expect(pickAddress([routed, wifi], null)).toBe("192.168.4.30");
    expect(pickAddress([wired, { ...wifi, cidr: null }], "192.168.4.31")).toBe(
      "10.0.10.110",
    );
  });
});

describe("AddressWatch", () => {
  it("stays quiet with no saved poll", () => {
    const c = clock();
    const watch = new AddressWatch(null, c.now);
    c.advance(SILENCE_MS * 10);
    expect(watch.check([wifi])).toBeNull();
  });

  it("waits 60 s of silence from app start before offering an address", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS - 1);
    expect(watch.check([wifi])).toBeNull();
    c.advance(1);
    expect(watch.check([wifi])).toBe("192.168.4.30");
  });

  it("stays quiet while the address the panel used is still here, so a panel that is simply off shows nothing", () => {
    const c = clock();
    const watch = new AddressWatch({ ...seen, via: "192.168.4.30" }, c.now);
    c.advance(SILENCE_MS * 10);
    expect(watch.check([wifi, docker])).toBeNull();
  });

  it("restarts the silence on each poll and says when the poll came from somewhere new", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    expect(watch.polled(seen)).toBe(false);
    expect(watch.check([wifi])).toBeNull();
    c.advance(SILENCE_MS - 1);
    expect(watch.check([wifi])).toBeNull();
    expect(watch.polled({ ...seen, via: "192.168.4.30" })).toBe(true);
    expect(new AddressWatch(null, c.now).polled(seen)).toBe(true);
  });

  it("restarts the silence after the computer wakes from sleep", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS * 5);
    watch.woke();
    expect(watch.check([wifi])).toBeNull();
    c.advance(SILENCE_MS);
    expect(watch.check([wifi])).toBe("192.168.4.30");
  });

  it("stays quiet with no LAN address, as while the network comes back", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    expect(watch.check([])).toBeNull();
    expect(watch.check([docker, tailscale])).toBeNull();
  });

  it("ignores VPN and container addresses when choosing", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    expect(watch.check([tailscale, docker, wifi])).toBe("192.168.4.30");
  });

  it("holds Not now until this computer's addresses change or the panel polls", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    watch.dismiss([wifi]);
    expect(watch.check([wifi])).toBeNull();
    expect(watch.check([wifi, wired])).toBe("192.168.4.30");
    watch.dismiss([wifi]);
    watch.polled(seen);
    c.advance(SILENCE_MS);
    expect(watch.check([wifi])).toBe("192.168.4.30");
  });
});

describe("saved poll", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "calico-seen-"));

  it("keeps the last poll across a restart", () => {
    const path = join(dir(), "panel-seen.json");
    saveSeen(path, seen);
    expect(loadSeen(path)).toEqual(seen);
  });

  it("reads nothing from a missing, damaged or wrong file", () => {
    const d = dir();
    expect(loadSeen(join(d, "none.json"))).toBeNull();
    for (const [name, text] of [
      ["bad.json", "{bad"],
      ["null.json", "null"],
      ["v6.json", JSON.stringify({ from: "fe80::1", via: "192.168.4.20" })],
      ["type.json", JSON.stringify({ from: 1, via: "192.168.4.20" })],
    ] as const) {
      writeFileSync(join(d, name), text);
      expect(loadSeen(join(d, name))).toBeNull();
    }
  });

  it("does not throw when it cannot save", () => {
    const d = dir();
    const file = join(d, "a-file");
    writeFileSync(file, "x");
    expect(() => saveSeen(join(file, "panel-seen.json"), seen)).not.toThrow();
  });
});
