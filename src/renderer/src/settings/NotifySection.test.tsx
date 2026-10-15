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
  let current: Record<string, unknown> = { recent: [], ...initial };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      if (putStatus !== 200)
        return Response.json(
          { error: putError || "bad notify" },
          { status: putStatus },
        );
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      const nextUrl =
        typeof patch.url === "string" ? patch.url : String(current.url ?? "");
      const keySet =
        "key" in patch
          ? patch.key !== ""
          : nextUrl !== current.url
            ? false
            : current.key_set === true;
      current = patch.clear
        ? {
            url: "",
            header: "Authorization",
            offline_seconds: current.offline_seconds,
            key_set: false,
            last: null,
            recent: [],
          }
        : {
            url: nextUrl,
            header: patch.header || "Authorization",
            offline_seconds: patch.offline_seconds ?? current.offline_seconds,
            key_set: keySet,
            last: current.last ?? null,
            recent: current.recent ?? [],
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
      key: KEY,
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
    expect(key.placeholder).toBe("Set");
    expect(
      (screen.getByLabelText("Webhook address") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("https://hooks.example/calico")).toBeTruthy();
    expect(
      screen.getByLabelText("Webhook address").getAttribute("aria-describedby"),
    ).not.toBe(
      screen.getByLabelText("Sender key").getAttribute("aria-describedby"),
    );
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

  it("omits the key and the address when neither field was touched", async () => {
    const { fetchMock } = serve({
      ...empty,
      url: "https://hooks.example/calico",
      key_set: true,
    });
    render(<NotifySection />);
    expect(
      await screen.findByText("https://hooks.example/calico"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Webhook address") as HTMLInputElement).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("key");
    expect(body).not.toHaveProperty("url");
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
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/did not save the sender key/);
    expect(alert.textContent).not.toContain(KEY);
    expect(alert.className).toContain("text-amber");
    expect(container.querySelector("#notify-notice")).toBe(alert);
  });

  it("mounts the save notice before it has anything to say", () => {
    serve(empty);
    render(<NotifySection />);
    const notice = document.getElementById("notify-notice");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toBe("");
  });

  it("shows Not set after a new address is saved without a key", async () => {
    const { fetchMock } = serve({
      ...empty,
      url: "https://hooks.example/calico",
      key_set: true,
    });
    render(<NotifySection />);
    await screen.findByText("https://hooks.example/calico");
    fireEvent.change(screen.getByLabelText("Webhook address"), {
      target: { value: "https://other.example/hook" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(
      (screen.getByLabelText("Sender key") as HTMLInputElement).placeholder,
    ).toBe("Not set");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body)) as Record<string, unknown>;
    expect(body.url).toBe("https://other.example/hook");
    expect(body).not.toHaveProperty("key");
  });

  it("warns when plain http would carry the sender key", async () => {
    serve({
      ...empty,
      url: "http://192.168.1.9/hook",
      key_set: true,
    });
    render(<NotifySection />);
    const warning = await screen.findByText(/in the clear/);
    expect(warning.className).toContain("text-amber");
  });

  it("removes only the key", async () => {
    const { fetchMock } = serve({
      ...empty,
      url: "https://hooks.example/\u2026",
      key_set: true,
    });
    render(<NotifySection />);
    const button = await screen.findByRole("button", { name: "Remove key" });
    fireEvent.click(button);
    expect(await screen.findByText("Saved.")).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ key: "" });
    expect(
      (screen.getByLabelText("Sender key") as HTMLInputElement).placeholder,
    ).toBe("Not set");
  });
});
