import { describe, expect, it } from "vitest";
import header from "../../../../test/parity/ble_desk.h?raw";
import { BleLink, type Gatt, UUID } from "./ble";

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

describe("BleLink", () => {
  it("reads status", async () => {
    const { gatt } = fakeGatt({
      [UUID.status]: [
        "name=grokbot-buddy\nfw=1\nssid=home\nurl=none\ntoken=none\n",
      ],
    });
    expect(await new BleLink(gatt, instant).send({ op: "status" })).toEqual({
      ok: true,
      info: {
        name: "grokbot-buddy",
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
});
