import { useEffect, useRef } from "react";

export function ConsoleView({
  lines,
  usbConnected,
  onClear,
}: {
  lines: string[];
  usbConnected: boolean;
  onClear: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-stroke/40 px-4 py-2">
        <span className="text-muted">
          {usbConnected
            ? "Serial output from the desk"
            : "Connect over USB in Device to see serial output."}
        </span>
        <button type="button" className="btn ml-auto" onClick={onClear}>
          Clear
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-xs leading-5 whitespace-pre-wrap">
        {lines.join("\n")}
        <div ref={end} />
      </pre>
    </div>
  );
}
