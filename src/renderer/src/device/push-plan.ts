import type { PushRelease, SavedNetwork } from "../../../shared/ipc";
import { NETWORKS_MAX } from "../../../shared/panel-fields";
import type { Cmd, DeviceLink, PanelNet, Reply } from "./commands";

/** What a push would change on the panel. The networks saved on this computer are the truth. */
export interface PushPlan {
  /** Saved here, not on the panel. */
  add: SavedNetwork[];
  /** On both. The panel never sends a password back, so these are always sent again. */
  update: SavedNetwork[];
  /** On the panel, not saved here. */
  remove: string[];
  /** The network the panel is on now, or "". */
  current: string;
}

export type PushStep =
  { op: "wifi"; net: SavedNetwork } | { op: "forget"; ssid: string };

export interface PushResult {
  done: number;
  total: number;
  error: string;
}

const message = (e: unknown): string =>
  e instanceof Error ? e.message : "The push stopped unexpectedly.";

export function buildPlan(
  vault: SavedNetwork[],
  panel: PanelNet[],
  current: string,
): PushPlan {
  const onPanel = new Set(panel.map((n) => n.ssid));
  const saved = new Set(vault.map((n) => n.ssid));
  return {
    add: vault.filter((n) => !onPanel.has(n.ssid)),
    update: vault.filter((n) => onPanel.has(n.ssid)),
    remove: panel.map((n) => n.ssid).filter((ssid) => !saved.has(ssid)),
    current,
  };
}

export const planSize = (plan: PushPlan): number =>
  plan.add.length + plan.update.length + plan.remove.length;

/**
 * The writes in a safe order: updates (no slot moves), removals (make room), additions. The
 * network the panel is on now is removed only when the person said so. Refuses a plan that would
 * leave the panel more than NETWORKS_MAX networks.
 */
export function planSteps(
  plan: PushPlan,
  removeCurrent: boolean,
): { steps: PushStep[]; error: string } {
  const remove = plan.remove.filter(
    (ssid) => removeCurrent || ssid !== plan.current,
  );
  const after =
    plan.update.length + (plan.remove.length - remove.length) + plan.add.length;
  if (after > NETWORKS_MAX)
    return {
      steps: [],
      error: `The panel would need ${after} networks and holds ${NETWORKS_MAX}. Remove one in Settings, or let the push remove ${plan.current}.`,
    };
  return {
    steps: [
      ...plan.update.map((net): PushStep => ({ op: "wifi", net })),
      ...remove.map((ssid): PushStep => ({ op: "forget", ssid })),
      ...plan.add.map((net): PushStep => ({ op: "wifi", net })),
    ],
    error: "",
  };
}

/**
 * Applies the steps in order and stops at the first failure. Each password comes from main once
 * and goes straight into the write. Every write is idempotent, so pushing again after a stop
 * finishes the job.
 */
export async function runPush(
  link: DeviceLink,
  steps: PushStep[],
  release: (ssid: string) => Promise<PushRelease>,
  onStep: (index: number, step: PushStep) => void,
): Promise<PushResult> {
  const total = steps.length;
  for (const [i, step] of steps.entries()) {
    onStep(i, step);
    let reply: Reply;
    if (step.op === "forget") {
      try {
        reply = await link.send({ op: "forget", ssid: step.ssid });
      } catch (e) {
        return { done: i, total, error: message(e) };
      }
    } else {
      let secret: PushRelease;
      try {
        secret = await release(step.net.ssid);
      } catch (e) {
        return { done: i, total, error: message(e) };
      }
      if (!secret.ok) return { done: i, total, error: secret.error };
      const cmd: Extract<Cmd, { op: "wifi" }> = {
        op: "wifi",
        ssid: step.net.ssid,
        pass: secret.password,
        url: step.net.url,
        token: secret.token,
      };
      // ponytail: JS strings cannot be wiped. Blanking the only references lets the collector
      // take them; a native buffer would need the password to stay out of JS, which Web
      // Bluetooth cannot do.
      secret.password = "";
      secret.token = "";
      try {
        reply = await link.send(cmd);
      } catch (e) {
        return { done: i, total, error: message(e) };
      } finally {
        cmd.pass = "";
        cmd.token = "";
      }
    }
    if (!reply.ok) return { done: i, total, error: reply.error };
  }
  return { done: total, total, error: "" };
}
