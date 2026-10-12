// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelBattery } from "./PanelBattery";

afterEach(cleanup);

const now = 2_000_000;
const reading = { pct: 81, charging: true, external: true, at: now - 5_000 };

describe("PanelBattery", () => {
  it("shows the percent and the state", () => {
    render(<PanelBattery battery={reading} now={now} />);
    expect(screen.getByText("81%")).toBeTruthy();
    expect(screen.getByLabelText("Panel battery 81%, Charging")).toBeTruthy();
  });

  it("shows nothing without a reading", () => {
    const { container } = render(<PanelBattery battery={null} now={now} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing once the reading is stale", () => {
    const { container } = render(
      <PanelBattery battery={{ ...reading, at: now - 61_000 }} now={now} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
