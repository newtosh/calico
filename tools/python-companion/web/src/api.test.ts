import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  injectBody,
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
});

describe("parsePanel", () => {
  it("reads the url and whether a token is stored", () => {
    expect(parsePanel({ url: "http://192.168.4.30:8787", token_set: true })).toEqual(
      { url: "http://192.168.4.30:8787", token_set: true },
    );
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
