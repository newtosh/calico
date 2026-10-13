// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Cmd, DeviceLink, PanelNet, Reply } from "./commands";
import { PanelNetworks } from "./PanelNetworks";

afterEach(cleanup);

function panel(start: PanelNet[], fail?: string) {
  let nets = start;
  const sent: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd: Cmd): Promise<Reply> {
      sent.push(cmd);
      if (fail) return { ok: false, error: fail };
      if (cmd.op === "forget") nets = nets.filter((n) => n.ssid !== cmd.ssid);
      return cmd.op === "nets" ? { ok: true, nets } : { ok: true };
    },
    close() {},
  };
  return { link, sent };
}

describe("PanelNetworks", () => {
  it("lists the panel's networks with flags only", async () => {
    const { link } = panel([{ ssid: "home", has_url: true, has_token: false }]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    const list = await screen.findByRole("list", {
      name: "Networks on the panel",
    });
    expect(list.textContent).toContain("home");
    expect(list.textContent).toContain("Own URL");
    expect(list.textContent).toContain("Default token");
  });

  it("forgets one on the panel after a confirmation, then reads the list again", async () => {
    const { link, sent } = panel([
      { ssid: "home", has_url: false, has_token: false },
      { ssid: "cafe", has_url: false, has_token: false },
    ]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    fireEvent.click(await screen.findByLabelText("Forget cafe on the panel"));
    expect(sent.some((c) => c.op === "forget")).toBe(false);
    fireEvent.click(screen.getByText("Forget network"));
    await waitFor(() => expect(screen.queryByText("cafe")).toBeNull());
    expect(sent).toContainEqual({ op: "forget", ssid: "cafe" });
    expect(sent.filter((c) => c.op === "nets")).toHaveLength(2);
  });

  it("says when the panel has none", async () => {
    const { link } = panel([]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    expect(
      await screen.findByText("No networks saved on the panel."),
    ).toBeTruthy();
  });

  it("shows the link's error, such as old firmware", async () => {
    const { link } = panel([], "Flash the latest firmware.");
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Flash the latest firmware.",
    );
  });

  it("shows nothing as empty before the panel answers, and titles long names", async () => {
    const long = "The-Quick-Brown-Fox-Jumps-Over-It";
    const { link } = panel([{ ssid: long, has_url: false, has_token: false }]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    expect(screen.queryByText("No networks saved on the panel.")).toBeNull();
    expect(
      (screen.getByText("Asking the panel") as HTMLButtonElement).disabled,
    ).toBe(true);
    const name = await screen.findByText(long);
    expect(name.getAttribute("title")).toBe(long);
  });

  it("moves focus into the confirmation (on Cancel) and back to the opener on cancel", async () => {
    const { link } = panel([
      { ssid: "home", has_url: false, has_token: false },
    ]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    const opener = await screen.findByLabelText("Forget home on the panel");
    fireEvent.click(opener);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText("Cancel")),
    );
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("returns focus to the list heading after a forget removes the opener", async () => {
    const { link } = panel([
      { ssid: "home", has_url: false, has_token: false },
    ]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    fireEvent.click(await screen.findByLabelText("Forget home on the panel"));
    fireEvent.click(screen.getByText("Forget network"));
    await waitFor(() => expect(screen.queryByText("home")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Networks on the panel" }),
      ),
    );
  });
});
