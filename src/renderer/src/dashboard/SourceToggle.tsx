import type { SourceFilter } from "../lib/sources";

const OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "combined", label: "Combined" },
  { value: "grok", label: "Grok Bot" },
  { value: "cursor", label: "Cursor" },
];

export function SourceToggle({
  value,
  counts,
  onChange,
}: {
  value: SourceFilter;
  counts: Record<SourceFilter, number>;
  onChange: (next: SourceFilter) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show agents from"
      className="flex gap-2 px-4 pt-3"
    >
      {OPTIONS.map(({ value: option, label }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={`btn ${value === option ? "btn-primary" : ""}`}
          onClick={() => onChange(option)}
        >
          <span>
            {label} {counts[option]}
          </span>
        </button>
      ))}
    </div>
  );
}
