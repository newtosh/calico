import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentMark,
  configureApi,
  fetchCursor,
  fetchStatus,
  injectBody,
  NEUTRAL_MARK,
  parseStatus,
  postDismiss,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("builds a manual inject body with optional identity", () => {
    expect(
      injectBody("agent.needs_you", "a1", "Pick one", {
        color: " #9bb57a ",
        shape: "",
      }),
    ).toEqual({
      type: "agent.needs_you",
      agent_id: "a1",
      title: "a1",
      message: "Pick one",
      source: "manual",
      color: "#9bb57a",
    });
  });

  it("normalizes marks", () => {
    expect(agentMark("9bb57a", "Diamond")).toEqual({
      color: "#9bb57a",
      shape: "diamond",
    });
    expect(agentMark("red", "blob")).toEqual({
      color: NEUTRAL_MARK,
      shape: "circle",
    });
  });

  it("parses status and keeps attention and message", () => {
    const status = parseStatus({
      phase: "needs_you",
      needs_you: true,
      unread: 1,
      agents: [
        {
          id: "a1",
          title: "A",
          status: "needs_you",
          attention: true,
          message: "q",
        },
        { nope: 1 },
      ],
      last_event: null,
      events: [],
    });
    expect(status.agents).toEqual([
      {
        id: "a1",
        title: "A",
        status: "needs_you",
        attention: true,
        message: "q",
        updated_at: "",
        color: "",
        shape: "",
        icon: "",
        source: "",
      },
    ]);
    expect(status.unread).toBe(1);
  });

  it("uses the configured base URL and token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    configureApi("http://127.0.0.1:8788", "secret");
    await postDismiss();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/api/dismiss",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("throws on a bad status body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ nope: true })),
    );
    configureApi("http://127.0.0.1:8787", "");
    await expect(fetchStatus()).rejects.toThrow("bad status");
  });
});

describe("fetchCursor", () => {
  it("reads the poll status and defaults anything malformed", async () => {
    configureApi("http://127.0.0.1:1", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          configured: true,
          last_poll_at: "2026-10-08T12:00:00Z",
          ok: false,
          agents: "many",
          error: "Cursor rejected the API key (HTTP 401).",
        }),
      ),
    );
    expect(await fetchCursor()).toEqual({
      configured: true,
      last_poll_at: "2026-10-08T12:00:00Z",
      ok: false,
      agents: 0,
      error: "Cursor rejected the API key (HTTP 401).",
    });
  });
});

describe("detail status", () => {
  it("asks for sources and keeps them", async () => {
    configureApi("http://127.0.0.1:1", "");
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      Response.json({
        phase: "idle",
        agents: [{ id: "a", title: "A", status: "running", source: "cursor" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const status = await fetchStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:1/api/status?detail=1",
    );
    expect(status.agents[0]?.source).toBe("cursor");
  });
});
