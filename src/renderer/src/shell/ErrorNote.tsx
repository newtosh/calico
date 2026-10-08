import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

// Red text fails 4.5:1 on the panel's dark tokens, so the red goes on the icon
// and the words stay cream.
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-cream">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-red" />
      <span>{children}</span>
    </span>
  );
}
