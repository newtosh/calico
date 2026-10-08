export const SSID_MAX = 32;
export const PASS_MAX = 64;
export const URL_MAX = 127;
export const TOKEN_MAX = 127;

export interface DeskInfo {
  name: string;
  fw: string;
  ssid: string;
  url: string;
  token: "set" | "none";
}

export interface Ap {
  rssi: number;
  ssid: string;
}

export type ProbeReason = "auth" | "missing" | "timeout" | "radio" | "other";

export type Cmd =
  | { op: "status" }
  | { op: "scan" }
  | { op: "verify"; ssid: string; pass: string }
  | { op: "wifi"; ssid: string; pass: string }
  | { op: "url"; value: string }
  | { op: "token"; value: string }
  | { op: "reboot" };

export type Reply =
  | { ok: true; info?: DeskInfo; aps?: Ap[] }
  | { ok: false; error: string; reason?: ProbeReason };

export interface DeviceLink {
  kind: "usb" | "ble";
  send(cmd: Cmd): Promise<Reply>;
  close(): void;
}

export class FieldError extends Error {}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function noBreaks(value: string, label: string): void {
  if (/[\r\n\0]/.test(value))
    throw new FieldError(`${label} cannot contain a newline or NUL.`);
}

function checkSsid(ssid: string): void {
  noBreaks(ssid, "SSID");
  if (!ssid) throw new FieldError("SSID is required.");
  if (bytes(ssid) > SSID_MAX)
    throw new FieldError(`SSID must be at most ${SSID_MAX} bytes.`);
}

function checkPass(pass: string): void {
  noBreaks(pass, "Password");
  const n = bytes(pass);
  if (n > PASS_MAX)
    throw new FieldError(`Password must be at most ${PASS_MAX} bytes.`);
  if (n > 0 && n < 8)
    throw new FieldError(
      "Password must be empty (open network) or 8 to 64 bytes.",
    );
}

export function validateCmd(cmd: Cmd): void {
  switch (cmd.op) {
    case "url": {
      noBreaks(cmd.value, "URL");
      const ok =
        (cmd.value.startsWith("http://") && cmd.value.length > 7) ||
        (cmd.value.startsWith("https://") && cmd.value.length > 8);
      if (!ok)
        throw new FieldError(
          "URL must start with http:// or https:// and name a host.",
        );
      if (bytes(cmd.value) > URL_MAX)
        throw new FieldError(`URL must be at most ${URL_MAX} bytes.`);
      return;
    }
    case "token":
      noBreaks(cmd.value, "Token");
      if (bytes(cmd.value) > TOKEN_MAX)
        throw new FieldError(`Token must be at most ${TOKEN_MAX} bytes.`);
      return;
    case "verify":
    case "wifi":
      checkSsid(cmd.ssid);
      checkPass(cmd.pass);
      return;
    default:
      return;
  }
}

export function timeoutFor(cmd: Cmd): number {
  return cmd.op === "scan" || cmd.op === "verify" ? 30_000 : 10_000;
}

export function secretsOf(cmd: Cmd): string[] {
  if (cmd.op === "verify" || cmd.op === "wifi")
    return cmd.pass ? [cmd.pass] : [];
  if (cmd.op === "token") return cmd.value ? [cmd.value] : [];
  return [];
}

export function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1).replace(/\r$/, "");
  }
  return out;
}

const orEmpty = (value: string | undefined) =>
  value === undefined || value === "none" ? "" : value;

export function infoFromKv(kv: Record<string, string>): DeskInfo {
  return {
    name: kv.name ?? "",
    fw: kv.fw ?? "",
    ssid: orEmpty(kv.ssid),
    url: orEmpty(kv.url),
    token: kv.token === "set" ? "set" : "none",
  };
}

export function parseScan(body: string): { state: string; aps: Ap[] } {
  const aps: Ap[] = [];
  for (const line of body.split("\n")) {
    const tab = line.indexOf("\t");
    if (line.startsWith("state=") || tab < 0) continue;
    const rssi = Number.parseInt(line.slice(0, tab), 10);
    const ssid = line.slice(tab + 1).replace(/\r$/, "");
    if (Number.isNaN(rssi) || !ssid) continue;
    aps.push({ rssi, ssid });
  }
  aps.sort((a, b) => b.rssi - a.rssi);
  return { state: parseKv(body).state ?? "", aps };
}

export function parseProbe(body: string): {
  state: string;
  ssid: string;
  reason: string;
} {
  const kv = parseKv(body);
  return {
    state: kv.state ?? "",
    ssid: kv.ssid ?? "",
    reason: kv.reason ?? "",
  };
}

export function toReason(value: string): ProbeReason {
  return value === "auth" ||
    value === "missing" ||
    value === "timeout" ||
    value === "radio"
    ? value
    : "other";
}

export function describeProbeFailure(ssid: string, reason: string): string {
  const name = ssid || "that network";
  const why: Record<string, string> = {
    auth: " The password was rejected.",
    missing: " The network was not found.",
    timeout: " The network did not answer in time.",
    radio: " The radio was busy.",
  };
  return `Could not join ${name}.${why[reason] ?? ""} Nothing was saved.`;
}
