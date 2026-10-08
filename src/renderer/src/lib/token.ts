/** 32 random bytes as 64 hex characters, within the panel's 127-byte token limit. */
export function newWebhookToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
