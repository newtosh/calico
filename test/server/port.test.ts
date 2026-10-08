import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  lanUrls,
  listenWithFallback,
  PanelPort,
  PortsBusyError,
  resolvePort,
} from "../../src/server/port";

async function occupy(): Promise<{ port: number; close: () => void }> {
  const s = http.createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return { port: (s.address() as AddressInfo).port, close: () => s.close() };
}

describe("port selection", () => {
  it("moves past a busy port", async () => {
    const busy = await occupy();
    const server = http.createServer();
    try {
      const port = await listenWithFallback(server, "127.0.0.1", busy.port);
      expect(port).toBeGreaterThan(busy.port);
      expect(port).toBeLessThanOrEqual(busy.port + 12);
    } finally {
      server.close();
      busy.close();
    }
  });

  it("throws PortsBusyError when the whole span is taken", async () => {
    const busy = await occupy();
    const server = http.createServer();
    try {
      await expect(
        listenWithFallback(server, "127.0.0.1", busy.port, 0),
      ).rejects.toBeInstanceOf(PortsBusyError);
    } finally {
      busy.close();
    }
  });

  it("persists the bound port on first run", () => {
    expect(resolvePort(false, 8787, 8788)).toEqual({
      persist: true,
      drift: false,
    });
  });

  it("does not persist a fallback over a saved port", () => {
    expect(resolvePort(true, 8787, 8789)).toEqual({
      persist: false,
      drift: true,
    });
    expect(resolvePort(true, 8787, 8787)).toEqual({
      persist: false,
      drift: false,
    });
  });

  it("lists non-internal IPv4 addresses", () => {
    const ifaces = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wlan0: [
        { address: "192.168.4.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
    } as unknown as NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>;
    expect(lanUrls(8787, ifaces)).toEqual(["http://192.168.4.20:8787"]);
  });
});

describe("PanelPort", () => {
  it("reports drift only while calico is on a different port than the panel", () => {
    const panel = new PanelPort(8787);
    expect(panel.driftFrom(8787)).toBeNull();
    expect(panel.driftFrom(8788)).toBe(8787);
    expect(panel.driftFrom(null)).toBeNull();
  });

  it("stops reporting drift once the panel is re-pointed", () => {
    const panel = new PanelPort(8787);
    panel.adopt(8788);
    expect(panel.expected).toBe(8788);
    expect(panel.driftFrom(8788)).toBeNull();
  });
});
