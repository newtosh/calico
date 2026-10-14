import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  NetworkVault,
  NO_KEYRING,
  PLAINTEXT_KEYRING,
  type SecretBox,
} from "../../src/main/networks";
import type { NetworksState } from "../../src/shared/ipc";

const PASS = "placeholder-pass";
const TOKEN = "placeholder-token";

function box(backend = "gnome_libsecret", available = true) {
  const seen: string[] = [];
  const fake: SecretBox = {
    backend: () => backend,
    available: () => available,
    encrypt: (text) => {
      seen.push(text);
      return Buffer.from(`sealed-${seen.length}`);
    },
  };
  return { fake, seen };
}

const file = () =>
  join(mkdtempSync(join(tmpdir(), "calico-nets-")), "networks.json");
const home = { ssid: "home", url: "", edit: false };
/** The set-aside copies next to networks.json. */
const setAside = (path: string) =>
  readdirSync(dirname(path))
    .filter((f) => f.startsWith("networks.json.bad"))
    .map((f) => join(dirname(path), f));

describe("NetworkVault", () => {
  it("starts empty when there is no file", () => {
    expect(new NetworkVault(file(), box().fake).list()).toEqual({
      networks: [],
      error: "",
      notice: "",
    });
  });

  it("saves a network 0600 with the password sealed and gives the window only flags", () => {
    const path = file();
    const state = new NetworkVault(path, box().fake).save({
      ssid: "home",
      url: "http://10.0.0.8:8787",
      password: PASS,
      token: TOKEN,
      edit: false,
    });
    expect(state).toEqual({
      networks: [
        {
          ssid: "home",
          url: "http://10.0.0.8:8787",
          password_set: true,
          token_set: true,
        },
      ],
      error: "",
      notice: "",
    });
    const text = readFileSync(path, "utf8");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(text).not.toContain(PASS);
    expect(JSON.parse(text).networks[0]).toEqual({
      ssid: "home",
      url: "http://10.0.0.8:8787",
      token: TOKEN,
      password: Buffer.from("sealed-1").toString("base64"),
    });
    const sent = JSON.stringify(state);
    expect(sent).not.toContain(PASS);
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain(Buffer.from("sealed-1").toString("base64"));
  });

  it("refuses a password on the basic_text backend", () => {
    const path = file();
    const { fake, seen } = box("basic_text");
    const state = new NetworkVault(path, fake).save({
      ...home,
      password: PASS,
    });
    expect(state.error).toBe(PLAINTEXT_KEYRING);
    expect(state.networks).toEqual([]);
    expect(seen).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a password when encryption is unavailable", () => {
    for (const { fake } of [box("gnome_libsecret", false), box("unknown")]) {
      const path = file();
      const state = new NetworkVault(path, fake).save({
        ...home,
        password: PASS,
      });
      expect(state.error).toBe(NO_KEYRING);
      expect(existsSync(path)).toBe(false);
    }
  });

  it("saves an open network without a keyring", () => {
    const state = new NetworkVault(file(), box("basic_text").fake).save({
      ...home,
      password: "",
    });
    expect(state.error).toBe("");
    expect(state.networks[0]?.password_set).toBe(false);
  });

  it("keeps the password and token when an edit leaves them out, and clears them on empty", () => {
    const { fake, seen } = box();
    const vault = new NetworkVault(file(), fake);
    vault.save({ ...home, password: PASS, token: TOKEN });
    let state = vault.save({ ssid: "home", url: "http://h", edit: true });
    expect(state.networks[0]).toEqual({
      ssid: "home",
      url: "http://h",
      password_set: true,
      token_set: true,
    });
    expect(seen).toEqual([PASS]);
    state = vault.save({ ...home, edit: true, password: "", token: "" });
    expect(state.networks[0]?.password_set).toBe(false);
    expect(state.networks[0]?.token_set).toBe(false);
  });

  it("refuses a duplicate and keeps case-differing SSIDs", () => {
    const vault = new NetworkVault(file(), box().fake);
    vault.save({ ...home, password: "" });
    expect(vault.save({ ...home, password: "" }).error).toMatch(
      /already saved/,
    );
    const state = vault.save({ ...home, ssid: "Home", password: "" });
    expect(state.error).toBe("");
    expect(state.networks.map((n) => n.ssid)).toEqual(["home", "Home"]);
    expect(vault.save({ ...home, ssid: "gone", edit: true }).error).toMatch(
      /not saved/,
    );
  });

  it("counts SSID bytes, not characters", () => {
    const vault = new NetworkVault(file(), box().fake);
    const signal = "\u{1F4F6}";
    expect(
      vault.save({ ...home, ssid: signal.repeat(9), password: PASS }).error,
    ).toMatch(/at most 32 bytes/);
    expect(
      vault.save({ ...home, ssid: signal.repeat(8), password: "" }).error,
    ).toBe("");
  });

  it("refuses a ninth network", () => {
    const path = file();
    const vault = new NetworkVault(path, box().fake);
    for (let i = 0; i < 8; i++)
      vault.save({ ...home, ssid: `n${i}`, password: "" });
    const state = vault.save({ ...home, ssid: "ninth", password: "" });
    expect(state.error).toMatch(/holds 8 networks/);
    expect(JSON.parse(readFileSync(path, "utf8")).networks).toHaveLength(8);
  });

  it("encrypts a password with quotes and non-ASCII exactly, and refuses a newline without echoing it", () => {
    const { fake, seen } = box();
    const vault = new NetworkVault(file(), fake);
    const quoted = 'pla"ce\\hölder';
    expect(vault.save({ ...home, password: quoted }).error).toBe("");
    expect(seen).toEqual([quoted]);
    const state = vault.save({
      ...home,
      ssid: "other",
      password: `${PASS}\nx`,
    });
    expect(state.error).toBe("Password cannot contain a newline or NUL.");
    expect(state.error).not.toContain(PASS);
  });

  it("refuses input that is not a network", () => {
    const vault = new NetworkVault(file(), box().fake);
    expect(vault.save(null).error).toBe("That network could not be saved.");
    expect(vault.save({ ...home, password: 7 }).error).toBe(
      "That network could not be saved.",
    );
    expect(vault.remove(3).error).toBe("That network could not be removed.");
  });

  it("removes a network, and removing it again is not an error", () => {
    const path = file();
    const vault = new NetworkVault(path, box().fake);
    vault.save({ ...home, password: PASS });
    expect(vault.remove("home")).toEqual({
      networks: [],
      error: "",
      notice: "",
    });
    expect(vault.remove("home").error).toBe("");
    expect(JSON.parse(readFileSync(path, "utf8")).networks).toEqual([]);
  });

  it("sets aside a corrupt file and starts empty", () => {
    const path = file();
    writeFileSync(path, "{not json");
    const state = new NetworkVault(path, box().fake).list();
    expect(state.networks).toEqual([]);
    expect(state.notice).toMatch(/networks\.json\.bad-\d+/);
    const [bad] = setAside(path);
    expect(bad && readFileSync(bad, "utf8")).toBe("{not json");
  });

  it("sets aside a hand-edited duplicate or a wrong type", () => {
    for (const bad of [
      {
        networks: [
          { ssid: "a", url: "", token: "", password: "" },
          { ssid: "a", url: "", token: "", password: "" },
        ],
      },
      { networks: [{ ssid: "a", url: 5, token: "", password: "" }] },
      {
        networks: [{ ssid: "a", url: "", token: "", password: "not base64!" }],
      },
      {
        networks: Array.from({ length: 9 }, (_, i) => ({
          ssid: `n${i}`,
          url: "",
          token: "",
          password: "",
        })),
      },
      [],
    ]) {
      const path = file();
      writeFileSync(path, JSON.stringify(bad));
      expect(new NetworkVault(path, box().fake).list().notice).toMatch(
        /set it aside/,
      );
      expect(setAside(path)).toHaveLength(1);
    }
  });

  it("will not overwrite a file it cannot read", () => {
    const path = file();
    mkdirSync(path);
    const vault = new NetworkVault(path, box().fake);
    expect(vault.list().error).toMatch(/will not change it/);
    expect(vault.save({ ...home, password: "" }).error).toMatch(
      /will not change it/,
    );
    expect(vault.remove("home").error).toMatch(/will not change it/);
    expect(vault.remove(3).error).toMatch(/will not change it/);
    expect(statSync(path).isDirectory()).toBe(true);
  });

  it("keeps a save made while another is sealing, without a duplicate", () => {
    // Main is single-threaded, so the only way two saves interleave is a call out of
    // the vault mid-save. encrypt is that call: two saves land inside it.
    const path = file();
    let inner: NetworksState[] = [];
    const vault: NetworkVault = new NetworkVault(path, {
      backend: () => "gnome_libsecret",
      available: () => true,
      encrypt: () => {
        if (inner.length === 0)
          inner = [
            vault.save({ ...home, ssid: "b", password: "" }),
            vault.save({ ...home, ssid: "a", password: "" }),
          ];
        return Buffer.from("sealed");
      },
    });
    const outer = vault.save({ ...home, ssid: "a", password: PASS });
    expect(inner.map((s) => s.error)).toEqual(["", ""]);
    expect(outer.error).toMatch(/already saved/);
    expect(new NetworkVault(path, box().fake).list()).toEqual({
      networks: [
        { ssid: "b", url: "", password_set: false, token_set: false },
        { ssid: "a", url: "", password_set: false, token_set: false },
      ],
      error: "",
      notice: "",
    });
  });

  it("refuses a URL the panel would refuse", () => {
    const vault = new NetworkVault(file(), box().fake);
    expect(vault.save({ ...home, url: "ftp://x", password: "" }).error).toMatch(
      /URL must start with/,
    );
  });

  it("refuses when encrypt throws, writing nothing and echoing nothing", () => {
    const path = file();
    const state = new NetworkVault(path, {
      backend: () => "gnome_libsecret",
      available: () => true,
      encrypt: (text) => {
        throw new Error(`keyring refused ${text}`);
      },
    }).save({ ...home, password: PASS });
    expect(state.error).toBe(NO_KEYRING);
    expect(JSON.stringify(state)).not.toContain(PASS);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses rather than throws when the keyring query throws", () => {
    const fail = () => {
      throw new Error("keyring gone");
    };
    for (const fake of [
      { backend: fail, available: () => true },
      { backend: () => "gnome_libsecret", available: fail },
    ]) {
      const path = file();
      const vault = new NetworkVault(path, {
        ...fake,
        encrypt: () => Buffer.from("sealed"),
      });
      expect(vault.save({ ...home, password: PASS }).error).toBe(NO_KEYRING);
      expect(existsSync(path)).toBe(false);
    }
  });

  it("never overwrites an earlier set-aside copy", () => {
    const path = file();
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1000);
      writeFileSync(path, "{first");
      expect(new NetworkVault(path, box().fake).list().notice).toMatch(
        /networks\.json\.bad-1000/,
      );
      now.mockReturnValue(2000);
      writeFileSync(path, "{second");
      new NetworkVault(path, box().fake).list();
      expect(readFileSync(`${path}.bad-1000`, "utf8")).toBe("{first");
      expect(readFileSync(`${path}.bad-2000`, "utf8")).toBe("{second");
    } finally {
      now.mockRestore();
    }
  });
});
