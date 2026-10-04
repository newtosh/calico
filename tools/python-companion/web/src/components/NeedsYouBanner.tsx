import type { DeskStatus } from "../api";

interface NeedsYouBannerProps {
  status: DeskStatus | null;
  onDismiss: () => void;
}

export function NeedsYouBanner({ status, onDismiss }: NeedsYouBannerProps) {
  if (!status?.needs_you) {
    return null;
  }
  const message =
    status.last_event?.message ||
    status.last_event?.title ||
    "An agent is blocked.";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-alert px-4 py-4 text-ink">
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-[0.08em]">NEEDS YOU</p>
        <p className="mt-1 text-lg">{message}</p>
      </div>
      <button
        type="button"
        className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
