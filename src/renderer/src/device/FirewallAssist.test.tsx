// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CalicoApi } from "../../../shared/ipc";
import { FirewallAssist } from "./FirewallAssist";

afterEach(cleanup);

describe("FirewallAssist", () => {
  it("does not blame a firewall or name a port when the server never started", async () => {
    window.calico = {
      firewall: async () => ({ kind: "ufw", command: null }),
    } as unknown as CalicoApi;
    render(<FirewallAssist port={null} />);
    expect(
      await screen.findByText(/calico is not listening on any port/i),
    ).toBeTruthy();
    expect(screen.queryByText(/port null/i)).toBeNull();
  });
});
