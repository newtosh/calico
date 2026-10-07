import { Copy } from "lucide-react";
import { useState } from "react";

export function UrlChip({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn inline-flex items-center gap-2 font-mono text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={`Copy ${url}`}
    >
      <span>{url}</span>
      <span className="text-muted">
        {copied ? "Copied" : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}
