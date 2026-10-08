import type { SourceFilter } from "../lib/sources";

export function EmptyAgents({
  filter,
  webhookUrl,
  onSetup,
}: {
  filter: SourceFilter;
  webhookUrl: string | null;
  onSetup: () => void;
}) {
  const where = webhookUrl ? (
    <code className="font-mono text-xs">{webhookUrl}</code>
  ) : (
    "calico's webhook"
  );
  return (
    <div className="px-4 py-3">
      <p className="max-w-2xl text-muted">
        {filter === "cursor" ? (
          "No Cursor agents yet. Add a Cursor API key in Settings and calico lists your Cursor agents."
        ) : filter === "grok" ? (
          <>
            No Grok Bot agents yet. They appear when desky and other routines
            post to {where}.
          </>
        ) : (
          <>
            No agents yet. Grok Bot routines appear when they post to {where},
            and Cursor agents appear once a Cursor API key is set.
          </>
        )}
      </p>
      <button type="button" className="btn mt-2" onClick={onSetup}>
        Set up agent updates
      </button>
    </div>
  );
}
