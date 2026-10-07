import type { DeskStatus } from "../lib/api";

export function NeedsYouStrip({
  status,
  onDismiss,
}: {
  status: DeskStatus;
  onDismiss: () => void;
}) {
  if (!status.needs_you) return null;
  const text =
    status.last_event?.message ||
    status.last_event?.title ||
    "An agent is waiting on you.";
  return (
    <div
      role="status"
      className="flex items-center gap-4 border-b border-amber/60 bg-surface px-4 py-3"
    >
      <span className="text-xs font-medium text-amber uppercase">
        Needs you
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <button type="button" className="btn" onClick={onDismiss}>
        Dismiss all
      </button>
    </div>
  );
}
