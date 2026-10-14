// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "../lib/api";
import { NotifySection } from "./NotifySection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KEY = "sender-key-do-not-leak";

function serve(
  initial: Record<string, unknown>,
  putStatus = 200,
  putError = "",
) {
  configureApi("http://127.0.0.1:1", "hook");
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      if (putStatus !== 200)
        return Response.json(
          { error: putError || "bad notify" },
          { status: putStatus },
        );
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      current = patch.clear
        ? {
            url: "",
            header: "Authorization",
            offline_seconds: current.offline_seconds,
            key_set: false,
            last: null,
          }
        : {
            url: patch.url,
            header: patch.header || "Authorization",
            offline_seconds: patch.offline_seconds,
            key_set: patch.key
              ? true
              : current.key_set === true && patch.key !== "",
            last: current.last ?? null,
          };
      return Response.json(current);
    }
    return Response.json(current);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, read: () => current };
}

const empty = {
  url: "",
  header: "Authorization",
  offline_seconds: 180,
  key_set: false,
  last: null,
};

describe("NotifySection", () => {
  it("explains the header and shows the key only as masked", async () => {
    serve({
      ...empty,
      url: "https://hooks.example/calico",
      key_set: true,
      header: "X-Calico-Key",
      offline_seconds: 240,
      last: {
        at: "2026-10-14T20:41:00Z",
        type: "calico.online",
        ok: false,
        status: null,
        error: "timed out",
      },
    });
    const { container } = render(<NotifySection />);
    expect(
      await screen.findByText(/sealed with the system keyring/),
    ).toBeTruthy();
    expect(screen.getByText(/Authorization: Bearer/)).toBeTruthy();
    expect(screen.getByText(/raw key/)).toBeTruthy();
    expect(screen.getByText(/180 seconds/)).toBeTruthy();
    const key = screen.getByLabelText("Sender key") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.value).toBe("");
    expect(key.placeholder).toMatch(/Set/);
    expect(
      (screen.getByLabelText("Header name") as HTMLInputElement).value,
    ).toBe("X-Calico-Key");
    expect(
      await screen.findByText(/Panel online failed \(timed out\)/),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(KEY);
  });

  it("saves the address, header, threshold, and a newly typed key", async () => {
    const { fetchMock } = serve(empty);
    render(<NotifySection />);
    await screen.findByLabelText("Webhook address");
    fireEvent.change(screen.getByLabelText("Webhook address"), {
      target: { value: "https://hooks.example/calico" },
    });
    fireEvent.change(screen.getByLabelText("Sender key"), {
      target: { value: KEY },
    });
    fireEvent.change(screen.getByLabelText("Header name"), {
      target: { value: "X-Calico-Key" },
    });
    fireEvent.change(screen.getByLabelText("Offline threshold seconds"), {
      target: { value: "240" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      url: "https://hooks.example/calico",
      header: "X-Calico-Key",
      offline_seconds: 240,
      key: KEY,
    });
    expect(
      (screen.getByLabelText("Sender key") as HTMLInputElement).value,
    ).toBe("");
  });

  it("omits the key when the field was not touched", async () => {
    const { fetchMock } = serve({
      ...empty,
      url: "https://hooks.example/calico",
      key_set: true,
    });
    render(<NotifySection />);
    await screen.findByDisplayValue("https://hooks.example/calico");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("key");
    expect(body.offline_seconds).toBe(180);
  });

  it("shows the keyring refusal and does not echo the key", async () => {
    serve(
      empty,
      400,
      "Calico could not reach a system keyring, so it did not save the sender key.",
    );
    const { container } = render(<NotifySection />);
    await screen.findByLabelText("Webhook address");
    fireEvent.change(screen.getByLabelText("Webhook address"), {
      target: { value: "https://hooks.example/calico" },
    });
    fireEvent.change(screen.getByLabelText("Sender key"), {
      target: { value: KEY },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/did not save the sender key/)).toBeTruthy();
    expect(container.textContent).not.toContain(KEY);
  });
});
