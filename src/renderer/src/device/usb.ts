import {
  type Ap,
  type Cmd,
  type DeviceLink,
  FieldError,
  type Reply,
  secretsOf,
  timeoutFor,
  toReason,
  validateCmd,
} from "./commands";

export interface LineTransport {
  write(line: string): Promise<void>;
  close(): Promise<void> | void;
}

export class LineSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, ""));
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function toReply(obj: Record<string, unknown>): Reply {
  if (obj.ok !== true) {
    const reply: Reply = {
      ok: false,
      error: str(obj.error) || "The desk reported an error.",
    };
    if (typeof obj.reason === "string") reply.reason = toReason(obj.reason);
    return reply;
  }
  const reply: Reply = { ok: true };
  if (typeof obj.name === "string") {
    reply.info = {
      name: obj.name,
      fw: str(obj.fw),
      ssid: str(obj.ssid),
      url: str(obj.url),
      token: obj.token === "set" ? "set" : "none",
    };
  }
  if (Array.isArray(obj.aps)) {
    reply.aps = obj.aps.flatMap((ap): Ap[] =>
      ap &&
      typeof ap === "object" &&
      typeof (ap as Ap).rssi === "number" &&
      typeof (ap as Ap).ssid === "string"
        ? [{ rssi: (ap as Ap).rssi, ssid: (ap as Ap).ssid }]
        : [],
    );
  }
  return reply;
}

interface Pending {
  resolve: (reply: Reply) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class UsbLink implements DeviceLink {
  readonly kind = "usb" as const;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  // Secrets sent this session. Redacted from any log line, even after the reply.
  private readonly secrets = new Set<string>();

  constructor(
    private readonly transport: LineTransport,
    private readonly onLog: (line: string) => void,
  ) {}

  handleLine(line: string): void {
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const entry =
          typeof obj.id === "number" ? this.pending.get(obj.id) : undefined;
        if (entry && typeof obj.id === "number") {
          clearTimeout(entry.timer);
          this.pending.delete(obj.id);
          entry.resolve(toReply(obj));
          return;
        }
      } catch {
        // Not JSON after all. Fall through to the log.
      }
    }
    this.onLog(this.redact(line));
  }

  async send(cmd: Cmd): Promise<Reply> {
    try {
      validateCmd(cmd);
    } catch (err) {
      return { ok: false, error: (err as FieldError).message };
    }
    for (const secret of secretsOf(cmd)) this.secrets.add(secret);
    const id = this.nextId++;
    const seconds = timeoutFor(cmd) / 1000;
    const reply = new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false,
          error: `The desk did not answer in ${seconds} seconds.`,
        });
      }, timeoutFor(cmd));
      this.pending.set(id, { resolve, timer });
    });
    try {
      await this.transport.write(`${JSON.stringify({ id, ...cmd })}\n`);
    } catch (err) {
      this.settle(id, { ok: false, error: `USB: ${(err as Error).message}` });
    }
    return reply;
  }

  close(): void {
    for (const id of [...this.pending.keys()])
      this.settle(id, { ok: false, error: "The USB link closed." });
    void this.transport.close();
  }

  private settle(id: number, reply: Reply): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(reply);
  }

  private redact(line: string): string {
    let out = line;
    for (const secret of this.secrets) out = out.split(secret).join("••••");
    return out;
  }
}

export async function connectUsb(
  onLog: (line: string) => void,
  onClosed: () => void,
): Promise<UsbLink> {
  // 0x303a is Espressif. The S3's USB-Serial-JTAG enumerates with it.
  const port = await navigator.serial.requestPort({
    filters: [{ usbVendorId: 0x303a }],
  });
  await port.open({ baudRate: 115200 });
  if (!port.readable || !port.writable)
    throw new Error("The serial port opened without streams.");
  const writer = port.writable.getWriter();
  const reader = port.readable
    .pipeThrough(
      new TextDecoderStream() as unknown as ReadableWritablePair<
        string,
        Uint8Array
      >,
    )
    .getReader();
  const encoder = new TextEncoder();
  const usb = new UsbLink(
    {
      write: (line) => writer.write(encoder.encode(line)),
      close: async () => {
        await reader.cancel().catch(() => undefined);
        writer.releaseLock();
        await port.close().catch(() => undefined);
      },
    },
    onLog,
  );
  const splitter = new LineSplitter();
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of splitter.push(value)) usb.handleLine(line);
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      usb.close();
      onClosed();
    });
  return usb;
}
