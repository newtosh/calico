import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
import { desktopEntry } from "../../src/main/autostart";

describe("autostart entry", () => {
  it("starts hidden and quotes paths with spaces", () => {
    const entry = desktopEntry("/opt/My Apps/Calico.AppImage");
    expect(entry).toContain('Exec="/opt/My Apps/Calico.AppImage" --hidden\n');
    expect(entry).toContain("Type=Application\n");
    expect(entry).toContain("X-GNOME-Autostart-enabled=true\n");
  });

  it("leaves simple paths bare", () => {
    expect(desktopEntry("/usr/bin/calico")).toContain(
      "Exec=/usr/bin/calico --hidden\n",
    );
  });
});
