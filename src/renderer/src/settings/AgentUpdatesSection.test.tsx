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

  it("generates a token, applies it to calico and the panel, and shows it once", async () => {
    configureApi(info.serverUrl ?? "", "");
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ url, auth: headers.get("Authorization"), body });
        return Response.json(
          url.endsWith("/api/config")
            ? { port: 8787, restart_required: false }
            : { url: body.url, token_set: true },
        );
      }),
    );
    render(<AgentUpdatesSection info={info} />);
    fireEvent.click(screen.getByRole("button", { name: /Set a token/ }));
    expect(screen.getByText(/will get 401/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate and apply" }));
    const shown = await screen.findByTestId("new-token");
    const token = shown.textContent ?? "";
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.map((c) => c.url)).toEqual([
      "http://127.0.0.1:8787/api/config",
      "http://127.0.0.1:8787/api/panel",
    ]);
    expect(calls[0]?.body).toEqual({ webhook_token: token });
    // The second call must already carry the new token, or calico rejects it.
    expect(calls[1]?.auth).toBe(`Bearer ${token}`);
    expect(calls[1]?.body).toEqual({
      url: "http://192.168.4.30:8787",
      token,
    });
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
});
