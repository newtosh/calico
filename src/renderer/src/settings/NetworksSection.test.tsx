// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkInput, NetworksState } from "../../../shared/ipc";
import type { DeviceLink } from "../device/commands";
import { NetworksSection } from "./NetworksSection";

const saved: NetworksState = {
  networks: [
    { ssid: "home", url: "", password_set: true, token_set: false },
    {
      ssid: "lab",
      url: "http://10.0.0.8:8787",
      password_set: false,
      token_set: true,
    },
  ],
  error: "",
  notice: "",
};

let api: {
  networksList: ReturnType<typeof vi.fn>;
  networksSave: ReturnType<typeof vi.fn>;
  networksRemove: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  api = {
    networksList: vi.fn(async () => saved),
    networksSave: vi.fn(async (input: NetworkInput) => ({
      ...saved,
      networks: [
        ...saved.networks,
        {
          ssid: input.ssid,
          url: input.url,
          password_set: true,
          token_set: false,
        },
      ],
    })),
    networksRemove: vi.fn(async () => ({ ...saved, networks: [] })),
  };
  Object.assign(window, { calico: api });
});

afterEach(cleanup);

const scanLink: DeviceLink = {
  kind: "ble",
  send: async () => ({ ok: true, aps: [{ rssi: -40, ssid: "cafe" }] }),
  close() {},
};

describe("NetworksSection", () => {
  it("lists each network with its URL and whether a password is set", async () => {
    render(<NetworksSection link={null} />);
    const list = await screen.findByRole("list", { name: "Saved networks" });
    expect(list.textContent).toContain("home");
    expect(list.textContent).toContain("Default URL");
    expect(list.textContent).toContain("Password set");
    expect(list.textContent).toContain("http://10.0.0.8:8787");
    expect(list.textContent).toContain("No password");
  });

  it("adds a hidden network by typing its SSID, then forgets the typed password", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "hidden" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "placeholder-pass" },
    });
    fireEvent.click(screen.getByText("Save network"));
    await waitFor(() =>
      expect(api.networksSave).toHaveBeenCalledWith({
        ssid: "hidden",
        url: "",
        edit: false,
        password: "placeholder-pass",
      }),
    );
    expect(await screen.findByText("hidden")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("placeholder-pass");
  });

  it("asks for a password or Open network before adding", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "cafe" },
    });
    fireEvent.click(screen.getByText("Save network"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.networksSave).not.toHaveBeenCalled();
  });

  it("shows the vault's refusal, such as a missing keyring", async () => {
    api.networksSave.mockResolvedValueOnce({
      ...saved,
      error: "Calico did not save it.",
    });
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "cafe" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "placeholder-pass" },
    });
    fireEvent.click(screen.getByText("Save network"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Calico did not save it.",
    );
  });

  it("edits without resending an untouched password", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByLabelText("Edit home"));
    expect((screen.getByLabelText("SSID") as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText("Companion URL for this network"), {
      target: { value: "http://10.0.0.9:8787" },
    });
    fireEvent.click(screen.getByText("Save network"));
    await waitFor(() =>
      expect(api.networksSave).toHaveBeenCalledWith({
        ssid: "home",
        url: "http://10.0.0.9:8787",
        edit: true,
      }),
    );
  });

  it("removes from this computer only after a confirmation", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByLabelText("Remove home"));
    expect(api.networksRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/The panel keeps it/)).toBeTruthy();
    fireEvent.click(screen.getByText("Remove network"));
    await waitFor(() =>
      expect(api.networksRemove).toHaveBeenCalledWith("home"),
    );
  });

  it("picks an SSID from the panel's scan", async () => {
    render(<NetworksSection link={scanLink} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.click(screen.getByText("Scan networks"));
    fireEvent.change(await screen.findByLabelText("Network"), {
      target: { value: "cafe" },
    });
    expect((screen.getByLabelText("SSID") as HTMLInputElement).value).toBe(
      "cafe",
    );
  });

  it("says how to scan when no panel is connected", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    expect(
      (screen.getByText("Scan networks") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Connect the panel on the Device page/),
    ).toBeTruthy();
  });

  it("stops adding at eight networks", async () => {
    api.networksList.mockResolvedValueOnce({
      ...saved,
      networks: Array.from({ length: 8 }, (_, i) => ({
        ssid: `n${i}`,
        url: "",
        password_set: false,
        token_set: false,
      })),
    });
    render(<NetworksSection link={null} />);
    await screen.findByText("n7");
    expect(
      (screen.getByText("Add network") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/holds 8 networks/)).toBeTruthy();
  });

  it("shows a loading state, with Add disabled, until the list arrives", async () => {
    let release: (s: NetworksState) => void = () => undefined;
    api.networksList.mockReturnValueOnce(
      new Promise<NetworksState>((r) => (release = r)),
    );
    render(<NetworksSection link={null} />);
    expect(screen.queryByText("No networks saved.")).toBeNull();
    expect(screen.getByText("Loading networks")).toBeTruthy();
    expect(
      (screen.getByText("Add network") as HTMLButtonElement).disabled,
    ).toBe(true);
    release({ ...saved, networks: [] });
    expect(await screen.findByText("No networks saved.")).toBeTruthy();
    expect(
      (screen.getByText("Add network") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("gives a long SSID a tooltip with the full name", async () => {
    const long = "The-Quick-Brown-Fox-Jumps-Over-It";
    api.networksList.mockResolvedValueOnce({
      ...saved,
      networks: [{ ssid: long, url: "", password_set: true, token_set: false }],
    });
    render(<NetworksSection link={null} />);
    expect((await screen.findByText(long)).getAttribute("title")).toBe(long);
  });

  it("keeps the remove confirmation inside the list container", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByLabelText("Remove home"));
    const box = screen.getByText(/The panel keeps it/).parentElement;
    expect(box?.parentElement?.className).toContain("max-w-2xl");
    expect(box?.parentElement?.className).toContain("px-4");
  });

  it("moves focus into the form, and back to the opener when it closes", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    expect(document.activeElement).toBe(screen.getByLabelText("SSID"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.activeElement).toBe(screen.getByText("Add network"));

    fireEvent.click(screen.getByLabelText("Edit home"));
    expect(document.activeElement).toBe(screen.getByLabelText("Password"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.activeElement).toBe(screen.getByLabelText("Edit home"));
  });

  it("returns focus to the opener after saving", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "hidden" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "placeholder-pass" },
    });
    fireEvent.click(screen.getByText("Save network"));
    await screen.findByText("hidden");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText("Add network")),
    );
  });

  it("puts focus on the heading when the removed row's button is gone", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByLabelText("Remove home"));
    fireEvent.click(screen.getByText("Remove network"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText("Wi-Fi networks")),
    );
  });

  it("shows an empty password after cancelling and reopening", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "placeholder-pass" },
    });
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Add network"));
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    expect(document.body.innerHTML).not.toContain("placeholder-pass");
  });
});
