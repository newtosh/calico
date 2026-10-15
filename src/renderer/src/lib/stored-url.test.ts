import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPanel = vi.fn();
const putPanel = vi.fn();
vi.mock("./api", () => ({
  fetchPanel: () => fetchPanel(),
  putPanel: (patch: unknown) => putPanel(patch),
}));
import { keepStoredAddress } from "./stored-url";

const NEW = "http://192.168.4.30:8787";

beforeEach(() => {
  fetchPanel.mockReset();
  putPanel.mockReset();
  putPanel.mockResolvedValue({ url: NEW, token_set: true });
});

describe("keepStoredAddress", () => {
  it("updates a stored address that differs", async () => {
    fetchPanel.mockResolvedValue({
      url: "http://192.168.4.201:8787",
      token_set: true,
    });
    expect(await keepStoredAddress(NEW)).toBe("");
    expect(putPanel).toHaveBeenCalledWith({ url: NEW });
  });

  it("never creates an address when none is stored", async () => {
    fetchPanel.mockResolvedValue({ url: "", token_set: false });
    expect(await keepStoredAddress(NEW)).toBe("");
    expect(putPanel).not.toHaveBeenCalled();
  });

  it("leaves an address that already matches, with or without a trailing slash", async () => {
    fetchPanel.mockResolvedValue({ url: `${NEW}/`, token_set: true });
    expect(await keepStoredAddress(NEW)).toBe("");
    expect(putPanel).not.toHaveBeenCalled();
  });

  it("returns a note instead of throwing when the stored address cannot be read", async () => {
    fetchPanel.mockRejectedValue(new Error("offline"));
    const note = await keepStoredAddress(NEW);
    expect(note).toMatch(/not updated/);
    expect(note).toMatch(/offline/);
  });

  it("returns a note instead of throwing when the update is refused", async () => {
    fetchPanel.mockResolvedValue({
      url: "http://192.168.4.201:8787",
      token_set: true,
    });
    putPanel.mockRejectedValue(new Error("bad panel"));
    expect(await keepStoredAddress(NEW)).toMatch(/bad panel/);
  });
});
