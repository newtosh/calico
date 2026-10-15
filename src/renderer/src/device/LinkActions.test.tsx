// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import type { DeviceLink } from "./commands";
import { LinkActions } from "./LinkActions";

const link: DeviceLink = {
  kind: "ble",
  send: async () => ({ ok: true }),
  close() {},
};
const base = {
  port: 8787,
  lanUrls: ["http://192.168.1.2:8787"],
  webhookToken: "",
  addressChange: null,
} as unknown as CalicoInfo;

afterEach(cleanup);

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
