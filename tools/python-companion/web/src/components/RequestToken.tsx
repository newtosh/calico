import { useState } from "react";
import { rememberToken } from "../api";

export function RequestToken() {
  const [token, setToken] = useState("");

  return (
    <label className="desk-label">
      Browser token
      <input
        type="password"
        className="desk-field"
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
