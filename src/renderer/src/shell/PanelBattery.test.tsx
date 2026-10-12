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
    expect(
      screen.getByRole("img", { name: "Panel battery 81%, Charging" }),
    ).toBeTruthy();
    // The state is announced once, by the whole chip, not again by its icon.
    expect(screen.getAllByRole("img")).toHaveLength(1);
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

  const markOf = () => document.querySelector(".lucide");

  it("shows a bolt while charging and a plug on external power with no charge", () => {
    const at = now - 1_000;
    const { rerender } = render(
      <PanelBattery
        battery={{ pct: 60, charging: true, external: true, at }}
        now={now}
      />,
    );
    expect(markOf()?.classList.contains("lucide-zap")).toBe(true);
    rerender(
      <PanelBattery
        battery={{ pct: 100, charging: false, external: true, at }}
        now={now}
      />,
    );
    expect(markOf()?.classList.contains("lucide-usb")).toBe(true);
    rerender(
      <PanelBattery
        battery={{ pct: 60, charging: false, external: false, at }}
        now={now}
      />,
    );
    expect(markOf()).toBeNull();
  });

  it("keeps the mark readable: dark over the fill, cream when the fill is too short to reach it", () => {
    const at = now - 1_000;
    const { rerender } = render(
      <PanelBattery
        battery={{ pct: 81, charging: true, external: true, at }}
        now={now}
      />,
    );
    expect(markOf()?.getAttribute("class")).toContain("text-glass");
    rerender(
      <PanelBattery
        battery={{ pct: 10, charging: true, external: true, at }}
        now={now}
      />,
    );
    expect(markOf()?.getAttribute("class")).toContain("text-cream");
  });

  it("puts the fill's right edge where the panel does, 2 px inside the body", () => {
    render(
      <PanelBattery
        battery={{ pct: 100, charging: false, external: false, at: now - 1 }}
        now={now}
      />,
    );
    const fill = part("fill");
    expect(Number(fill?.getAttribute("x"))).toBe(6);
    expect(Number(fill?.getAttribute("width"))).toBe(22);
  });
});
