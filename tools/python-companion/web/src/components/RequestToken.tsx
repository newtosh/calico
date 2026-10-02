import { useState } from "react";
import { rememberToken } from "../api";

export function RequestToken() {
  const [token, setToken] = useState("");

  return (
    <label className="block text-sm text-muted">
      Browser token
      <input
        type="password"
        className="mt-1 w-full rounded bg-ink px-3 py-2 text-paper"
        value={token}
        placeholder="Sent with inject, dismiss, and save when the companion has a token"
        onChange={(event) => {
          setToken(event.target.value);
          rememberToken(event.target.value);
        }}
      />
    </label>
  );
}
