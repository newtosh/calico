import { useCallback, useEffect, useRef, useState } from "react";

/** "Copy for Grok Bot" with a message that fades after a few seconds. The token stays in main. */
export function useCopy(): [string, () => void, () => void] {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    setMessage("");
  }, []);
  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback(() => {
    void window.calico.relayCopyForBot().then((ok) => {
      window.clearTimeout(timer.current);
      setMessage(ok ? "Copied." : "Nothing to copy.");
      timer.current = window.setTimeout(() => setMessage(""), 4000);
    });
  }, []);

  return [message, copy, reset];
}
