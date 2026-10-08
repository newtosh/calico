// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "../lib/api";
import { Dashboard } from "./Dashboard";

const WEBHOOK = "http://192.168.4.30:8787/api/webhook/grok-bot";
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function serve(agents: Record<string, unknown>[]) {
  configureApi("http://127.0.0.1:1", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        phase: "running",
        needs_you: false,
        unread: 0,
        agents,
        last_event: null,
        events: agents.map((a) => ({
          id: `e-${String(a.id)}`,
          type: "agent.launched",
          agent_id: a.id,
          title: a.title,
          message: "",
          source: a.source,
          at: a.updated_at,
        })),
      }),
    ),
  );
}

const mixed = [
  {
    id: "g1",
    title: "Desky",
    status: "running",
    source: "grok-bot",
    updated_at: ago(4),
  },
  {
    id: "c1",
    title: "Fix tests",
    status: "running",
    source: "cursor",
    updated_at: ago(1),
  },
  {
    id: "c2",
    title: "Refactor",
    status: "idle",
    source: "cursor",
    updated_at: ago(30),
  },
];

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard sources", () => {
  it("shows every source together by default, each with its age", async () => {
    serve(mixed);
    render(
      <Dashboard
        serverUrl="http://127.0.0.1:1"
        webhookUrl={WEBHOOK}
        onSetup={() => undefined}
      />,
    );
    expect((await screen.findAllByText("Desky")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fix tests").length).toBeGreaterThan(0);
    expect(screen.getByText("4 min ago")).toBeTruthy();
    expect(screen.getByText("30 min ago")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Combined 3/ })).toBeTruthy();
  });

  it("narrows agents and events to Cursor, then to Grok Bot, and remembers it", async () => {
    serve(mixed);
    const { unmount } = render(
      <Dashboard
        serverUrl="http://127.0.0.1:1"
        webhookUrl={WEBHOOK}
        onSetup={() => undefined}
      />,
    );
    await screen.findAllByText("Desky");
    fireEvent.click(screen.getByRole("radio", { name: /^Cursor/ }));
    expect(screen.queryByText("Desky")).toBeNull();
    expect(screen.getAllByText("Fix tests").length).toBeGreaterThan(0);
    expect(screen.getByText(/1\/2 active/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /^Grok Bot/ }));
    expect(screen.queryByText("Fix tests")).toBeNull();
    expect(screen.getAllByText("Desky").length).toBeGreaterThan(0);
    unmount();
    render(
      <Dashboard
        serverUrl="http://127.0.0.1:1"
        webhookUrl={WEBHOOK}
        onSetup={() => undefined}
      />,
    );
    await screen.findAllByText("Desky");
    expect(
      screen
        .getByRole("radio", { name: /^Grok Bot/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("points an empty Cursor view at Settings", async () => {
    serve([mixed[0] as Record<string, unknown>]);
    const onSetup = vi.fn();
    render(
      <Dashboard
        serverUrl="http://127.0.0.1:1"
        webhookUrl={WEBHOOK}
        onSetup={onSetup}
      />,
    );
    await screen.findAllByText("Desky");
    fireEvent.click(screen.getByRole("radio", { name: /^Cursor/ }));
    expect(screen.getByText(/No Cursor agents yet/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Set up agent updates" }),
    );
    expect(onSetup).toHaveBeenCalled();
  });

  it("tells an empty Grok Bot view where desky should post", async () => {
    serve([mixed[1] as Record<string, unknown>]);
    render(
      <Dashboard
        serverUrl="http://127.0.0.1:1"
        webhookUrl={WEBHOOK}
        onSetup={() => undefined}
      />,
    );
    await screen.findAllByText("Fix tests");
    fireEvent.click(screen.getByRole("radio", { name: /^Grok Bot/ }));
    expect(screen.getByText(/No Grok Bot agents yet/)).toBeTruthy();
    expect(screen.getByText(WEBHOOK)).toBeTruthy();
  });
});
