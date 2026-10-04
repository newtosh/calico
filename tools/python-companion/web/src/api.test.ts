import { describe, expect, it } from "vitest";
import {
  agentIconUrl,
  agentMark,
  authorizationHeader,
  injectBody,
  NEUTRAL_MARK,
  parsePanel,
  parseStatus,
  rememberToken,
} from "./api";

describe("injectBody", () => {
  it("builds a manual needs-you event", () => {
    expect(injectBody("agent.needs_you", "a1", "Pick one")).toEqual({
      type: "agent.needs_you",
      agent_id: "a1",
      title: "a1",
      message: "Pick one",
      source: "manual",
    });
  });

  it("sends the token remembered for this browser", () => {
    const memory = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
      key: () => null,
      length: 0,
    };
    rememberToken("secret");
    expect(authorizationHeader()).toEqual({ Authorization: "Bearer secret" });
  });

  it("omits identity fields that were left blank", () => {
    expect(
      injectBody("agent.launched", "a1", "go", { color: "  ", shape: "" }),
    ).toEqual({
      type: "agent.launched",
      agent_id: "a1",
      title: "a1",
      message: "go",
      source: "manual",
    });
  });

  it("sends color, shape, and icon when they are set", () => {
    expect(
      injectBody("agent.launched", "a1", "go", {
        color: "#c45c26",
        shape: "diamond",
        icon: "bolt",
      }),
    ).toEqual({
      type: "agent.launched",
      agent_id: "a1",
      title: "a1",
      message: "go",
      source: "manual",
      color: "#c45c26",
      shape: "diamond",
      icon: "bolt",
    });
  });
});

describe("agent identity", () => {
  it("uses one neutral mark when color and shape are omitted", () => {
    expect(agentMark("", "")).toEqual({ color: NEUTRAL_MARK, shape: "circle" });
    expect(agentMark("coral", "hexagon")).toEqual({
      color: NEUTRAL_MARK,
      shape: "circle",
    });
  });

  it("keeps a real color when the shape was omitted", () => {
    expect(agentMark("#C45C26", "")).toEqual({
      color: "#C45C26",
      shape: "circle",
    });
    expect(agentMark("224466", "square")).toEqual({
      color: "#224466",
      shape: "square",
    });
  });

  it("shows an icon url and ignores other icon strings", () => {
    expect(agentIconUrl("https://example.test/a.png")).toBe(
      "https://example.test/a.png",
    );
    expect(agentIconUrl("bolt")).toBe("");
    expect(agentIconUrl("javascript:alert(1)")).toBe("");
  });

  it("reads identity from status and leaves missing fields empty", () => {
    const status = parseStatus({
      phase: "running",
      needs_you: false,
      agents: [
        {
          id: "a1",
          title: "Scaffold",
          status: "running",
          color: "#112233",
          shape: "triangle",
        },
        { id: "a2", status: "idle" },
      ],
      last_event: { id: "e1", type: "agent.launched", icon: "bolt" },
      events: [],
    });
    expect(status.agents[0]).toMatchObject({
      color: "#112233",
      shape: "triangle",
      icon: "",
    });
    expect(status.agents[1]).toMatchObject({ color: "", shape: "", icon: "" });
    expect(status.last_event).toMatchObject({
      color: "",
      shape: "",
      icon: "bolt",
    });
  });
});

describe("parsePanel", () => {
  it("reads the url and whether a token is stored", () => {
    expect(
      parsePanel({ url: "http://192.168.4.30:8787", token_set: true }),
    ).toEqual({ url: "http://192.168.4.30:8787", token_set: true });
  });

  it("does not require the bearer token in the masked view", () => {
    expect(parsePanel({ url: "", token_set: false, token: "hidden" })).toEqual({
      url: "",
      token_set: false,
    });
  });
});

describe("parseStatus", () => {
  it("keeps polling when a panel push is attached", () => {
    const status = parseStatus({
      phase: "idle",
      needs_you: false,
      agents: [],
      last_event: null,
      events: [],
      panel: { url: "http://192.168.4.30:8787", token: "desk-secret" },
    });
    expect(status.phase).toBe("idle");
    expect(status).not.toHaveProperty("panel");
  });
});
