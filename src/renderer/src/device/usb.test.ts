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
