import { describe, expect, it } from "vitest";
import type { PushRelease, SavedNetwork } from "../../../shared/ipc";
import { BleLink, type Gatt } from "./ble";
import type { Cmd, DeviceLink, PanelNet } from "./commands";
import {
  buildPlan,
  planSize,
  planSteps,
  type PushStep,
  runPush,
} from "./push-plan";

const PASS = "placeholder-pass";
const TOKEN = "placeholder-token";
const net = (ssid: string, url = ""): SavedNetwork => ({
  ssid,
  url,
  password_set: true,
  token_set: true,
});
const onPanel = (ssid: string): PanelNet => ({
  ssid,
  has_url: false,
  has_token: false,
});

function fakeLink(fail?: Cmd["op"]) {
  const sent: Cmd[] = [];
  const live: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push({ ...cmd });
      live.push(cmd);
      return cmd.op === fail
        ? { ok: false, error: "Bluetooth: GATT Server is disconnected." }
        : { ok: true };
    },
    close() {},
  };
  return { link, sent, live };
}

function releaser(reply?: PushRelease) {
  const asked: string[] = [];
  const release = async (ssid: string): Promise<PushRelease> => {
    asked.push(ssid);
    return reply ? { ...reply } : { ok: true, password: PASS, token: TOKEN };
  };
  return { asked, release };
}

const quiet = () => undefined;

describe("buildPlan", () => {
  it("adds what only this computer has, resends what both have, removes what only the panel has", () => {
    expect(
      buildPlan(
        [net("home"), net("lab")],
        [onPanel("home"), onPanel("old")],
        "home",
      ),
    ).toEqual({
      add: [net("lab")],
      update: [net("home")],
      remove: ["old"],
      current: "home",
    });
  });

  it("compares SSIDs exactly, so Home and home are different networks", () => {
    const plan = buildPlan([net("Home")], [onPanel("home")], "");
    expect(plan.add.map((n) => n.ssid)).toEqual(["Home"]);
    expect(plan.remove).toEqual(["home"]);
  });

  it("treats leading and trailing spaces as part of the SSID", () => {
    const plan = buildPlan(
      [net("home ")],
      [onPanel("home"), onPanel(" lab")],
      "",
    );
    expect(plan.add.map((n) => n.ssid)).toEqual(["home "]);
    expect(plan.remove).toEqual(["home", " lab"]);
  });

  it("keeps a network literally named none when the panel has one, since status says none for no network too", () => {
    const plan = buildPlan([net("lab")], [onPanel("none")], "");
    expect(plan.current).toBe("none");
    expect(planSteps(plan, false).steps).toEqual([
      { op: "wifi", net: net("lab") },
    ]);
    expect(planSteps(plan, true).steps[0]).toEqual({
      op: "forget",
      ssid: "none",
    });
  });

  it("reads an empty current as disconnected when the panel has no network named none", () => {
    expect(buildPlan([net("lab")], [onPanel("old")], "").current).toBe("");
    expect(buildPlan([], [onPanel("old")], "old").current).toBe("old");
    expect(
      buildPlan([], [onPanel("none"), onPanel("cafe")], "cafe").current,
    ).toBe("cafe");
  });

  it("after a push that stopped halfway, plans the rest again", () => {
    // The first run resent home and removed old, then the link dropped before lab.
    expect(
      buildPlan([net("home"), net("lab")], [onPanel("home")], "home"),
    ).toEqual({
      add: [net("lab")],
      update: [net("home")],
      remove: [],
      current: "home",
    });
  });
});

describe("planSteps", () => {
  it("updates first, then removes, then adds", () => {
    const plan = buildPlan(
      [net("home"), net("lab")],
      [onPanel("home"), onPanel("old")],
      "",
    );
    expect(planSteps(plan, false)).toEqual({
      steps: [
        { op: "wifi", net: net("home") },
        { op: "forget", ssid: "old" },
        { op: "wifi", net: net("lab") },
      ],
      error: "",
    });
  });

  it("keeps the network the panel is on unless the person says to remove it", () => {
    const plan = buildPlan([net("lab")], [onPanel("cafe")], "cafe");
    expect(planSteps(plan, false).steps).toEqual([
      { op: "wifi", net: net("lab") },
    ]);
    expect(planSteps(plan, true).steps).toEqual([
      { op: "forget", ssid: "cafe" },
      { op: "wifi", net: net("lab") },
    ]);
  });

  it("refuses a plan that would leave the panel more than 8 networks", () => {
    const eight = Array.from({ length: 8 }, (_, i) => net(`n${i}`));
    const plan = buildPlan(eight, [onPanel("cafe")], "cafe");
    expect(planSteps(plan, false)).toEqual({
      steps: [],
      error:
        "The panel would need 9 networks and holds 8. Remove one in Settings, or let the push remove cafe.",
    });
    expect(planSteps(plan, true).steps).toHaveLength(9);
  });
});

describe("runPush", () => {
  it("asks main for each password once, writes it, and blanks the command after", async () => {
    const { link, sent, live } = fakeLink();
    const { asked, release } = releaser();
    const steps: PushStep[] = [
      { op: "wifi", net: net("home", "http://10.0.0.8:8787") },
      { op: "forget", ssid: "old" },
    ];
    expect(await runPush(link, steps, release, quiet)).toEqual({
      done: 2,
      total: 2,
      error: "",
    });
    expect(asked).toEqual(["home"]);
    expect(sent).toEqual([
      {
        op: "wifi",
        ssid: "home",
        pass: PASS,
        url: "http://10.0.0.8:8787",
        token: TOKEN,
      },
      { op: "forget", ssid: "old" },
    ]);
    expect(live[0]).toMatchObject({ pass: "", token: "" });
  });

  it("stops before writing when main refuses the password", async () => {
    const { link, sent } = fakeLink();
    const { release } = releaser({
      ok: false,
      error: "The keyring is locked.",
    });
    expect(
      await runPush(
        link,
        [
          { op: "wifi", net: net("home") },
          { op: "wifi", net: net("lab") },
        ],
        release,
        quiet,
      ),
    ).toEqual({ done: 0, total: 2, error: "The keyring is locked." });
    expect(sent).toEqual([]);
  });

  it("stops at the first failed write and says how far it got", async () => {
    const { link } = fakeLink("forget");
    const { asked, release } = releaser();
    expect(
      await runPush(
        link,
        [
          { op: "wifi", net: net("home") },
          { op: "forget", ssid: "old" },
          { op: "wifi", net: net("lab") },
        ],
        release,
        quiet,
      ),
    ).toEqual({
      done: 1,
      total: 3,
      error: "Bluetooth: GATT Server is disconnected.",
    });
    expect(asked).toEqual(["home"]);
  });

  it("refuses a password with a newline before anything reaches the panel", async () => {
    const writes: string[] = [];
    const gatt: Gatt = {
      async read() {
        return "count=0\n";
      },
      async write(uuid) {
        writes.push(uuid);
      },
      disconnect() {},
    };
    const { release } = releaser({
      ok: true,
      password: "placeholder\npass",
      token: "",
    });
    const result = await runPush(
      new BleLink(gatt, async () => undefined),
      [{ op: "wifi", net: net("home") }],
      release,
      quiet,
    );
    expect(result.done).toBe(0);
    expect(result.error).toMatch(/newline/);
    expect(result.error).not.toContain("placeholder");
    expect(writes).toEqual([]);
  });

  it("reports each step before it starts", async () => {
    const { link } = fakeLink();
    const { release } = releaser();
    const seen: number[] = [];
    await runPush(
      link,
      [
        { op: "forget", ssid: "old" },
        { op: "wifi", net: net("lab") },
      ],
      release,
      (i) => seen.push(i),
    );
    expect(seen).toEqual([0, 1]);
  });
});

describe("planSize", () => {
  it("counts every change, including the resent ones", () => {
    const plan = buildPlan(
      [net("home"), net("lab")],
      [onPanel("home"), onPanel("old")],
      "",
    );
    expect(planSize(plan)).toBe(3);
    expect(planSize(buildPlan([], [], ""))).toBe(0);
  });
});

describe("runPush secrets", () => {
  it("blanks the reply main gave it, and never shows the password in progress or results", async () => {
    const { link } = fakeLink();
    const reply = { ok: true as const, password: PASS, token: TOKEN };
    const seen: unknown[] = [];
    const result = await runPush(
      link,
      [{ op: "wifi", net: net("home") }],
      async () => reply,
      (i, step) => seen.push(i, step),
    );
    expect(reply).toMatchObject({ password: "", token: "" });
    expect(JSON.stringify([seen, result])).not.toContain(PASS);
    expect(JSON.stringify([seen, result])).not.toContain(TOKEN);
  });

  it("asks for a password only when its write is next", async () => {
    const order: string[] = [];
    const link: DeviceLink = {
      kind: "ble",
      async send(cmd) {
        order.push(`send:${cmd.op}`);
        return { ok: true };
      },
      close() {},
    };
    await runPush(
      link,
      [
        { op: "wifi", net: net("home") },
        { op: "wifi", net: net("lab") },
      ],
      async (ssid) => {
        order.push(`release:${ssid}`);
        return { ok: true, password: PASS, token: "" };
      },
      quiet,
    );
    expect(order).toEqual([
      "release:home",
      "send:wifi",
      "release:lab",
      "send:wifi",
    ]);
  });

  it("stops with a clear message when the link throws, and blanks the command", async () => {
    const live: Cmd[] = [];
    const link: DeviceLink = {
      kind: "ble",
      async send(cmd) {
        live.push(cmd);
        throw new Error("Bluetooth went away");
      },
      close() {},
    };
    const { release } = releaser();
    const result = await runPush(
      link,
      [{ op: "wifi", net: net("home") }],
      release,
      quiet,
    );
    expect(result).toEqual({
      done: 0,
      total: 1,
      error: "Bluetooth went away",
    });
    expect(live[0]).toMatchObject({ pass: "", token: "" });
  });

  it("stops with a clear message when main's release rejects", async () => {
    const { link, sent } = fakeLink();
    const result = await runPush(
      link,
      [{ op: "wifi", net: net("home") }],
      async () => {
        throw new Error("ipc closed");
      },
      quiet,
    );
    expect(result).toEqual({ done: 0, total: 1, error: "ipc closed" });
    expect(sent).toEqual([]);
  });
});

describe("runPush onStep", () => {
  it("stops with a message when the progress callback throws", async () => {
    const { link, sent } = fakeLink();
    const { release } = releaser();
    const result = await runPush(
      link,
      [{ op: "forget", ssid: "old" }],
      release,
      () => {
        throw new Error("render failed");
      },
    );
    expect(result).toEqual({ done: 0, total: 1, error: "render failed" });
    expect(sent).toEqual([]);
  });
});
