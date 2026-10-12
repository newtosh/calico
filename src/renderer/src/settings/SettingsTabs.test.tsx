// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsTabs } from "./SettingsTabs";

afterEach(cleanup);

const TABS = [
  { id: "agents", label: "Agents" },
  { id: "connectivity", label: "Connectivity" },
  { id: "app", label: "App" },
] as const;

function setup(value: (typeof TABS)[number]["id"] = "agents") {
  const onChange = vi.fn();
  render(<SettingsTabs tabs={TABS} value={value} onChange={onChange} />);
  return onChange;
}

describe("SettingsTabs", () => {
  it("shows every category as a tab and marks the current one", () => {
    setup("connectivity");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Agents",
      "Connectivity",
      "App",
    ]);
    expect(
      screen
        .getByRole("tab", { name: "Connectivity" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Agents" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("is one stop in the tab order: only the current tab is focusable", () => {
    setup("agents");
    expect(screen.getByRole("tab", { name: "Agents" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "App" }).tabIndex).toBe(-1);
  });

  it("selects a tab on click", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("tab", { name: "App" }));
    expect(onChange).toHaveBeenCalledWith("app");
  });

  it("moves with the arrow keys, wrapping at both ends", () => {
    const onChange = setup("agents");
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("connectivity");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("app");
  });

  it("jumps to the ends with Home and End", () => {
    const onChange = setup("connectivity");
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("app");
    fireEvent.keyDown(list, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("agents");
  });

  it("points each tab at its panel", () => {
    setup();
    const tab = screen.getByRole("tab", { name: "Agents" });
    expect(tab.getAttribute("aria-controls")).toBe("settings-panel-agents");
    expect(tab.id).toBe("settings-tab-agents");
  });
});
