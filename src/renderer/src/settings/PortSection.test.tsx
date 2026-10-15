// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "../lib/api";
import { PortSection } from "./PortSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(restart = false) {
  configureApi("http://127.0.0.1:1", "");
  const puts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      if (init.method === "PUT") {
        puts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Response.json({ restart_required: restart });
      }
      return Response.json({
        port: 8787,
        cursor_poll_seconds: 30,
        webhook_token_set: false,
        cursor_api_key_set: false,
        running_timeout_seconds: 120,
      });
    }),
  );
  return { puts };
}

describe("PortSection", () => {
  it("shows the saved port", async () => {
    serve();
    render(<PortSection />);
    const field = (await screen.findByLabelText("Port")) as HTMLInputElement;
    await vi.waitFor(() => expect(field.value).toBe("8787"));
  });

  it("saves only the port, and says when a restart is needed", async () => {
    const { puts } = serve(true);
    render(<PortSection />);
    const field = (await screen.findByLabelText("Port")) as HTMLInputElement;
    await vi.waitFor(() => expect(field.value).toBe("8787"));
    fireEvent.change(field, { target: { value: "9001" } });
    fireEvent.click(screen.getByRole("button", { name: "Save port" }));
    expect(await screen.findByText(/Quit and reopen Calico/)).toBeTruthy();
    expect(puts).toEqual([{ port: 9001 }]);
  });

  it("catches a bad port before the server rejects it", async () => {
    const { puts } = serve();
    render(<PortSection />);
    const field = (await screen.findByLabelText("Port")) as HTMLInputElement;
    await vi.waitFor(() => expect(field.value).toBe("8787"));
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save port" }));
    expect(await screen.findByText(/Port must be/)).toBeTruthy();
    expect(puts).toEqual([]);
  });
});
