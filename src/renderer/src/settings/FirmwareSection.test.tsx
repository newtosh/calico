// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import { FirmwareSection } from "./FirmwareSection";

const info = (check: boolean): CalicoInfo =>
  ({ firmware: { check } }) as unknown as CalicoInfo;

let setCheck: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setCheck = vi.fn(async () => undefined);
  Object.assign(window, { calico: { firmwareSetCheck: setCheck } });
});
afterEach(cleanup);

const box = () =>
  screen.getByRole("checkbox", {
    name: "Check for panel firmware updates",
  }) as HTMLInputElement;

it("is ticked when checks are on", () => {
  render(<FirmwareSection info={info(true)} />);
  expect(box().checked).toBe(true);
});

it("is unticked when checks are off", () => {
  render(<FirmwareSection info={info(false)} />);
  expect(box().checked).toBe(false);
});

it("tells main when it is unticked", () => {
  render(<FirmwareSection info={info(true)} />);
  fireEvent.click(box());
  expect(setCheck).toHaveBeenCalledWith(false);
});

it("says it only asks GitHub's public releases list and sends nothing about the person or panel", () => {
  render(<FirmwareSection info={info(true)} />);
  expect(document.body.textContent).toContain("GitHub's public releases list");
  expect(document.body.textContent).toContain(
    "Nothing about you or your panel is sent.",
  );
});

it("the box follows the click when main rejects", async () => {
  setCheck.mockImplementation(() => Promise.reject(new Error("x")));
  render(<FirmwareSection info={info(true)} />);
  fireEvent.click(box());
  await new Promise((r) => setTimeout(r, 0));
  expect(box().checked).toBe(false);
});
