import { afterEach, describe, expect, it, vi } from "vitest";
import { LineSplitter, toReply, UsbLink } from "./usb";

afterEach(() => vi.useRealTimers());

function link() {
  const sent: string[] = [];
  const logs: string[] = [];
  const usb = new UsbLink(
    {
      async write(line) {
        sent.push(line);
      },
      close() {},
    },
    (line) => logs.push(line),
  );
  return { usb, sent, logs };
}

describe("LineSplitter", () => {
  it("joins partial chunks and strips CR", () => {
    const s = new LineSplitter();
    expect(s.push('{"id":1,')).toEqual([]);
    expect(s.push('"ok":true}\r\nI (12) boot\n')).toEqual([
      '{"id":1,"ok":true}',
      "I (12) boot",
    ]);
  });
});

describe("UsbLink", () => {
  it("sends NDJSON and resolves the matching reply", async () => {
    const { usb, sent } = link();
    const pending = usb.send({ op: "url", value: "http://h:8787" });
    await Promise.resolve();
    expect(sent).toEqual(['{"id":1,"op":"url","value":"http://h:8787"}\n']);
    usb.handleLine('{"id":1,"ok":true}');
    expect(await pending).toEqual({ ok: true });
  });

  it("routes non-JSON and unknown ids to the log", () => {
    const { usb, logs } = link();
    usb.handleLine("I (100) wifi: connected");
    usb.handleLine('{"id":99,"ok":true}');
    expect(logs).toEqual(["I (100) wifi: connected", '{"id":99,"ok":true}']);
  });

  it("times out after 10 s", async () => {
    vi.useFakeTimers();
    const { usb } = link();
    const pending = usb.send({ op: "status" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      ok: false,
      error: "The desk did not answer in 10 seconds.",
    });
  });

  it("redacts secrets the device echoes", async () => {
    const { usb, logs } = link();
    const pending = usb.send({ op: "verify", ssid: "home", pass: "hunter22" });
    await Promise.resolve();
    usb.handleLine("W (5) wifi: trying home with hunter22");
    usb.handleLine('{"id":1,"ok":true}');
    await pending;
    usb.handleLine("later hunter22 again");
    expect(logs).toEqual([
      "W (5) wifi: trying home with ••••",
      "later •••• again",
    ]);
  });

  it("fails pending requests when closed", async () => {
    const { usb } = link();
    const pending = usb.send({ op: "status" });
    usb.close();
    expect(await pending).toEqual({ ok: false, error: "The USB link closed." });
  });

  it("rejects invalid fields without sending", async () => {
    const { usb, sent } = link();
    expect((await usb.send({ op: "wifi", ssid: "", pass: "" })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("maps replies", () => {
    expect(
      toReply({
        ok: true,
        name: "grokbot-buddy",
        fw: "1",
        ssid: "",
        url: "",
        token: "none",
      }),
    ).toEqual({
      ok: true,
      info: {
        name: "grokbot-buddy",
        fw: "1",
        ssid: "",
        url: "",
        token: "none",
      },
    });
    expect(
      toReply({ ok: true, aps: [{ rssi: -40, ssid: "home" }, { bad: 1 }] }),
    ).toEqual({ ok: true, aps: [{ rssi: -40, ssid: "home" }] });
    expect(
      toReply({ ok: false, error: "auth failed", reason: "auth" }),
    ).toEqual({ ok: false, error: "auth failed", reason: "auth" });
  });
});

describe("secret redaction across links", () => {
  async function fresh() {
    vi.resetModules();
    return await import("./usb");
  }
  const mk = (UsbLink: typeof import("./usb").UsbLink, logs: string[]) =>
    new UsbLink({ async write() {}, close() {} }, (line) => logs.push(line));

  it("keeps hiding a password after the desk reboots and the app reconnects", async () => {
    const { UsbLink } = await fresh();
    const first = mk(UsbLink, []);
    const pending = first.send({ op: "wifi", ssid: "home", pass: "hunter22" });
    await Promise.resolve();
    first.handleLine('{"id":1,"ok":true}');
    await pending;
    first.close();
    const logs: string[] = [];
    mk(UsbLink, logs).handleLine("I (40) desk: saved home hunter22");
    expect(logs).toEqual(["I (40) desk: saved home ••••"]);
  });

  it("hides a secret the firmware printed JSON-escaped", async () => {
    const { UsbLink } = await fresh();
    const logs: string[] = [];
    const usb = mk(UsbLink, logs);
    const secret = 'to"ken\\1';
    const pending = usb.send({ op: "token", value: secret });
    await Promise.resolve();
    usb.handleLine('{"id":1,"ok":true}');
    await pending;
    usb.handleLine(JSON.stringify({ note: `token is ${secret}` }));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe('{"note":"token is ••••"}');
  });
});
