import { readFileSync, renameSync } from "node:fs";
import { basename } from "node:path";
import { writeAtomic } from "../server/state-file";
import type { NetworkInput, NetworksState, SavedNetwork } from "../shared/ipc";
import {
  checkPass,
  checkSsid,
  checkToken,
  checkUrl,
  FieldError,
  NETWORKS_MAX,
} from "../shared/panel-fields";

/** What the vault needs from Electron's safeStorage, injected so tests never touch a keyring. */
export interface SecretBox {
  /** safeStorage.getSelectedStorageBackend() on Linux. */
  backend(): string;
  available(): boolean;
  encrypt(text: string): Buffer;
}

interface StoredNetwork {
  ssid: string;
  url: string;
  token: string;
  /** base64 of the safeStorage ciphertext. "" is an open network. */
  password: string;
}

export const NO_KEYRING =
  "Calico could not reach a system keyring, so it did not save the password. Unlock GNOME Keyring or KWallet, then try again.";
export const PLAINTEXT_KEYRING =
  "This desktop gives Calico no keyring, so the password would be stored as plain text. Calico did not save it. Install GNOME Keyring or KWallet, then try again.";
const BAD_INPUT = "That network could not be saved.";
const BAD_REMOVE = "That network could not be removed.";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkFields(ssid: string, url: string, token: string): void {
  checkSsid(ssid);
  if (url !== "") checkUrl(url);
  checkToken(token);
}

function view(n: StoredNetwork): SavedNetwork {
  return {
    ssid: n.ssid,
    url: n.url,
    password_set: n.password !== "",
    token_set: n.token !== "",
  };
}

/** The file as written by save. Anything else is a hand edit or damage, and throws. */
export function parseNetworks(value: unknown): StoredNetwork[] {
  if (!isRecord(value) || !Array.isArray(value.networks))
    throw new Error("bad networks");
  if (value.networks.length > NETWORKS_MAX) throw new Error("too many");
  const seen = new Set<string>();
  return value.networks.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error("bad network");
    const { ssid, url, token, password } = entry;
    if (
      typeof ssid !== "string" ||
      typeof url !== "string" ||
      typeof token !== "string" ||
      typeof password !== "string"
    )
      throw new Error("bad network");
    checkFields(ssid, url, token);
    if (password !== "" && !BASE64.test(password))
      throw new Error("bad network");
    if (seen.has(ssid)) throw new Error("duplicate network");
    seen.add(ssid);
    return { ssid, url, token, password };
  });
}

function optional(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FieldError(BAD_INPUT);
  return value;
}

function networkInput(raw: unknown): NetworkInput {
  if (
    !isRecord(raw) ||
    typeof raw.ssid !== "string" ||
    typeof raw.url !== "string" ||
    typeof raw.edit !== "boolean"
  )
    throw new FieldError(BAD_INPUT);
  const input: NetworkInput = {
    ssid: raw.ssid,
    url: raw.url,
    edit: raw.edit,
    password: optional(raw.password),
    token: optional(raw.token),
  };
  checkFields(input.ssid, input.url, input.token ?? "");
  if (input.password !== undefined) checkPass(input.password);
  return input;
}

function keyringRefusal(box: SecretBox): string | null {
  const backend = box.backend();
  if (backend === "basic_text") return PLAINTEXT_KEYRING;
  if (backend === "unknown" || !box.available()) return NO_KEYRING;
  return null;
}

// ponytail: synchronous file I/O serializes saves, and the single-instance lock makes main the
// only writer. An async rewrite would need a queue.
export class NetworkVault {
  private nets: StoredNetwork[] = [];
  private notice = "";
  /** Set when networks.json exists but cannot be read: saving would overwrite it. */
  private blocked = "";

  constructor(
    private readonly path: string,
    private readonly box: SecretBox,
  ) {
    this.load();
  }

  list(): NetworksState {
    return this.state("");
  }

  save(raw: unknown): NetworksState {
    if (this.blocked) return this.state("");
    let input: NetworkInput;
    try {
      input = networkInput(raw);
    } catch (err) {
      return this.state(err instanceof FieldError ? err.message : BAD_INPUT);
    }
    // Seal before reading this.nets: nothing outside the vault runs between that read
    // and the write, so a save that lands during encrypt cannot be lost or duplicated.
    let sealed = "";
    if (input.password) {
      try {
        const refused = keyringRefusal(this.box);
        if (refused) return this.state(refused);
        sealed = this.box.encrypt(input.password).toString("base64");
      } catch {
        return this.state(NO_KEYRING);
      }
    }
    const at = this.nets.findIndex((n) => n.ssid === input.ssid);
    if (input.edit && at < 0) return this.state(`${input.ssid} is not saved.`);
    if (!input.edit && at >= 0)
      return this.state(`${input.ssid} is already saved. Edit it instead.`);
    if (!input.edit && this.nets.length >= NETWORKS_MAX)
      return this.state(
        `The panel holds ${NETWORKS_MAX} networks. Remove one first.`,
      );
    const old = this.nets[at];
    const password =
      input.password === undefined ? (old?.password ?? "") : sealed;
    const next: StoredNetwork = {
      ssid: input.ssid,
      url: input.url,
      token: input.token ?? old?.token ?? "",
      password,
    };
    return this.write(
      at >= 0
        ? this.nets.map((n, i) => (i === at ? next : n))
        : [...this.nets, next],
    );
  }

  remove(raw: unknown): NetworksState {
    if (this.blocked) return this.state("");
    if (typeof raw !== "string") return this.state(BAD_REMOVE);
    if (!this.nets.some((n) => n.ssid === raw)) return this.state("");
    return this.write(this.nets.filter((n) => n.ssid !== raw));
  }

  private write(nets: StoredNetwork[]): NetworksState {
    try {
      writeAtomic(
        this.path,
        `${JSON.stringify({ networks: nets }, null, 2)}\n`,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "a write error";
      return this.state(`Could not save ${basename(this.path)} (${code}).`);
    }
    this.nets = nets;
    return this.state("");
  }

  private load(): void {
    const name = basename(this.path);
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      this.blocked = `Calico cannot read ${name} (${code ?? "error"}), so it will not change it. Fix the file, then restart Calico.`;
      return;
    }
    try {
      this.nets = parseNetworks(JSON.parse(text));
    } catch {
      // A unique name, so an earlier set-aside copy is never overwritten.
      const bad = `${this.path}.bad-${Date.now()}`;
      try {
        renameSync(this.path, bad);
      } catch {
        this.blocked = `Calico cannot read ${name}, so it will not change it. Fix the file, then restart Calico.`;
        return;
      }
      this.notice = `${name} was damaged, so Calico set it aside as ${basename(bad)} and started an empty list.`;
    }
  }

  private state(error: string): NetworksState {
    return {
      networks: this.nets.map(view),
      error: error || this.blocked,
      notice: this.notice,
    };
  }
}
