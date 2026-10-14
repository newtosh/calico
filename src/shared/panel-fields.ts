// The panel's field limits (firmware/main/ble_desk.h, wifi_store.h), in bytes.
// Main checks the vault with these and the renderer checks every command with them.
export const SSID_MAX = 32;
export const PASS_MAX = 64;
export const URL_MAX = 127;
export const TOKEN_MAX = 127;
export const NETWORKS_MAX = 8;
/** The longest wifi write the panel takes: ssid\npass\nurl\ntoken\n at full size (BLE_DESK_WIFI_CFG_MAX). */
export const WIFI_WRITE_MAX =
  SSID_MAX + 1 + PASS_MAX + 1 + URL_MAX + 1 + TOKEN_MAX + 1;

/** A field the panel would refuse. The message names the field, never its value. */
export class FieldError extends Error {}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function noBreaks(value: string, label: string): void {
  if (/[\r\n\0]/.test(value))
    throw new FieldError(`${label} cannot contain a newline or NUL.`);
}

export function checkSsid(ssid: string): void {
  noBreaks(ssid, "SSID");
  if (!ssid) throw new FieldError("SSID is required.");
  if (bytes(ssid) > SSID_MAX)
    throw new FieldError(`SSID must be at most ${SSID_MAX} bytes.`);
}

export function checkPass(pass: string): void {
  noBreaks(pass, "Password");
  const n = bytes(pass);
  if (n > PASS_MAX)
    throw new FieldError(`Password must be at most ${PASS_MAX} bytes.`);
  if (n > 0 && n < 8)
    throw new FieldError(
      "Password must be empty (open network) or 8 to 64 bytes.",
    );
}

export function checkUrl(url: string): void {
  noBreaks(url, "URL");
  const ok =
    (url.startsWith("http://") && url.length > 7) ||
    (url.startsWith("https://") && url.length > 8);
  if (!ok)
    throw new FieldError(
      "URL must start with http:// or https:// and name a host.",
    );
  if (bytes(url) > URL_MAX)
    throw new FieldError(`URL must be at most ${URL_MAX} bytes.`);
}

export function checkToken(token: string): void {
  noBreaks(token, "Token");
  if (bytes(token) > TOKEN_MAX)
    throw new FieldError(`Token must be at most ${TOKEN_MAX} bytes.`);
}
