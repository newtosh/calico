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

/** The panel's last reported battery. `at` is epoch ms when Calico received it. */
export interface PanelBatteryInfo {
  pct: number;
  charging: boolean;
  external: boolean;
  at: number;
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
  /** The panel's last reported battery, null until it reports one. */
  panelBattery: PanelBatteryInfo | null;
  webhookToken: string;
  webhook: WebhookActivity;
  serverError: ServerErrorInfo | null;
  autostart: { enabled: boolean; available: boolean };
  /** Release version from package.json. */
  version: string;
  /** This computer's name, shown on the panel after it pairs. */
  hostname: string;
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

export type RelaySetupStep =
  "sign-in" | "upload" | "address" | "check" | "save";
export type RelayStepState = "pending" | "active" | "done" | "failed";

/** What the window may know about relay setup. It never holds a token. */
export type RelaySetupView =
  | { phase: "idle" }
  | { phase: "running"; steps: Record<RelaySetupStep, RelayStepState> }
  | { phase: "done"; url: string; revoked: boolean }
  | {
      phase: "failed";
      step: RelaySetupStep;
      message: string;
      cleanedUp: boolean;
      cancelled: boolean;
    };

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
  relaySetupView(): Promise<RelaySetupView>;
  /** Returns at once. Progress arrives through onRelaySetup. */
  relaySetupStart(): Promise<void>;
  relaySetupCancel(): Promise<void>;
  /** Closes a finished or failed setup. */
  relaySetupDismiss(): Promise<void>;
  onRelaySetup(cb: (view: RelaySetupView) => void): () => void;
  /** Puts the relay address and send token on the clipboard. The token never reaches the window. */
  relayCopyForBot(): Promise<boolean>;
}

declare global {
  interface Window {
    calico: CalicoApi;
  }
}
