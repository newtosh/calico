import {
  type Cmd,
  describeProbeFailure,
  type DeviceLink,
  FieldError,
  infoFromKv,
  parseKv,
  parseProbe,
  parseScan,
  type Reply,
  timeoutFor,
  toReason,
  validateCmd,
} from "./commands";

// The first name is the firmware's (firmware/main/ble_desk.h, checked by a test).
// A panel flashed before the rename still advertises the old one.
export const BLE_NAMES = ["ginger", "grokbot-buddy"] as const;
// UUIDs are checked against firmware/main/ble_desk.h by a test.
export const UUID = {
  svc: "8d7c4b10-6e2a-4f91-a3c5-67726f6b6465",
  status: "8d7c4b11-6e2a-4f91-a3c5-67726f6b6465",
  url: "8d7c4b12-6e2a-4f91-a3c5-67726f6b6465",
  token: "8d7c4b13-6e2a-4f91-a3c5-67726f6b6465",
  wifi: "8d7c4b14-6e2a-4f91-a3c5-67726f6b6465",
  reboot: "8d7c4b15-6e2a-4f91-a3c5-67726f6b6465",
  scan: "8d7c4b16-6e2a-4f91-a3c5-67726f6b6465",
  verify: "8d7c4b17-6e2a-4f91-a3c5-67726f6b6465",
} as const;

export interface Gatt {
  read(uuid: string): Promise<string>;
  write(uuid: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  disconnect(): void;
}

const encode = (text: string) => new TextEncoder().encode(text);
const POLL_MS = 1000;

export class BleLink implements DeviceLink {
  readonly kind = "ble" as const;

  constructor(
    private readonly gatt: Gatt,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async send(cmd: Cmd): Promise<Reply> {
    try {
      validateCmd(cmd);
      return await this.run(cmd);
    } catch (err) {
      if (err instanceof FieldError) return { ok: false, error: err.message };
      return { ok: false, error: `Bluetooth: ${(err as Error).message}` };
    }
  }

  close(): void {
    this.gatt.disconnect();
  }

  private async run(cmd: Cmd): Promise<Reply> {
    switch (cmd.op) {
      case "status":
        return {
          ok: true,
          info: infoFromKv(parseKv(await this.gatt.read(UUID.status))),
        };
      case "url":
        await this.gatt.write(UUID.url, encode(cmd.value));
        return { ok: true };
      case "token":
        // A zero-length ATT write is easy to drop. One newline strips to empty on the desk.
        await this.gatt.write(
          UUID.token,
          encode(cmd.value === "" ? "\n" : cmd.value),
        );
        return { ok: true };
      case "wifi":
        await this.gatt.write(UUID.wifi, encode(`${cmd.ssid}\n${cmd.pass}`));
        return { ok: true };
      case "reboot":
        try {
          await this.gatt.write(UUID.reboot, encode("reboot"));
        } catch {
          // The desk resets as it handles the write, so the link often drops first.
        }
        return { ok: true };
      case "scan": {
        await this.gatt.write(UUID.scan, encode("scan"));
        const body = await this.pollUntil(
          UUID.scan,
          ["ready", "fail"],
          timeoutFor(cmd),
        );
        if (body === null)
          return {
            ok: false,
            error: "The desk did not finish scanning in 30 seconds.",
          };
        const { state, aps } = parseScan(body);
        return state === "ready"
          ? { ok: true, aps }
          : { ok: false, error: "The desk could not scan for networks." };
      }
      case "verify": {
        // The desk sets state=busy before this write returns (firmware
        // ble_link.c, write_verify), so polling right after the write cannot
        // see an older state=ok.
        await this.gatt.write(UUID.verify, encode(`${cmd.ssid}\n${cmd.pass}`));
        const body = await this.pollUntil(
          UUID.verify,
          ["ok", "fail"],
          timeoutFor(cmd),
        );
        if (body === null)
          return {
            ok: false,
            reason: "timeout",
            error: describeProbeFailure(cmd.ssid, "timeout"),
          };
        const probe = parseProbe(body);
        if (probe.state === "ok") return { ok: true };
        return {
          ok: false,
          reason: toReason(probe.reason),
          error: describeProbeFailure(probe.ssid || cmd.ssid, probe.reason),
        };
      }
    }
  }

  private async pollUntil(
    uuid: string,
    done: string[],
    timeoutMs: number,
  ): Promise<string | null> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const body = await this.gatt.read(uuid);
      if (done.includes(parseKv(body).state ?? "")) return body;
      await this.sleep(POLL_MS);
    }
    return null;
  }
}

export async function connectBle(onClosed: () => void): Promise<BleLink> {
  const device = await navigator.bluetooth.requestDevice({
    filters: BLE_NAMES.map((name) => ({ name })),
    optionalServices: [UUID.svc],
  });
  if (!device.gatt) throw new Error("This device has no GATT server.");
  device.addEventListener("gattserverdisconnected", onClosed, { once: true });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(UUID.svc);
  const chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  const char = async (uuid: string) => {
    let c = chars.get(uuid);
    if (!c) {
      c = await service.getCharacteristic(uuid);
      chars.set(uuid, c);
    }
    return c;
  };
  const decoder = new TextDecoder();
  return new BleLink({
    async read(uuid) {
      const view = await (await char(uuid)).readValue();
      return decoder.decode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      );
    },
    async write(uuid, data) {
      await (await char(uuid)).writeValueWithResponse(data);
    },
    disconnect: () => server.disconnect(),
  });
}
