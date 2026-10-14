// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushPlan } from "./push-plan";
import { PushPlanDialog } from "./PushPlanDialog";

afterEach(cleanup);

const plan: PushPlan = { add: [], update: [], remove: ["old"], current: "" };

function show(progress: string) {
  const onCancel = vi.fn();
  render(
    <PushPlanDialog
      plan={plan}
      removeCurrent={false}
      onRemoveCurrent={() => undefined}
      progress={progress}
      error=""
      count={1}
      opener={{ current: null }}
      onConfirm={() => undefined}
      onCancel={onCancel}
    />,
  );
  const backdrop = () =>
    document.querySelector("[data-open].fixed.inset-0") as HTMLElement;
  const escape = () =>
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  const outside = () => {
    fireEvent.pointerDown(backdrop());
    fireEvent.mouseDown(backdrop());
    fireEvent.pointerUp(backdrop());
    fireEvent.click(backdrop());
  };
  return { onCancel, escape, outside };
}

describe("PushPlanDialog dismissal", () => {
  it("Escape and a backdrop click cancel while idle", async () => {
    const a = show("");
    a.escape();
    expect(a.onCancel).toHaveBeenCalledTimes(1);
    cleanup();
    const b = show("");
    b.outside();
    expect(b.onCancel).toHaveBeenCalledTimes(1);
  });

  it("neither cancels while a push runs", () => {
    const a = show("Step 1 of 1: removing old");
    a.escape();
    a.outside();
    expect(a.onCancel).not.toHaveBeenCalled();
  });
});
