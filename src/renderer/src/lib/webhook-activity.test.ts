import { describe, expect, it } from "vitest";
import type { WebhookActivity } from "../../../shared/ipc";
import { activityLines } from "./webhook-activity";

const NOW = Date.parse("2026-10-09T18:00:00Z");
const none: WebhookActivity = {
  accepted: null,
  refused: { count: 0, last: null },
};

describe("activityLines", () => {
  it("says nothing arrived when nothing has", () => {
    expect(activityLines(none, NOW)).toEqual({
      received: "No updates received since calico started.",
      refused: "",
    });
  });

  it("says when and from where the last update came", () => {
    const lines = activityLines(
      { ...none, accepted: { at: NOW - 3 * 60_000, from: "192.168.4.30" } },
      NOW,
    );
    expect(lines.received).toBe(
      "Last update received 3 min ago, from 192.168.4.30.",
    );
    expect(lines.refused).toBe("");
  });

  it("reports refused requests with the last reason, time, and address", () => {
    const lines = activityLines(
      {
        accepted: null,
        refused: {
          count: 4,
          last: {
            at: NOW - 12 * 60_000,
            reason: "unauthorized",
            from: "10.0.10.9",
          },
        },
      },
      NOW,
    );
    expect(lines.refused).toBe(
      "4 requests refused since calico started. Last: wrong or missing token, 12 min ago, from 10.0.10.9.",
    );
  });

  it("says one request, not 1 requests", () => {
    const lines = activityLines(
      {
        accepted: null,
        refused: {
          count: 1,
          last: { at: NOW, reason: "bad_json", from: "127.0.0.1" },
        },
      },
      NOW,
    );
    expect(lines.refused.startsWith("1 request refused since")).toBe(true);
    expect(lines.refused).toContain("not valid JSON");
  });

  it("names every reason in plain words", () => {
    const words = (
      reason: WebhookActivity["refused"]["last"] extends infer L
        ? L extends { reason: infer R }
          ? R
          : never
        : never,
    ) =>
      activityLines(
        {
          accepted: null,
          refused: { count: 1, last: { at: NOW, reason, from: "x" } },
        },
        NOW,
      ).refused;
    expect(words("forbidden_origin")).toContain("sent by a web page");
    expect(words("bad_event")).toContain("not a valid event");
    expect(words("too_large")).toContain("too large");
  });
});
