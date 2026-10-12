// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import { SettingsView } from "./SettingsView";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// No server, so only the sections that need none render: that is enough to
// check where each lives and that switching keeps what the person typed.
const info: CalicoInfo = {
  serverUrl: null,
  port: null,
  expectedPort: 8787,
  lanUrls: ["http://10.0.10.110:8787"],
  lastPanelPoll: null,
  panelBattery: null,
  webhookToken: "",
  webhook: { accepted: null, refused: { count: 0, last: null } },
  serverError: null,
  autostart: { enabled: true, available: true },
  version: "0.1.9",
};

// The panel the person sees: the others are mounted but hidden. happy-dom does
// not apply the browser's [hidden] rule, so select by the attribute.
const panel = () => {
  const open = document.querySelectorAll('[role="tabpanel"]:not([hidden])');
  expect(open).toHaveLength(1);
  return open[0] as HTMLElement;
};

describe("SettingsView", () => {
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

  it("lets keyboard users reach a panel that has nothing focusable", () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "Connectivity" }));
    expect(panel().tabIndex).toBe(0);
  });
});
