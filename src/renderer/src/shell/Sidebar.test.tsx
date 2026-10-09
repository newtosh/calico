// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar", () => {
  it("leads the Calico name with the app icon", () => {
    render(<Sidebar view="dashboard" onSelect={() => {}} panelOnline />);
    const name = screen.getByText("Calico");
    const icon = name.previousElementSibling;
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("src")).toBeTruthy();
    // Decorative: the name next to it already says what it is.
    expect(icon?.getAttribute("alt")).toBe("");
    expect(icon?.tagName).toBe("IMG");
  });
});
