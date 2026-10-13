import { afterEach, describe, expect, it, vi } from "vitest";
import header from "../../../../firmware/main/ble_desk.h?raw";
import {
  BLE_NAMES,
  BleLink,
  connectBle,
  type Gatt,
  requirePairing,
  UUID,
} from "./ble";

function fakeGatt(
  reads: Record<string, string[]>,
  opts: { failWrite?: string } = {},
) {
  const writes: [string, string][] = [];
  const gatt: Gatt = {
    async read(uuid) {
      const queue = reads[uuid] ?? [];
      return queue.length > 1 ? (queue.shift() ?? "") : (queue[0] ?? "");
    },
    async write(uuid, data) {
      if (uuid === opts.failWrite)
        throw new Error("GATT Server is disconnected.");
      writes.push([uuid, new TextDecoder().decode(data)]);
    },
    disconnect() {},
  };
  return { gatt, writes };
}

const instant = async () => undefined;

afterEach(() => vi.unstubAllGlobals());

describe("BleLink", () => {
  it("reads status", async () => {
    const { gatt } = fakeGatt({
      [UUID.status]: ["name=ginger\nfw=1\nssid=home\nurl=none\ntoken=none\n"],
    });
    expect(await new BleLink(gatt, instant).send({ op: "status" })).toEqual({
      ok: true,
      info: {
        name: "ginger",
        fw: "1",
        ssid: "home",
        url: "",
        token: "none",
      },
    });
  });

  it("writes an empty token as one newline", async () => {
    const { gatt, writes } = fakeGatt({});
    await new BleLink(gatt, instant).send({ op: "token", value: "" });
    expect(writes).toEqual([[UUID.token, "\n"]]);
  });

  it("scans until ready", async () => {
    const { gatt, writes } = fakeGatt({
      [UUID.scan]: ["state=busy\n", "state=busy\n", "state=ready\n-40\thome\n"],
    });
    const reply = await new BleLink(gatt, instant).send({ op: "scan" });
    expect(writes).toEqual([[UUID.scan, "scan"]]);
    expect(reply).toEqual({ ok: true, aps: [{ rssi: -40, ssid: "home" }] });
  });

  it("reports a failed verify with its reason and never writes wifi", async () => {
    const { gatt, writes } = fakeGatt({
      [UUID.verify]: [
        "state=busy\nssid=home\n",
        "state=fail\nssid=home\nreason=auth\n",
      ],
    });
    const reply = await new BleLink(gatt, instant).send({
      op: "verify",
      ssid: "home",
      pass: "wrongpass",
    });
    expect(reply).toEqual({
      ok: false,
      reason: "auth",
      error:
        "Could not join home. The password was rejected. Nothing was saved.",
    });
    expect(writes.map(([uuid]) => uuid)).toEqual([UUID.verify]);
  });

  it("times out a scan that never finishes", async () => {
    let t = 0;
    const { gatt } = fakeGatt({ [UUID.scan]: ["state=busy\n"] });
    const link = new BleLink(
      gatt,
      async () => {
        t += 1000;
      },
      () => t,
    );
    expect(await link.send({ op: "scan" })).toEqual({
      ok: false,
      error: "The desk did not finish scanning in 30 seconds.",
    });
  });

  it("reboot counts a dropped link as success", async () => {
    const { gatt } = fakeGatt({}, { failWrite: UUID.reboot });
    expect(await new BleLink(gatt, instant).send({ op: "reboot" })).toEqual({
      ok: true,
    });
  });

  it("turns validation errors into a failed reply", async () => {
    const { gatt, writes } = fakeGatt({});
    const reply = await new BleLink(gatt, instant).send({
      op: "url",
      value: "nope",
    });
    expect(reply.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("matches the firmware's UUIDs", () => {
    for (const [key, uuid] of Object.entries(UUID)) {
      const name = key === "svc" ? "SVC" : key.toUpperCase();
      expect(header).toContain(`#define BLE_DESK_UUID_${name} "${uuid}"`);
    }
  });

  it("advertises under the firmware's name and still finds the old one", () => {
    const firmware = /#define BLE_DESK_NAME "([^"]+)"/.exec(header)?.[1];
    expect(BLE_NAMES[0]).toBe(firmware);
    expect(BLE_NAMES).toContain("grokbot-buddy");
  });

  it("asks the browser for a panel under either name", async () => {
    const requestDevice = vi.fn(async () => {
      throw Object.assign(new Error("none"), { name: "NotFoundError" });
    });
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    await expect(connectBle(() => undefined)).rejects.toThrow("none");
    expect(requestDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: BLE_NAMES.map((name) => ({ name })),
      }),
    );
  });
});

describe("requirePairing", () => {
  it("accepts a panel that pairs and is already paired", () => {
    expect(
      requirePairing(
        "name=ginger\nfw=abc\nssid=Home\nurl=http://h\ntoken=set\npair=1\npaired=1\n",
      ),
    ).toBe("paired");
  });

  it("asks for pairing when the panel says the link is not paired", () => {
    expect(requirePairing("name=ginger\nfw=abc\npair=1\npaired=0\n")).toBe(
      "needs-pairing",
    );
  });

  it("refuses firmware that does not pair, so no secret is sent to it", () => {
    expect(() =>
      requirePairing("name=ginger\nfw=abc\nssid=Home\nurl=none\ntoken=none\n"),
    ).toThrow(/does not pair yet/);
    expect(() => requirePairing("")).toThrow(/does not pair yet/);
  });
});

const PAIR_FAILED =
  "Pairing did not finish. Confirm the same code on the panel and on this computer, then try again. If no code appeared, remove ginger from this computer's Bluetooth settings and connect again.";
const LINK_FAILED =
  "Could not talk to the panel over Bluetooth. Move closer and connect again.";

describe("connectBle pairing", () => {
  afterEach(() => vi.unstubAllGlobals());

  type Url = "ok" | "throw" | "hang";

  // One device object across connects, as Chromium hands back the same BluetoothDevice.
  function setup(
    status: string | Error,
    url: Url = "ok",
    opts: { failService?: boolean; failPeer?: boolean } = {},
  ) {
    const order: string[] = [];
    const writes: [string, string][] = [];
    const read: string[] = [];
    const listeners = new Set<() => void>();
    const hung: ((e: Error) => void)[] = [];
    const state = { status, url };
    // device.gatt is the server: connect() resolves with the same object.
    const server = {
      connect: async () => server,
      disconnect: vi.fn(() => order.push("disconnect")),
      getPrimaryService: async () => {
        if (opts.failService) throw new Error("GATT Error Unknown.");
        return {
          getCharacteristic: async (uuid: string) => ({
            readValue: async () => {
              read.push(uuid);
              if (uuid === UUID.status) {
                if (state.status instanceof Error) throw state.status;
                return new DataView(
                  new TextEncoder().encode(state.status).buffer,
                );
              }
              if (state.url === "throw") throw new Error("auth failed");
              if (state.url === "hang")
                return new Promise<DataView>((_, reject) => hung.push(reject));
              return new DataView(new TextEncoder().encode("url=x").buffer);
            },
            writeValueWithResponse: async (data: Uint8Array) => {
              if (uuid === UUID.peer && opts.failPeer)
                throw new Error("GATT Error Unknown.");
              writes.push([uuid, new TextDecoder().decode(data)]);
            },
          }),
        };
      },
    };
    const device = {
      gatt: server,
      addEventListener: vi.fn((_name: string, fn: () => void) =>
        listeners.add(fn),
      ),
      removeEventListener: vi.fn((name: string, fn: () => void) => {
        if (listeners.delete(fn)) order.push("remove:" + name);
      }),
      drop: () => [...listeners].forEach((fn) => fn()),
    };
    vi.stubGlobal("navigator", {
      bluetooth: { requestDevice: async () => device },
    });
    return { server, device, order, read, hung, state, listeners, writes };
  }

  it("refuses non-pairing firmware and disconnects after removing the listener", async () => {
    const s = setup("name=g\nfw=a\n");
    await expect(connectBle(() => {})).rejects.toThrow(/does not pair yet/);
    expect(s.server.disconnect).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["remove:gattserverdisconnected", "disconnect"]);
    expect(s.read).toEqual([UUID.status]);
  });

  it("reports an unfinished pairing and disconnects", async () => {
    const s = setup("pair=1\npaired=0\n", "throw");
    await expect(connectBle(() => {})).rejects.toThrow(PAIR_FAILED);
    expect(s.server.disconnect).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["remove:gattserverdisconnected", "disconnect"]);
  });

  it("hides the raw error when the status read fails, and disconnects", async () => {
    const s = setup(new Error("GATT Error Unknown."));
    await expect(connectBle(() => {})).rejects.toThrow(LINK_FAILED);
    expect(s.server.disconnect).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["remove:gattserverdisconnected", "disconnect"]);
  });

  it("disconnects when the service lookup fails", async () => {
    const s = setup("pair=1\npaired=1\n", "ok", { failService: true });
    await expect(connectBle(() => {})).rejects.toThrow(LINK_FAILED);
    expect(s.server.disconnect).toHaveBeenCalledTimes(1);
  });

  it("skips the protected read when already paired", async () => {
    const s = setup("pair=1\npaired=1\n");
    const onPairing = vi.fn();
    await expect(connectBle(() => {}, onPairing)).resolves.toBeInstanceOf(
      BleLink,
    );
    expect(s.read).toEqual([UUID.status]);
    expect(onPairing).not.toHaveBeenCalled();
    expect(s.server.disconnect).not.toHaveBeenCalled();
  });

  it("says pairing is under way and reads url once to trigger it", async () => {
    const s = setup("pair=1\npaired=0\n");
    const onPairing = vi.fn();
    await expect(connectBle(() => {}, onPairing)).resolves.toBeInstanceOf(
      BleLink,
    );
    expect(onPairing).toHaveBeenCalledTimes(1);
    expect(s.read.filter((u) => u === UUID.url)).toHaveLength(1);
    expect(s.server.disconnect).not.toHaveBeenCalled();
  });

  it("reports a drop only after connecting, not during pairing", async () => {
    const s = setup("pair=1\npaired=0\n", "hang");
    const onClosed = vi.fn();
    const pending = connectBle(onClosed);
    await vi.waitFor(() => expect(s.hung).toHaveLength(1));
    s.device.drop();
    // The panel refused the code: fail now, not when the OS read times out.
    await expect(pending).rejects.toThrow(PAIR_FAILED);
    expect(onClosed).not.toHaveBeenCalled();
    expect(s.listeners.size).toBe(0);

    s.state.url = "ok";
    await expect(connectBle(onClosed)).resolves.toBeInstanceOf(BleLink);
    s.device.drop();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("connects again after a refused pairing, and the old attempt does not cut the new link", async () => {
    const s = setup("pair=1\npaired=0\n", "hang");
    const first = connectBle(() => {});
    await vi.waitFor(() => expect(s.hung).toHaveLength(1));
    s.device.drop();
    await expect(first).rejects.toThrow(PAIR_FAILED);
    expect(s.server.disconnect).toHaveBeenCalledTimes(1);

    s.state.url = "ok";
    const link = await connectBle(() => {});
    // Chromium rejects the first read late, once the OS gives up on it.
    s.hung[0]?.(new Error("GATT Server is disconnected."));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.server.disconnect).toHaveBeenCalledTimes(1);
    expect(link).toBeInstanceOf(BleLink);
  });

  it("tells the panel this computer's name once, after connecting", async () => {
    const s = setup("pair=1\npaired=0\n");
    await expect(
      connectBle(() => {}, undefined, "jonn-desk"),
    ).resolves.toBeInstanceOf(BleLink);
    expect(s.writes).toEqual([[UUID.peer, "jonn-desk"]]);
  });

  it("connects even when the panel refuses the name", async () => {
    const s = setup("pair=1\npaired=1\n", "ok", { failPeer: true });
    await expect(
      connectBle(() => {}, undefined, "jonn-desk"),
    ).resolves.toBeInstanceOf(BleLink);
    expect(s.server.disconnect).not.toHaveBeenCalled();
  });

  it("sends no name when it has none", async () => {
    const s = setup("pair=1\npaired=1\n");
    await connectBle(() => {});
    expect(s.writes).toEqual([]);
  });
});
