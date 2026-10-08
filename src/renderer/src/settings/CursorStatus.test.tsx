// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "../lib/api";
import { CursorStatus } from "./CursorStatus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(status: Record<string, unknown>) {
  configureApi("http://127.0.0.1:1", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(status)),
  );
}

const base = {
  configured: true,
  last_poll_at: new Date().toISOString(),
  ok: true,
  agents: 0,
  error: "",
};

describe("CursorStatus", () => {
  it("tells you to add a key when none is set", async () => {
    serve({ ...base, configured: false, last_poll_at: null, ok: null });
    render(<CursorStatus />);
    expect(await screen.findByText(/Add a Cursor API key/)).toBeTruthy();
  });

  it("waits for the first poll", async () => {
    serve({ ...base, last_poll_at: null, ok: null });
    render(<CursorStatus />);
    expect(await screen.findByText(/Waiting for the first poll/)).toBeTruthy();
  });

  it("shows a working poll with its agent count", async () => {
    serve({ ...base, agents: 3 });
    render(<CursorStatus />);
    expect(await screen.findByText(/Polling works: 3 agents/)).toBeTruthy();
  });

  it("shows the failure in words instead of an empty list", async () => {
    serve({
      ...base,
      ok: false,
      error: "Cursor rejected the API key (HTTP 401).",
    });
    render(<CursorStatus />);
    expect(
      await screen.findByText(/Cursor rejected the API key \(HTTP 401\)/),
    ).toBeTruthy();
  });
});
