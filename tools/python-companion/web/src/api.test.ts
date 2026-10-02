import { describe, expect, it } from "vitest";
import { authorizationHeader, injectBody, rememberToken } from "./api";

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
