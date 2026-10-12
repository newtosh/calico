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

  const part = (name: string) =>
    document.querySelector(`[data-part="${name}"]`) as SVGElement | null;

  it("draws the panel's battery: the nub sits left of the body", () => {
    render(<PanelBattery battery={reading} now={now} />);
    const nub = part("nub");
    const body = part("body");
    expect(nub).not.toBeNull();
    expect(body).not.toBeNull();
    expect(Number(nub?.getAttribute("x"))).toBeLessThan(
      Number(body?.getAttribute("x")),
    );
    // The percent reads to the left of the drawing, as on the panel.
    const text = screen.getByText("81%");
    const svg = document.querySelector("svg") as SVGElement;
    expect(
      text.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fills from the right, in the panel's colors", () => {
    const at = now - 1_000;
    const cases: [number, boolean, string][] = [
      [81, true, "fill-sage"],
      [50, false, "fill-cream"],
      [15, false, "fill-amber"],
      [8, false, "fill-red"],
    ];
    for (const [pct, charging, color] of cases) {
      const { unmount } = render(
        <PanelBattery
          battery={{ pct, charging, external: charging, at }}
          now={now}
        />,
      );
      const fill = part("fill");
      expect(fill?.getAttribute("class"), `${pct}`).toContain(color);
      const body = part("body");
      const right =
        Number(body?.getAttribute("x")) + Number(body?.getAttribute("width"));
      expect(
        Number(fill?.getAttribute("x")) + Number(fill?.getAttribute("width")),
      ).toBeLessThan(right);
      unmount();
    }
  });

  it("shows a bolt while charging and a plug on external power with no charge", () => {
    const at = now - 1_000;
    const { rerender } = render(
      <PanelBattery
        battery={{ pct: 60, charging: true, external: true, at }}
        now={now}
      />,
    );
    expect(screen.getByRole("img", { name: "Charging" })).toBeTruthy();
    rerender(
      <PanelBattery
        battery={{ pct: 100, charging: false, external: true, at }}
        now={now}
      />,
    );
    expect(screen.getByRole("img", { name: "On external power" })).toBeTruthy();
    rerender(
      <PanelBattery
        battery={{ pct: 60, charging: false, external: false, at }}
        now={now}
      />,
    );
    expect(screen.queryByRole("img", { name: "Charging" })).toBeNull();
    expect(screen.queryByRole("img", { name: "On external power" })).toBeNull();
  });
});
