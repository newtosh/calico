// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import type { DeviceLink } from "./commands";
import { LinkActions } from "./LinkActions";

const keepStored = vi.fn<(url: string) => Promise<string>>();
vi.mock("../lib/stored-url", () => ({
  keepStoredAddress: (url: string) => keepStored(url),
}));

const link: DeviceLink = {
  kind: "ble",
  send: async () => ({ ok: true }),
  close() {},
};
const info = {
  name: "ginger",
  fw: "1.2",
  ssid: "home",
  url: "http://x:1",
  token: "set" as const,
};
const base = {
  port: 8787,
  lanUrls: ["http://192.168.1.2:8787"],
  webhookToken: "",
  addressChange: null,
} as unknown as CalicoInfo;

beforeEach(() => {
  keepStored.mockReset();
  keepStored.mockResolvedValue("");
});
afterEach(cleanup);

it("labels the readout of the address the panel polls", async () => {
  const sending: DeviceLink = {
    ...link,
    send: async () => ({ ok: true, info }),
  };
  render(<LinkActions info={base} link={sending} onReboot={async () => {}} />);
  expect(await screen.findByText("Calico's address")).toBeTruthy();
});

function field(info: CalicoInfo) {
  render(<LinkActions info={info} link={link} onReboot={async () => {}} />);
  return (
    screen.getByLabelText(
      "Calico's address (the panel polls this)",
    ) as HTMLInputElement
  ).value;
}

describe("LinkActions", () => {
  it("starts the URL field at this computer's first address", () => {
    expect(field(base)).toBe("http://192.168.1.2:8787");
  });

  it("starts the URL field at the offered address when the banner sent the person here", () => {
    expect(
      field({ ...base, addressChange: { url: "http://192.168.4.30:8787" } }),
    ).toBe("http://192.168.4.30:8787");
  });

  it("follows a new offer while mounted, until the person types", () => {
    const offer = { url: "http://192.168.4.30:8787" };
    const view = (info: CalicoInfo) => (
      <LinkActions info={info} link={link} onReboot={async () => {}} />
    );
    const { rerender } = render(view(base));
    const input = screen.getByLabelText(
      "Calico's address (the panel polls this)",
    ) as HTMLInputElement;
    rerender(view({ ...base, addressChange: offer }));
    expect(input.value).toBe(offer.url);
    fireEvent.change(input, { target: { value: "http://10.0.0.9:8787" } });
    rerender(view({ ...base, addressChange: { url: "http://10.0.0.5:8787" } }));
    expect(input.value).toBe("http://10.0.0.9:8787");
  });
});

describe("Set URL keeps Settings in step", () => {
  beforeEach(() => {
    Object.assign(window, {
      calico: { adoptPort: vi.fn(async () => undefined) },
    });
  });
  const SAVED =
    "Calico's address saved on the panel. It applies after a reboot.";
  const withReply = (reply: Awaited<ReturnType<DeviceLink["send"]>>) => {
    const sending: DeviceLink = { ...link, send: async () => reply };
    render(
      <LinkActions info={base} link={sending} onReboot={async () => {}} />,
    );
  };

  it("updates the saved address after the panel accepts the URL", async () => {
    withReply({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Set URL" }));
    expect(await screen.findByText(SAVED)).toBeTruthy();
    expect(keepStored).toHaveBeenCalledWith("http://192.168.1.2:8787");
  });

  it("adds the note when the saved address could not be updated", async () => {
    keepStored.mockResolvedValue(
      "Calico's saved address was not updated: offline.",
    );
    withReply({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Set URL" }));
    expect(
      await screen.findByText(
        `${SAVED} Calico's saved address was not updated: offline.`,
      ),
    ).toBeTruthy();
  });

  it("still shows the panel's error when it refuses the URL", async () => {
    withReply({ ok: false, error: "panel said no" });
    fireEvent.click(screen.getByRole("button", { name: "Set URL" }));
    expect(await screen.findByText("panel said no")).toBeTruthy();
  });

  it("updates the saved address before writing to the panel, so a poll cannot offer the old one back", async () => {
    const order: string[] = [];
    keepStored.mockImplementation(async () => {
      order.push("sync");
      return "";
    });
    const sending: DeviceLink = {
      ...link,
      send: async (cmd) => {
        order.push(cmd.op);
        return { ok: true };
      },
    };
    render(
      <LinkActions info={base} link={sending} onReboot={async () => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set URL" }));
    await screen.findByText(SAVED);
    expect(order.indexOf("sync")).toBeLessThan(order.indexOf("url"));
  });
});
