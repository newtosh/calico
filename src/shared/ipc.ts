export interface Candidate {
  id: string;
  name: string;
}

export interface ServerErrorInfo {
  first: number;
  last: number;
  holders: string[];
}

/** Why the server turned a request away. A short code, never the request. */
export type RefusalReason =
  "unauthorized" | "forbidden_origin" | "bad_json" | "bad_event" | "too_large";

/** What the server has seen since calico started. Epoch ms. In memory only. */
export interface WebhookActivity {
  accepted: { at: number; from: string } | null;
  refused: {
    count: number;
    last: { at: number; reason: RefusalReason; from: string } | null;
  };
}

export interface CalicoInfo {
  /** http://127.0.0.1:<port>, null if the server could not bind. */
  serverUrl: string | null;
  /** Bound port. */
  port: number | null;
  /** Saved port the panel was told. */
  expectedPort: number;
  lanUrls: string[];
  /** Epoch ms of the last non-loopback GET /api/status. */
  lastPanelPoll: number | null;
  webhookToken: string;
  webhook: WebhookActivity;
  serverError: ServerErrorInfo | null;
  autostart: { enabled: boolean; available: boolean };
  /** Release version from package.json. */
  version: string;
}

export type FirewallKind = "ufw" | "firewalld" | "nftables" | "none";

export interface FirewallInfo {
  kind: FirewallKind;
  command: string | null;
}

export interface SerialAccess {
  denied: string[];
  group: string;
  command: string;
}

export interface FixResult {
  ok: boolean;
  output: string;
}

export interface CalicoApi {
  info(): Promise<CalicoInfo>;
  onBleCandidates(cb: (list: Candidate[]) => void): () => void;
  /** "" cancels. */
  chooseBle(id: string): void;
  onSerialCandidates(cb: (list: Candidate[]) => void): () => void;
  /** "" cancels. */
  chooseSerial(id: string): void;
  firewall(): Promise<FirewallInfo>;
  serialAccess(): Promise<SerialAccess>;
  runFix(fix: "firewall" | "serial"): Promise<FixResult>;
  portHolders(port: number): Promise<string[]>;
  /** Save the bound port after the panel was re-pointed. */
  adoptPort(): Promise<void>;
  setAutostart(on: boolean): Promise<boolean>;
}

declare global {
  interface Window {
    calico: CalicoApi;
  }
}
