// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar", () => {
  it("leads the Calico name with the app icon", () => {
    render(<Sidebar view="dashboard" onSelect={() => {}} panelOnline />);
    const name = screen.getByText("Calico");
    const icon = name.querySelector("img");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("src")).toBeTruthy();
    // Decorative: the name next to it already says what it is.
    expect(icon?.getAttribute("alt")).toBe("");
    // The icon comes before the name in reading and visual order.
    expect(name.firstElementChild).toBe(icon);
  });
});
