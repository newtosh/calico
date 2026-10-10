// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "../lib/api";
import { RelaySection } from "./RelaySection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const idle = {
  configured: false,
  last_poll_at: null,
  ok: null,
  applied: 0,
  refused: 0,
  error: "",
  used: null,
  budget: null,
};

function serve(initial: Record<string, unknown>, putStatus = 200) {
  configureApi("http://127.0.0.1:1", "hook");
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (putStatus === 200)
        current = patch.clear
          ? { url: "", token_set: false, status: idle }
          : {
              url: patch.url,
              token_set: true,
              status: { ...idle, configured: true },
            };
      return new Response("{}", { status: putStatus });
    }
    return Response.json(current);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const off = { url: "", token_set: false, status: idle };
const on = (status: Record<string, unknown>) => ({
  url: "https://r.example/inbox",
  token_set: true,
  status: { ...idle, configured: true, ...status },
});

describe("RelaySection", () => {
  it("offers to connect when no relay is set", async () => {
    serve(off);
    render(<RelaySection />);
    expect(
      await screen.findByRole("button", { name: /Connect an existing relay/ }),
    ).toBeTruthy();
  });

  it("opens the form, saves the address and token, and shows the relay", async () => {
    const fetchMock = serve(off);
    render(<RelaySection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Connect an existing relay/ }),
    );
    fireEvent.change(screen.getByLabelText("Relay address"), {
      target: { value: "https://r.example/inbox" },
    });
    fireEvent.change(screen.getByLabelText("Read token"), {
      target: { value: "tok" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("https://r.example/inbox")).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      url: "https://r.example/inbox",
      token: "tok",
    });
  });

  it("says what was wrong when the relay is rejected", async () => {
    serve(off, 400);
    render(<RelaySection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Connect an existing relay/ }),
    );
    fireEvent.change(screen.getByLabelText("Relay address"), {
      target: { value: "ftp://x" },
    });
    fireEvent.change(screen.getByLabelText("Read token"), {
      target: { value: "t" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/was not accepted/)).toBeTruthy();
  });

  it("cancels the form without saving", async () => {
    const fetchMock = serve(off);
    render(<RelaySection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Connect an existing relay/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Relay address")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("waits for the first check", async () => {
    serve(on({}));
    render(<RelaySection />);
    expect(await screen.findByText(/Waiting for the first check/)).toBeTruthy();
  });

  it("shows a working relay with when it was last read", async () => {
    serve(on({ ok: true, last_poll_at: new Date().toISOString() }));
    render(<RelaySection />);
    expect(await screen.findByText(/Connected, checked/)).toBeTruthy();
  });

  it("shows daily use when the relay reports it", async () => {
    serve(
      on({
        ok: true,
        last_poll_at: new Date().toISOString(),
        used: 212,
        budget: 60000,
      }),
    );
    render(<RelaySection />);
    expect(await screen.findByText(/212 of 60,000 requests/)).toBeTruthy();
  });

  it("says that messages were refused", async () => {
    serve(on({ ok: true, last_poll_at: new Date().toISOString(), refused: 2 }));
    render(<RelaySection />);
    expect(await screen.findByText(/2 messages were refused/)).toBeTruthy();
  });

  it("shows the failure in words and that agents' updates wait", async () => {
    serve(
      on({ ok: false, error: "The relay rejected the read token (HTTP 403)." }),
    );
    render(<RelaySection />);
    expect(await screen.findByText(/rejected the read token/)).toBeTruthy();
    expect(screen.getByText(/waiting safely on the relay/)).toBeTruthy();
  });

  it("asks before disconnecting, then forgets the relay", async () => {
    const fetchMock = serve(
      on({ ok: true, last_poll_at: new Date().toISOString() }),
    );
    render(<RelaySection />);
    fireEvent.click(await screen.findByRole("button", { name: /Disconnect/ }));
    expect(
      screen.getByText(/Updates already on the relay stay there/),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect relay" }));
    expect(
      await screen.findByRole("button", { name: /Connect an existing relay/ }),
    ).toBeTruthy();
  });
});
