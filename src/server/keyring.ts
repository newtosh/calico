/** What a vault needs from Electron's safeStorage. Tests pass a fake. */
export interface SecretBox {
  /** safeStorage.getSelectedStorageBackend() on Linux. */
  backend(): string;
  available(): boolean;
  encrypt(text: string): Buffer;
  /** safeStorage.decryptString. Throws when the keyring is locked or did not seal it. */
  decrypt(sealed: Buffer): string;
}

export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Wi-Fi vault copy. Callers that seal something else pass their own sentences. */
export const NO_KEYRING =
  "Calico could not reach a system keyring, so it did not save the password. Unlock GNOME Keyring or KWallet, then try again.";
export const PLAINTEXT_KEYRING =
  "This desktop gives Calico no keyring, so the password would be stored as plain text. Calico did not save it. Install GNOME Keyring or KWallet, then try again.";

/** null when the box can seal a secret. */
export function keyringRefusal(
  box: SecretBox,
  none = NO_KEYRING,
  plaintext = PLAINTEXT_KEYRING,
): string | null {
  const backend = box.backend();
  if (backend === "basic_text") return plaintext;
  if (backend === "unknown" || !box.available()) return none;
  return null;
}
