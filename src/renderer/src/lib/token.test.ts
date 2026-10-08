import { describe, expect, it } from "vitest";
import { newWebhookToken } from "./token";

describe("newWebhookToken", () => {
  it("is 64 hex characters and different each time", () => {
    const a = newWebhookToken();
    const b = newWebhookToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
