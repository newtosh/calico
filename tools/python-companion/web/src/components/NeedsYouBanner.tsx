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
    <div className="rounded-lg bg-alert px-5 py-4 text-ink">
      <p className="text-sm font-semibold tracking-[0.18em]">NEEDS YOU</p>
      <p className="mt-1 text-lg">{message}</p>
      <button
        type="button"
        className="mt-3 text-sm underline"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
