// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AboutSection } from "./AboutSection";

afterEach(cleanup);

describe("AboutSection", () => {
  it("shows the running release version", () => {
    render(<AboutSection version="0.1.1" />);
    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy();
    expect(screen.getByText("Calico 0.1.1")).toBeTruthy();
  });
});
