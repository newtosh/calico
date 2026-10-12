import { Check } from "lucide-react";
import { STAGES } from "../lib/relay-setup";

/** Four nodes: done is a filled check, current an amber ring, later a plain ring, failed red with "!". */
export function Stepper({ at, failed }: { at: number; failed: boolean }) {
  return (
    <ol aria-label="Setup progress" className="mb-4 flex">
      {STAGES.map((label, i) => {
        const n = i + 1;
        const done = n < at || (n === at && at === 4 && !failed);
        const now = n === at && !done && !failed;
        const bad = n === at && failed;
        const line = n <= at ? "bg-sage" : "bg-stroke";
        const ring = bad
          ? "border-red text-cream"
          : done
            ? "border-sage bg-selected text-sage"
            : now
              ? "border-amber text-amber"
              : "border-stroke";
        return (
          <li
            key={label}
            aria-current={now || bad ? "step" : undefined}
            className="relative flex flex-1 flex-col items-center gap-1 text-xs text-muted"
          >
            {i > 0 ? (
              <span
                aria-hidden
                className={`absolute top-[0.73rem] right-1/2 h-0.5 w-full ${line}`}
              />
            ) : null}
            <span
              aria-hidden
              className={`relative z-10 grid size-[1.465rem] place-items-center rounded-full border-2 bg-surface font-semibold ${ring}`}
            >
              {done ? <Check className="size-3.5" /> : bad ? "!" : n}
            </span>
            <span className={now || bad ? "text-cream" : undefined}>
              {label}
              <span className="sr-only">
                {done
                  ? " (done)"
                  : bad
                    ? " (failed)"
                    : now
                      ? " (current step)"
                      : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
