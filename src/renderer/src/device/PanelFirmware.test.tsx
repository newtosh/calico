// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalicoInfo, FirmwareInfo } from "../../../shared/ipc";
import { PanelFirmware } from "./PanelFirmware";

const latest = {
  version: "0.3.0",
  minApp: "0.1.13",
  notesUrl: "https://example.test/notes",
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

let checkNow: ReturnType<typeof vi.fn>;
beforeEach(() => {
  checkNow = vi.fn(async () => undefined);
  Object.assign(window, { calico: { firmwareCheckNow: checkNow } });
});
afterEach(cleanup);

const text = () => document.body.textContent ?? "";

it("shows the Panel firmware heading", () => {
  render(<PanelFirmware info={fw({})} />);
  expect(screen.getByRole("heading", { name: "Panel firmware" })).toBeTruthy();
});

it("says an update is available and what the panel has", () => {
  render(<PanelFirmware info={fw({})} />);
  expect(text()).toContain(
    "Panel firmware 0.3.0 is available. This panel has firmware 0.2.0.",
  );
});

it("says the panel is up to date", () => {
  render(<PanelFirmware info={fw({ status: "current" })} />);
  expect(text()).toContain("Panel firmware 0.2.0 is up to date.");
});

it("says when the panel's version is not known yet", () => {
  render(<PanelFirmware info={fw({ panel: null, status: "unknown" })} />);
  expect(text()).toContain("The panel's firmware version is not known yet.");
});

it("says when the panel is older than the first versioned firmware", () => {
  render(<PanelFirmware info={fw({ belowMinimum: true })} />);
  expect(text()).toContain("older than the first versioned release");
});

it("says when it has not checked yet", () => {
  render(<PanelFirmware info={fw({ checkedAt: null })} />);
  expect(text()).toContain("Not checked yet.");
});

it("shows a failed check as plain text, not an alert", () => {
  render(<PanelFirmware info={fw({ lastError: "offline" })} />);
  expect(text()).toContain("Could not check: offline.");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("says when automatic checks are off", () => {
  render(<PanelFirmware info={fw({ check: false })} />);
  expect(text()).toContain("Automatic checks are off.");
});

it("Check now calls main once, is disabled while it runs, and comes back", async () => {
  let done: () => void = () => undefined;
  checkNow.mockImplementation(
    () => new Promise<void>((resolve) => (done = resolve)),
  );
  render(<PanelFirmware info={fw({})} />);
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  expect(checkNow).toHaveBeenCalledTimes(1);
  const busy = screen.getByRole("button", { name: "Checking" });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  await act(async () => done());
  const back = screen.getByRole("button", { name: "Check now" });
  expect((back as HTMLButtonElement).disabled).toBe(false);
});

it("Check now comes back when main rejects", async () => {
  checkNow.mockImplementation(() => Promise.reject(new Error("x")));
  render(<PanelFirmware info={fw({})} />);
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await act(async () => undefined);
  const back = screen.getByRole("button", { name: "Check now" });
  expect((back as HTMLButtonElement).disabled).toBe(false);
});

it("does not call a hash-reporting panel up to date", () => {
  render(<PanelFirmware info={fw({ status: "current", panel: "886dd11" })} />);
  expect(text()).not.toContain("up to date");
  expect(text()).not.toContain("Panel an unversioned build");
  expect(text()).toContain("This panel has an unversioned build.");
});

it("links to the update steps only when an update is available", () => {
  render(<PanelFirmware info={fw({})} />);
  expect(screen.getByRole("link", { name: "How to update" })).toBeTruthy();
});

it.each(["current", "unknown", "needs_calico"] as const)(
  "offers no update steps when the status is %s",
  (status) => {
    render(<PanelFirmware info={fw({ status })} />);
    expect(screen.queryByRole("link", { name: "How to update" })).toBeNull();
  },
);
