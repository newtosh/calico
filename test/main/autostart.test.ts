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

  // Desktop Entry spec: reserved characters force quoting. Inside quotes,
  // " ` $ and \ get a backslash, and the file format doubles every backslash.
  const two = "\\".repeat(2);
  const four = "\\".repeat(4);
  it.each([
    ["/opt/a$b/calico", `Exec="/opt/a${two}$b/calico" --hidden`],
    ['/opt/a"b/calico', `Exec="/opt/a${two}"b/calico" --hidden`],
    ["/opt/a`b/calico", 'Exec="/opt/a' + two + '`b/calico" --hidden'],
    ["/opt/a\\b/calico", `Exec="/opt/a${four}b/calico" --hidden`],
    ["/opt/a&b;c/calico", 'Exec="/opt/a&b;c/calico" --hidden'],
    ["/opt/100%/calico", "Exec=/opt/100%%/calico --hidden"],
  ])("quotes %s for the Exec key", (exec, line) => {
    expect(desktopEntry(exec).split("\n")).toContain(line);
  });
});
