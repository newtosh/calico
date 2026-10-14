import {
  checkPass,
  checkSsid,
  checkToken,
  checkUrl,
  NETWORKS_MAX,
} from "../../../shared/panel-fields";

export {
  FieldError,
  NETWORKS_MAX,
  PASS_MAX,
  SSID_MAX,
  TOKEN_MAX,
  URL_MAX,
} from "../../../shared/panel-fields";

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

export interface PanelNet {
  ssid: string;
  has_url: boolean;
  has_token: boolean;
}

export type Cmd =
  | { op: "status" }
  | { op: "scan" }
  | { op: "verify"; ssid: string; pass: string }
  // url and token travel together: sending either writes both to this network's slot.
  | { op: "wifi"; ssid: string; pass: string; url?: string; token?: string }
  | { op: "url"; value: string }
  | { op: "token"; value: string }
  | { op: "reboot" }
  | { op: "nets" }
  | { op: "forget"; ssid: string };

export type Reply =
  | { ok: true; info?: DeskInfo; aps?: Ap[]; nets?: PanelNet[] }
  | { ok: false; error: string; reason?: ProbeReason };

export interface DeviceLink {
  kind: "usb" | "ble";
  send(cmd: Cmd): Promise<Reply>;
  close(): void;
}

export function validateCmd(cmd: Cmd): void {
  switch (cmd.op) {
    case "url":
      checkUrl(cmd.value);
      return;
    case "token":
      checkToken(cmd.value);
      return;
    case "verify":
      checkSsid(cmd.ssid);
      checkPass(cmd.pass);
      return;
    case "wifi":
      checkSsid(cmd.ssid);
      checkPass(cmd.pass);
      // An empty URL means this network uses the panel's global one.
      if (cmd.url) checkUrl(cmd.url);
      if (cmd.token !== undefined) checkToken(cmd.token);
      return;
    case "forget":
      checkSsid(cmd.ssid);
      return;
    default:
      return;
  }
}

export function timeoutFor(cmd: Cmd): number {
  return cmd.op === "scan" || cmd.op === "verify" ? 30_000 : 10_000;
}

export function secretsOf(cmd: Cmd): string[] {
  if (cmd.op === "verify") return cmd.pass ? [cmd.pass] : [];
  if (cmd.op === "wifi") return [cmd.pass, cmd.token ?? ""].filter(Boolean);
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

/** The panel's nets read: "count=N", then "<url><token>\t<ssid>" with 1 or 0 flags. */
export function parseNets(body: string): PanelNet[] {
  const nets: PanelNet[] = [];
  for (const line of body.split("\n")) {
    const tab = line.indexOf("\t");
    const flags = line.slice(0, tab);
    const ssid = line.slice(tab + 1).replace(/\r$/, "");
    if (tab !== 2 || !/^[01]{2}$/.test(flags) || !ssid) continue;
    nets.push({
      ssid,
      has_url: flags[0] === "1",
      has_token: flags[1] === "1",
    });
  }
  return nets.slice(0, NETWORKS_MAX);
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
