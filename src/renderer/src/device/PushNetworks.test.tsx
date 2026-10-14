// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushRelease, SavedNetwork } from "../../../shared/ipc";
import { OLD_FIRMWARE } from "./ble";
import type { Cmd, DeviceLink, Reply } from "./commands";
import { pushedAll, PushNetworks, pushStopped } from "./PushNetworks";

const PASS = "placeholder-pass";
const TOKEN = "placeholder-token";
const DROP = "Bluetooth: GATT Server is disconnected.";

afterEach(cleanup);

const saved = (ssid: string): SavedNetwork => ({
  ssid,
  url: "",
  password_set: true,
  token_set: true,
});

function setup(
  vault: string[],
  panel: string[],
  current: string,
  opts: {
    nets?: Reply;
    status?: Reply;
    fail?: Cmd["op"];
    throwOn?: Cmd["op"];
    release?: PushRelease;
  } = {},
) {
  const sent: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push({ ...cmd });
      if (cmd.op === "status")
        return (
          opts.status ?? {
            ok: true,
            info: {
              name: "ginger",
              fw: "1",
              ssid: current,
              url: "",
              token: "none",
            },
          }
        );
      if (cmd.op === "nets")
        return (
          opts.nets ?? {
            ok: true,
            nets: panel.map((ssid) => ({
              ssid,
              has_url: false,
              has_token: false,
            })),
          }
        );
      if (cmd.op === opts.throwOn) throw new Error("link exploded");
      if (cmd.op === opts.fail) return { ok: false, error: DROP };
      return { ok: true };
    },
    close() {},
  };
  const api = {
    networksList: vi.fn(async () => ({
      networks: vault.map(saved),
      error: "",
      notice: "",
    })),
    networksConfirmPush: vi.fn(async () => ({ ok: true as const })),
    networksRelease: vi.fn(async (): Promise<PushRelease> =>
      opts.release
        ? { ...opts.release }
        : { ok: true, password: PASS, token: TOKEN },
    ),
    networksEndPush: vi.fn(async () => undefined),
  };
  Object.assign(window, { calico: api });
  const onFinished = vi.fn();
  render(<PushNetworks link={link} onFinished={onFinished} />);
  return { sent, api, onFinished };
}

describe("PushNetworks", () => {
  it("shows the plan and writes nothing until it is confirmed", async () => {
    const { sent, api, onFinished } = setup(
      ["home", "lab"],
      ["home", "old"],
      "home",
    );
    fireEvent.click(screen.getByText("Push to panel"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Add" }).textContent).toBe("lab");
    expect(
      screen.getByRole("list", { name: "Update, sent again" }).textContent,
    ).toBe("home");
    expect(
      screen.getByRole("list", { name: "Remove from the panel" }).textContent,
    ).toBe("old");
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    expect(api.networksRelease).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Cancel"),
    );

    fireEvent.click(screen.getByText("Push 3 changes"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushedAll(3), true),
    );
    expect(api.networksConfirmPush).toHaveBeenCalledWith(["home", "lab"]);
    expect(sent.slice(2)).toEqual([
      { op: "wifi", ssid: "home", pass: PASS, url: "", token: TOKEN },
      { op: "forget", ssid: "old" },
      { op: "wifi", ssid: "lab", pass: PASS, url: "", token: TOKEN },
    ]);
    expect(api.networksEndPush).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.innerHTML).not.toContain(PASS);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("keeps the panel's current network unless the person ticks it", async () => {
    const { sent, onFinished } = setup(["lab"], ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    expect(await screen.findByText(/The panel is on cafe now/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Remove from the panel" })).toBe(
      null,
    );
    fireEvent.click(screen.getByLabelText("Also remove cafe"));
    fireEvent.click(screen.getByLabelText("Also remove cafe"));
    fireEvent.click(screen.getByText("Push 1 change"));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(sent.some((c) => c.op === "forget")).toBe(false);
  });

  it("removes the current network only when ticked", async () => {
    const { sent, onFinished } = setup(["lab"], ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByLabelText("Also remove cafe"));
    fireEvent.click(screen.getByText("Push 2 changes"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushedAll(2), true),
    );
    expect(sent).toContainEqual({ op: "forget", ssid: "cafe" });
  });

  it("refuses a ninth network until the current one may go", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => `n${i}`);
    setup(eight, ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The panel would need 9 networks and holds 8.",
    );
    expect(
      (screen.getByText("Nothing to push") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Also remove cafe"));
    expect(
      (screen.getByText("Push 9 changes") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("stops on old firmware or an unreadable status before anything secret", async () => {
    for (const opts of [
      { nets: { ok: false as const, error: OLD_FIRMWARE } },
      { status: { ok: false as const, error: DROP } },
    ]) {
      const { sent, api } = setup(["home"], [], "", opts);
      fireEvent.click(screen.getByText("Push to panel"));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "nets" in opts ? OLD_FIRMWARE : DROP,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api.networksConfirmPush).not.toHaveBeenCalled();
      expect(api.networksRelease).not.toHaveBeenCalled();
      expect(sent.every((c) => c.op === "status" || c.op === "nets")).toBe(
        true,
      );
      cleanup();
    }
  });

  it("reports a push that stopped halfway, without restarting", async () => {
    const { onFinished } = setup(["home", "lab"], ["home", "old"], "home", {
      fail: "forget",
    });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 3 changes"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushStopped(1, 3, DROP), false),
    );
  });

  it("a keyring refusal stops the push with its message", async () => {
    const locked = "Calico could not unlock the saved password for home.";
    const { sent, onFinished } = setup(["home"], [], "", {
      release: { ok: false, error: locked },
    });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushStopped(0, 1, locked), false),
    );
    expect(sent.some((c) => c.op === "wifi")).toBe(false);
  });

  it("Cancel closes the plan, ends the push and returns focus to its opener", async () => {
    const { api, sent } = setup(["home"], [], "");
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.networksEndPush).toHaveBeenCalled();
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Push to panel"),
    );
  });

  it("says when there is nothing to push", async () => {
    setup([], [], "");
    fireEvent.click(screen.getByText("Push to panel"));
    expect(
      await screen.findByText(
        "Nothing to push: no networks are saved on this computer or on the panel.",
      ),
    ).toBeTruthy();
  });

  it("ends the push on every path: refused release, thrown link, thrown confirm", async () => {
    const a = setup(["home"], [], "", {
      release: { ok: false, error: "locked" },
    });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    await waitFor(() => expect(a.onFinished).toHaveBeenCalled());
    expect(a.api.networksEndPush).toHaveBeenCalledTimes(1);
    cleanup();

    const b = setup(["home"], [], "", { throwOn: "wifi" });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    await waitFor(() => expect(b.onFinished).toHaveBeenCalled());
    expect(b.api.networksEndPush).toHaveBeenCalledTimes(1);
    expect(String(b.onFinished.mock.calls[0]?.[0])).toContain("link exploded");
    expect(b.onFinished.mock.calls[0]?.[1]).toBe(false);
    cleanup();

    const c = setup(["home"], [], "");
    c.api.networksConfirmPush.mockRejectedValueOnce(new Error("ipc gone"));
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    await waitFor(() => expect(c.onFinished).toHaveBeenCalled());
    expect(c.api.networksEndPush).toHaveBeenCalledTimes(1);
    expect(String(c.onFinished.mock.calls[0]?.[0])).toContain("ipc gone");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a loading state and no verdict until the panel has answered", async () => {
    setup(["home"], [], "");
    fireEvent.click(screen.getByText("Push to panel"));
    const busy = screen.getByText("Reading the panel") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(screen.queryByText(/Nothing to push/)).toBeNull();
    await screen.findByRole("dialog");
    expect(
      (screen.getByText("Push to panel") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("names the steps done and says push can be run again", async () => {
    const msg = pushStopped(1, 3, DROP);
    expect(msg).toContain("1 of 3");
    expect(msg).toContain("push again");
    expect(msg).not.toContain("\u2014");
    expect(pushedAll(1)).not.toContain("\u2014");
  });

  it("gives a long SSID a tooltip and keeps secrets out of the DOM", async () => {
    const long = "x".repeat(32);
    setup([long], [], "");
    fireEvent.click(screen.getByText("Push to panel"));
    const item = await screen.findByText(long);
    expect(item.getAttribute("title")).toBe(long);
    expect(item.className).toContain("truncate");
  });

  it("shows progress as SSIDs and counts, never a secret", async () => {
    const { api } = setup(["home", "lab"], [], "");
    let seen = "";
    api.networksRelease.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0)); // let progress render
      seen += document.body.innerHTML;
      return { ok: true, password: PASS, token: TOKEN };
    });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 2 changes"));
    await waitFor(() => expect(api.networksEndPush).toHaveBeenCalled());
    expect(seen).toContain("Step 1 of 2: sending home<");
    expect(seen).not.toContain(PASS);
    expect(seen).not.toContain(TOKEN);
  });

  it("locks the dialog while pushing and ends the push when the keyring is not confirmed", async () => {
    const { api } = setup(["home"], [], "");
    let go: () => void = () => {};
    api.networksRelease.mockImplementation(
      () =>
        new Promise((r) => {
          go = () => r({ ok: true, password: PASS, token: TOKEN });
        }),
    );
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    const busy = (await screen.findByText("Pushing")) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByText("Cancel") as HTMLButtonElement).disabled).toBe(
      true,
    );
    go();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();

    const n = setup(["home"], [], "");
    n.api.networksConfirmPush.mockResolvedValueOnce({
      ok: false,
      error: "not allowed",
    } as never);
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    await waitFor(() => expect(n.api.networksEndPush).toHaveBeenCalled());
    expect(n.api.networksRelease).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "not allowed",
    );
  });

  it("warns in amber before the current network can be removed", async () => {
    setup(["lab"], ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    const warn = await screen.findByText(/The panel is on cafe now/);
    expect(warn.className).toContain("text-amber");
  });
});
