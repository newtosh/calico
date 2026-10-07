# Bugbot rules for calico

Flag any change that breaks these.

1. **Frozen panel contract.** `src/server/http.ts` and `src/server/store.ts` must keep the paths, methods, auth checks, JSON shapes, and key order of `/api/status`, `/api/dismiss`, `/api/unread/dismiss`, `/api/frame`, `/api/frame/request`. `panel` stays the first key of the status body and `capture` stays before `agents`. JSON responses must escape non-ASCII as `\uXXXX`.
2. **Server boundary.** Nothing under `src/server/` imports `electron` or code from `src/main`, `src/preload`, or `src/renderer`.
3. **Secrets.** Wi-Fi passwords, bearer tokens, and the Cursor API key are never logged, never sent to the Console pane, and never written anywhere except `config.json` (tokens and keys only, never Wi-Fi passwords).
4. **Electron security.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. No `webSecurity: false`, no remote URLs loaded in the window, no widening of the CSP in `src/renderer/index.html`.
5. **Privileged commands.** Only through `pkexec`, only after a user click, and the command is built in main from validated integers and fixed strings. Never from renderer-supplied text.
6. **Device protocol.** BLE UUIDs and limits in `src/renderer/src/device/commands.ts` and `ble.ts` must match `test/parity/ble_desk.h`. USB messages must match `docs/usb-console-protocol.md`.
7. **Design.** Renderer changes follow `DESIGN.md`: panel palette tokens only, no inline `style`, no card grids or gradients.

Do not flag: formatting (prettier owns it), import order, or naming that matches the Python companion it was ported from.
