// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "../lib/api";
import { ConfigSection } from "./ConfigSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(timeout: number) {
  configureApi("http://127.0.0.1:1", "");
  const puts: unknown[] = [];
  let seen = timeout;
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      requested.push(
        `${init.method ?? "GET"} ${url.replace("http://127.0.0.1:1", "")}`,
      );
      if (init.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        puts.push(body);
        seen = Number(body.running_timeout_seconds ?? seen);
        return Response.json({ restart_required: false });
      }
      return Response.json({
        port: 8787,
        cursor_poll_seconds: 30,
        webhook_token_set: false,
        cursor_api_key_set: false,
        running_timeout_seconds: seen,
      });
    }),
  );
  return { puts, requested };
}

describe("ConfigSection running timeout", () => {
  it("shows the saved timeout and explains what it does", async () => {
    const { requested } = serve(600);
    render(<ConfigSection />);
    const field = (await screen.findByLabelText(
      "Running timeout seconds",
    )) as HTMLInputElement;
    await vi.waitFor(() => expect(field.value).toBe("600"));
    expect(requested).toContain("GET /api/config?detail=1");
    expect(screen.getByText(/stays Running without an update/)).toBeTruthy();
  });

  it("saves a new timeout as a number", async () => {
    const { puts } = serve(120);
    render(<ConfigSection />);
    const field = (await screen.findByLabelText(
      "Running timeout seconds",
    )) as HTMLInputElement;
    await vi.waitFor(() => expect(field.value).toBe("120"));
    fireEvent.change(field, { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ running_timeout_seconds: 600 });
  });

  it.each([
    ["", /from 30 to 3600/],
    ["abc", /from 30 to 3600/],
    ["10", /from 30 to 3600/],
    ["99999", /from 30 to 3600/],
    ["60.5", /from 30 to 3600/],
  ])(
    "does not send a save for the timeout %j, and says why",
    async (value, message) => {
      const { puts } = serve(120);
      render(<ConfigSection />);
      const field = (await screen.findByLabelText(
        "Running timeout seconds",
      )) as HTMLInputElement;
      await vi.waitFor(() => expect(field.value).toBe("120"));
      fireEvent.change(field, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("status")).textContent).toMatch(message);
      expect(puts).toHaveLength(0);
    },
  );

  it("catches a bad port or poll interval before the server rejects the whole save", async () => {
    const { puts } = serve(120);
    render(<ConfigSection />);
    const port = (await screen.findByLabelText("Port")) as HTMLInputElement;
    await vi.waitFor(() => expect(port.value).toBe("8787"));
    fireEvent.change(port, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Port must be/)).toBeTruthy();
    expect(puts).toHaveLength(0);
  });
});
