# Review rules for calico

Any reviewer, human or bot, flags a change that breaks these.

1. **Frozen panel contract.** `src/server/http.ts` and `src/server/store.ts` must keep the paths, methods, auth checks, JSON shapes, and key order of `/api/status`, `/api/dismiss`, `/api/unread/dismiss`, `/api/frame`, `/api/frame/request`. `panel` stays the first key of the status body and `capture` stays before `agents`. JSON responses must escape non-ASCII as `\uXXXX`.
2. **Server boundary.** Nothing under `src/server/` imports `electron` or code from `src/main`, `src/preload`, or `src/renderer`.
3. **Secrets.** Wi-Fi passwords, bearer tokens, and the Cursor API key are never logged, never sent to the Console pane, and never written anywhere except `config.json` (tokens and keys only) and `networks.json` (mode 0600; Wi-Fi passwords only as `safeStorage` ciphertext, refused on the `basic_text` backend). The outbound sender key is the one key in `config.json` stored as `safeStorage` ciphertext, with the same `basic_text` refusal; it is never logged and never returned by `GET /api/config`, `/api/panel`, `/api/relay`, or `/api/notify`. The window receives a saved Wi-Fi password and per-network token only through `networks:release`: once per SSID in the push plan the person confirmed, within two minutes of confirming, straight into the Bluetooth write, then blanked. This is a deliberate, owner-approved exception to "the window never sees a password". It never goes into React state, the DOM, logs, errors or any IPC event. The vault list and every other IPC carry only `password_set` and `token_set`. The panel's `nets` never carries a password, token, or URL.
4. **Electron security.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. No `webSecurity: false`, no remote URLs loaded in the window, no widening of the CSP in `src/renderer/index.html`.
5. **Privileged commands.** Only through `pkexec`, only after a user click, and the command is built in main from validated integers and fixed strings. Never from renderer-supplied text.
6. **Device protocol.** BLE UUIDs and limits in `src/renderer/src/device/commands.ts` and `ble.ts` must match `test/parity/ble_desk.h`. USB messages must match `docs/usb-console-protocol.md`.
7. **Design.** Renderer changes follow `DESIGN.md`: panel palette tokens only, no inline `style`, no card grids or gradients.

Do not flag: formatting (prettier owns it), import order, or naming that matches the Python companion it was ported from.
