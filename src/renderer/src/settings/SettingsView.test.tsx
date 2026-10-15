// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import { configureApi } from "../lib/api";
import { SettingsView } from "./SettingsView";

beforeEach(() => {
  // Connectivity lists the saved networks on mount, with or without the server.
  Object.assign(window, {
    calico: {
      networksList: vi.fn(async () => ({
        networks: [],
        error: "",
        notice: "",
      })),
    },
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

// No server, so only the sections that need none render: that is enough to
// check where each lives and that switching keeps what the person typed.
const info: CalicoInfo = {
  serverUrl: null,
  port: null,
  expectedPort: 8787,
  lanUrls: ["http://10.0.10.110:8787"],
  panelUrl: null,
  lastPanelPoll: null,
  panelBattery: null,
  webhookToken: "",
  webhook: { accepted: null, refused: { count: 0, last: null } },
  serverError: null,
  autostart: { enabled: true, available: true },
  version: "0.1.9",
  hostname: "test-host",
  addressChange: null,
};

// The panel the person sees: the others are mounted but hidden. happy-dom does
// not apply the browser's [hidden] rule, so select by the attribute.
const panel = () => {
  const open = document.querySelectorAll('[role="tabpanel"]:not([hidden])');
  expect(open).toHaveLength(1);
  return open[0] as HTMLElement;
};

describe("SettingsView", () => {
  it("shows the Wi-Fi networks under Connectivity even without the server", async () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "Connectivity" }));
    expect(panel().textContent).toContain("Wi-Fi networks");
    expect(await screen.findByText("No networks saved.")).toBeTruthy();
  });

  it("opens on Agents and shows only that category", () => {
    render(<SettingsView info={info} />);
    expect(
      screen.getByRole("tab", { name: "Agents" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(panel().textContent).toContain("Agent updates");
    expect(panel().textContent).not.toContain("Startup");
    expect(panel().textContent).not.toContain("About");
  });

  it("puts Startup and About under App", () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "App" }));
    expect(panel().textContent).toContain("Startup");
    expect(panel().textContent).toContain("Calico 0.1.9");
    expect(panel().textContent).not.toContain("Agent updates");
  });

  it("says Connectivity needs the server when it is not running", () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "Connectivity" }));
    expect(panel().textContent).toMatch(/need calico's server/);
  });

  it("keeps a half-finished action when you switch tabs and come back", () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("button", { name: "Set a token…" }));
    expect(screen.getByText(/will get 401/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "App" }));
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    expect(screen.getByText(/will get 401/)).toBeTruthy();
  });

  it("remembers the last tab", () => {
    const first = render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "App" }));
    first.unmount();
    render(<SettingsView info={info} />);
    expect(
      screen.getByRole("tab", { name: "App" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(panel().textContent).toContain("Calico 0.1.9");
  });

  it("names each panel after its tab", () => {
    render(<SettingsView info={info} />);
    expect(panel().getAttribute("aria-labelledby")).toBe("settings-tab-agents");
  });

  it("keeps the pinned strip below dialogs by isolating its stacking", () => {
    const { container } = render(<SettingsView info={info} />);
    expect((container.firstChild as HTMLElement).className).toContain(
      "isolate",
    );
  });

  it("puts the outbound webhook under Connectivity, next to Relay", async () => {
    configureApi("http://127.0.0.1:8787", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.includes("/api/notify"))
          return Response.json({
            url: "",
            header: "Authorization",
            offline_seconds: 180,
            key_set: false,
            last: null,
          });
        if (path.includes("/api/relay"))
          return Response.json({
            url: "",
            token_set: false,
            can_copy: false,
            status: {
              configured: false,
              last_poll_at: null,
              ok: null,
              applied: 0,
              refused: 0,
              error: "",
              used: null,
              budget: null,
            },
          });
        if (path.includes("/api/panel"))
          return Response.json({ url: "", token_set: false });
        return Response.json({
          port: 8787,
          cursor_poll_seconds: 30,
          webhook_token_set: false,
          cursor_api_key_set: false,
          running_timeout_seconds: 120,
        });
      }),
    );
    Object.assign(window, {
      calico: {
        networksList: vi.fn(async () => ({
          networks: [],
          error: "",
          notice: "",
        })),
        relaySetupView: vi.fn(async () => ({ phase: "idle" })),
        onRelaySetup: vi.fn(() => () => undefined),
      },
    });
    render(
      <SettingsView
        info={{ ...info, serverUrl: "http://127.0.0.1:8787", port: 8787 }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Connectivity" }));
    const relay = await screen.findByRole("heading", { name: "Relay" });
    const webhook = await screen.findByRole("heading", {
      name: "Outbound webhook",
    });
    expect(
      relay.compareDocumentPosition(webhook) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(panel().textContent).toContain("sealed with the system keyring");
  });

  it("lets keyboard users reach a panel that has nothing focusable", () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "Connectivity" }));
    expect(panel().tabIndex).toBe(0);
  });
});
