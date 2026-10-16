/** Where firmware releases are published. */
export const FIRMWARE_REPO = "newtosh/calico";
/** The update steps, until Calico flashes the panel itself. */
export const FIRMWARE_HELP_URL = `https://github.com/${FIRMWARE_REPO}/blob/main/firmware/README.md#releasing`;
/** The first versioned panel firmware. A panel below it is out of date whatever is released. */
export const MIN_FIRMWARE = "0.2.0";
export const FIRMWARE_TAG =
  /^fw-v(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
/** The first check waits so startup never does. */
export const CHECK_DELAY_MS = 10_000;
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
