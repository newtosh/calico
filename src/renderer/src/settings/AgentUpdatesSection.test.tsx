// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import { configureApi } from "../lib/api";
import { AgentUpdatesSection } from "./AgentUpdatesSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const info: CalicoInfo = {
  serverUrl: "http://127.0.0.1:8787",
  port: 8787,
  expectedPort: 8787,
  lanUrls: ["http://192.168.4.30:8787"],
  lastPanelPoll: null,
  webhookToken: "",
  webhook: { accepted: null, refused: { count: 0, last: null } },
  serverError: null,
  autostart: { enabled: false, available: true },
  version: "0.1.1",
};

const WEBHOOK = "http://192.168.4.30:8787/api/webhook/grok-bot";

describe("AgentUpdatesSection", () => {
  it("shows the webhook URL and copies it", () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<AgentUpdatesSection info={info} />);
    expect(screen.getByText(WEBHOOK)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy webhook URL" }));
    expect(writeText).toHaveBeenCalledWith(WEBHOOK);
  });

  it("says plainly whether a token protects the endpoint", () => {
    const { rerender } = render(<AgentUpdatesSection info={info} />);
    expect(screen.getByText(/No token is set/)).toBeTruthy();
    rerender(<AgentUpdatesSection info={{ ...info, webhookToken: "abc" }} />);
    expect(screen.getByText(/A token is set/)).toBeTruthy();
  });

  it("falls back to the loopback address when there is no LAN address", () => {
    render(<AgentUpdatesSection info={{ ...info, lanUrls: [] }} />);
    expect(
      screen.getByText("http://127.0.0.1:8787/api/webhook/grok-bot"),
    ).toBeTruthy();
  });

  it("explains itself when the server is not running", () => {
    render(
      <AgentUpdatesSection
        info={{ ...info, serverUrl: null, port: null, lanUrls: [] }}
      />,
    );
    expect(screen.getByText(/server is not running/i)).toBeTruthy();
  });

  type Call = {
    method: string;
    url: string;
    auth: string | null;
    body: unknown;
  };

  function serve(panelUrl: string, onPanelRead?: () => void) {
    const calls: Call[] = [];
    let releasePanel: () => void = () => undefined;
    const panelGate = new Promise<void>((r) => (releasePanel = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = init.body
          ? (JSON.parse(String(init.body)) as unknown)
          : null;
        calls.push({
          method,
          url,
          auth: new Headers(init.headers).get("Authorization"),
          body,
        });
        if (url.endsWith("/api/config"))
          return Response.json({ port: 8787, restart_required: false });
        if (method === "GET") onPanelRead?.();
        if (method === "PUT") await panelGate;
        return Response.json({ url: panelUrl, token_set: true });
      }),
    );
    return { calls, releasePanel };
  }

  it("generates a token, applies it to calico and the panel, and shows it once", async () => {
    configureApi(info.serverUrl ?? "", "");
    const { calls, releasePanel } = serve("");
    releasePanel();
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: /Set a token/ }));
    expect(screen.getByText(/will get 401/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate and apply" }));
    const shown = await screen.findByTestId("new-token");
    const token = shown.textContent ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await screen.findByText(/sent to the panel/);
    expect(
      calls.map(
        (c) => `${c.method} ${c.url.replace("http://127.0.0.1:8787", "")}`,
      ),
    ).toEqual(["PUT /api/config", "GET /api/panel", "PUT /api/panel"]);
    expect(calls[0]?.body).toEqual({ webhook_token: token });
    // No panel URL yet, so one is sent. Every call after the change carries the new token.
    expect(calls[2]?.body).toEqual({ url: "http://192.168.4.30:8787", token });
    expect(calls[2]?.auth).toBe(`Bearer ${token}`);
  });

  it("keeps the panel's working URL and sends only the token", async () => {
    configureApi(info.serverUrl ?? "", "");
    const { calls, releasePanel } = serve("http://100.64.0.2:8787");
    releasePanel();
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: /Set a token/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate and apply" }));
    await screen.findByText(/sent to the panel/);
    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["token"]);
  });

  it("is not thrown off when a stale info poll puts the old token back", async () => {
    configureApi(info.serverUrl ?? "", "");
    // useInfo ticks every 2 s and may land between the two requests with the old token.
    const { calls, releasePanel } = serve("", () =>
      configureApi(info.serverUrl ?? "", ""),
    );
    releasePanel();
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: /Set a token/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate and apply" }));
    await screen.findByText(/sent to the panel/);
    const token = screen.getByTestId("new-token").textContent ?? "";
    expect(calls.at(-1)?.auth).toBe(`Bearer ${token}`);
  });

  it("does not allow a second apply while the panel push is in flight", async () => {
    configureApi(info.serverUrl ?? "", "");
    const { releasePanel } = serve("");
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: /Set a token/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate and apply" }));
    await screen.findByTestId("new-token");
    expect(
      (
        screen.getByRole("button", {
          name: "Generate and apply",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: /Set a token|Replace the token/ }),
    ).toBeNull();
    releasePanel();
    expect(
      await screen.findByRole("button", {
        name: /Set a token|Replace the token/,
      }),
    ).toBeTruthy();
  });

  it("says when the copy did not work", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => Promise.reject(new Error("denied"))),
      },
    });
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy webhook URL" }));
    expect(await screen.findByText("Copy failed")).toBeTruthy();
  });

  it("shows nothing secret when calico refuses the new token", async () => {
    configureApi(info.serverUrl ?? "", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: /Set a token/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate and apply" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("new-token")).toBeNull();
  });

  it("says when the last update arrived, and that none were refused", () => {
    const at = Date.now() - 3 * 60_000;
    render(
      <AgentUpdatesSection
        info={{
          ...info,
          webhook: {
            accepted: { at, from: "192.168.4.30" },
            refused: { count: 0, last: null },
          },
        }}
      />,
    );
    expect(
      screen.getByText("Last update received 3 min ago, from 192.168.4.30."),
    ).toBeTruthy();
    expect(screen.queryByText(/refused/)).toBeNull();
  });

  it("says plainly when nothing has arrived", () => {
    render(<AgentUpdatesSection info={info} />);
    expect(
      screen.getByText("No updates received since calico started."),
    ).toBeTruthy();
  });

  it("shows refused requests and why", () => {
    render(
      <AgentUpdatesSection
        info={{
          ...info,
          webhook: {
            accepted: null,
            refused: {
              count: 2,
              last: {
                at: Date.now() - 60_000,
                reason: "unauthorized",
                from: "10.0.10.9",
              },
            },
          },
        }}
      />,
    );
    expect(
      screen.getByText(
        "2 requests refused since calico started. Last: wrong or missing token, 1 min ago, from 10.0.10.9.",
      ),
    ).toBeTruthy();
  });
});
