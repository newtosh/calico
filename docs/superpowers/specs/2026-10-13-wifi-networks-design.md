# Wi-Fi networks, pairing and address updates, design

Status: draft for review. Date: 2026-10-13.

> **Superseded in part (2026-10-13).** Hardware testing showed that Electron's `setBluetoothPairingHandler` is never called on Linux with BlueZ, because BlueZ pairs through the desktop's own agent. Pairing is now numeric comparison done at the OS level: the panel shows a 6-digit code with Yes and No buttons on its glass, the computer's system dialog shows the same code, and the app only guides, verifies and recovers. Wherever this document describes a typed passkey or an in-app PIN prompt, read it as that. The Phase 1 pull request carries the final design and the hardware results.

## Goal

Manage the panel's Wi-Fi networks from the app in one place, keep their passwords safe on the computer, push them to the panel, and fix the panel's companion address with one click when this computer's address changes. Secrets only cross Bluetooth once the link is paired and encrypted.

## What was asked, and what is assumed

Asked: a Connectivity area that can scan for SSIDs, save a network's password and custom config securely, manage them in one place, update the panel from them, and use an address-range change as a trigger to refresh the panel. Bluetooth is the channel. The address update is one click, not hands-free. The link gets real pairing first.

Assumed, and open to correction: Linux only for now; the panel's own scan is the scan source; the app, not the panel, is the source of truth for the list.

## What is already true (read from the repo)

- The panel stores up to 8 networks. Each has an SSID (32 bytes), a password (64), and an optional companion URL and token (127 each). An empty per-network URL falls back to the global one. `firmware/main/wifi_store.h`.
- The USB and Bluetooth commands today are `status`, `scan`, `verify`, `wifi` (add or update one network), `url`, `token` and `reboot`. There is no command to list or remove a saved network. `src/renderer/src/device/commands.ts`.
- Bluetooth is an open GATT with no pairing: "Proximity is the gate until the glass can show a PIN." `firmware/main/ble_link.c`. Nothing on it is encrypted.
- The LAN push (`PUT /api/panel`) refuses Wi-Fi credentials outright, so passwords never ride the status poll. `mergePanel` in `src/server/config.ts`. This stays.
- The app uses Web Bluetooth. Electron's main process answers the device picker (`src/main/devices.ts`). A Web Bluetooth connection can only start from a user gesture.
- ESP32 radios are 2.4 GHz only, so the panel's scan is the right source.

## Phases

Each phase is its own pull request, built on the one before.

### Phase 1: Bluetooth pairing

Firmware:

- NimBLE security on, LE Secure Connections, man-in-the-middle protection required, bonding on. The panel displays a random 6-digit passkey on its glass while a new computer pairs (display only; the computer enters it).
- Every write characteristic and `scan`/`verify` require an authenticated, encrypted link. The `status` characteristic stays readable without pairing and gains a capability field (`pair: 1`), so the app can tell a pairing panel from an older one.
- Up to three bonded computers. A Control Center action forgets them all.

App:

- `session.setBluetoothPairingHandler` shows an in-app prompt, "Enter the 6-digit code shown on the panel", and answers the pairing request with it. A wrong PIN offers a retry. A timeout says so.
- A panel without `pair` is told "this panel does not pair yet, flash the update", and the app sends it no secret.

Spikes before building: (a) the pairing handler works on Linux with this Electron; (b) NimBLE security fits in the panel's internal RAM beside Wi-Fi, which the firmware already budgets tightly (`DESK_DMA_KEPT_FOR_STA`).

### Phase 2: the Networks vault

Storage: `networks.json` in the profile, mode 0600. Each entry holds `ssid`, `url`, `token` in the clear and `password` encrypted with `safeStorage.encryptString`. If `safeStorage.getSelectedStorageBackend()` is the plaintext fallback, the app refuses to save a password and says why. The renderer never receives a password or token, only `password_set` and `token_set`, as for the other tokens.

Panel commands (USB and Bluetooth), new characteristics for each:

- `nets` returns the saved SSIDs, each with `has_url` and `has_token`. Never a password or token.
- `forget` removes one SSID.
- `wifi` gains optional `url` and `token`, written to that network's slot.

UI, in Connectivity: a Networks list (SSID, "default URL" or the custom one, "password set"), Add, Scan through the panel, Edit, Remove. Hidden networks are added by typing the SSID. All fields use the panel's own limits, checked by the existing validators in `commands.ts`.

### Phase 3: sync and the address banner

Push to panel:

- Connects over the paired link (or USB), reads `nets`, and shows a plan: add, update, and remove (networks on the panel that are not in the vault). Nothing is removed until the person confirms the plan.
- Applies it with `wifi` and `forget`, then reboots only if something changed.
- The panel's passwords cannot be read back, so the vault cannot import them. The app knows only the SSIDs on the panel.

Address change:

- The main process compares this computer's LAN addresses with the set seen when the panel last polled. If the panel has been silent for 60 seconds and the addresses differ, the app shows a banner: "The panel's address may have changed", with **Update over Bluetooth**.
- One click (the gesture Web Bluetooth needs) connects, asks for the pairing PIN the first time only, writes the new URL, reboots the panel, and waits for its first poll. No password or token is sent, though the link is paired anyway.
- With two addresses on one subnet (wired and Wi-Fi), the one on the panel's subnet is used, judged from the address the panel polled from. With no history, the first LAN address.
- A network's own saved URL wins for that network.

## Security

- Passwords exist only in the keyring-backed vault and, briefly, in memory while being sent.
- Bluetooth carries secrets only once paired and encrypted. Older firmware is refused secrets, not trusted.
- The status poll never carries Wi-Fi credentials, as today.
- A forged or old panel cannot make the app write anything: writes only start from a user click.

## Testing

Host C tests for the pure parts: passkey generation and formatting, the bond limit, the network list and forget logic. Vitest for the vault (encryption refused on the plaintext backend, limits, the renderer never seeing a password), the command validators, the sync plan, and the address-change rule. Component tests for the pairing prompt, the Networks list, the plan dialog and the banner. Fakes for the Bluetooth flows. A check on the real board in each phase: pairing with a wrong and a right PIN, a list round trip, and a changed address.

## Risks

- Linux Web Bluetooth pairing may not give the app a usable PIN hook. If the spike fails, the fallback is the OS pairing agent (BlueZ shows its own prompt), which the app cannot style.
- Panels already flashed keep the open link until reflashed. The app handles them, but cannot protect them.
- NimBLE security adds RAM use. If it does not fit, Wi-Fi buffer sizes or another feature must give way, and this is the spec's largest unknown.
- `safeStorage` on Linux depends on a keyring (libsecret or kwallet) being present.

## Out of scope

Finding the computer by name (mDNS), hands-free Bluetooth in the background, importing passwords from the panel, and macOS and Windows keyring behavior beyond what `safeStorage` already provides.
