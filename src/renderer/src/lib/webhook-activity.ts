import type { RefusalReason, WebhookActivity } from "../../../shared/ipc";
import { ago } from "./time";

const REASON: Record<RefusalReason, string> = {
  unauthorized: "wrong or missing token",
  forbidden_origin: "sent by a web page",
  bad_json: "not valid JSON",
  bad_event: "not a valid event",
  too_large: "too large",
};

/** The two lines Settings shows under Agent updates. `refused` is empty when none were. */
export function activityLines(
  activity: WebhookActivity,
  now = Date.now(),
): { received: string; refused: string } {
  const when = (at: number) => ago(new Date(at).toISOString(), now);
  const { accepted, refused } = activity;
  const received = accepted
    ? `Last update received ${when(accepted.at)}, from ${accepted.from}.`
    : "No updates received since calico started.";
  if (refused.count === 0 || !refused.last) return { received, refused: "" };
  const { last } = refused;
  const noun = refused.count === 1 ? "request" : "requests";
  return {
    received,
    refused: `${refused.count} ${noun} refused since calico started. Last: ${REASON[last.reason]}, ${when(last.at)}, from ${last.from}.`,
  };
}
