# Calico core: design

**Date:** 2026-10-07
**Status:** Approved in brainstorm, pending written-spec review
**Sub-project:** 1 of 4 (core app)

## Purpose

Calico is a desktop companion and developer kit for [grokbot-buddy](https://github.com/newtosh/grokbot-buddy), a desk panel on the Waveshare ESP32-S3-Touch-AMOLED-2.16 that shows coding-agent status. Calico replaces the grokbot-buddy Python companion process, its React dashboard, and its provisioning scripts with one installable app.

**Audience:** the author's desk first. Built so other owners of the board can install it without Python or ESP-IDF.

**Build in public:** the repo is public from the first push. That push already carries README, CONTRIBUTING, repo protections, and CI.

**Differentiator:** at least six projects already put agent status on an ESP32 display (AgentMeter on this same board, agentface32, pixel-agents-esp32, claude-status-display, esp32-ai-monitor, cursor_agent_status_light). None ship a developer kit or emulator. Calico's long-term value is sub-projects 2 and 3. Sub-project 1 is the base they stand on.

## Decomposition

Each sub-project gets its own spec, plan, and implementation cycle.

| #   | Sub-project                                                                                                                                                                  | Depends on                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | **Core app** (this spec): companion server, dashboard, device provisioning over USB and BLE, Linux packaging, public-repo scaffolding                                        | grokbot-buddy USB serial console (see Prerequisites)        |
| 2   | Screen simulator: the firmware's real LVGL `ui.c` compiled to WASM (lv_web_emscripten) with HAL stubs, rendered in an app pane and fed by the live store                     | grokbot-buddy publishing a WASM UI build as a release asset |
| 3   | SDK: firmware flashing with esptool-js over the v1 USB layer, first-run wizard (flash, provision, done), QEMU headless boot tests                                            | grokbot-buddy publishing tagged firmware binaries           |
| 4   | Stretch: agent adapters (Claude Code and Codex hooks), status push over BLE and USB, macOS and Windows builds and signing, board abstraction (Improv Wi-Fi for other boards) | 1 to 3                                                      |

## Repo relationship

Separate repos. Firmware stays in grokbot-buddy and publishes release assets (firmware binaries, later the WASM UI build). Calico consumes those assets. Supporting another board later means pointing calico at another firmware repo's releases.

The Python companion (`companion/`), the React dashboard (`web/`), and `scripts/ble-provision.py` move into calico. The Python companion is frozen in grokbot-buddy once calico reaches contract parity, then removed there.

## Prerequisites (outside this repo)

1. **grokbot-buddy: USB serial console.** A newline-delimited JSON command protocol on USB-Serial-JTAG that mirrors the existing GATT operations: `status`, `scan`, `verify`, `wifi`, `url`, `token`, `reboot`. Non-JSON lines remain normal ESP log output. This gets its own small spec in grokbot-buddy. Calico's USB features depend on it. BLE and Wi-Fi features do not.

Why not port `provision-wifi.py`: it reads the raw NVS partition with esptool, edits it, regenerates it with ESP-IDF's `nvs_partition_gen.py`, and writes it back. A TypeScript port would need a full NVS writer, could corrupt NVS on a bug, cannot run the Wi-Fi `verify` join test, and resets the board on every write. The serial console avoids all four and later carries status push.

## v1 scope

In:

1. Companion server with parity to the Python companion: webhook, status, dismiss, unread, panel push, config, frame capture, Cursor poll.
2. Dashboard: the existing React UI, restyled per the UI direction below.
3. Device provisioning over USB serial and BLE.
4. Tray, autostart, and a full application window.
5. Port selection, firewall assist, serial permission assist.
6. Linux packages: AppImage, deb, pacman.
7. Public-repo scaffolding, CI, release workflow, protections, AI review.

Out (named so it does not creep in): flashing and the first-run wizard (sub-project 3), the WASM simulator (sub-project 2), status push over BLE or USB, agent integrations beyond the existing webhook and Cursor poll, macOS and Windows builds.

## Architecture

```
calico/  (electron-vite, pnpm, TypeScript strict)
├─ src/server/      plain Node. Never imports electron.
│   store.ts        agents, events, unread, frame (port of store.py)
│   config.ts       load, merge, save, public views (port of config.py)
│   http.ts         node:http router, same routes, same JSON
│   cursor-poll.ts  optional CURSOR_API_KEY poller
│   port.ts         pick and persist the listen port
│   link.ts         status hand-off seam (HTTP poll is the only link in v1)
├─ src/main/        Electron main process
│   index.ts        single-instance lock, start server, window, tray
│   tray.ts         Open, copy LAN URL, Quit
│   autostart.ts    app.setLoginItemSettings, XDG autostart .desktop on Linux
│   devices.ts      select-bluetooth-device and select-serial-port handlers, picker IPC
│   assist.ts       firewall and serial-permission detection, pkexec runner
├─ src/preload/     contextBridge: small typed API
├─ src/renderer/    React 18 + Tailwind + Base UI primitives
│   dashboard/      ported from grokbot-buddy/web
│   device/         DeviceLink, USB and BLE implementations, provisioning flow
│   console/        serial log pane
│   settings/
└─ test/
    contract/       golden JSON captured from the Python companion
```

### Process and lifecycle

- One process tree. Main starts the server, then opens the window. The renderer talks to the server over plain HTTP, the same way the panel and agent webhooks do.
- `src/server/` must not import `electron`, so a headless `calico serve` stays possible later. A lint rule enforces this.
- The window is a full application with sidebar navigation: Dashboard, Device, Console, Settings. Closing the window hides it to the tray. Tray Quit stops the server and exits. A second launch focuses the existing window.
- Autostart at login is on by default and can be turned off in Settings. The panel is only fed while the user is logged in. That is accepted for v1.

### Persistence

- `app.getPath('userData')/config.json`: settings and secrets, file mode 600.
- `app.getPath('userData')/state.json`: store snapshot, written atomically (temp file, then rename).
- The Python companion's optional SQLite store is dropped. The store holds at most 24 agents plus recent events, so JSON is enough and avoids a native module. A `ponytail:` comment marks the upgrade path if history ever needs querying.

### Frozen contract

`GET /api/status` and every route the firmware calls (`/api/status`, `/api/dismiss`, `/api/unread/dismiss`, `/api/frame`, `/api/frame/request`) keep their exact paths, methods, auth rules, and JSON shapes. Boards in the field depend on them. The contract tests below enforce this.

### Listen port

- First run tries 8787, then counts up to 8799, and persists the first free port.
- Later launches reuse the persisted port. If it is busy, calico binds the next free port and shows a banner and tray badge: the panel points at the old port, calico is on the new one. The banner offers two fixes: show the process holding the old port (from `ss -ltnp`), or re-point the panel with the `url` command over whichever device link is live.
- The current LAN URL with a copy button is always visible in the window header and the tray menu.

### Firewall assist (Linux in v1)

- Signal: the server records `lastPanelPoll`, the time of the last `/api/status` request from a non-loopback address. A self-probe against the host's own LAN IP proves nothing, because that traffic goes through `lo`, which ufw allows.
- Trigger: after provisioning, the device reports a Wi-Fi join but no panel poll arrives within 30 seconds.
- Detection: `systemctl is-active ufw firewalld`, then nftables or iptables drop policy. No root needed.
- Fix: show the exact command (`ufw allow <port>/tcp comment calico`, or `firewall-cmd --permanent --add-port=<port>/tcp && firewall-cmd --reload`) with Copy and Run. Run goes through `pkexec`, so the system auth prompt appears. Never automatic. An unknown firewall gets copyable instructions only.

### Serial permission assist (Linux in v1)

- On EACCES opening `/dev/ttyACM*`, detect the distro's group (`uucp` on Arch, `dialout` on Debian and Ubuntu) and show `sudo usermod -aG <group> $USER` with Copy and Run (pkexec), plus a note that the change needs a logout. A udev rule is offered as the alternative.

### Security baseline

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no remote content in the window.
- The server binds `0.0.0.0` as today. LAN posture and bearer-token rules are unchanged from grokbot-buddy and documented in the README.
- Wi-Fi passwords and tokens go from the renderer to a device link only. Never logged, never echoed to the Console pane. Calico stores the bearer token in `config.json`, as the Python companion did. It never stores Wi-Fi passwords.
- Privileged commands only run through pkexec after an explicit click.

## Device links

One command model, two transports.

```ts
type Cmd =
  | { op: "status" }
  | { op: "scan" }
  | { op: "verify"; ssid: string; pass: string } // join test, no NVS write
  | { op: "wifi"; ssid: string; pass: string } // write after verify succeeds
  | { op: "url"; value: string }
  | { op: "token"; value: string }
  | { op: "reboot" };

interface DeviceLink {
  kind: "usb" | "ble";
  send(cmd: Cmd): Promise<Reply>;
  close(): void;
}
```

- **BLE:** Web Bluetooth in the renderer. Main handles `select-bluetooth-device` and forwards candidates to an in-app picker. Each op maps to an existing GATT characteristic. UUIDs and length limits are copied from `firmware/main/ble_desk.h`. No firmware change.
- **USB:** Web Serial in the renderer. Main handles `select-serial-port`. NDJSON at 115200: requests `{"id":n,"op":...}`, replies `{"id":n,"ok":true,...}`. Lines that are not JSON go to the Console pane, which makes it a serial monitor. Sub-project 3 reuses this picker and permission handling for flashing.
- **Wi-Fi:** not a `DeviceLink`. The panel polls calico. "Online" comes from `lastPanelPoll`.
- The Device view shows which links are live for the panel and offers each action on any link that supports it.

## Flows

1. **Provision:** pick a link (USB if plugged in, otherwise a BLE scan) → `status` → `scan` → choose an SSID → `verify` → `wifi` → `url` (prefilled with calico's LAN URL and port) → `token` → `reboot` → wait for `lastPanelPoll` → "Panel online". No poll within 30 seconds starts the firewall assist.
2. **Port drift:** banner → "Re-point panel" → `url` over the live link.
3. **Agent status:** webhook or Cursor poll → store → `GET /api/status` → panel. The dashboard reads the same endpoint.

## Error handling

- Device commands time out after 10 seconds (`scan` and `verify` after 30) and surface the firmware's error text. A dropped link moves the Device view to disconnected and offers to reconnect.
- `verify` failure never writes NVS, matching the BLE behavior today.
- Server bind failure on every port 8787 to 8799 shows a blocking error with the conflicting processes. The app stays usable for provisioning.
- Corrupt `state.json` is moved aside to `state.json.bad` and the store starts empty. Corrupt `config.json` stops startup with an error that names the file. Calico never overwrites a config it could not parse.

## UI direction

Goal: a small, fast desktop tool that does not look like a default agent-generated SPA (Inter, purple gradient, card grids, shadcn default grays, decorative motion).

- **Identity from the hardware.** The panel's palette becomes the design tokens: glass `#0c0e09`, surface `#14160f`, stroke `#6d6756`, sage `#9bb57a`, cream `#efe7d6`, amber `#e2a23a`, red `#c4544a`. App and device read as one product.
- **Tool layout.** Native window frame, sidebar, dense rows like the panel list, no card grids, no hero. Tabular numerals. Monospace only in the Console.
- **Icons:** Lucide, because the panel firmware already draws Lucide glyphs.
- **Dependencies:** React, Tailwind tokens, Base UI primitives only where accessibility is hard (dialog, menu, select, tooltip). No router, since four views are a state switch. No state library. No shadcn default theme.
- **Motion:** state changes only, 150 to 200 ms, `prefers-reduced-motion` respected.
- **Process:** `DESIGN.md` in the repo holds the brief, tokens, and do and don't lists, and serves as project context for the Impeccable skill (product mode). Renderer PRs run Impeccable `/audit` and the ui-skills `baseline-ui` and `fixing-accessibility` passes. The Vercel Web Interface Guidelines become the UI section of the PR template.

## Testing

- **Contract:** golden JSON captured from the Python companion's tests for status, webhook, dismiss, unread, panel, config, and frame routes. The TypeScript server must match exactly. This is the gate for retiring the Python companion.
- **Unit:** store, config merge and validation, port selection, firewall and permission detection with exec stubbed.
- **Device links:** `DeviceLink` against a fake transport. NDJSON framing: partial lines, interleaved log output, timeouts.
- **Firmware parity:** CI fetches `ble_desk.h` at the pinned grokbot-buddy tag and asserts UUIDs and limits match.
- **Smoke:** Playwright `_electron` under xvfb. The app launches, the server answers on its port, the window renders the Dashboard.

## CI and releases

- `ci.yml` on pull requests and pushes to `main`: install, eslint, prettier check, typecheck, vitest, build, Electron smoke.
- `release.yml` on `v*` tags: electron-builder produces AppImage, deb, and pacman packages, then `SHA256SUMS`, a build-provenance attestation, and a draft GitHub release with generated notes. The author publishes the draft by hand.
- Hardening: third-party actions pinned by commit SHA, default `permissions: contents: read`, no `pull_request_target`, first-time fork contributors need approval before workflows run.
- Versioning: semver tags pushed by hand. Release automation waits until release frequency needs it.
- "Signed" in v1 means checksums plus provenance. AppImage GPG signing and macOS and Windows code signing arrive with cross-platform support.

## Public repo and protections

Ready before or at the first push:

- `main` ruleset: pull request required with 0 approvals, required status check `ci`, linear history, no force push, no deletion, admin bypass off.
- Secret scanning with push protection, private vulnerability reporting, CodeQL default setup, Dependabot security updates, and grouped weekly Dependabot version updates.
- pre-commit: eslint, prettier, gitleaks.
- Files: `README.md` (what it is, screenshots, install, dev quickstart), `CONTRIBUTING.md` (setup, branch and PR flow, commit style, review order), `SECURITY.md`, `CODEOWNERS`, `DESIGN.md`, issue templates (bug, feature), PR template with the UI checklist, `LICENSE` (MIT, matching grokbot-buddy).

## AI review

- Deferred. Cursor Bugbot was dropped on 2026-10-07 for cost (about $1.20 per review). Claude Code Action, using the author's subscription token, is the candidate to revisit after v1.
- `docs/review-rules.md` holds the rules any reviewer, human or bot, applies: the frozen `/api/status` contract, no `electron` imports in `src/server/`, secrets never logged, Electron security flags, GATT UUID parity, and `DESIGN.md` rules for renderer changes.
- Any bot reviewer added later stays advisory, never a required check.
- Review order in CONTRIBUTING: CI green, self-review against `docs/review-rules.md`, UI audit for renderer PRs, merge.

## Tooling choices

| Need            | Choice                 | Why                                                                                   |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| Build           | electron-vite          | Main, preload, and renderer in one Vite config. The existing Vite React app drops in. |
| Packaging       | electron-builder       | AppImage and pacman targets, which Forge lacks. Later macOS and Windows signing.      |
| BLE             | Electron Web Bluetooth | Built in, cross-platform, no native module. Fallback if needed: @stoprocent/noble.    |
| USB             | Electron Web Serial    | Built in. Same layer esptool-js uses in sub-project 3.                                |
| Headless UI     | Base UI                | Active, unstyled, now shadcn's default base.                                          |
| Package manager | pnpm                   |                                                                                       |

All checked active in September and October 2026.

## Follow-up deliverables

1. Implementation plan for this spec (writing-plans).
2. A standalone write-up of the UI pattern (anti-slop brief, skill stack, token approach, audit loop), written for reuse outside calico.
3. A grokbot-buddy spec for the USB serial console.
