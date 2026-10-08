import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
import { desktopEntry, initAutostartOnce } from "../../src/main/autostart";

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

describe("first-run autostart", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "calico-autostart-"));

  it("turns startup on the first time an installed build runs", () => {
    const enable = vi.fn();
    const userData = dir();
    expect(initAutostartOnce(userData, true, enable)).toBe(true);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(existsSync(join(userData, "autostart-initialized"))).toBe(true);
  });

  it("does not turn it back on after the user switched it off", () => {
    const enable = vi.fn();
    const userData = dir();
    initAutostartOnce(userData, true, enable);
    expect(initAutostartOnce(userData, true, enable)).toBe(false);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("is not used up by a dev run, so the installed build still gets its first run", () => {
    const enable = vi.fn();
    const userData = dir();
    expect(initAutostartOnce(userData, false, enable)).toBe(false);
    expect(enable).not.toHaveBeenCalled();
    expect(existsSync(join(userData, "autostart-initialized"))).toBe(false);
    expect(initAutostartOnce(userData, true, enable)).toBe(true);
  });

  it("never lets a failure to set startup abort the app, and retries next launch", () => {
    const userData = dir();
    const boom = () => {
      throw new Error("read-only home");
    };
    expect(() => initAutostartOnce(userData, true, boom)).not.toThrow();
    expect(initAutostartOnce(userData, true, boom)).toBe(false);
    // No marker was written, so a launch where it works still gets its first run.
    const enable = vi.fn();
    expect(initAutostartOnce(userData, true, enable)).toBe(true);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("creates the data folder if it does not exist yet", () => {
    const userData = join(dir(), "nested", "calico");
    expect(initAutostartOnce(userData, true, vi.fn())).toBe(true);
    expect(existsSync(join(userData, "autostart-initialized"))).toBe(true);
  });
});
