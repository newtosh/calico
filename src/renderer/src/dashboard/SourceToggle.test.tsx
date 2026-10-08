// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceToggle } from "./SourceToggle";

afterEach(cleanup);

describe("SourceToggle", () => {
  it("offers Combined, Grok Bot, and Cursor with counts and marks the choice", () => {
    render(
      <SourceToggle
        value="cursor"
        counts={{ combined: 5, grok: 2, cursor: 3 }}
        onChange={() => undefined}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Show agents from" });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Combined 5",
      "Grok Bot 2",
      "Cursor 3",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  it("reports the clicked choice", () => {
    const onChange = vi.fn();
    render(
      <SourceToggle
        value="combined"
        counts={{ combined: 1, grok: 1, cursor: 0 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Grok Bot/ }));
    expect(onChange).toHaveBeenCalledWith("grok");
  });
});
