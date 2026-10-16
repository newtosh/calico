// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalicoInfo, FirmwareInfo } from "../../../shared/ipc";
import { FirmwareBanner } from "./FirmwareBanner";

const latest = {
  version: "0.3.0",
  minApp: "0.1.13",
  notesUrl: "https://github.com/newtosh/calico/releases/tag/fw-v0.3.0",
};
const fw = (patch: Partial<FirmwareInfo>): CalicoInfo =>
  ({
    firmware: {
      status: "available",
      panel: "0.2.0",
      latest,
      checkedAt: 1,
      lastError: "",
      check: true,
      dismissed: false,
      belowMinimum: false,
      ...patch,
    },
  }) as unknown as CalicoInfo;

let dismiss: ReturnType<typeof vi.fn>;
beforeEach(() => {
  dismiss = vi.fn(async () => undefined);
  Object.assign(window, { calico: { firmwareDismiss: dismiss } });
});
afterEach(cleanup);

it("announces an available update politely, with release notes and Not now", () => {
  render(<FirmwareBanner info={fw({})} />);
  const banner = screen.getByRole("status");
  expect(banner.getAttribute("aria-live")).toBe("polite");
  expect(banner.textContent).toContain("Panel firmware 0.3.0 is available");
  expect(banner.textContent).toContain("This panel has firmware 0.2.0");
  const link = screen.getByRole("link", { name: "Release notes" });
  expect(link.getAttribute("href")).toBe(latest.notesUrl);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noreferrer");
  expect(document.activeElement).toBe(document.body);
});

it("says to update Calico first when the firmware needs a newer one, with no flash steps", () => {
  render(
    <FirmwareBanner
      info={fw({
        status: "needs_calico",
        latest: { ...latest, minApp: "0.2.0" },
      })}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "needs Calico 0.2.0 or later. Update Calico first, then the panel.",
  );
});

it.each([
  ["current", { status: "current" as const }],
  ["unknown", { status: "unknown" as const }],
  ["dismissed", { dismissed: true }],
  ["without a release", { latest: null }],
])("shows nothing when %s", (_name, patch) => {
  const { container } = render(<FirmwareBanner info={fw(patch)} />);
  expect(container.textContent).toBe("");
});

it("Not now hides the banner at once and tells main which version", () => {
  render(<FirmwareBanner info={fw({})} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(dismiss).toHaveBeenCalledWith("0.3.0");
  expect(screen.queryByRole("status")).toBeNull();
});

it("Not now still hides the banner when main rejects", async () => {
  dismiss.mockImplementation(() => Promise.reject(new Error("x")));
  render(<FirmwareBanner info={fw({})} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("status")).toBeNull();
});

it("links to the update steps when an update is available", () => {
  render(<FirmwareBanner info={fw({})} />);
  const help = screen.getByRole("link", { name: "How to update" });
  expect(help.getAttribute("href")).toBe(
    "https://github.com/newtosh/calico/blob/main/firmware/README.md#releasing",
  );
  expect(help.getAttribute("target")).toBe("_blank");
  expect(help.getAttribute("rel")).toContain("noreferrer");
});

it("offers no update steps when Calico must be updated first", () => {
  render(<FirmwareBanner info={fw({ status: "needs_calico" })} />);
  expect(screen.queryByRole("link", { name: "How to update" })).toBeNull();
});
