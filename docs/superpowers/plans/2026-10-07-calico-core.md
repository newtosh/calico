# Calico Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship calico v1: an Electron app that replaces the grokbot-buddy Python companion, dashboard, and provisioning scripts, published as a public repo with CI, protections, and Linux packages.

**Architecture:** A plain-Node companion server (`src/server/`, no Electron imports) runs inside Electron's main process and keeps the firmware's HTTP contract byte-compatible. The React renderer talks to that server over HTTP and to the panel over Web Bluetooth and Web Serial through one `DeviceLink` command model. Main owns lifecycle (tray, autostart, single instance), device pickers, and privileged-fix helpers.

**Tech Stack:** Electron 44, electron-vite 5, Vite 7, React 18, Tailwind 4, Base UI 1.8, lucide-react, TypeScript 6.0, Vitest 5, Playwright 1.63, electron-builder 26, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-07-calico-core-design.md`

## Global Constraints

- Node `>=22.12` (Electron 44 engine floor). CI uses Node 24.
- TypeScript strict, `noUncheckedIndexedAccess`. No `any`. TypeScript stays on `~6.0.3` because typescript-eslint 8.71 supports `<6.1`.
- Vite stays on `^7` because electron-vite 5 peers on Vite `^5 || ^6 || ^7`. `@vitejs/plugin-react` stays on `^5.2.0` for the same reason.
- `src/server/` never imports `electron` or anything under `src/main`, `src/preload`, `src/renderer`. ESLint enforces it.
- Frozen firmware contract: `GET /api/status`, `POST /api/dismiss`, `POST /api/unread/dismiss`, `POST /api/frame`, `POST /api/frame/request` keep paths, methods, auth, JSON shapes, and key order. JSON bodies escape non-ASCII as `\uXXXX` (lowercase hex), like Python's `json.dumps`.
- Window: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no remote content.
- Wi-Fi passwords and tokens are never logged and never shown in the Console pane. Calico never stores Wi-Fi passwords.
- Privileged commands run only through `pkexec` after an explicit click.
- Default port 8787, fallback span 8787 to 8799 (`PORT_SPAN = 12`).
- Device command timeouts: 10 s, except `scan` and `verify` at 30 s.
- Design tokens: glass `#0c0e09`, surface `#14160f`, field `#2a2d24`, stroke `#6d6756`, sage `#9bb57a`, selected `#3d4f32`, cream `#efe7d6`, muted `#a39b88`, amber `#e2a23a`, red `#c4544a`.
- No inline `style` props. Dynamic colors go through SVG `fill` attributes.
- One React component per file. Tailwind classes only.
- Prose in docs, comments, commits, and UI copy: no em-dashes unless a sentence truly needs one (author's global style rule).
- Conventional commit subjects. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- grokbot-buddy is a private repo. Nothing in public CI may fetch from it.

## Review Focus

1. **Non-ASCII agent text.** A webhook title like `Café ✓ 🙂` must reach the panel as `é`, `✓`, `🙂`, because the firmware decodes JSON escapes and folds codepoints. Raw UTF-8 would break the panel. Test: Task 9 `escapes non-ASCII like Python`.
2. **Status key order under a full store.** The panel reads into a 16 KB buffer and drops the tail, so `panel` must be the first key and `capture` must come before `agents`. Test: Task 9 `keeps panel first and capture before agents`.
3. **BLE reboot drops the link.** Writing `reboot` resets the desk, so the GATT write often rejects. That is success, not an error. Test: Task 15 `reboot counts a dropped link as success`.
4. **Secrets echoed by the device.** If the firmware logs a line that contains the password or token calico just sent, the Console must show it redacted. Test: Task 16 `redacts secrets the device echoes`.
5. **Hand-edited or corrupt config, and a busy saved port.** A config.json that does not parse must stop startup with the file named and must never be overwritten. A saved port that is busy at launch must not be overwritten by the fallback port. Tests: Task 8 `refuses corrupt config and leaves the file`, Task 11 `does not persist a fallback over a saved port`.

## File Map

```
calico/
├─ package.json, pnpm-workspace.yaml, electron.vite.config.ts, electron-builder.yml
├─ tsconfig.node.json, tsconfig.web.json, eslint.config.mjs, vitest.config.ts, playwright.config.ts
├─ .prettierrc, .prettierignore, .gitignore, .pre-commit-config.yaml
├─ README.md, CONTRIBUTING.md, SECURITY.md, LICENSE, DESIGN.md
├─ .cursor/BUGBOT.md
├─ .github/CODEOWNERS, dependabot.yml, pull_request_template.md
├─ .github/ISSUE_TEMPLATE/bug.yml, feature.yml, config.yml
├─ .github/workflows/ci.yml, release.yml
├─ docs/usb-console-protocol.md
├─ resources/icon.png, resources/tray.png
├─ scripts/pin-actions.sh
├─ src/shared/ipc.ts                 IPC types shared by main, preload, renderer
├─ src/server/store.ts               DeskStore (port of store.py)
├─ src/server/state-file.ts          snapshot load/save, writeAtomic
├─ src/server/config.ts              CalicoConfig load/save/merge, panel push
├─ src/server/http.ts                node:http companion server
├─ src/server/cursor-poll.ts         Cursor API poller
├─ src/server/port.ts                listen with fallback, resolvePort, lanUrls
├─ src/main/index.ts                 lifecycle, window, startup
├─ src/main/tray.ts                  tray menu
├─ src/main/autostart.ts             XDG autostart entry
├─ src/main/devices.ts               BLE and serial picker handlers, permissions
├─ src/main/assist.ts                firewall, serial group, port holders (pure, exec injected)
├─ src/main/ipc.ts                   ipcMain handlers
├─ src/preload/index.ts              contextBridge API
├─ src/renderer/index.html
├─ src/renderer/src/main.tsx, App.tsx, styles.css
├─ src/renderer/src/lib/api.ts, use-info.ts, panel-online.ts
├─ src/renderer/src/shell/Sidebar.tsx, UrlChip.tsx, DriftBanner.tsx, ServerErrorPanel.tsx
├─ src/renderer/src/dashboard/Dashboard.tsx, AgentMark.tsx, AgentRows.tsx, EventRows.tsx, NeedsYouStrip.tsx, InjectBar.tsx
├─ src/renderer/src/device/commands.ts, ble.ts, usb.ts
├─ src/renderer/src/device/DeviceView.tsx, Picker.tsx, ProvisionFlow.tsx, FirewallAssist.tsx, SerialAssist.tsx, LinkActions.tsx
├─ src/renderer/src/console/ConsoleView.tsx
├─ src/renderer/src/settings/SettingsView.tsx, ConfigSection.tsx, PanelSection.tsx, AutostartSection.tsx
└─ test/
   ├─ lint-boundary.test.ts
   ├─ contract/capture.py, scenario.json, fixtures/companion.json, contract.test.ts
   ├─ server/*.test.ts, main/*.test.ts
   ├─ parity/ble_desk.h, parity/ble-uuids.test.ts
   └─ e2e/smoke.spec.ts
```

## Phases and branches

| Phase | Tasks | Branch | Ends with |
|---|---|---|---|
| A. Public skeleton | 1 to 4 | `main` (local, then first push) | Repo public with docs, CI, protections |
| B. Server | 5 to 11 | `feat/server` | PR, CI green, Bugbot reviewed, user merges |
| C. App shell | 12 to 14 | `feat/app-shell` | PR |
| D. Devices | 15 to 18 | `feat/devices` | PR |
| E. Release | 19 to 21 | `feat/release` | PR, then user tags `v0.1.0` |

From Task 5 on, `main` is protected. Every phase starts with `git switch main && git pull && git switch -c <branch>` and ends with the PR step written in its last task.

---

## Phase A: Public skeleton

### Task 1: Scaffold the Electron app

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `electron.vite.config.ts`, `tsconfig.node.json`, `tsconfig.web.json`, `eslint.config.mjs`, `vitest.config.ts`, `.prettierrc`, `.prettierignore`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/server/.gitkeep`
- Test: `test/lint-boundary.test.ts`

**Interfaces:**
- Produces: scripts `pnpm dev`, `build`, `lint`, `format:check`, `typecheck`, `test`. `window.calico` typed as `CalicoApi` from `src/shared/ipc.ts` (empty interface for now, filled in Task 12).

- [ ] **Step 1: Write package.json**

```json
{
  "name": "calico",
  "version": "0.1.0",
  "private": true,
  "description": "Desktop companion and dev kit for the grokbot-buddy desk panel",
  "author": { "name": "Jon Newton", "email": "jonn@hey.com" },
  "license": "MIT",
  "homepage": "https://github.com/newtosh/calico",
  "main": "out/main/index.js",
  "packageManager": "pnpm@11.25.0",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "dist": "electron-vite build && electron-builder --linux --publish never"
  }
}
```

- [ ] **Step 2: Allow Electron's postinstall and install dependencies**

`pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - electron
  - esbuild
```

Run:

```bash
pnpm add react@^18.3.1 react-dom@^18.3.1 @base-ui/react@^1.8.0 lucide-react@^1.52.0
pnpm add -D electron@^44.7.0 electron-vite@^5.0.0 vite@^7 @vitejs/plugin-react@^5.2.0 \
  tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3 typescript@~6.0.3 @types/node@^24 \
  @types/react@^18.3 @types/react-dom@^18.3 @types/web-bluetooth @types/w3c-web-serial \
  vitest@^5.0.3 eslint@^10 @eslint/js@^10 typescript-eslint@^8.71.1 prettier@^3.9.9 \
  @playwright/test@^1.63.0 electron-builder@^26.15.3
node_modules/.bin/electron --version
```

Expected: the last command prints `v44.x`. If pnpm prints "Ignored build scripts: electron", run `pnpm approve-builds electron esbuild` (or `pnpm rebuild electron`) and repeat the version check.

- [ ] **Step 3: Write build and type configs**

`electron.vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [react(), tailwindcss()] },
});
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "electron-vite/node"]
  },
  "include": [
    "src/main",
    "src/preload",
    "src/server",
    "src/shared",
    "test",
    "electron.vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "web-bluetooth", "w3c-web-serial"]
  },
  "include": ["src/renderer/src", "src/shared"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Write lint, format, and ignore files**

`eslint.config.mjs`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "dist/**", "node_modules/**", "test/contract/fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "electron", message: "src/server must run without Electron." }],
          patterns: [
            {
              group: ["**/main/**", "**/preload/**", "**/renderer/**"],
              message: "src/server must not depend on app layers.",
            },
          ],
        },
      ],
    },
  },
);
```

`.prettierrc`:

```json
{}
```

`.prettierignore`:

```
out
dist
pnpm-lock.yaml
test/contract/fixtures
test/parity/ble_desk.h
```

`.gitignore`:

```
node_modules/
out/
dist/
.vite/
playwright-report/
test-results/
*.log
.env
__pycache__/
```

- [ ] **Step 5: Write the failing boundary test**

`test/lint-boundary.test.ts`:

```ts
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("server boundary", () => {
  it("rejects electron imports in src/server", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      'import { app } from "electron";\nexport const name = app.name;\n',
      { filePath: "src/server/probe.ts" },
    );
    expect(result?.messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("allows electron imports in src/main", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      'import { app } from "electron";\nexport const name = app.name;\n',
      { filePath: "src/main/probe.ts" },
    );
    expect(result?.messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to confirm the rule is live**

Run: `pnpm test test/lint-boundary.test.ts`
Expected: PASS for both cases. If the first case fails, the `files` glob in `eslint.config.mjs` is not matching. Fix the config, not the test.

- [ ] **Step 7: Write the minimal app**

`src/shared/ipc.ts`:

```ts
// Filled in Task 12.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CalicoApi {}

declare global {
  interface Window {
    calico: CalicoApi;
  }
}
```

`src/main/index.ts`:

```ts
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: "#0c0e09",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(createWindow);
```

`src/preload/index.ts`:

```ts
import { contextBridge } from "electron";
import type { CalicoApi } from "../shared/ipc";

const api: CalicoApi = {};
contextBridge.exposeInMainWorld("calico", api);
```

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    />
    <title>Calico</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/styles.css`:

```css
@import "tailwindcss";
```

`src/renderer/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
```

`src/renderer/src/App.tsx`:

```tsx
export function App() {
  return <main className="p-4">Calico</main>;
}
```

Create `src/server/.gitkeep` (empty).

- [ ] **Step 8: Verify everything runs**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
Expected: all succeed. Fix formatting with `pnpm format` if `format:check` fails.

Run: `pnpm dev`
Expected: a window titled "Calico" shows the word Calico. If the DevTools console reports a CSP violation for an inline React refresh script in dev, copy the `sha256-...` value Chrome prints into `script-src` (dev only affects the preamble). Close the window.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite app with lint boundary for src/server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Public repo docs and hygiene files

**Files:**
- Create: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `DESIGN.md`, `.cursor/BUGBOT.md`, `.github/CODEOWNERS`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.pre-commit-config.yaml`

**Interfaces:**
- Produces: `DESIGN.md` (read by Task 13, 14, 17, 21), `.cursor/BUGBOT.md`, pre-commit hooks.

- [ ] **Step 1: LICENSE**

Copy the MIT license text from grokbot-buddy and set the holder line:

```bash
sed 's/^Copyright (c) .*/Copyright (c) 2026 Jon Newton/' /home/jonn/src/grokbot-buddy/LICENSE > LICENSE
head -3 LICENSE
```

Expected: `MIT License`, blank line, `Copyright (c) 2026 Jon Newton`.

- [ ] **Step 2: README.md**

```markdown
# Calico

Desktop companion and developer kit for [grokbot-buddy](https://github.com/newtosh/grokbot-buddy), an ESP32-S3 AMOLED desk panel that shows what your coding agents are doing.

> Status: pre-alpha. Built in public. The first release targets Linux.

## What it does

- Runs the companion server the panel polls (`/api/status` on port 8787 by default) and receives agent webhooks.
- Shows a dashboard of agents, events, and the panel's state.
- Sets up the panel over USB or Bluetooth: Wi-Fi (tested before it is saved), companion URL, token, reboot.
- Lives in the tray and starts at login, so the panel keeps working when the window is closed.

Planned: firmware flashing and a first-run wizard, a screen simulator built from the real firmware UI, more agent integrations, macOS and Windows.

## Install

Linux packages (AppImage, deb, pacman) are attached to each [release](https://github.com/newtosh/calico/releases). Each release lists SHA-256 checksums and a build provenance attestation:

```bash
sha256sum -c SHA256SUMS
gh attestation verify Calico-*.AppImage --repo newtosh/calico
```

The tray icon needs a StatusNotifier host. KDE and most panels have one. GNOME needs the AppIndicator extension.

## Develop

Requires Node 22.12+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

The companion listens on your LAN with no accounts. Anyone on the same network can read status. Writes require the bearer token when one is set. Do not port-forward it. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
```

- [ ] **Step 3: CONTRIBUTING.md**

```markdown
# Contributing

Thanks for looking. Calico is a solo project built in public, so the process is small but strict.

## Setup

```bash
pnpm install
pre-commit install
pnpm dev
```

`pre-commit` runs eslint, prettier, and gitleaks before each commit.

## Branches and pull requests

- `main` is protected. Every change lands through a pull request with a green `ci` check and a linear history.
- Branch names: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
- Commit subjects follow Conventional Commits (`feat: add BLE picker`).
- Keep pull requests to one concern.

## Review order

1. CI is green.
2. Cursor Bugbot runs when the pull request is marked ready for review. Fix each finding, or reply with the reason it does not apply and resolve the thread. Comment `bugbot run` to request another pass.
3. Renderer changes get a UI audit against [DESIGN.md](DESIGN.md) and the checklist in the pull request template.
4. Merge with squash.

## Rules that reviewers enforce

- `src/server/` never imports Electron. ESLint fails the build if it does.
- The panel's HTTP contract is frozen. `test/contract` must pass unchanged.
- Never log Wi-Fi passwords or tokens.
- No new runtime dependency without a reason in the pull request description.

## Firmware

The firmware lives in [grokbot-buddy](https://github.com/newtosh/grokbot-buddy). Changes to the Bluetooth or USB protocol start there. `docs/usb-console-protocol.md` here is the contract both sides follow.
```

- [ ] **Step 4: SECURITY.md**

```markdown
# Security

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

I aim to acknowledge reports within a week. Calico is a hobby project with one maintainer, so fixes ship on a best-effort basis.

## Scope

- The companion server (LAN HTTP on port 8787 to 8799).
- Device provisioning over USB and Bluetooth.
- Privileged helper commands run through pkexec.
- Release artifacts and the CI that builds them.

## Known posture

The companion has no user accounts by design. Status reads are open to the LAN. When a panel token is pushed, `/api/status` includes it, because the panel polls without authentication. See the README.
```

- [ ] **Step 5: DESIGN.md**

```markdown
# Calico design brief

Calico is a small desktop tool for one person at a desk. It sits next to a physical panel and should feel like that panel's other half, not like a web dashboard template.

## Who and when

A developer glancing over between tasks, or setting up a board with a cable in one hand. They want state at a glance, and setup steps that cannot go wrong quietly.

## Tokens

The palette comes from the panel firmware. Do not add colors.

| Token | Hex | Use |
|---|---|---|
| glass | `#0c0e09` | window background, strips |
| surface | `#14160f` | sidebar, raised areas |
| field | `#2a2d24` | inputs, buttons, off states |
| stroke | `#6d6756` | borders, dividers |
| selected | `#3d4f32` | selected rows, primary button fill |
| sage | `#9bb57a` | ok, running, online, focus ring |
| cream | `#efe7d6` | primary text |
| muted | `#a39b88` | secondary text, idle |
| amber | `#e2a23a` | needs you, warnings, connecting |
| red | `#c4544a` | errors, offline |

Type: the platform UI font (`system-ui`), tabular numerals everywhere. Monospace only in the Console and for commands the user copies.

## Do

- Dense rows separated by hairlines, like the panel's agent list.
- A sidebar with four views: Dashboard, Device, Console, Settings.
- Say what happened and what to do next, in plain words. Show the exact command before running anything privileged.
- Motion only for state changes, 150 to 200 ms, and none under `prefers-reduced-motion`.
- Lucide icons, because the panel draws Lucide glyphs.
- Keyboard reachable everything, visible focus ring in sage.

## Do not

- Card grids, hero headers, gradients, glassmorphism, drop shadows for depth.
- Inter, or any web font download.
- shadcn default theme, purple, blue links.
- Modals for anything except device pickers and destructive confirmation.
- Toasts that vanish before they can be read.
- Spinners without a label saying what is being waited on.

## Audit

Renderer pull requests run Impeccable `/audit` (product mode) with this file as context, plus the ui-skills `baseline-ui` and `fixing-accessibility` passes. The pull request template carries the checklist.
```

- [ ] **Step 6: Bugbot rules**

`.cursor/BUGBOT.md`:

```markdown
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
```

- [ ] **Step 7: GitHub metadata**

`.github/CODEOWNERS`:

```
* @newtosh
```

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev:
        dependency-type: development
      prod:
        dependency-type: production
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      actions:
        patterns: ["*"]
```

`.github/pull_request_template.md`:

```markdown
## What and why

## How I tested it

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally
- [ ] Contract tests unchanged (or the contract change is intended and called out above)
- [ ] No secrets in logs, fixtures, or screenshots
- [ ] New runtime dependency? Reason given above

### UI changes only

- [ ] Uses DESIGN.md tokens, no inline styles, no new colors
- [ ] Every control reachable by keyboard, focus ring visible
- [ ] Buttons and inputs have labels a screen reader can read
- [ ] Loading and error states say what is happening and what to do
- [ ] Numbers use tabular figures; long text truncates instead of wrapping rows
- [ ] Works with `prefers-reduced-motion`
- [ ] Impeccable `/audit` and ui-skills `baseline-ui` / `fixing-accessibility` run, findings handled
```

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security report
    url: https://github.com/newtosh/calico/security/advisories/new
    about: Report vulnerabilities privately.
```

`.github/ISSUE_TEMPLATE/bug.yml`:

```yaml
name: Bug
description: Something does not work.
labels: [bug]
body:
  - type: textarea
    id: what
    attributes:
      label: What happened
      description: What you did, what you expected, what you saw.
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Calico version
    validations:
      required: true
  - type: input
    id: os
    attributes:
      label: Distro and desktop
      placeholder: Arch, KDE Plasma 6
    validations:
      required: true
  - type: input
    id: firmware
    attributes:
      label: Panel firmware version
      description: Shown in Device after connecting.
  - type: textarea
    id: logs
    attributes:
      label: Console output
      description: Remove any passwords or tokens before pasting.
      render: text
```

`.github/ISSUE_TEMPLATE/feature.yml`:

```yaml
name: Feature
description: Suggest an improvement.
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What are you trying to do, and what gets in the way?
    validations:
      required: true
  - type: textarea
    id: idea
    attributes:
      label: Idea
```

- [ ] **Step 8: pre-commit**

`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.28.0
    hooks:
      - id: gitleaks
  - repo: local
    hooks:
      - id: eslint
        name: eslint
        entry: pnpm exec eslint --max-warnings=0
        language: system
        files: \.(ts|tsx|mjs)$
      - id: prettier
        name: prettier
        entry: pnpm exec prettier --check
        language: system
        types_or: [ts, tsx, javascript, json, yaml, markdown, css]
```

Run:

```bash
pre-commit autoupdate --repo https://github.com/gitleaks/gitleaks
pre-commit install
pnpm format
pre-commit run --all-files
```

Expected: autoupdate bumps `rev` to the latest gitleaks tag; all hooks pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs: add README, contributing, security, design brief, and repo hygiene

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: CI workflow with pinned actions

**Files:**
- Create: `.github/workflows/ci.yml`, `scripts/pin-actions.sh`

**Interfaces:**
- Produces: required status check named `ci` (job name). `scripts/pin-actions.sh` reused in Tasks 19 and 20.

- [ ] **Step 1: Write ci.yml with major-version refs**

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  ci:
    name: ci
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Write the pinning script**

`scripts/pin-actions.sh`:

```bash
#!/usr/bin/env bash
# Rewrite `uses: owner/repo@vN` to the latest release, pinned by commit SHA.
# Already-pinned lines (40-hex refs) are left alone. Needs `gh` logged in.
set -euo pipefail
for f in .github/workflows/*.yml; do
  grep -oE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@v[0-9][A-Za-z0-9.]*$' "$f" | sort -u |
    while read -r _ ref; do
      repo=${ref%@*}
      base=$(echo "$repo" | cut -d/ -f1-2)
      tag=$(gh api "repos/$base/releases/latest" --jq .tag_name)
      sha=$(gh api "repos/$base/commits/$tag" --jq .sha)
      sed -i "s#uses: $ref\$#uses: $repo@$sha \# $tag#" "$f"
      echo "$f: $repo -> $tag ($sha)"
    done
done
```

Run:

```bash
chmod +x scripts/pin-actions.sh
scripts/pin-actions.sh
grep -n 'uses:' .github/workflows/ci.yml
```

Expected: every `uses:` line reads `owner/repo@<40 hex> # vX.Y.Z`.

- [ ] **Step 3: Validate the workflow locally**

Run: `pnpm dlx @action-validator/cli .github/workflows/ci.yml` (if that package is unavailable, run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` to at least confirm valid YAML).
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: add lint, typecheck, test, build workflow with SHA-pinned actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Publish the repo and turn on protections

This task is outward-facing. **Stop and get the user's explicit go-ahead before Step 2.** Steps 5 and 6 are done by the user in web dashboards.

**Files:** none.

- [ ] **Step 1: Pre-flight**

Run:

```bash
gitleaks git --no-banner .
git log --oneline
gh repo view newtosh/calico 2>&1 | head -1
```

Expected: gitleaks finds no leaks; five commits (spec, plan, scaffold, docs, ci); the repo does not exist yet. Show this output to the user and ask: "Create public repo newtosh/calico and push main?"

- [ ] **Step 2: Create and push (after user says yes)**

```bash
gh repo create newtosh/calico --public --source . --remote origin \
  --description "Desktop companion and dev kit for the grokbot-buddy ESP32 desk panel" --push
```

- [ ] **Step 3: Repository settings and security features**

```bash
R=newtosh/calico
gh api -X PATCH repos/$R -F has_wiki=false -F delete_branch_on_merge=true \
  -F allow_merge_commit=false -F allow_rebase_merge=false -F allow_squash_merge=true
gh api -X PATCH repos/$R --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh api -X PUT repos/$R/vulnerability-alerts
gh api -X PUT repos/$R/automated-security-fixes
gh api -X PUT repos/$R/private-vulnerability-reporting
gh api -X PATCH repos/$R/code-scanning/default-setup -f state=configured
gh api -X PUT repos/$R/actions/permissions/fork-pr-contributor-approval -f approval_policy=first_time_contributors
```

- [ ] **Step 4: Ruleset for main**

```bash
gh api -X POST repos/newtosh/calico/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ci" }]
      }
    }
  ]
}
JSON
```

Verify:

```bash
gh api repos/newtosh/calico/rulesets --jq '.[].name'
gh api repos/newtosh/calico --jq '.security_and_analysis'
gh run list --repo newtosh/calico --limit 1
```

Expected: `main`; secret scanning and push protection `enabled`; the push run of `ci` is `completed success`. If `ci` failed, fix on a branch through a pull request (main is now protected).

- [ ] **Step 5: User: enable Cursor Bugbot**

Ask the user to do this in the Cursor dashboard (cursor.com/dashboard → Bugbot):
1. Connect GitHub if not connected, and enable `newtosh/calico`.
2. Set Bugbot to run when a pull request is marked ready for review, not on draft pushes. Manual `bugbot run` comments stay on.
3. Set a monthly spending cap.
4. Do not add Bugbot as a required check.

Also confirm Copilot code review is off for this repo (Settings → Copilot → Code review).

- [ ] **Step 6: Confirm with the user**

Wait for the user to confirm Bugbot is enabled before starting Phase B.

---

## Phase B: Server (branch `feat/server`)

Start: `git switch main && git pull && git switch -c feat/server`

### Task 5: Capture contract fixtures from the Python companion

**Files:**
- Create: `test/contract/capture.py`, `test/contract/scenario.json`, `test/contract/fixtures/companion.json` (generated)

**Interfaces:**
- Produces: `fixtures/companion.json` with shape `{ "source": string, "steps": Recorded[] }`, where `Recorded = { step, status, content_type, cors: [string, string, string], json?, body_b64? }`. Consumed by Task 9.

- [ ] **Step 1: Write the scenario**

`test/contract/scenario.json` (each step is one request; `auth: true` adds `Authorization: Bearer secret`):

```json
[
  { "method": "GET", "path": "/api/status" },
  { "method": "POST", "path": "/api/webhook/grok-bot", "json": { "type": "agent.launched", "agent_id": "a1" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "headers": { "Authorization": "Bearer nope" }, "json": { "type": "agent.launched", "agent_id": "a1" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "agent.launched", "agent_id": "a1", "title": "Scaffold", "color": "#9bb57a", "shape": " Diamond ", "icon": "https://example.com/i.png" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "nope", "agent_id": "a1" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "agent.needs_you", "agent_id": "a1", "title": "Question?", "message": "Pick one" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "agent.launched", "agent_id": "b2", "title": "Builder", "message": "Compiling" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "note", "message": "Deploy done" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "agent.launched", "agent_id": "c3", "title": "Café ✓ 🙂" } },
  { "method": "GET", "path": "/api/status" },
  { "method": "POST", "path": "/api/unread/dismiss", "auth": true },
  { "method": "POST", "path": "/api/dismiss", "auth": true, "json": { "agent_id": "zz" } },
  { "method": "GET", "path": "/api/status" },
  { "method": "POST", "path": "/api/dismiss", "auth": true, "json": { "agent_id": "a1" } },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "json": { "type": "agent.finished", "agent_id": "b2" } },
  { "method": "GET", "path": "/api/status" },
  { "method": "PUT", "path": "/api/panel", "auth": true, "json": { "ssid": "home" } },
  { "method": "PUT", "path": "/api/panel", "auth": true, "json": { "token": "t" } },
  { "method": "PUT", "path": "/api/panel", "auth": true, "json": { "url": "http://192.168.4.30:8787/", "token": "desk-secret" } },
  { "method": "GET", "path": "/api/status" },
  { "method": "GET", "path": "/api/panel" },
  { "method": "POST", "path": "/api/frame/request", "auth": true },
  { "method": "GET", "path": "/api/status" },
  { "method": "POST", "path": "/api/frame", "auth": true, "headers": { "Content-Type": "image/bmp" }, "body_b64": "Qk0AAQID" },
  { "method": "GET", "path": "/api/frame" },
  { "method": "POST", "path": "/api/frame", "auth": true, "headers": { "Content-Type": "text/plain" }, "body_b64": "Qk0AAQID" },
  { "method": "POST", "path": "/api/frame", "auth": true, "headers": { "Content-Type": "image/bmp" }, "body_b64": "WFhYWA==" },
  { "method": "POST", "path": "/api/webhook/grok-bot", "auth": true, "headers": { "Content-Type": "application/json" }, "body_b64": "bm90IGpzb24=" },
  { "method": "PUT", "path": "/api/panel", "auth": true, "json": { "clear": true } },
  { "method": "GET", "path": "/api/status" },
  { "method": "GET", "path": "/api/nope" },
  { "method": "POST", "path": "/api/nope", "auth": true },
  { "method": "OPTIONS", "path": "/api/status" },
  { "method": "POST", "path": "/api/needs-auth-check", "json": {} },
  { "method": "POST", "path": "/api/dismiss", "auth": true }
]
```

- [ ] **Step 2: Write the capture script**

`test/contract/capture.py`:

```python
"""Record the Python companion's responses for calico's contract tests.

Run from the calico repo root, against a grokbot-buddy checkout:

    python3 test/contract/capture.py /home/jonn/src/grokbot-buddy

Writes test/contract/fixtures/companion.json. Re-run only when the frozen
contract changes on purpose, and say so in the pull request.
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

CORS = ("Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers")


def run(base: str, step: dict[str, object]) -> dict[str, object]:
    headers = dict(step.get("headers", {}))  # type: ignore[arg-type]
    if step.get("auth"):
        headers["Authorization"] = "Bearer secret"
    data: bytes | None = None
    if "json" in step:
        data = json.dumps(step["json"]).encode()
        headers.setdefault("Content-Type", "application/json")
    elif "body_b64" in step:
        data = base64.b64decode(str(step["body_b64"]))
    request = Request(base + str(step["path"]), data=data, headers=headers, method=str(step["method"]))
    try:
        with urlopen(request) as response:
            status, got, body = response.status, response.headers, response.read()
    except HTTPError as exc:
        status, got, body = exc.code, exc.headers, exc.read()
    record: dict[str, object] = {
        "step": step,
        "status": status,
        "content_type": got.get("Content-Type", ""),
        "cors": [got.get(name, "") for name in CORS],
    }
    if str(record["content_type"]).startswith("application/json"):
        record["json"] = json.loads(body)
    elif body:
        record["body_b64"] = base64.b64encode(body).decode()
    return record


def main() -> None:
    repo = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(repo / "companion" / "src"))
    from grok_desk_buddy.config import default_config
    from grok_desk_buddy.server import serve_in_thread
    from grok_desk_buddy.store import DeskStore

    here = Path(__file__).parent
    steps = json.loads((here / "scenario.json").read_text(encoding="utf-8"))
    config = default_config()
    config.webhook_token = "secret"
    server, base = serve_in_thread(DeskStore(), web_dist=None, config=config, config_path=None)
    try:
        results = [run(base, step) for step in steps]
    finally:
        server.shutdown()
    commit = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    out = here / "fixtures" / "companion.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(
        json.dumps({"source": f"grokbot-buddy@{commit}", "steps": results}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(results)} steps to {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Capture**

Run: `python3 test/contract/capture.py /home/jonn/src/grokbot-buddy`
Expected: `wrote 35 steps to .../companion.json`.

Spot-check:

```bash
python3 - <<'PY'
import json
s = json.load(open("test/contract/fixtures/companion.json"))["steps"]
print([x["status"] for x in s])
print(list(s[19]["json"].keys()))
PY
```

Expected statuses: `[200, 401, 401, 201, 400, 201, 201, 201, 201, 200, 204, 204, 200, 204, 201, 200, 400, 400, 200, 200, 200, 204, 200, 204, 200, 415, 400, 400, 200, 200, 404, 404, 204, 404, 204]`. Step 19's keys start with `panel`, then `phase`, `needs_you`, `unread`, `capture`, `agents`. If the statuses differ, read the step that differs and fix the scenario, not the Python companion.

- [ ] **Step 4: Commit**

```bash
git add test/contract
git commit -m "test: capture frozen HTTP contract from the Python companion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: DeskStore

**Files:**
- Create: `src/server/store.ts`
- Delete: `src/server/.gitkeep`
- Test: `test/server/store.test.ts`

**Interfaces:**
- Produces (exact names, used by Tasks 7, 9, 10, 12):

```ts
export const EVENT_CAP = 50, COLOR_LIMIT = 32, SHAPE_LIMIT = 16, ICON_LIMIT = 200;
export const RUNNING_TTL_MS = 120_000;
export const FRAME_MAX = 480 * 480 * 2 + 256;
export class StoreError extends Error {}
export interface EventIn { type: string; agent_id?: string; title?: string; message?: string; source?: string; color?: string; shape?: string; icon?: string }
export interface DeskEvent { id: string; type: string; agent_id: string; title: string; message: string; source: string; at: string; color: string; shape: string; icon: string }
export interface AgentRecord { id: string; title: string; status: "running" | "idle"; updated_at: string; color: string; shape: string; icon: string; attention: boolean; message: string }
export interface Snapshot { events: DeskEvent[]; agents: AgentRecord[]; unread: number }
export interface StatusBody { phase: Phase; needs_you: boolean; unread: number; capture: boolean; agents: PublicAgent[]; last_event: DeskEvent | null; events: DeskEvent[] }
export function clipText(value: unknown, limit: number): string;
export function clipShape(value: unknown): string;
export function isoSeconds(date: Date): string;
export class DeskStore {
  constructor(opts?: { now?: () => Date; snapshot?: Snapshot | null; onChange?: (s: Snapshot) => void });
  applyEvent(raw: EventIn): DeskEvent;         // throws StoreError
  dismiss(agentId?: string): void;
  requestFrame(): void;
  saveFrame(body: Buffer): "ok" | "too_big" | "bad";
  frame(): Buffer | null;
  clearUnread(): void;
  status(): StatusBody;
  applyCursorItem(agentId: string, name: string, mapped: string, at: string, color?: string, shape?: string, icon?: string): boolean;
  snapshot(): Snapshot;
}
```

- [ ] **Step 1: Write the failing tests**

`test/server/store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DeskStore, FRAME_MAX, type Snapshot } from "../../src/server/store";

function clock(start = "2026-10-07T12:00:00Z") {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance: (seconds: number) => {
      t += seconds * 1000;
    },
  };
}

describe("DeskStore", () => {
  it("goes launched, needs_you, dismissed", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1", title: "Scaffold" });
    expect(store.status().phase).toBe("running");
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "Pick one" });
    expect(store.status()).toMatchObject({ phase: "needs_you", needs_you: true });
    store.dismiss();
    const after = store.status();
    expect(after).toMatchObject({ phase: "running", needs_you: false });
    expect(after.last_event).toMatchObject({ type: "note", source: "manual", title: "", message: "" });
  });

  it("orders waiting agents first, then newest", () => {
    const row = (id: string, status: "running" | "idle", at: string, attention = false) => ({
      id, title: id.toUpperCase(), status, updated_at: at, color: "", shape: "", icon: "", attention, message: "",
    });
    const snapshot: Snapshot = {
      events: [],
      unread: 0,
      agents: [
        row("m", "running", "2026-10-05T12:00:00Z"),
        row("z", "running", "2026-10-05T09:00:00Z", true),
        row("a", "running", "2026-10-05T12:00:00Z"),
        row("b", "idle", "2026-10-05T15:00:00Z"),
        row("n", "running", "2026-10-05T10:00:00Z", true),
      ],
    };
    const store = new DeskStore({ snapshot, now: clock("2026-10-05T12:01:00Z").now });
    expect(store.status().agents.map((a) => a.id)).toEqual(["n", "z", "b", "a", "m"]);
  });

  it("returns every stored agent", () => {
    const store = new DeskStore({ now: clock().now });
    for (let i = 0; i < 17; i++) {
      const id = `a${String(i).padStart(2, "0")}`;
      store.applyEvent({ type: "agent.launched", agent_id: id, title: `Agent ${i}` });
    }
    const agents = store.status().agents;
    expect(agents).toHaveLength(17);
    expect(agents[0]?.id).toBe("a00");
    expect(agents[16]).toMatchObject({ id: "a16", title: "Agent 16" });
  });

  it("counts unread as waiting agents and clears with them", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "one" });
    store.applyEvent({ type: "agent.needs_you", agent_id: "b2", message: "two" });
    expect(store.status().unread).toBe(2);
    store.dismiss();
    expect(store.status().unread).toBe(0);
  });

  it("keeps a note out of the roster and finishes to idle", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "note", message: "hi" });
    expect(store.status()).toMatchObject({ agents: [], unread: 1 });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    store.applyEvent({ type: "agent.finished", agent_id: "a1" });
    expect(store.status().agents[0]?.status).toBe("idle");
  });

  it("rejects unknown types and agent events without an id", () => {
    const store = new DeskStore();
    expect(() => store.applyEvent({ type: "nope", agent_id: "a1" })).toThrow("unknown event type");
    expect(() => store.applyEvent({ type: "agent.launched" })).toThrow("agent_id required");
  });

  it("caps events at 50", () => {
    const store = new DeskStore({ now: clock().now });
    for (let i = 0; i < 60; i++) store.applyEvent({ type: "note", message: `n${i}` });
    const events = store.status().events;
    expect(events).toHaveLength(50);
    expect(events[0]?.message).toBe("n59");
  });

  it("does not let cursor clear needs_you", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "wait" });
    expect(store.applyCursorItem("a1", "Cursor", "idle", "2026-10-07T12:00:05Z")).toBe(false);
    expect(store.status().phase).toBe("needs_you");
  });

  it("treats a repeated launch as a standing ping", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    expect(store.status().events).toHaveLength(1);
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "q" });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    const body = store.status();
    expect(body.phase).toBe("needs_you");
    expect(body.events).toHaveLength(2);
  });

  it("ages a silent running agent to idle after 120 s", () => {
    const c = clock();
    const store = new DeskStore({ now: c.now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1" });
    c.advance(121);
    expect(store.status()).toMatchObject({ phase: "idle", agents: [{ status: "idle" }] });
  });

  it("dismisses one named agent and ignores a name that matches nobody", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "one" });
    store.applyEvent({ type: "agent.needs_you", agent_id: "b2", message: "two" });
    store.dismiss("zz");
    expect(store.status().unread).toBe(2);
    store.dismiss("a1");
    const body = store.status();
    expect(body.unread).toBe(1);
    expect(body.agents.find((a) => a.id === "b2")?.attention).toBe(true);
    expect(body.agents.find((a) => a.id === "a1")?.attention).toBe(false);
  });

  it("keeps a single waiter's question on last_event", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1", title: "Scaffold" });
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", message: "Pick one" });
    store.applyEvent({ type: "agent.launched", agent_id: "b2", title: "Builder" });
    expect(store.status().last_event).toMatchObject({
      type: "agent.launched",
      agent_id: "a1",
      title: "Scaffold",
      message: "Pick one",
    });
  });

  it("stores one frame and clears the capture flag", () => {
    const store = new DeskStore();
    store.requestFrame();
    expect(store.status().capture).toBe(true);
    expect(store.saveFrame(Buffer.from("XX"))).toBe("bad");
    expect(store.saveFrame(Buffer.alloc(FRAME_MAX + 1))).toBe("too_big");
    expect(store.status().capture).toBe(true);
    const bmp = Buffer.from("BM1234");
    expect(store.saveFrame(bmp)).toBe("ok");
    expect(store.status().capture).toBe(false);
    expect(store.frame()?.equals(bmp)).toBe(true);
  });

  it("clips identity and lowercases the shape", () => {
    const store = new DeskStore({ now: clock().now });
    store.applyEvent({ type: "agent.launched", agent_id: "a1", shape: "  DiamondDiamondDiamond ", color: " #9bb57a " });
    expect(store.status().agents[0]).toMatchObject({ shape: "diamonddiamonddi", color: "#9bb57a" });
  });

  it("round-trips through a snapshot and reports every change", () => {
    const onChange = vi.fn();
    const c = clock();
    const store = new DeskStore({ now: c.now, onChange });
    store.applyEvent({ type: "agent.needs_you", agent_id: "a1", title: "A", message: "q" });
    expect(onChange).toHaveBeenCalledTimes(1);
    const copy = new DeskStore({ now: c.now, snapshot: store.snapshot() });
    expect(copy.status()).toEqual(store.status());
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/server/store.test.ts`
Expected: FAIL, cannot resolve `../../src/server/store`.

- [ ] **Step 3: Implement the store**

`src/server/store.ts` (a direct port of `grokbot-buddy/companion/src/grok_desk_buddy/store.py`; object literal key order is part of the contract):

```ts
import { randomUUID } from "node:crypto";

export const AGENT_TYPES = new Set(["agent.launched", "agent.finished", "agent.needs_you"]);
export const EVENT_CAP = 50;
export const COLOR_LIMIT = 32;
export const SHAPE_LIMIT = 16;
export const ICON_LIMIT = 200;
// A launch POST that nobody refreshes must not pin the desk on the 2 s poll.
export const RUNNING_TTL_MS = 120_000;
// One 480x480 RGB565 BMP plus the 66-byte header and a little slack.
export const FRAME_MAX = 480 * 480 * 2 + 256;

export class StoreError extends Error {}

export interface EventIn {
  type: string;
  agent_id?: string;
  title?: string;
  message?: string;
  source?: string;
  color?: string;
  shape?: string;
  icon?: string;
}

export interface DeskEvent {
  id: string;
  type: string;
  agent_id: string;
  title: string;
  message: string;
  source: string;
  at: string;
  color: string;
  shape: string;
  icon: string;
}

export interface AgentRecord {
  id: string;
  title: string;
  status: "running" | "idle";
  updated_at: string;
  color: string;
  shape: string;
  icon: string;
  // Awaiting the user. Independent of running/idle so a finish does not drop the lamp.
  attention: boolean;
  message: string;
}

export type Phase = "idle" | "running" | "needs_you";

export interface PublicAgent {
  id: string;
  title: string;
  status: Phase;
  attention: boolean;
  message: string;
  updated_at: string;
  color: string;
  shape: string;
  icon: string;
}

export interface StatusBody {
  phase: Phase;
  needs_you: boolean;
  unread: number;
  capture: boolean;
  agents: PublicAgent[];
  last_event: DeskEvent | null;
  events: DeskEvent[];
}

export interface Snapshot {
  events: DeskEvent[];
  agents: AgentRecord[];
  unread: number;
}

export interface StoreOptions {
  now?: () => Date;
  snapshot?: Snapshot | null;
  onChange?: (snapshot: Snapshot) => void;
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function clipText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function clipShape(value: unknown): string {
  return clipText(value, SHAPE_LIMIT).toLowerCase();
}

/** Panel headline. A dismiss acknowledgement is not one. */
export function faceEventTitle(title: string, message = ""): string {
  return title === "Dismissed" && !message ? "" : title;
}

export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function makeEvent(fields: Omit<DeskEvent, "id">): DeskEvent {
  return {
    id: randomUUID(),
    type: fields.type,
    agent_id: fields.agent_id,
    title: fields.title,
    message: fields.message,
    source: fields.source,
    at: fields.at,
    color: fields.color,
    shape: fields.shape,
    icon: fields.icon,
  };
}

function publicEvent(event: DeskEvent): DeskEvent {
  return { ...event, title: faceEventTitle(event.title, event.message) };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class DeskStore {
  private events: DeskEvent[] = [];
  private agents = new Map<string, AgentRecord>();
  private unread = 0;
  private capture = false;
  private frameBytes: Buffer | null = null;
  private readonly now: () => Date;
  private readonly onChange: (snapshot: Snapshot) => void;

  constructor(opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.onChange = opts.onChange ?? (() => undefined);
    if (opts.snapshot) {
      this.events = opts.snapshot.events.slice(0, EVENT_CAP).map((e) => ({ ...e }));
      for (const agent of opts.snapshot.agents) this.agents.set(agent.id, { ...agent });
      this.unread = Math.max(0, opts.snapshot.unread);
    }
  }

  snapshot(): Snapshot {
    return {
      events: this.events.map((e) => ({ ...e })),
      agents: [...this.agents.values()].map((a) => ({ ...a })),
      unread: this.unread,
    };
  }

  applyEvent(raw: EventIn): DeskEvent {
    const agentId = raw.agent_id ?? "";
    if (!AGENT_TYPES.has(raw.type) && raw.type !== "note") throw new StoreError("unknown event type");
    if (AGENT_TYPES.has(raw.type) && !agentId) throw new StoreError("agent_id required");
    const title = raw.title ?? "";
    const message = raw.message ?? "";
    const event = makeEvent({
      type: raw.type,
      agent_id: agentId,
      title,
      message,
      source: raw.source ?? "grok-bot",
      at: this.stamp(),
      color: clipText(raw.color ?? "", COLOR_LIMIT),
      shape: clipShape(raw.shape ?? ""),
      icon: clipText(raw.icon ?? "", ICON_LIMIT),
    });
    // A standing launch ping refreshes updated_at and must not flood the log,
    // bump unread, or clear attention.
    if (raw.type === "agent.launched") {
      const current = this.agents.get(agentId);
      if (current && (current.status === "running" || current.attention)) {
        const changed = Boolean(message) && message !== current.message;
        this.touch(agentId, title, event, "running", current.attention, message || null);
        if (changed) this.remember(event);
        this.persist();
        return event;
      }
    }
    if (raw.type === "agent.finished") {
      const waiting = this.agents.get(agentId)?.attention === true;
      this.remember(event);
      // Keep the question up while they are still waiting.
      this.touch(agentId, title, event, "idle", waiting, waiting ? null : "");
      this.persist();
      return event;
    }
    if (raw.type === "note" && message) this.unread = 1;
    this.remember(event);
    if (raw.type === "agent.needs_you") {
      // The question is `message`. A title here must not rename the agent to the question.
      const named = this.agents.has(agentId) ? "" : title;
      this.touch(agentId, named, event, "running", true, message || null);
    } else if (raw.type === "agent.launched") {
      this.touch(agentId, title, event, "running", false, message || null);
    }
    this.persist();
    return event;
  }

  dismiss(agentId = ""): void {
    const at = this.stamp();
    let cleared = false;
    for (const agent of this.agents.values()) {
      if (!agent.attention) continue;
      if (agentId && agent.id !== agentId) continue;
      agent.attention = false;
      agent.message = "";
      if (agent.status === "running") agent.updated_at = at;
      cleared = true;
    }
    const still = [...this.agents.values()].some((a) => a.attention);
    // A named dismiss that matched nobody must not clear the others.
    if (agentId && !cleared) return;
    if (still) {
      this.persist();
      return;
    }
    this.unread = 0;
    this.remember(
      makeEvent({ type: "note", agent_id: "", title: "", message: "", source: "manual", at, color: "", shape: "", icon: "" }),
    );
    this.persist();
  }

  requestFrame(): void {
    this.capture = true;
  }

  /** Store one BMP. "too_big" and "bad" leave the previous frame and the flag. */
  saveFrame(body: Buffer): "ok" | "too_big" | "bad" {
    if (body.length > FRAME_MAX) return "too_big";
    if (body.length < 2 || body[0] !== 0x42 || body[1] !== 0x4d) return "bad";
    this.frameBytes = Buffer.from(body);
    this.capture = false;
    return "ok";
  }

  frame(): Buffer | null {
    return this.frameBytes;
  }

  clearUnread(): void {
    if (this.unread === 0) return;
    this.unread = 0;
    this.persist();
  }

  status(): StatusBody {
    // attention, then newest updated_at. Two needs_you in one second follow
    // event order (later event first). id is the last tie. Stable sorts keep
    // the earlier key, exactly like the Python companion.
    const recent = new Map<string, number>();
    this.events.forEach((event, index) => {
      if (event.agent_id && !recent.has(event.agent_id)) recent.set(event.agent_id, index);
    });
    const tail = this.events.length;
    const ordered = [...this.agents.values()].sort((a, b) => compare(a.id, b.id));
    const waitKey = (a: AgentRecord) => (a.attention ? (recent.get(a.id) ?? tail) : 0);
    ordered.sort((a, b) => waitKey(a) - waitKey(b));
    ordered.sort((a, b) => compare(b.updated_at, a.updated_at));
    ordered.sort((a, b) => Number(!a.attention) - Number(!b.attention));
    const now = this.now().getTime();
    const agents: PublicAgent[] = ordered.map((agent) => ({
      id: agent.id,
      title: agent.title,
      status: visibleStatus(agent, now),
      attention: agent.attention,
      message: agent.message,
      updated_at: agent.updated_at,
      color: agent.color,
      shape: agent.shape,
      icon: agent.icon,
    }));
    const statuses = new Set(agents.map((a) => a.status));
    const phase: Phase = statuses.has("needs_you") ? "needs_you" : statuses.has("running") ? "running" : "idle";
    const unread = this.reportedUnread();
    if (unread === 0 && this.unread !== 0) {
      this.unread = 0;
      this.persist();
    }
    return {
      phase,
      needs_you: phase === "needs_you",
      unread,
      // Before agents: a 16 KB panel buffer drops the tail.
      capture: this.capture,
      agents,
      last_event: this.faceLast(),
      events: this.events.map(publicEvent),
    };
  }

  applyCursorItem(
    agentId: string,
    name: string,
    mapped: string,
    at: string,
    color = "",
    shape = "",
    icon = "",
  ): boolean {
    if (mapped !== "running" && mapped !== "idle") throw new StoreError("cursor status must be running or idle");
    const current = this.agents.get(agentId);
    if (current?.attention) return false;
    if (current && current.status === mapped) {
      // Same status is the heartbeat. A newer stamp keeps the row from aging out.
      if (mapped === "running" && at > current.updated_at) {
        current.updated_at = at;
        this.persist();
      }
      return false;
    }
    const event = makeEvent({
      type: mapped === "running" ? "agent.launched" : "agent.finished",
      agent_id: agentId,
      title: name,
      message: "",
      source: "cursor",
      at,
      color: clipText(color, COLOR_LIMIT),
      shape: clipShape(shape),
      icon: clipText(icon, ICON_LIMIT),
    });
    this.remember(event);
    this.touch(agentId, name, event, mapped, false);
    this.persist();
    return true;
  }

  private stamp(): string {
    return isoSeconds(this.now());
  }

  private persist(): void {
    this.onChange(this.snapshot());
  }

  private remember(event: DeskEvent): void {
    this.events.unshift(event);
    this.events.length = Math.min(this.events.length, EVENT_CAP);
  }

  private touch(
    agentId: string,
    title: string,
    event: DeskEvent,
    status: "running" | "idle",
    attention: boolean,
    message: string | null = null,
  ): void {
    const current = this.agents.get(agentId);
    this.agents.set(agentId, {
      id: agentId,
      title: title || current?.title || "",
      status,
      updated_at: event.at,
      color: event.color || current?.color || "",
      shape: event.shape || current?.shape || "",
      icon: event.icon || current?.icon || "",
      attention,
      message: message ?? current?.message ?? "",
    });
  }

  /** Badge equals waiting agents. A note counts only when nothing is waiting. */
  private reportedUnread(): number {
    const waiters = [...this.agents.values()].filter((a) => a.attention).length;
    if (waiters) return waiters;
    const last = this.events[0];
    if (last && last.type === "note" && last.message && this.unread) return 1;
    return 0;
  }

  /**
   * Last event the face matches onto a row. One waiting agent keeps their
   * question on that row even when a later event has no text.
   */
  private faceLast(): DeskEvent | null {
    const first = this.events[0];
    if (!first) return null;
    const data = publicEvent(first);
    const waiters = [...this.agents.values()].filter((a) => a.attention && a.message);
    const only = waiters.length === 1 ? waiters[0] : undefined;
    if (only) {
      data.agent_id = only.id;
      data.title = only.title || only.id;
      data.message = only.message;
      return data;
    }
    if (data.message && data.agent_id) {
      const agent = this.agents.get(data.agent_id);
      const bound = agent ? agent.title || agent.id : "";
      if (agent && bound && data.title !== agent.title && data.title !== agent.id) data.title = bound;
    }
    return data;
  }
}

function visibleStatus(agent: AgentRecord, now: number): Phase {
  if (agent.attention) return "needs_you";
  if (agent.status !== "running") return "idle";
  if (!STAMP.test(agent.updated_at)) return agent.status;
  return now - Date.parse(agent.updated_at) > RUNNING_TTL_MS ? "idle" : "running";
}
```

Delete `src/server/.gitkeep`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test test/server/store.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): port DeskStore from the Python companion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Snapshot persistence

**Files:**
- Create: `src/server/state-file.ts`
- Test: `test/server/state-file.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `AgentRecord`, `DeskEvent` from Task 6.
- Produces: `writeAtomic(path: string, text: string): void`, `parseSnapshot(value: unknown): Snapshot` (throws), `loadSnapshot(path: string): Snapshot | null`, `saveSnapshot(path: string, snapshot: Snapshot): void`.

- [ ] **Step 1: Write the failing tests**

`test/server/state-file.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnapshot, saveSnapshot } from "../../src/server/state-file";
import type { Snapshot } from "../../src/server/store";

const dir = () => mkdtempSync(join(tmpdir(), "calico-state-"));

const sample: Snapshot = {
  unread: 1,
  events: [
    { id: "e1", type: "note", agent_id: "", title: "", message: "hi", source: "manual", at: "2026-10-07T12:00:00Z", color: "", shape: "", icon: "" },
  ],
  agents: [
    { id: "a1", title: "A", status: "running", updated_at: "2026-10-07T12:00:00Z", color: "", shape: "", icon: "", attention: true, message: "q" },
  ],
};

describe("state file", () => {
  it("returns null when the file is missing", () => {
    expect(loadSnapshot(join(dir(), "state.json"))).toBeNull();
  });

  it("round-trips with mode 600 and no temp file left", () => {
    const path = join(dir(), "nested", "state.json");
    saveSnapshot(path, sample);
    expect(loadSnapshot(path)).toEqual(sample);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("moves a corrupt file aside and starts empty", () => {
    const path = join(dir(), "state.json");
    writeFileSync(path, "{not json");
    expect(loadSnapshot(path)).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(`${path}.bad`, "utf8")).toBe("{not json");
  });

  it("moves a wrong-shaped file aside", () => {
    const path = join(dir(), "state.json");
    writeFileSync(path, JSON.stringify({ events: "nope" }));
    expect(loadSnapshot(path)).toBeNull();
    expect(existsSync(`${path}.bad`)).toBe(true);
  });

  it("coerces unknown agent status to idle", () => {
    const path = join(dir(), "state.json");
    const raw = { ...sample, agents: [{ ...sample.agents[0], status: "needs_you" }] };
    writeFileSync(path, JSON.stringify(raw));
    expect(loadSnapshot(path)?.agents[0]?.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/server/state-file.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/server/state-file.ts`:

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentRecord, DeskEvent, Snapshot } from "./store";

// ponytail: whole-file JSON snapshot on every change. The store holds at most
// 50 events and a few dozen agents. Move to SQLite if history ever needs queries.

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function eventFrom(value: unknown): DeskEvent {
  if (!isRecord(value)) throw new Error("bad event");
  return {
    id: str(value.id),
    type: str(value.type),
    agent_id: str(value.agent_id),
    title: str(value.title),
    message: str(value.message),
    source: str(value.source),
    at: str(value.at),
    color: str(value.color),
    shape: str(value.shape),
    icon: str(value.icon),
  };
}

function agentFrom(value: unknown): AgentRecord {
  if (!isRecord(value) || typeof value.id !== "string") throw new Error("bad agent");
  return {
    id: value.id,
    title: str(value.title),
    status: value.status === "running" ? "running" : "idle",
    updated_at: str(value.updated_at),
    color: str(value.color),
    shape: str(value.shape),
    icon: str(value.icon),
    attention: value.attention === true,
    message: str(value.message),
  };
}

export function parseSnapshot(value: unknown): Snapshot {
  if (!isRecord(value) || !Array.isArray(value.events) || !Array.isArray(value.agents)) {
    throw new Error("bad snapshot");
  }
  return {
    events: value.events.map(eventFrom),
    agents: value.agents.map(agentFrom),
    unread: typeof value.unread === "number" && value.unread > 0 ? Math.floor(value.unread) : 0,
  };
}

export function loadSnapshot(path: string): Snapshot | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return parseSnapshot(JSON.parse(text));
  } catch {
    renameSync(path, `${path}.bad`);
    return null;
  }
}

export function saveSnapshot(path: string, snapshot: Snapshot): void {
  writeAtomic(path, JSON.stringify(snapshot));
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test test/server/state-file.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): persist the store as an atomic JSON snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Config

**Files:**
- Create: `src/server/config.ts`
- Test: `test/server/config.test.ts`

**Interfaces:**
- Consumes: `writeAtomic` from Task 7.
- Produces:

```ts
export interface CalicoConfig { port: number; webhook_token: string; cursor_api_key: string; cursor_poll_seconds: number; panel_url: string; panel_token: string }
export const DEFAULT_PORT = 8787;
export class ConfigError extends Error {}   // startup-fatal, message names the file
export class BadInput extends Error {}      // 400 from the HTTP layer
export function defaultConfig(): CalicoConfig;
export function loadConfig(path: string): { config: CalicoConfig; existed: boolean };
export function saveConfig(path: string, config: CalicoConfig): void;
export function publicView(c: CalicoConfig): { port: number; cursor_poll_seconds: number; webhook_token_set: boolean; cursor_api_key_set: boolean };
export function mergeConfig(current: CalicoConfig, patch: Record<string, unknown>): { config: CalicoConfig; restart: boolean };
export function panelPublicView(c: CalicoConfig): { url: string; token_set: boolean };
export function panelStatusField(c: CalicoConfig): { url: string; token: string } | null;
export function mergePanel(current: CalicoConfig, patch: Record<string, unknown>): CalicoConfig;
```

- [ ] **Step 1: Write the failing tests**

`test/server/config.test.ts`:

```ts
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BadInput,
  ConfigError,
  defaultConfig,
  loadConfig,
  mergeConfig,
  mergePanel,
  panelStatusField,
  publicView,
  saveConfig,
} from "../../src/server/config";

const file = () => join(mkdtempSync(join(tmpdir(), "calico-config-")), "config.json");

describe("config file", () => {
  it("uses defaults when missing", () => {
    expect(loadConfig(file())).toEqual({ config: defaultConfig(), existed: false });
  });

  it("saves with mode 600 and loads back", () => {
    const path = file();
    const config = { ...defaultConfig(), port: 8790, webhook_token: "s" };
    saveConfig(path, config);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig(path)).toEqual({ config, existed: true });
  });

  it("refuses corrupt config and leaves the file", () => {
    const path = file();
    writeFileSync(path, "{oops");
    expect(() => loadConfig(path)).toThrow(ConfigError);
    expect(() => loadConfig(path)).toThrow(path);
    expect(readFileSync(path, "utf8")).toBe("{oops");
  });

  it("refuses an out-of-range port", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ port: 70000 }));
    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it("masks secrets in the public view", () => {
    expect(publicView({ ...defaultConfig(), webhook_token: "x" })).toEqual({
      port: 8787,
      cursor_poll_seconds: 30,
      webhook_token_set: true,
      cursor_api_key_set: false,
    });
  });
});

describe("mergeConfig", () => {
  it("keeps an omitted secret", () => {
    const current = { ...defaultConfig(), webhook_token: "keep" };
    expect(mergeConfig(current, { cursor_poll_seconds: 60 }).config.webhook_token).toBe("keep");
  });

  it.each([0, 70000, "abc", true, 1.5])("rejects port %s", (port) => {
    expect(() => mergeConfig(defaultConfig(), { port })).toThrow(BadInput);
  });

  it("flags a port change as needing a restart", () => {
    expect(mergeConfig(defaultConfig(), { port: "8790" })).toMatchObject({ config: { port: 8790 }, restart: true });
    expect(mergeConfig(defaultConfig(), { cursor_poll_seconds: 10 }).restart).toBe(false);
  });
});

describe("mergePanel", () => {
  it("stores url and token and strips trailing slashes", () => {
    const merged = mergePanel(defaultConfig(), { url: "http://192.168.4.30:8787//", token: "desk-secret" });
    expect(panelStatusField(merged)).toEqual({ url: "http://192.168.4.30:8787", token: "desk-secret" });
  });

  it("requires a url before a token", () => {
    expect(() => mergePanel(defaultConfig(), { token: "t" })).toThrow(BadInput);
  });

  it.each([
    { ssid: "home" },
    { password: "x", url: "http://h" },
    { url: "ftp://h" },
    { url: "http://" },
    { url: "http://user@h" },
    { url: "http://:80" },
    { url: "http://h", token: "has space" },
    { url: "http://h", token: 'has"quote' },
    { url: `http://${"h".repeat(130)}` },
  ])("rejects %j", (patch) => {
    expect(() => mergePanel(defaultConfig(), patch)).toThrow(BadInput);
  });

  it("clears both fields", () => {
    const set = mergePanel(defaultConfig(), { url: "http://h", token: "t" });
    expect(panelStatusField(mergePanel(set, { clear: true }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/server/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/server/config.ts`:

```ts
import { readFileSync } from "node:fs";
import { writeAtomic } from "./state-file";

export interface CalicoConfig {
  port: number;
  webhook_token: string;
  cursor_api_key: string;
  cursor_poll_seconds: number;
  panel_url: string;
  panel_token: string;
}

export const DEFAULT_PORT = 8787;

/** Startup-fatal. The message names the file. */
export class ConfigError extends Error {}
/** A request body the HTTP layer answers with 400. */
export class BadInput extends Error {}

export function defaultConfig(): CalicoConfig {
  return {
    port: DEFAULT_PORT,
    webhook_token: "",
    cursor_api_key: "",
    cursor_poll_seconds: 30,
    panel_url: "",
    panel_token: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boundedInt(value: unknown, low: number, high: number): number {
  let n: number;
  if (typeof value === "number" && Number.isInteger(value)) n = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) n = Number(value);
  else throw new BadInput("bad number");
  if (n < low || n > high) throw new BadInput("bad number");
  return n;
}

export function loadConfig(path: string): { config: CalicoConfig; existed: boolean } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { config: defaultConfig(), existed: false };
    throw new ConfigError(`Cannot read ${path}: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConfigError(`${path} is not valid JSON. Fix or delete it. Calico will not overwrite it.`);
  }
  if (!isRecord(data)) throw new ConfigError(`${path} must contain a JSON object.`);
  const base = defaultConfig();
  try {
    return {
      existed: true,
      config: {
        port: "port" in data ? boundedInt(data.port, 1, 65535) : base.port,
        webhook_token: str(data.webhook_token),
        cursor_api_key: str(data.cursor_api_key),
        cursor_poll_seconds:
          "cursor_poll_seconds" in data ? boundedInt(data.cursor_poll_seconds, 5, 86400) : base.cursor_poll_seconds,
        panel_url: str(data.panel_url),
        panel_token: str(data.panel_token),
      },
    };
  } catch {
    throw new ConfigError(`${path} has an invalid port or cursor_poll_seconds.`);
  }
}

export function saveConfig(path: string, config: CalicoConfig): void {
  writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}

export function publicView(config: CalicoConfig) {
  return {
    port: config.port,
    cursor_poll_seconds: config.cursor_poll_seconds,
    webhook_token_set: Boolean(config.webhook_token),
    cursor_api_key_set: Boolean(config.cursor_api_key),
  };
}

export function mergeConfig(
  current: CalicoConfig,
  patch: Record<string, unknown>,
): { config: CalicoConfig; restart: boolean } {
  const merged = { ...current };
  if ("port" in patch) merged.port = boundedInt(patch.port, 1, 65535);
  if ("cursor_poll_seconds" in patch) merged.cursor_poll_seconds = boundedInt(patch.cursor_poll_seconds, 5, 86400);
  if ("webhook_token" in patch) merged.webhook_token = String(patch.webhook_token);
  if ("cursor_api_key" in patch) merged.cursor_api_key = String(patch.cursor_api_key);
  return { config: merged, restart: merged.port !== current.port };
}

const WIFI_KEYS = ["ssid", "pass", "password", "passphrase", "psk", "wifi", "wifi_ssid", "wifi_password", "wifi_pass"];
const PANEL_URL_MAX = 127;
const PANEL_TOKEN_MAX = 127;

function plainText(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) throw new BadInput("bad panel");
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 32 || code > 126 || ch === '"' || ch === "\\") throw new BadInput("bad panel");
  }
  return value;
}

function panelUrl(value: unknown): string {
  if (typeof value !== "string") throw new BadInput("bad panel");
  const url = plainText(value.replace(/\/+$/, ""), PANEL_URL_MAX);
  if (!url.startsWith("http://") && !url.startsWith("https://")) throw new BadInput("bad panel");
  const host = url.split("://", 2)[1]?.split("/", 1)[0] ?? "";
  if (!host || host.includes("@") || host.startsWith(":")) throw new BadInput("bad panel");
  return url;
}

export function panelPublicView(config: CalicoConfig) {
  return { url: config.panel_url, token_set: Boolean(config.panel_token) };
}

export function panelStatusField(config: CalicoConfig): { url: string; token: string } | null {
  return config.panel_url ? { url: config.panel_url, token: config.panel_token } : null;
}

export function mergePanel(current: CalicoConfig, patch: Record<string, unknown>): CalicoConfig {
  if (WIFI_KEYS.some((key) => key in patch)) throw new BadInput("wifi rejected");
  const merged = { ...current };
  if (patch.clear === true) return { ...merged, panel_url: "", panel_token: "" };
  if ("url" in patch) merged.panel_url = panelUrl(patch.url);
  else if (!merged.panel_url) throw new BadInput("bad panel");
  if ("token" in patch) merged.panel_token = plainText(patch.token, PANEL_TOKEN_MAX);
  return merged;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test test/server/config.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): add config load, merge, and panel push with corrupt-file refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: HTTP server and contract replay

**Files:**
- Create: `src/server/http.ts`
- Test: `test/contract/contract.test.ts`, `test/server/http.test.ts`

**Interfaces:**
- Consumes: `DeskStore`, `StoreError`, `FRAME_MAX`, `COLOR_LIMIT`, `ICON_LIMIT`, `clipText`, `clipShape`, `EventIn` (Task 6); `CalicoConfig`, `BadInput`, `mergeConfig`, `mergePanel`, `panelPublicView`, `panelStatusField`, `publicView` (Task 8).
- Produces:

```ts
export interface ServerDeps { store: DeskStore; getConfig(): CalicoConfig; setConfig(next: CalicoConfig): void }
export interface ServerStats { lastPanelPoll: number | null }   // epoch ms of last non-loopback GET /api/status
export function createCompanionServer(deps: ServerDeps): { server: http.Server; stats: ServerStats };
export function asciiJson(payload: unknown): string;
export function isLoopback(address: string | undefined): boolean;
```

- [ ] **Step 1: Write the failing contract test**

`test/contract/contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { defaultConfig, type CalicoConfig } from "../../src/server/config";
import { createCompanionServer } from "../../src/server/http";
import { DeskStore } from "../../src/server/store";

interface Step {
  method: string;
  path: string;
  auth?: boolean;
  headers?: Record<string, string>;
  json?: unknown;
  body_b64?: string;
}
interface Recorded {
  step: Step;
  status: number;
  content_type: string;
  cors: string[];
  json?: unknown;
  body_b64?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalize(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  }
  if (typeof value === "string" && (key === "at" || key === "updated_at")) return "<ts>";
  if (typeof value === "string" && key === "id" && UUID.test(value)) return "<uuid>";
  return value;
}

async function replay(base: string, step: Step): Promise<Omit<Recorded, "step">> {
  const headers: Record<string, string> = { ...(step.headers ?? {}) };
  if (step.auth) headers.Authorization = "Bearer secret";
  let body: string | Buffer | undefined;
  if (step.json !== undefined) {
    body = JSON.stringify(step.json);
    headers["Content-Type"] ??= "application/json";
  } else if (step.body_b64 !== undefined) {
    body = Buffer.from(step.body_b64, "base64");
  }
  const res = await fetch(base + step.path, { method: step.method, headers, body });
  const contentType = res.headers.get("content-type") ?? "";
  const cors = ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers"].map(
    (h) => res.headers.get(h) ?? "",
  );
  const raw = Buffer.from(await res.arrayBuffer());
  const out: Omit<Recorded, "step"> = { status: res.status, content_type: contentType, cors };
  if (contentType.startsWith("application/json")) out.json = JSON.parse(raw.toString("utf8"));
  else if (raw.length) out.body_b64 = raw.toString("base64");
  return out;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/companion.json", import.meta.url), "utf8")) as {
  steps: Recorded[];
};

describe("frozen HTTP contract", () => {
  it("matches the Python companion step for step, including key order", async () => {
    let config: CalicoConfig = { ...defaultConfig(), webhook_token: "secret" };
    const { server } = createCompanionServer({
      store: new DeskStore(),
      getConfig: () => config,
      setConfig: (next) => {
        config = next;
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const [index, recorded] of fixture.steps.entries()) {
        const { step, ...expected } = recorded;
        const actual = await replay(base, step);
        expect(
          `${index} ${step.method} ${step.path} ${JSON.stringify(normalize(actual))}`,
        ).toBe(`${index} ${step.method} ${step.path} ${JSON.stringify(normalize(expected))}`);
      }
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Write the failing unit tests**

`test/server/http.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, type CalicoConfig } from "../../src/server/config";
import { asciiJson, createCompanionServer, isLoopback } from "../../src/server/http";
import { DeskStore } from "../../src/server/store";

let close: (() => void) | null = null;
afterEach(() => close?.());

async function start(config: Partial<CalicoConfig> = {}) {
  let current: CalicoConfig = { ...defaultConfig(), ...config };
  const store = new DeskStore();
  const { server, stats } = createCompanionServer({
    store,
    getConfig: () => current,
    setConfig: (next) => {
      current = next;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  close = () => server.close();
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store, stats };
}

describe("companion server", () => {
  it("escapes non-ASCII like Python", async () => {
    const { base } = await start();
    await fetch(`${base}/api/webhook/grok-bot`, {
      method: "POST",
      body: JSON.stringify({ type: "agent.launched", agent_id: "c3", title: "Café ✓ 🙂" }),
    });
    const raw = Buffer.from(await (await fetch(`${base}/api/status`)).arrayBuffer());
    expect(raw.every((byte) => byte < 0x80)).toBe(true);
    const text = raw.toString("ascii");
    expect(text).toContain("Caf\\u00e9 \\u2713 \\ud83d\\ude42");
  });

  it("keeps panel first and capture before agents", async () => {
    const { base, store } = await start({ panel_url: "http://192.168.4.30:8787", panel_token: "t" });
    for (let i = 0; i < 60; i++) store.applyEvent({ type: "agent.launched", agent_id: `a${i}`, message: "x".repeat(100) });
    store.requestFrame();
    const text = await (await fetch(`${base}/api/status`)).text();
    expect(text.startsWith('{"panel":')).toBe(true);
    expect(text.indexOf('"capture"')).toBeLessThan(text.indexOf('"agents"'));
    expect(text.indexOf('"capture"')).toBeLessThan(200);
  });

  it("does not count loopback polls as the panel", async () => {
    const { base, stats } = await start();
    await fetch(`${base}/api/status`);
    expect(stats.lastPanelPoll).toBeNull();
  });

  it("rejects an oversized JSON body with 413", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/webhook/grok-bot`, { method: "POST", body: "x".repeat(1024 * 1024 + 1) });
    expect(res.status).toBe(413);
  });

  it("classifies loopback addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("192.168.4.30")).toBe(false);
    expect(isLoopback("::ffff:192.168.4.30")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it("asciiJson leaves ASCII alone", () => {
    expect(asciiJson({ a: "plain", b: 1 })).toBe('{"a":"plain","b":1}');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm test test/contract test/server/http.test.ts`
Expected: FAIL, module `src/server/http` not found.

- [ ] **Step 4: Implement**

`src/server/http.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import {
  BadInput,
  type CalicoConfig,
  mergeConfig,
  mergePanel,
  panelPublicView,
  panelStatusField,
  publicView,
} from "./config";
import {
  COLOR_LIMIT,
  clipShape,
  clipText,
  type DeskStore,
  type EventIn,
  FRAME_MAX,
  ICON_LIMIT,
  StoreError,
} from "./store";

const JSON_MAX = 1024 * 1024;
const POST_PATHS = new Set([
  "/api/webhook/grok-bot",
  "/api/dismiss",
  "/api/unread/dismiss",
  "/api/frame/request",
  "/api/frame",
]);

export interface ServerDeps {
  store: DeskStore;
  getConfig(): CalicoConfig;
  setConfig(next: CalicoConfig): void;
}

export interface ServerStats {
  lastPanelPoll: number | null;
}

/** JSON with non-ASCII escaped as \uXXXX, matching Python's json.dumps. The firmware decodes these. */
export function asciiJson(payload: unknown): string {
  return JSON.stringify(payload).replace(
    /[\u0080-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

function pyStr(value: unknown, fallback = ""): string {
  if (value === undefined) return fallback;
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function eventIn(payload: Record<string, unknown>): EventIn {
  return {
    type: pyStr(payload.type),
    agent_id: pyStr(payload.agent_id),
    title: pyStr(payload.title),
    message: pyStr(payload.message),
    source: pyStr(payload.source, "grok-bot"),
    color: clipText(payload.color, COLOR_LIMIT),
    shape: clipShape(payload.shape),
    icon: clipText(payload.icon, ICON_LIMIT),
  };
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(bytes.length),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(bytes);
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  send(res, status, asciiJson(payload), "application/json");
}

function empty(res: http.ServerResponse): void {
  send(res, 204, "", "text/plain");
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | "too_big"> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) {
    req.resume();
    return "too_big";
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) {
      req.resume();
      return "too_big";
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null | "too_big"> {
  const raw = await readBody(req, JSON_MAX);
  if (raw === "too_big") return raw;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8") || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createCompanionServer(deps: ServerDeps): { server: http.Server; stats: ServerStats } {
  const stats: ServerStats = { lastPanelPoll: null };
  const { store } = deps;

  function allowed(req: http.IncomingMessage): boolean {
    const expected = deps.getConfig().webhook_token;
    if (!expected) return true;
    const got = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(`Bearer ${expected}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://calico").pathname;
    const method = req.method ?? "GET";

    if (method === "OPTIONS") return empty(res);

    if (method === "GET") {
      if (path === "/api/frame") {
        const frame = store.frame();
        return frame ? send(res, 200, frame, "image/bmp") : json(res, 404, { error: "not found" });
      }
      if (path === "/api/status") {
        if (!isLoopback(req.socket.remoteAddress)) stats.lastPanelPoll = Date.now();
        const body = store.status();
        const panel = panelStatusField(deps.getConfig());
        // First key: the panel buffer is 16 KB and drops the tail.
        return json(res, 200, panel ? { panel, ...body } : body);
      }
      if (path === "/api/panel") return json(res, 200, panelPublicView(deps.getConfig()));
      if (path === "/api/config") return json(res, 200, publicView(deps.getConfig()));
      return json(res, 404, { error: "not found" });
    }

    if (method === "POST") {
      if (!POST_PATHS.has(path)) return json(res, 404, { error: "not found" });
      if (!allowed(req)) return json(res, 401, { error: "unauthorized" });
      if (path === "/api/dismiss") {
        const raw = await readBody(req, JSON_MAX);
        if (raw === "too_big") return json(res, 413, { error: "too large" });
        let agentId = "";
        if (raw.length) {
          let payload: unknown;
          try {
            payload = JSON.parse(raw.toString("utf8"));
          } catch {
            return json(res, 400, { error: "bad json" });
          }
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return json(res, 400, { error: "bad json" });
          }
          const id = (payload as Record<string, unknown>).agent_id;
          agentId = typeof id === "string" ? id : "";
        }
        store.dismiss(agentId);
        return empty(res);
      }
      if (path === "/api/unread/dismiss") {
        store.clearUnread();
        return empty(res);
      }
      if (path === "/api/frame/request") {
        store.requestFrame();
        return empty(res);
      }
      if (path === "/api/frame") {
        const kind = (req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
        if (kind !== "image/bmp") return json(res, 415, { error: "bmp required" });
        const raw = await readBody(req, FRAME_MAX);
        if (raw === "too_big") return json(res, 413, { error: "too large" });
        const saved = store.saveFrame(raw);
        if (saved === "too_big") return json(res, 413, { error: "too large" });
        if (saved !== "ok") return json(res, 400, { error: "bad bmp" });
        return empty(res);
      }
      const payload = await readJson(req);
      if (payload === "too_big") return json(res, 413, { error: "too large" });
      if (payload === null) return json(res, 400, { error: "bad json" });
      try {
        return json(res, 201, store.applyEvent(eventIn(payload)));
      } catch (err) {
        if (err instanceof StoreError) return json(res, 400, { error: "bad event" });
        throw err;
      }
    }

    if (method === "PUT") {
      if (path !== "/api/config" && path !== "/api/panel") return json(res, 404, { error: "not found" });
      if (!allowed(req)) return json(res, 401, { error: "unauthorized" });
      const payload = await readJson(req);
      if (payload === "too_big") return json(res, 413, { error: "too large" });
      if (payload === null) return json(res, 400, { error: "bad json" });
      if (path === "/api/panel") {
        try {
          deps.setConfig(mergePanel(deps.getConfig(), payload));
        } catch (err) {
          if (err instanceof BadInput) return json(res, 400, { error: "bad panel" });
          throw err;
        }
        return json(res, 200, panelPublicView(deps.getConfig()));
      }
      try {
        const { config, restart } = mergeConfig(deps.getConfig(), payload);
        deps.setConfig(config);
        return json(res, 200, { ...publicView(config), restart_required: restart });
      } catch (err) {
        if (err instanceof BadInput) return json(res, 400, { error: "bad config" });
        throw err;
      }
    }

    return json(res, 404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.destroy();
    });
  });
  return { server, stats };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test test/contract test/server/http.test.ts`
Expected: all passed. If the contract test fails, the assertion message shows the step index and both normalized bodies. Fix `http.ts` or `store.ts` until they match. Never edit `fixtures/companion.json` by hand.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): add node:http companion server matching the frozen contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Cursor poller

**Files:**
- Create: `src/server/cursor-poll.ts`
- Test: `test/server/cursor-poll.test.ts`

**Interfaces:**
- Consumes: `DeskStore.applyCursorItem`, `clipText`, `clipShape`, `COLOR_LIMIT`, `ICON_LIMIT`, `isoSeconds` (Task 6); `CalicoConfig` (Task 8).
- Produces: `mapCursorStatus(status: string): "running" | "idle" | null`, `pollOnce(store, apiKey, get, now, warn?): Promise<void>`, `fetchGet(url, apiKey): Promise<string>`, `startCursorPoll(store, getConfig): () => void`.

- [ ] **Step 1: Write the failing tests**

`test/server/cursor-poll.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mapCursorStatus, pollOnce } from "../../src/server/cursor-poll";
import { DeskStore } from "../../src/server/store";

const NOW = "2026-10-07T12:00:00Z";

describe("cursor poll", () => {
  it("maps statuses", () => {
    expect(mapCursorStatus("active")).toBe("running");
    expect(mapCursorStatus("IDLE")).toBe("idle");
    expect(mapCursorStatus("archived")).toBe("idle");
    expect(mapCursorStatus("error")).toBeNull();
  });

  it("applies items and forwards identity", async () => {
    const store = new DeskStore({ now: () => new Date(NOW) });
    const body = JSON.stringify({
      items: [
        { id: "c1", name: "Fix tests", status: "ACTIVE", color: "#9bb57a", shape: "Square" },
        { id: "", name: "skip", status: "ACTIVE" },
        { id: "c2", name: "weird", status: "ERROR" },
        "junk",
      ],
    });
    await pollOnce(store, "key", async () => body, NOW);
    expect(store.status().agents).toMatchObject([{ id: "c1", title: "Fix tests", status: "running", color: "#9bb57a", shape: "square" }]);
  });

  it("does nothing without a key", async () => {
    const get = vi.fn();
    await pollOnce(new DeskStore(), "", get, NOW);
    expect(get).not.toHaveBeenCalled();
  });

  it("logs a transport error and keeps going", async () => {
    const warn = vi.fn();
    await pollOnce(new DeskStore(), "key", async () => { throw new Error("boom"); }, NOW, warn);
    expect(warn).toHaveBeenCalledWith("cursor poll failed: boom");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/server/cursor-poll.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/server/cursor-poll.ts`:

```ts
import type { CalicoConfig } from "./config";
import { COLOR_LIMIT, clipShape, clipText, type DeskStore, ICON_LIMIT, isoSeconds } from "./store";

export const AGENTS_URL = "https://api.cursor.com/v1/agents?limit=20";

export function mapCursorStatus(status: string): "running" | "idle" | null {
  const key = status.toUpperCase();
  if (key === "ACTIVE") return "running";
  if (key === "IDLE" || key === "ARCHIVED") return "idle";
  return null;
}

export async function pollOnce(
  store: DeskStore,
  apiKey: string,
  get: (url: string, apiKey: string) => Promise<string>,
  now: string,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  if (!apiKey) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await get(AGENTS_URL, apiKey));
  } catch (err) {
    warn(`cursor poll failed: ${(err as Error).message}`);
    return;
  }
  const items = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).items : undefined;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mapped = mapCursorStatus(String(row.status ?? ""));
    const agentId = String(row.id ?? "");
    if (!mapped || !agentId) continue;
    store.applyCursorItem(
      agentId,
      String(row.name ?? ""),
      mapped,
      now,
      clipText(row.color, COLOR_LIMIT),
      clipShape(row.shape),
      clipText(row.icon, ICON_LIMIT),
    );
  }
}

export async function fetchGet(url: string, apiKey: string): Promise<string> {
  const basic = Buffer.from(`${apiKey}:`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Polls until the returned stop function is called. Reads the key and interval fresh each round. */
export function startCursorPoll(store: DeskStore, getConfig: () => CalicoConfig): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const round = async () => {
    const config = getConfig();
    await pollOnce(store, config.cursor_api_key, fetchGet, isoSeconds(new Date()));
    if (!stopped) timer = setTimeout(() => void round(), Math.max(5, config.cursor_poll_seconds) * 1000);
  };
  void round();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test test/server/cursor-poll.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): poll Cursor agents into the store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Port selection

**Files:**
- Create: `src/server/port.ts`
- Test: `test/server/port.test.ts`

**Interfaces:**
- Produces: `PORT_SPAN = 12`, `class PortsBusyError extends Error { first: number; last: number }`, `listenWithFallback(server: http.Server, host: string, preferred: number, span?: number): Promise<number>`, `resolvePort(existed: boolean, configured: number, bound: number): { persist: boolean; drift: boolean }`, `lanUrls(port: number, ifaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[]`.

- [ ] **Step 1: Write the failing tests**

`test/server/port.test.ts`:

```ts
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { lanUrls, listenWithFallback, PortsBusyError, resolvePort } from "../../src/server/port";

async function occupy(): Promise<{ port: number; close: () => void }> {
  const s = http.createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return { port: (s.address() as AddressInfo).port, close: () => s.close() };
}

describe("port selection", () => {
  it("moves past a busy port", async () => {
    const busy = await occupy();
    const server = http.createServer();
    try {
      const port = await listenWithFallback(server, "127.0.0.1", busy.port);
      expect(port).toBeGreaterThan(busy.port);
      expect(port).toBeLessThanOrEqual(busy.port + 12);
    } finally {
      server.close();
      busy.close();
    }
  });

  it("throws PortsBusyError when the whole span is taken", async () => {
    const busy = await occupy();
    const server = http.createServer();
    try {
      await expect(listenWithFallback(server, "127.0.0.1", busy.port, 0)).rejects.toBeInstanceOf(PortsBusyError);
    } finally {
      busy.close();
    }
  });

  it("persists the bound port on first run", () => {
    expect(resolvePort(false, 8787, 8788)).toEqual({ persist: true, drift: false });
  });

  it("does not persist a fallback over a saved port", () => {
    expect(resolvePort(true, 8787, 8789)).toEqual({ persist: false, drift: true });
    expect(resolvePort(true, 8787, 8787)).toEqual({ persist: false, drift: false });
  });

  it("lists non-internal IPv4 addresses", () => {
    const ifaces = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wlan0: [
        { address: "192.168.4.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
    } as unknown as NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>;
    expect(lanUrls(8787, ifaces)).toEqual(["http://192.168.4.20:8787"]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/server/port.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/server/port.ts`:

```ts
import type http from "node:http";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

export const PORT_SPAN = 12;

export class PortsBusyError extends Error {
  constructor(
    readonly first: number,
    readonly last: number,
  ) {
    super(`Ports ${first} to ${last} are all in use.`);
  }
}

function listenOnce(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function listenWithFallback(
  server: http.Server,
  host: string,
  preferred: number,
  span = PORT_SPAN,
): Promise<number> {
  const last = Math.min(preferred + span, 65535);
  for (let port = preferred; port <= last; port++) {
    try {
      await listenOnce(server, host, port);
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new PortsBusyError(preferred, last);
}

/**
 * First run keeps whatever port bound. After that the saved port is what the
 * panel was told, so a fallback is drift to report, never something to save.
 */
export function resolvePort(existed: boolean, configured: number, bound: number): { persist: boolean; drift: boolean } {
  if (!existed) return { persist: true, drift: false };
  return { persist: false, drift: bound !== configured };
}

export function lanUrls(port: number, ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  return Object.values(ifaces)
    .flatMap((list) => list ?? [])
    .filter((info) => info.family === "IPv4" && !info.internal)
    .map((info) => `http://${info.address}:${port}`);
}
```

- [ ] **Step 4: Run all tests and checks**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit and open the Phase B pull request**

```bash
git add -A
git commit -m "feat(server): pick a free port and report drift instead of saving it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/server
gh pr create --title "Companion server in TypeScript" --body "$(cat <<'EOF'
Ports the grokbot-buddy Python companion to src/server (no Electron imports).

- DeskStore, snapshot persistence, config with panel push, node:http server, Cursor poller, port fallback.
- test/contract replays 35 requests captured from the Python companion and compares bodies, status codes, CORS headers, and key order.

Spec: docs/superpowers/specs/2026-10-07-calico-core-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then mark the pull request ready for review (`gh pr ready`), wait for `ci` and Bugbot, and stop for the user to review and merge.

---

## Phase C: App shell (branch `feat/app-shell`)

Start: `git switch main && git pull && git switch -c feat/app-shell`

### Task 12: Main process lifecycle, tray, autostart

**Files:**
- Create: `src/main/tray.ts`, `src/main/autostart.ts`, `src/main/ipc.ts`, `resources/icon.png`, `resources/tray.png`
- Modify: `src/main/index.ts` (replace), `src/preload/index.ts` (replace), `src/shared/ipc.ts` (replace)
- Test: `test/main/autostart.test.ts`

**Interfaces:**
- Consumes: everything in `src/server/`.
- Produces `src/shared/ipc.ts` (complete; later tasks only add handlers in main, never change these types):

```ts
export interface Candidate { id: string; name: string }
export interface ServerErrorInfo { first: number; last: number; holders: string[] }
export interface CalicoInfo {
  serverUrl: string | null;      // http://127.0.0.1:<port>, null if the server could not bind
  port: number | null;           // bound port
  expectedPort: number;          // saved port the panel was told
  lanUrls: string[];
  lastPanelPoll: number | null;  // epoch ms
  webhookToken: string;
  serverError: ServerErrorInfo | null;
  autostart: { enabled: boolean; available: boolean };
}
export type FirewallKind = "ufw" | "firewalld" | "nftables" | "none";
export interface FirewallInfo { kind: FirewallKind; command: string | null }
export interface SerialAccess { denied: string[]; group: string; command: string }
export interface FixResult { ok: boolean; output: string }
export interface CalicoApi {
  info(): Promise<CalicoInfo>;
  onBleCandidates(cb: (list: Candidate[]) => void): () => void;
  chooseBle(id: string): void;               // "" cancels
  onSerialCandidates(cb: (list: Candidate[]) => void): () => void;
  chooseSerial(id: string): void;            // "" cancels
  firewall(): Promise<FirewallInfo>;
  serialAccess(): Promise<SerialAccess>;
  runFix(fix: "firewall" | "serial"): Promise<FixResult>;
  portHolders(port: number): Promise<string[]>;
  adoptPort(): Promise<void>;                // save the bound port after the panel was re-pointed
  setAutostart(on: boolean): Promise<boolean>;
}
```

- `src/main/autostart.ts`: `autostartPath(): string`, `desktopEntry(exec: string): string`, `autostartAvailable(): boolean`, `isAutostart(): boolean`, `setAutostart(on: boolean): boolean`.
- `src/main/ipc.ts`: `registerIpc(deps: IpcDeps): void` where `IpcDeps = { info(): CalicoInfo; boundPort(): number | null; adoptPort(): void }`. Task 18 adds handlers here.

- [ ] **Step 1: Write the failing autostart test**

`test/main/autostart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { desktopEntry } from "../../src/main/autostart";

describe("autostart entry", () => {
  it("starts hidden and quotes paths with spaces", () => {
    const entry = desktopEntry("/opt/My Apps/Calico.AppImage");
    expect(entry).toContain('Exec="/opt/My Apps/Calico.AppImage" --hidden\n');
    expect(entry).toContain("Type=Application\n");
    expect(entry).toContain("X-GNOME-Autostart-enabled=true\n");
  });

  it("leaves simple paths bare", () => {
    expect(desktopEntry("/usr/bin/calico")).toContain("Exec=/usr/bin/calico --hidden\n");
  });
});
```

`autostart.ts` imports `electron` for `app.isPackaged`. Vitest cannot load Electron, so the test file mocks it. Add at the top of the test, before the import of `autostart`:

```ts
import { vi } from "vitest";
vi.mock("electron", () => ({ app: { isPackaged: false } }));
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/main/autostart.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write shared IPC types**

Replace `src/shared/ipc.ts` with the `CalicoApi` block from Interfaces above, plus:

```ts
declare global {
  interface Window {
    calico: CalicoApi;
  }
}
```

- [ ] **Step 4: Implement autostart**

`src/main/autostart.ts`:

```ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";

export function autostartPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "autostart", "calico.desktop");
}

export function desktopEntry(exec: string): string {
  const quoted = /\s/.test(exec) ? `"${exec}"` : exec;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Calico",
    "Comment=Desk panel companion",
    `Exec=${quoted} --hidden`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** Only installed builds have a stable executable path to start at login. */
export function autostartAvailable(): boolean {
  return process.platform === "linux" && app.isPackaged;
}

export function isAutostart(): boolean {
  return existsSync(autostartPath());
}

export function setAutostart(on: boolean): boolean {
  if (!autostartAvailable()) return false;
  const path = autostartPath();
  if (!on) {
    rmSync(path, { force: true });
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, desktopEntry(process.env.APPIMAGE ?? process.execPath));
  return true;
}
```

- [ ] **Step 5: Make the icons**

```bash
mkdir -p resources
magick -size 512x512 xc:'#0c0e09' -fill '#9bb57a' -draw 'circle 256,256 256,96' \
  -fill '#0c0e09' -draw 'circle 200,236 200,212' -draw 'circle 312,236 312,212' resources/icon.png
magick resources/icon.png -resize 32x32 resources/tray.png
file resources/icon.png resources/tray.png
```

Expected: two PNGs, 512x512 and 32x32 (a sage disc with two eyes, echoing the panel's agent marks).

- [ ] **Step 6: Implement the tray**

`src/main/tray.ts`:

```ts
import { clipboard, Menu, nativeImage, Tray } from "electron";
import trayIcon from "../../resources/tray.png?asset";

export interface TrayActions {
  open(): void;
  quit(): void;
}

let tray: Tray | null = null;

export function createTray(actions: TrayActions): void {
  tray = new Tray(nativeImage.createFromPath(trayIcon));
  tray.setToolTip("Calico");
  tray.on("click", actions.open);
  updateTray(actions, null, null);
}

/** lanUrl is null while the server is down. drift names the port the panel expects. */
export function updateTray(actions: TrayActions, lanUrl: string | null, drift: number | null): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = [{ label: "Open Calico", click: actions.open }];
  if (lanUrl) items.push({ label: `Copy ${lanUrl}`, click: () => clipboard.writeText(lanUrl) });
  if (drift !== null) items.push({ label: `Panel expects port ${drift}`, enabled: false });
  items.push({ type: "separator" }, { label: "Quit", click: actions.quit });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
```

- [ ] **Step 7: Implement IPC registration**

`src/main/ipc.ts`:

```ts
import { ipcMain } from "electron";
import type { CalicoInfo } from "../shared/ipc";
import { autostartAvailable, isAutostart, setAutostart } from "./autostart";

export interface IpcDeps {
  info(): CalicoInfo;
  boundPort(): number | null;
  adoptPort(): void;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle("calico:info", () => deps.info());
  ipcMain.handle("calico:adopt-port", () => deps.adoptPort());
  ipcMain.handle("calico:set-autostart", (_e, on: unknown) => (autostartAvailable() ? setAutostart(on === true) : false));
}

export function autostartState(): CalicoInfo["autostart"] {
  return { enabled: isAutostart(), available: autostartAvailable() };
}
```

- [ ] **Step 8: Implement the main entry**

Replace `src/main/index.ts`:

```ts
import { join } from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { ConfigError, type CalicoConfig, loadConfig, saveConfig } from "../server/config";
import { startCursorPoll } from "../server/cursor-poll";
import { createCompanionServer } from "../server/http";
import { lanUrls, listenWithFallback, PortsBusyError, resolvePort } from "../server/port";
import { loadSnapshot, saveSnapshot } from "../server/state-file";
import { DeskStore } from "../server/store";
import type { CalicoInfo, ServerErrorInfo } from "../shared/ipc";
import { autostartAvailable, setAutostart } from "./autostart";
import { autostartState, registerIpc } from "./ipc";
import { createTray, type TrayActions, updateTray } from "./tray";

if (process.env.CALICO_USER_DATA) app.setPath("userData", process.env.CALICO_USER_DATA);

let win: BrowserWindow | null = null;
let quitting = false;

function showWindow(): void {
  if (!win) win = createWindow();
  win.show();
  win.focus();
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0c0e09",
    title: "Calico",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  w.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    w.hide();
  });
  w.webContents.on("will-navigate", (event) => event.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.once("ready-to-show", () => w.show());
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void w.loadFile(join(__dirname, "../renderer/index.html"));
  return w;
}

async function start(): Promise<void> {
  const userData = app.getPath("userData");
  const configPath = join(userData, "config.json");
  const statePath = join(userData, "state.json");

  let loaded: { config: CalicoConfig; existed: boolean };
  try {
    loaded = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      dialog.showErrorBox("Calico cannot start", err.message);
      app.exit(1);
      return;
    }
    throw err;
  }
  let config = loaded.config;
  const save = (next: CalicoConfig) => {
    config = next;
    saveConfig(configPath, config);
  };

  const store = new DeskStore({ snapshot: loadSnapshot(statePath), onChange: (s) => saveSnapshot(statePath, s) });
  const { server, stats } = createCompanionServer({ store, getConfig: () => config, setConfig: save });

  let bound: number | null = null;
  let serverError: ServerErrorInfo | null = null;
  try {
    bound = await listenWithFallback(server, "0.0.0.0", config.port);
    if (resolvePort(loaded.existed, config.port, bound).persist) save({ ...config, port: bound });
  } catch (err) {
    if (!(err instanceof PortsBusyError)) throw err;
    serverError = { first: err.first, last: err.last, holders: [] };
  }
  if (!loaded.existed && autostartAvailable()) setAutostart(true);

  const stopPoll = startCursorPoll(store, () => config);

  const info = (): CalicoInfo => ({
    serverUrl: bound ? `http://127.0.0.1:${bound}` : null,
    port: bound,
    expectedPort: config.port,
    lanUrls: bound ? lanUrls(bound) : [],
    lastPanelPoll: stats.lastPanelPoll,
    webhookToken: config.webhook_token,
    serverError,
    autostart: autostartState(),
  });

  registerIpc({
    info,
    boundPort: () => bound,
    adoptPort: () => {
      if (bound) save({ ...config, port: bound });
    },
  });

  const actions: TrayActions = {
    open: showWindow,
    quit: () => {
      quitting = true;
      app.quit();
    },
  };
  createTray(actions);
  const drift = bound !== null && bound !== config.port ? config.port : null;
  updateTray(actions, info().lanUrls[0] ?? null, drift);

  app.on("before-quit", () => {
    quitting = true;
    stopPoll();
    server.close();
  });

  if (!process.argv.includes("--hidden")) showWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  // Keep running in the tray with no window open.
  app.on("window-all-closed", () => undefined);
  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      dialog.showErrorBox("Calico failed to start", String(err));
      app.exit(1);
    });
}
```

- [ ] **Step 9: Implement the preload bridge**

Replace `src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { CalicoApi, Candidate } from "../shared/ipc";

function subscribe(channel: string, cb: (list: Candidate[]) => void): () => void {
  const handler = (_event: IpcRendererEvent, list: Candidate[]) => cb(list);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: CalicoApi = {
  info: () => ipcRenderer.invoke("calico:info"),
  onBleCandidates: (cb) => subscribe("device:ble-candidates", cb),
  chooseBle: (id) => ipcRenderer.send("device:ble-choose", id),
  onSerialCandidates: (cb) => subscribe("device:serial-candidates", cb),
  chooseSerial: (id) => ipcRenderer.send("device:serial-choose", id),
  firewall: () => ipcRenderer.invoke("calico:firewall"),
  serialAccess: () => ipcRenderer.invoke("calico:serial-access"),
  runFix: (fix) => ipcRenderer.invoke("calico:run-fix", fix),
  portHolders: (port) => ipcRenderer.invoke("calico:port-holders", port),
  adoptPort: () => ipcRenderer.invoke("calico:adopt-port"),
  setAutostart: (on) => ipcRenderer.invoke("calico:set-autostart", on),
};

contextBridge.exposeInMainWorld("calico", api);
```

- [ ] **Step 10: Run tests and the app**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: pass.

Run: `CALICO_USER_DATA=$(mktemp -d) pnpm dev`, then in another terminal: `curl -s http://127.0.0.1:8787/api/status`
Expected: the window opens; curl prints `{"phase":"idle",...}`. Closing the window leaves the tray icon. Tray Quit exits and port 8787 is free (`ss -ltn | grep 8787` prints nothing). Starting a second `pnpm start` while one runs focuses the first window.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(main): run the companion in main with tray, autostart, and single instance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Renderer shell, tokens, and dashboard

**Files:**
- Create: `src/renderer/src/lib/api.ts`, `src/renderer/src/lib/api.test.ts`, `src/renderer/src/lib/use-info.ts`, `src/renderer/src/shell/Sidebar.tsx`, `src/renderer/src/shell/UrlChip.tsx`, `src/renderer/src/shell/ServerErrorPanel.tsx`, `src/renderer/src/dashboard/Dashboard.tsx`, `AgentMark.tsx`, `AgentRows.tsx`, `EventRows.tsx`, `NeedsYouStrip.tsx`, `InjectBar.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.calico.info()` and `CalicoInfo` (Task 12). HTTP routes (Task 9).
- Produces: `configureApi(serverUrl: string, webhookToken: string): void`, `fetchStatus()`, `postWebhook()`, `postDismiss()`, `fetchConfig()`, `putConfig()`, `fetchPanel()`, `putPanel()`, `agentMark()`, `injectBody()`, `useInfo(): CalicoInfo | null`, `type View = "dashboard" | "device" | "console" | "settings"`.

- [ ] **Step 1: Write the failing API tests**

`src/renderer/src/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentMark, configureApi, fetchStatus, injectBody, NEUTRAL_MARK, parseStatus, postDismiss } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("builds a manual inject body with optional identity", () => {
    expect(injectBody("agent.needs_you", "a1", "Pick one", { color: " #9bb57a ", shape: "" })).toEqual({
      type: "agent.needs_you",
      agent_id: "a1",
      title: "a1",
      message: "Pick one",
      source: "manual",
      color: "#9bb57a",
    });
  });

  it("normalizes marks", () => {
    expect(agentMark("9bb57a", "Diamond")).toEqual({ color: "#9bb57a", shape: "diamond" });
    expect(agentMark("red", "blob")).toEqual({ color: NEUTRAL_MARK, shape: "circle" });
  });

  it("parses status and keeps attention and message", () => {
    const status = parseStatus({
      phase: "needs_you",
      needs_you: true,
      unread: 1,
      agents: [{ id: "a1", title: "A", status: "needs_you", attention: true, message: "q" }, { nope: 1 }],
      last_event: null,
      events: [],
    });
    expect(status.agents).toEqual([
      { id: "a1", title: "A", status: "needs_you", attention: true, message: "q", updated_at: "", color: "", shape: "", icon: "" },
    ]);
    expect(status.unread).toBe(1);
  });

  it("uses the configured base URL and token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    configureApi("http://127.0.0.1:8788", "secret");
    await postDismiss();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/api/dismiss",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }),
    );
  });

  it("throws on a bad status body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ nope: true })));
    configureApi("http://127.0.0.1:8787", "");
    await expect(fetchStatus()).rejects.toThrow("bad status");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test src/renderer/src/lib/api.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the API client**

`src/renderer/src/lib/api.ts`:

```ts
export interface DeskAgent {
  id: string;
  title: string;
  status: string;
  attention: boolean;
  message: string;
  updated_at: string;
  color: string;
  shape: string;
  icon: string;
}

export interface DeskEvent {
  id: string;
  type: string;
  agent_id: string;
  title: string;
  message: string;
  source: string;
  at: string;
}

export interface DeskStatus {
  phase: string;
  needs_you: boolean;
  unread: number;
  agents: DeskAgent[];
  last_event: DeskEvent | null;
  events: DeskEvent[];
}

export interface WebhookBody {
  type: string;
  agent_id: string;
  title: string;
  message: string;
  source: string;
  color?: string;
  shape?: string;
}

export interface PublicConfig {
  port: number;
  cursor_poll_seconds: number;
  webhook_token_set: boolean;
  cursor_api_key_set: boolean;
}

export interface ConfigPatch {
  port?: number;
  cursor_poll_seconds?: number;
  webhook_token?: string;
  cursor_api_key?: string;
}

export interface PanelPush {
  url: string;
  token_set: boolean;
}

export interface PanelPatch {
  url?: string;
  token?: string;
  clear?: boolean;
}

export type MarkShape = "circle" | "square" | "diamond" | "triangle";
export const NEUTRAL_MARK = "#a39b88";

let base = "";
let token = "";

export function configureApi(serverUrl: string, webhookToken: string): void {
  base = serverUrl;
  token = webhookToken;
}

function headers(json = true): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function agentMark(color: string, shape: string): { color: string; shape: MarkShape } {
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  const key = shape.trim().toLowerCase();
  const known = key === "square" || key === "diamond" || key === "triangle" || key === "circle" ? key : "circle";
  return { color: hex ? `#${hex[1]}` : NEUTRAL_MARK, shape: known };
}

export function injectBody(
  type: string,
  agentId: string,
  message: string,
  identity: { color?: string; shape?: string } = {},
): WebhookBody {
  const body: WebhookBody = { type, agent_id: agentId, title: agentId, message, source: "manual" };
  const color = identity.color?.trim() ?? "";
  const shape = identity.shape?.trim() ?? "";
  if (color) body.color = color;
  if (shape) body.shape = shape;
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const s = (value: unknown): string => (typeof value === "string" ? value : "");

function eventFrom(value: unknown): DeskEvent | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") return null;
  return {
    id: value.id,
    type: value.type,
    agent_id: s(value.agent_id),
    title: s(value.title),
    message: s(value.message),
    source: s(value.source),
    at: s(value.at),
  };
}

function agentFrom(value: unknown): DeskAgent | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    title: s(value.title),
    status: s(value.status),
    attention: value.attention === true,
    message: s(value.message),
    updated_at: s(value.updated_at),
    color: s(value.color),
    shape: s(value.shape),
    icon: s(value.icon),
  };
}

export function parseStatus(value: unknown): DeskStatus {
  if (!isRecord(value) || typeof value.phase !== "string" || !Array.isArray(value.agents)) {
    throw new Error("bad status");
  }
  return {
    phase: value.phase,
    needs_you: value.needs_you === true,
    unread: typeof value.unread === "number" ? value.unread : 0,
    agents: value.agents.flatMap((item) => agentFrom(item) ?? []),
    last_event: eventFrom(value.last_event),
    events: Array.isArray(value.events) ? value.events.flatMap((item) => eventFrom(item) ?? []) : [],
  };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(res.status === 401 ? "Unauthorized. Check the webhook token in Settings." : `${path} ${res.status}`);
  return res;
}

export async function fetchStatus(): Promise<DeskStatus> {
  return parseStatus(await (await call("/api/status")).json());
}

export async function postWebhook(body: WebhookBody): Promise<void> {
  await call("/api/webhook/grok-bot", { method: "POST", headers: headers(), body: JSON.stringify(body) });
}

export async function postDismiss(agentId = ""): Promise<void> {
  await call("/api/dismiss", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(agentId ? { agent_id: agentId } : {}),
  });
}

export async function fetchConfig(): Promise<PublicConfig> {
  const value: unknown = await (await call("/api/config")).json();
  if (!isRecord(value) || typeof value.port !== "number") throw new Error("bad config");
  return {
    port: value.port,
    cursor_poll_seconds: typeof value.cursor_poll_seconds === "number" ? value.cursor_poll_seconds : 30,
    webhook_token_set: value.webhook_token_set === true,
    cursor_api_key_set: value.cursor_api_key_set === true,
  };
}

export async function putConfig(patch: ConfigPatch): Promise<{ restart_required: boolean }> {
  const value: unknown = await (await call("/api/config", { method: "PUT", headers: headers(), body: JSON.stringify(patch) })).json();
  return { restart_required: isRecord(value) && value.restart_required === true };
}

function panelFrom(value: unknown): PanelPush {
  if (!isRecord(value) || typeof value.url !== "string") throw new Error("bad panel");
  return { url: value.url, token_set: value.token_set === true };
}

export async function fetchPanel(): Promise<PanelPush> {
  return panelFrom(await (await call("/api/panel")).json());
}

export async function putPanel(patch: PanelPatch): Promise<PanelPush> {
  return panelFrom(await (await call("/api/panel", { method: "PUT", headers: headers(), body: JSON.stringify(patch) })).json());
}
```

- [ ] **Step 4: Run the API tests**

Run: `pnpm test src/renderer/src/lib/api.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Tokens and base styles**

Replace `src/renderer/src/styles.css`:

```css
@import "tailwindcss";

@theme {
  --color-glass: #0c0e09;
  --color-surface: #14160f;
  --color-field: #2a2d24;
  --color-stroke: #6d6756;
  --color-selected: #3d4f32;
  --color-sage: #9bb57a;
  --color-cream: #efe7d6;
  --color-muted: #a39b88;
  --color-amber: #e2a23a;
  --color-red: #c4544a;
  --font-sans: system-ui, "Cantarell", "Noto Sans", sans-serif;
  --font-mono: ui-monospace, "JetBrains Mono", "Fira Code", monospace;
}

@layer base {
  html {
    font-feature-settings: "tnum" 1;
    -webkit-font-smoothing: antialiased;
  }
  body {
    @apply bg-glass font-sans text-sm text-cream;
  }
  :focus-visible {
    @apply outline-2 outline-offset-2 outline-sage;
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
      animation: none !important;
    }
  }
}

@layer components {
  .field {
    @apply w-full rounded-md border border-stroke bg-field px-2.5 py-1.5 text-cream outline-none placeholder:text-muted focus:border-cream;
  }
  .btn {
    @apply rounded-md border border-stroke bg-field px-3 py-1.5 text-cream transition-colors duration-150 hover:border-cream disabled:opacity-50;
  }
  .btn-primary {
    @apply border-sage bg-selected;
  }
  .label {
    @apply text-xs text-muted;
  }
  .section-title {
    @apply px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-muted uppercase;
  }
  .row {
    @apply flex items-center gap-3 border-b border-stroke/30 px-4 py-2;
  }
}
```

- [ ] **Step 6: Info hook**

`src/renderer/src/lib/use-info.ts`:

```ts
import { useEffect, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { configureApi } from "./api";

export function useInfo(): CalicoInfo | null {
  const [info, setInfo] = useState<CalicoInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await window.calico.info();
      if (!alive) return;
      configureApi(next.serverUrl ?? "", next.webhookToken);
      setInfo(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return info;
}
```

- [ ] **Step 7: Shell components**

`src/renderer/src/shell/Sidebar.tsx`:

```tsx
import { Cpu, LayoutList, Settings, SquareTerminal } from "lucide-react";
import type { ComponentType } from "react";

export type View = "dashboard" | "device" | "console" | "settings";

const ITEMS: { view: View; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { view: "dashboard", label: "Dashboard", Icon: LayoutList },
  { view: "device", label: "Device", Icon: Cpu },
  { view: "console", label: "Console", Icon: SquareTerminal },
  { view: "settings", label: "Settings", Icon: Settings },
];

export function Sidebar({ view, onSelect, panelOnline }: { view: View; onSelect: (v: View) => void; panelOnline: boolean }) {
  return (
    <nav aria-label="Views" className="flex w-48 shrink-0 flex-col border-r border-stroke/40 bg-surface">
      <p className="px-4 pt-4 pb-3 text-base font-medium">Calico</p>
      <ul>
        {ITEMS.map(({ view: v, label, Icon }) => (
          <li key={v}>
            <button
              type="button"
              aria-current={view === v ? "page" : undefined}
              onClick={() => onSelect(v)}
              className={`w-full px-4 py-2 text-left transition-colors duration-150 ${view === v ? "bg-selected text-cream" : "text-muted hover:text-cream"}`}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="size-4" />
                {label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-auto px-4 py-3 text-xs text-muted">
        <span className={`mr-2 inline-block size-2 rounded-full ${panelOnline ? "bg-sage" : "bg-stroke"}`} aria-hidden="true" />
        {panelOnline ? "Panel online" : "Panel not polling"}
      </p>
    </nav>
  );
}
```

`src/renderer/src/shell/UrlChip.tsx`:

```tsx
import { Copy } from "lucide-react";
import { useState } from "react";

export function UrlChip({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn inline-flex items-center gap-2 font-mono text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={`Copy ${url}`}
    >
      <span>{url}</span>
      <span className="text-muted">{copied ? "Copied" : <Copy className="size-3.5" />}</span>
    </button>
  );
}
```

`src/renderer/src/shell/ServerErrorPanel.tsx`:

```tsx
import type { ServerErrorInfo } from "../../../shared/ipc";

export function ServerErrorPanel({ error }: { error: ServerErrorInfo }) {
  return (
    <section role="alert" className="m-4 border border-red/60 bg-surface p-4">
      <p className="font-medium text-red">The companion server is not running.</p>
      <p className="mt-1 text-muted">
        Ports {error.first} to {error.last} are all in use, so the panel and agent webhooks cannot reach calico. Device setup over USB and Bluetooth still works.
      </p>
      <p className="mt-2 text-muted">Close whatever holds those ports, then quit and reopen calico from the tray.</p>
    </section>
  );
}
```

- [ ] **Step 8: Dashboard components**

`src/renderer/src/dashboard/AgentMark.tsx`:

```tsx
import { agentMark } from "../lib/api";

export function AgentMark({ color, shape }: { color: string; shape: string }) {
  const mark = agentMark(color, shape);
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden="true">
      {mark.shape === "square" ? (
        <rect x="2" y="2" width="12" height="12" rx="2" fill={mark.color} />
      ) : mark.shape === "diamond" ? (
        <path d="M8 1 15 8 8 15 1 8Z" fill={mark.color} />
      ) : mark.shape === "triangle" ? (
        <path d="M8 2 15 14H1Z" fill={mark.color} />
      ) : (
        <circle cx="8" cy="8" r="6.5" fill={mark.color} />
      )}
    </svg>
  );
}
```

`src/renderer/src/dashboard/AgentRows.tsx`:

```tsx
import type { DeskAgent } from "../lib/api";
import { AgentMark } from "./AgentMark";

const STATUS_CLASS: Record<string, string> = { needs_you: "text-amber", running: "text-sage" };

export function AgentRows({ agents }: { agents: DeskAgent[] }) {
  if (agents.length === 0) return <p className="px-4 py-3 text-muted">No agents yet. They appear when a webhook or the Cursor poll reports one.</p>;
  return (
    <ul>
      {agents.map((agent) => (
        <li key={agent.id} className={`row ${agent.attention ? "bg-selected/60" : ""}`}>
          <AgentMark color={agent.color} shape={agent.shape} />
          <span className="shrink-0 font-medium">{agent.title || agent.id}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{agent.message}</span>
          <span className={`shrink-0 text-xs uppercase ${STATUS_CLASS[agent.status] ?? "text-muted"}`}>
            {agent.status.replaceAll("_", " ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

`src/renderer/src/dashboard/EventRows.tsx`:

```tsx
import type { DeskEvent } from "../lib/api";

export function EventRows({ events }: { events: DeskEvent[] }) {
  if (events.length === 0) return <p className="px-4 py-3 text-muted">No events yet.</p>;
  return (
    <ul>
      {events.map((event) => (
        <li key={event.id} className="row">
          <time className="shrink-0 font-mono text-xs text-muted">{event.at.slice(11, 19)}</time>
          <span className={`shrink-0 text-xs ${event.type === "agent.needs_you" ? "text-amber" : "text-muted"}`}>{event.type}</span>
          <span className="min-w-0 flex-1 truncate">{event.title || event.message || event.agent_id}</span>
          <span className="shrink-0 text-xs text-muted">{event.source}</span>
        </li>
      ))}
    </ul>
  );
}
```

`src/renderer/src/dashboard/NeedsYouStrip.tsx`:

```tsx
import type { DeskStatus } from "../lib/api";

export function NeedsYouStrip({ status, onDismiss }: { status: DeskStatus; onDismiss: () => void }) {
  if (!status.needs_you) return null;
  const text = status.last_event?.message || status.last_event?.title || "An agent is waiting on you.";
  return (
    <div role="status" className="flex items-center gap-4 border-b border-amber/60 bg-surface px-4 py-3">
      <span className="text-xs font-medium text-amber uppercase">Needs you</span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <button type="button" className="btn" onClick={onDismiss}>
        Dismiss all
      </button>
    </div>
  );
}
```

`src/renderer/src/dashboard/InjectBar.tsx`:

```tsx
import { useState } from "react";
import { injectBody, postWebhook } from "../lib/api";

const TYPES = ["agent.launched", "agent.needs_you", "agent.finished", "note"] as const;

export function InjectBar({ onSent }: { onSent: () => void }) {
  const [agentId, setAgentId] = useState("demo");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function send(type: string) {
    try {
      await postWebhook(injectBody(type, agentId, message));
      setError("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    }
  }

  return (
    <details className="border-t border-stroke/40">
      <summary className="section-title cursor-pointer">Test events</summary>
      <div className="flex flex-wrap items-end gap-3 px-4 pb-4">
        <label className="label">
          Agent id
          <input className="field mt-1 w-40" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </label>
        <label className="label flex-1">
          Message
          <input className="field mt-1" value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        {TYPES.map((type) => (
          <button key={type} type="button" className="btn" onClick={() => void send(type)}>
            {type.replace("agent.", "")}
          </button>
        ))}
      </div>
      {error ? <p className="px-4 pb-3 text-red">{error}</p> : null}
    </details>
  );
}
```

`src/renderer/src/dashboard/Dashboard.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { type DeskStatus, fetchStatus, postDismiss } from "../lib/api";
import { AgentRows } from "./AgentRows";
import { EventRows } from "./EventRows";
import { InjectBar } from "./InjectBar";
import { NeedsYouStrip } from "./NeedsYouStrip";

export function Dashboard({ serverUrl }: { serverUrl: string }) {
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [refresh, serverUrl]);

  const running = status?.agents.filter((a) => a.status !== "idle").length ?? 0;
  return (
    <div className="flex flex-col">
      {status ? <NeedsYouStrip status={status} onDismiss={() => void postDismiss().then(refresh)} /> : null}
      <div className="flex items-baseline gap-4 px-4 pt-4">
        <h1 className="text-lg font-medium capitalize">{(status?.phase ?? "idle").replace("_", " ")}</h1>
        <span className="text-muted">
          {running}/{status?.agents.length ?? 0} active
        </span>
        {error ? <span className="text-red">{error}</span> : null}
      </div>
      <h2 className="section-title">Agents</h2>
      <AgentRows agents={status?.agents ?? []} />
      <h2 className="section-title">Events</h2>
      <EventRows events={status?.events ?? []} />
      <InjectBar onSent={() => void refresh()} />
    </div>
  );
}
```

- [ ] **Step 9: App layout**

Replace `src/renderer/src/App.tsx`:

```tsx
import { useState } from "react";
import { Dashboard } from "./dashboard/Dashboard";
import { useInfo } from "./lib/use-info";
import { ServerErrorPanel } from "./shell/ServerErrorPanel";
import { Sidebar, type View } from "./shell/Sidebar";
import { UrlChip } from "./shell/UrlChip";

export function App() {
  const info = useInfo();
  const [view, setView] = useState<View>("dashboard");
  const panelOnline = info?.lastPanelPoll != null && Date.now() - info.lastPanelPoll < 10_000;
  const lanUrl = info?.lanUrls[0];

  return (
    <div className="flex h-screen">
      <Sidebar view={view} onSelect={setView} panelOnline={panelOnline} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-stroke/40 px-4 py-2">
          {lanUrl ? <UrlChip url={lanUrl} /> : null}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {info?.serverError ? <ServerErrorPanel error={info.serverError} /> : null}
          {view === "dashboard" && info?.serverUrl ? <Dashboard serverUrl={info.serverUrl} /> : null}
          {view !== "dashboard" ? <p className="p-4 text-muted">Coming in a later task.</p> : null}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Verify in the app**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: pass.

Run: `CALICO_USER_DATA=$(mktemp -d) pnpm dev`. Open Test events, send `launched`, then `needs_you` with a message.
Expected: an agent row appears; the amber Needs you strip shows the message; Dismiss all clears it. No CSP errors in DevTools console. Clicking the URL chip copies the LAN URL.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(renderer): add tool layout with panel tokens and the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Settings view

**Files:**
- Create: `src/renderer/src/settings/SettingsView.tsx`, `ConfigSection.tsx`, `PanelSection.tsx`, `AutostartSection.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `fetchConfig`, `putConfig`, `fetchPanel`, `putPanel` (Task 13), `CalicoInfo.autostart`, `window.calico.setAutostart` (Task 12).
- Produces: `<SettingsView info={CalicoInfo} />`.

- [ ] **Step 1: ConfigSection**

`src/renderer/src/settings/ConfigSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { fetchConfig, type PublicConfig, putConfig } from "../lib/api";

export function ConfigSection() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [port, setPort] = useState("");
  const [poll, setPoll] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const loaded = await fetchConfig();
    setConfig(loaded);
    setPort(String(loaded.port));
    setPoll(String(loaded.cursor_poll_seconds));
  };

  useEffect(() => {
    load().catch((err: unknown) => setNotice(err instanceof Error ? err.message : "Could not load settings"));
  }, []);

  async function save() {
    try {
      const { restart_required } = await putConfig({
        port: Number(port),
        cursor_poll_seconds: Number(poll),
        ...(token !== null ? { webhook_token: token } : {}),
        ...(apiKey !== null ? { cursor_api_key: apiKey } : {}),
      });
      setToken(null);
      setApiKey(null);
      await load();
      setNotice(restart_required ? "Saved. Quit and reopen calico to use the new port." : "Saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <section>
      <h2 className="section-title">Companion</h2>
      <div className="grid max-w-2xl grid-cols-2 gap-3 px-4">
        <label className="label">
          Port
          <input className="field mt-1" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
        <label className="label">
          Cursor poll seconds
          <input className="field mt-1" inputMode="numeric" value={poll} onChange={(e) => setPoll(e.target.value)} />
        </label>
        <label className="label">
          Webhook token
          <input
            type="password"
            className="field mt-1"
            value={token ?? ""}
            placeholder={config?.webhook_token_set ? "Set (type to replace, clear to remove)" : "Not set"}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label className="label">
          Cursor API key
          <input
            type="password"
            className="field mt-1"
            value={apiKey ?? ""}
            placeholder={config?.cursor_api_key_set ? "Set" : "Not set"}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          Save
        </button>
        {notice ? <span role="status" className="text-muted">{notice}</span> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: PanelSection**

`src/renderer/src/settings/PanelSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { fetchPanel, type PanelPush, putPanel } from "../lib/api";

export function PanelSection() {
  const [panel, setPanel] = useState<PanelPush | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchPanel()
      .then((p) => {
        setPanel(p);
        setUrl(p.url);
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : "Could not load panel push"));
  }, []);

  async function apply(patch: Parameters<typeof putPanel>[0]) {
    try {
      const saved = await putPanel(patch);
      setPanel(saved);
      setUrl(saved.url);
      setToken(null);
      setNotice(patch.clear ? "Cleared." : "Saved. The panel applies it on its next successful poll.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <section>
      <h2 className="section-title">Panel push</h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        Sends a companion URL and token to the panel through its status poll. Use this when the panel is already online. For a panel that is offline, use Device.
      </p>
      <div className="grid max-w-2xl grid-cols-2 gap-3 px-4">
        <label className="label">
          Companion URL
          <input className="field mt-1 font-mono" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="label">
          Panel token
          <input
            type="password"
            className="field mt-1"
            value={token ?? ""}
            placeholder={panel?.token_set ? "Set" : "Not set"}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" className="btn btn-primary" onClick={() => void apply({ url, ...(token !== null ? { token } : {}) })}>
          Save
        </button>
        <button type="button" className="btn" onClick={() => void apply({ clear: true })}>
          Clear
        </button>
        {notice ? <span role="status" className="text-muted">{notice}</span> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: AutostartSection and SettingsView**

`src/renderer/src/settings/AutostartSection.tsx`:

```tsx
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";

export function AutostartSection({ autostart }: { autostart: CalicoInfo["autostart"] }) {
  const [enabled, setEnabled] = useState(autostart.enabled);
  return (
    <section>
      <h2 className="section-title">Startup</h2>
      <label className="flex items-center gap-2 px-4 pb-1">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!autostart.available}
          onChange={(e) => void window.calico.setAutostart(e.target.checked).then(setEnabled)}
        />
        Start calico in the tray when I log in
      </label>
      {!autostart.available ? <p className="px-4 text-xs text-muted">Available in installed builds.</p> : null}
    </section>
  );
}
```

`src/renderer/src/settings/SettingsView.tsx`:

```tsx
import type { CalicoInfo } from "../../../shared/ipc";
import { AutostartSection } from "./AutostartSection";
import { ConfigSection } from "./ConfigSection";
import { PanelSection } from "./PanelSection";

export function SettingsView({ info }: { info: CalicoInfo }) {
  return (
    <div className="pb-6">
      {info.serverUrl ? <ConfigSection /> : null}
      {info.serverUrl ? <PanelSection /> : null}
      <AutostartSection autostart={info.autostart} />
    </div>
  );
}
```

- [ ] **Step 4: Route it**

In `src/renderer/src/App.tsx`, import `SettingsView` and replace the placeholder line with:

```tsx
          {view === "settings" && info ? <SettingsView info={info} /> : null}
          {view === "device" || view === "console" ? <p className="p-4 text-muted">Coming in a later task.</p> : null}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`, then `CALICO_USER_DATA=$(mktemp -d) pnpm dev`.
Expected: Settings shows Companion, Panel push, and Startup. Setting a webhook token, then sending a Test event from the Dashboard still works (the token flows through `useInfo`). Changing the port shows the restart notice. `cat $CALICO_USER_DATA/config.json` shows the saved values and `stat -c %a` prints `600`.

- [ ] **Step 6: Commit and open the Phase C pull request**

```bash
git add -A
git commit -m "feat(renderer): add settings for companion, panel push, and startup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/app-shell
gh pr create --title "App shell: main process, dashboard, settings" --body "$(cat <<'EOF'
- Electron main runs the companion server with port fallback, tray, XDG autostart, single instance.
- Renderer uses the panel palette from DESIGN.md: sidebar, dense rows, no cards.
- Settings for companion config, panel push, and login autostart.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr ready
```

Run the UI audit (Task 21 Step 2 commands) on this branch if the skills are installed; otherwise note in the PR that the audit runs in Task 21. Stop for the user to merge.

---

## Phase D: Devices (branch `feat/devices`)

Start: `git switch main && git pull && git switch -c feat/devices`

### Task 15: Command model and BLE link

**Files:**
- Create: `src/renderer/src/device/commands.ts`, `src/renderer/src/device/ble.ts`, `test/parity/ble_desk.h`
- Test: `src/renderer/src/device/commands.test.ts`, `src/renderer/src/device/ble.test.ts`

**Interfaces:**
- Produces (`commands.ts`):

```ts
export const SSID_MAX = 32, PASS_MAX = 64, URL_MAX = 127, TOKEN_MAX = 127;
export interface DeskInfo { name: string; fw: string; ssid: string; url: string; token: "set" | "none" }
export interface Ap { rssi: number; ssid: string }
export type ProbeReason = "auth" | "missing" | "timeout" | "radio" | "other";
export type Cmd =
  | { op: "status" } | { op: "scan" }
  | { op: "verify"; ssid: string; pass: string } | { op: "wifi"; ssid: string; pass: string }
  | { op: "url"; value: string } | { op: "token"; value: string } | { op: "reboot" };
export type Reply = { ok: true; info?: DeskInfo; aps?: Ap[] } | { ok: false; error: string; reason?: ProbeReason };
export interface DeviceLink { kind: "usb" | "ble"; send(cmd: Cmd): Promise<Reply>; close(): void }
export class FieldError extends Error {}
export function validateCmd(cmd: Cmd): void;          // throws FieldError
export function timeoutFor(cmd: Cmd): number;         // 30000 for scan/verify, else 10000
export function secretsOf(cmd: Cmd): string[];        // pass or token values, non-empty
export function parseKv(body: string): Record<string, string>;
export function infoFromKv(kv: Record<string, string>): DeskInfo;
export function parseScan(body: string): { state: string; aps: Ap[] };
export function parseProbe(body: string): { state: string; ssid: string; reason: string };
export function describeProbeFailure(ssid: string, reason: string): string;
export function toReason(value: string): ProbeReason;
```

- Produces (`ble.ts`): `BLE_NAME`, `UUID` map, `interface Gatt { read(uuid: string): Promise<string>; write(uuid: string, data: Uint8Array): Promise<void>; disconnect(): void }`, `class BleLink implements DeviceLink { constructor(gatt: Gatt, sleep?: (ms: number) => Promise<void>, now?: () => number) }`, `connectBle(onClosed: () => void): Promise<BleLink>`.

- [ ] **Step 1: Vendor the firmware header**

```bash
mkdir -p test/parity
{ echo "/* Vendored from grokbot-buddy@$(git -C /home/jonn/src/grokbot-buddy rev-parse --short HEAD) firmware/main/ble_desk.h."
  echo " * grokbot-buddy is private, so CI cannot fetch it. Refresh this copy when the firmware protocol changes. */"
  cat /home/jonn/src/grokbot-buddy/firmware/main/ble_desk.h; } > test/parity/ble_desk.h
head -3 test/parity/ble_desk.h
```

- [ ] **Step 2: Write the failing command tests**

`src/renderer/src/device/commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  describeProbeFailure,
  FieldError,
  infoFromKv,
  parseKv,
  parseProbe,
  parseScan,
  secretsOf,
  timeoutFor,
  validateCmd,
} from "./commands";

describe("validateCmd", () => {
  it.each([
    { op: "url", value: "ftp://x" },
    { op: "url", value: "http://" },
    { op: "url", value: `http://${"h".repeat(125)}` },
    { op: "url", value: "http://h\n" },
    { op: "token", value: "t".repeat(128) },
    { op: "wifi", ssid: "", pass: "" },
    { op: "wifi", ssid: "s".repeat(33), pass: "" },
    { op: "verify", ssid: "home", pass: "short" },
    { op: "verify", ssid: "home", pass: "p".repeat(65) },
    { op: "verify", ssid: "ho\0me", pass: "" },
  ] as const)("rejects %j", (cmd) => {
    expect(() => validateCmd(cmd)).toThrow(FieldError);
  });

  it.each([
    { op: "url", value: "http://192.168.4.20:8787" },
    { op: "token", value: "" },
    { op: "verify", ssid: "home", pass: "" },
    { op: "verify", ssid: "café", pass: "12345678" },
    { op: "status" },
  ] as const)("accepts %j", (cmd) => {
    expect(() => validateCmd(cmd)).not.toThrow();
  });

  it("counts bytes, not characters", () => {
    expect(() => validateCmd({ op: "wifi", ssid: "é".repeat(17), pass: "" })).toThrow(FieldError);
  });
});

describe("parsers", () => {
  it("reads the status body", () => {
    const kv = parseKv("name=grokbot-buddy\nfw=1.2\nssid=none\nurl=http://h:8787\ntoken=set\n");
    expect(infoFromKv(kv)).toEqual({ name: "grokbot-buddy", fw: "1.2", ssid: "", url: "http://h:8787", token: "set" });
  });

  it("reads a scan and sorts by signal", () => {
    expect(parseScan("state=ready\n-70\tfar\n-40\tnear\nbad line\n-50\t\n")).toEqual({
      state: "ready",
      aps: [
        { rssi: -40, ssid: "near" },
        { rssi: -70, ssid: "far" },
      ],
    });
  });

  it("reads a probe", () => {
    expect(parseProbe("state=fail\nssid=home\nreason=auth\n")).toEqual({ state: "fail", ssid: "home", reason: "auth" });
    expect(describeProbeFailure("home", "auth")).toBe("Could not join home. The password was rejected. Nothing was saved.");
  });

  it("knows timeouts and secrets", () => {
    expect(timeoutFor({ op: "scan" })).toBe(30_000);
    expect(timeoutFor({ op: "url", value: "http://h" })).toBe(10_000);
    expect(secretsOf({ op: "verify", ssid: "home", pass: "hunter22" })).toEqual(["hunter22"]);
    expect(secretsOf({ op: "token", value: "" })).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the failing BLE tests**

`src/renderer/src/device/ble.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BleLink, type Gatt, UUID } from "./ble";

function fakeGatt(reads: Record<string, string[]>, opts: { failWrite?: string } = {}) {
  const writes: [string, string][] = [];
  const gatt: Gatt = {
    async read(uuid) {
      const queue = reads[uuid] ?? [];
      return queue.length > 1 ? (queue.shift() ?? "") : (queue[0] ?? "");
    },
    async write(uuid, data) {
      if (uuid === opts.failWrite) throw new Error("GATT Server is disconnected.");
      writes.push([uuid, new TextDecoder().decode(data)]);
    },
    disconnect() {},
  };
  return { gatt, writes };
}

const instant = async () => undefined;

describe("BleLink", () => {
  it("reads status", async () => {
    const { gatt } = fakeGatt({ [UUID.status]: ["name=grokbot-buddy\nfw=1\nssid=home\nurl=none\ntoken=none\n"] });
    expect(await new BleLink(gatt, instant).send({ op: "status" })).toEqual({
      ok: true,
      info: { name: "grokbot-buddy", fw: "1", ssid: "home", url: "", token: "none" },
    });
  });

  it("writes an empty token as one newline", async () => {
    const { gatt, writes } = fakeGatt({});
    await new BleLink(gatt, instant).send({ op: "token", value: "" });
    expect(writes).toEqual([[UUID.token, "\n"]]);
  });

  it("scans until ready", async () => {
    const { gatt, writes } = fakeGatt({ [UUID.scan]: ["state=busy\n", "state=busy\n", "state=ready\n-40\thome\n"] });
    const reply = await new BleLink(gatt, instant).send({ op: "scan" });
    expect(writes).toEqual([[UUID.scan, "scan"]]);
    expect(reply).toEqual({ ok: true, aps: [{ rssi: -40, ssid: "home" }] });
  });

  it("reports a failed verify with its reason and never writes wifi", async () => {
    const { gatt, writes } = fakeGatt({ [UUID.verify]: ["state=busy\nssid=home\n", "state=fail\nssid=home\nreason=auth\n"] });
    const reply = await new BleLink(gatt, instant).send({ op: "verify", ssid: "home", pass: "wrongpass" });
    expect(reply).toEqual({ ok: false, reason: "auth", error: "Could not join home. The password was rejected. Nothing was saved." });
    expect(writes.map(([uuid]) => uuid)).toEqual([UUID.verify]);
  });

  it("times out a scan that never finishes", async () => {
    let t = 0;
    const { gatt } = fakeGatt({ [UUID.scan]: ["state=busy\n"] });
    const link = new BleLink(gatt, async () => { t += 1000; }, () => t);
    expect(await link.send({ op: "scan" })).toEqual({ ok: false, error: "The desk did not finish scanning in 30 seconds." });
  });

  it("reboot counts a dropped link as success", async () => {
    const { gatt } = fakeGatt({}, { failWrite: UUID.reboot });
    expect(await new BleLink(gatt, instant).send({ op: "reboot" })).toEqual({ ok: true });
  });

  it("turns validation errors into a failed reply", async () => {
    const { gatt, writes } = fakeGatt({});
    const reply = await new BleLink(gatt, instant).send({ op: "url", value: "nope" });
    expect(reply.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("matches the firmware's UUIDs", async () => {
    const { readFileSync } = await import("node:fs");
    const header = readFileSync("test/parity/ble_desk.h", "utf8");
    for (const [key, uuid] of Object.entries(UUID)) {
      const name = key === "svc" ? "SVC" : key.toUpperCase();
      expect(header).toContain(`#define BLE_DESK_UUID_${name} "${uuid}"`);
    }
  });
});
```

- [ ] **Step 4: Run to confirm failure**

Run: `pnpm test src/renderer/src/device`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement commands.ts**

`src/renderer/src/device/commands.ts`:

```ts
export const SSID_MAX = 32;
export const PASS_MAX = 64;
export const URL_MAX = 127;
export const TOKEN_MAX = 127;

export interface DeskInfo {
  name: string;
  fw: string;
  ssid: string;
  url: string;
  token: "set" | "none";
}

export interface Ap {
  rssi: number;
  ssid: string;
}

export type ProbeReason = "auth" | "missing" | "timeout" | "radio" | "other";

export type Cmd =
  | { op: "status" }
  | { op: "scan" }
  | { op: "verify"; ssid: string; pass: string }
  | { op: "wifi"; ssid: string; pass: string }
  | { op: "url"; value: string }
  | { op: "token"; value: string }
  | { op: "reboot" };

export type Reply = { ok: true; info?: DeskInfo; aps?: Ap[] } | { ok: false; error: string; reason?: ProbeReason };

export interface DeviceLink {
  kind: "usb" | "ble";
  send(cmd: Cmd): Promise<Reply>;
  close(): void;
}

export class FieldError extends Error {}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function noBreaks(value: string, label: string): void {
  if (/[\r\n\0]/.test(value)) throw new FieldError(`${label} cannot contain a newline or NUL.`);
}

function checkSsid(ssid: string): void {
  noBreaks(ssid, "SSID");
  if (!ssid) throw new FieldError("SSID is required.");
  if (bytes(ssid) > SSID_MAX) throw new FieldError(`SSID must be at most ${SSID_MAX} bytes.`);
}

function checkPass(pass: string): void {
  noBreaks(pass, "Password");
  const n = bytes(pass);
  if (n > PASS_MAX) throw new FieldError(`Password must be at most ${PASS_MAX} bytes.`);
  if (n > 0 && n < 8) throw new FieldError("Password must be empty (open network) or 8 to 64 bytes.");
}

export function validateCmd(cmd: Cmd): void {
  switch (cmd.op) {
    case "url": {
      noBreaks(cmd.value, "URL");
      const ok = (cmd.value.startsWith("http://") && cmd.value.length > 7) || (cmd.value.startsWith("https://") && cmd.value.length > 8);
      if (!ok) throw new FieldError("URL must start with http:// or https:// and name a host.");
      if (bytes(cmd.value) > URL_MAX) throw new FieldError(`URL must be at most ${URL_MAX} bytes.`);
      return;
    }
    case "token":
      noBreaks(cmd.value, "Token");
      if (bytes(cmd.value) > TOKEN_MAX) throw new FieldError(`Token must be at most ${TOKEN_MAX} bytes.`);
      return;
    case "verify":
    case "wifi":
      checkSsid(cmd.ssid);
      checkPass(cmd.pass);
      return;
    default:
      return;
  }
}

export function timeoutFor(cmd: Cmd): number {
  return cmd.op === "scan" || cmd.op === "verify" ? 30_000 : 10_000;
}

export function secretsOf(cmd: Cmd): string[] {
  if (cmd.op === "verify" || cmd.op === "wifi") return cmd.pass ? [cmd.pass] : [];
  if (cmd.op === "token") return cmd.value ? [cmd.value] : [];
  return [];
}

export function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1).replace(/\r$/, "");
  }
  return out;
}

const orEmpty = (value: string | undefined) => (value === undefined || value === "none" ? "" : value);

export function infoFromKv(kv: Record<string, string>): DeskInfo {
  return {
    name: kv.name ?? "",
    fw: kv.fw ?? "",
    ssid: orEmpty(kv.ssid),
    url: orEmpty(kv.url),
    token: kv.token === "set" ? "set" : "none",
  };
}

export function parseScan(body: string): { state: string; aps: Ap[] } {
  const aps: Ap[] = [];
  for (const line of body.split("\n")) {
    const tab = line.indexOf("\t");
    if (line.startsWith("state=") || tab < 0) continue;
    const rssi = Number.parseInt(line.slice(0, tab), 10);
    const ssid = line.slice(tab + 1).replace(/\r$/, "");
    if (Number.isNaN(rssi) || !ssid) continue;
    aps.push({ rssi, ssid });
  }
  aps.sort((a, b) => b.rssi - a.rssi);
  return { state: parseKv(body).state ?? "", aps };
}

export function parseProbe(body: string): { state: string; ssid: string; reason: string } {
  const kv = parseKv(body);
  return { state: kv.state ?? "", ssid: kv.ssid ?? "", reason: kv.reason ?? "" };
}

export function toReason(value: string): ProbeReason {
  return value === "auth" || value === "missing" || value === "timeout" || value === "radio" ? value : "other";
}

export function describeProbeFailure(ssid: string, reason: string): string {
  const name = ssid || "that network";
  const why: Record<string, string> = {
    auth: " The password was rejected.",
    missing: " The network was not found.",
    timeout: " The network did not answer in time.",
    radio: " The radio was busy.",
  };
  return `Could not join ${name}.${why[reason] ?? ""} Nothing was saved.`;
}
```

- [ ] **Step 6: Implement ble.ts**

`src/renderer/src/device/ble.ts`:

```ts
import {
  type Cmd,
  describeProbeFailure,
  type DeviceLink,
  FieldError,
  infoFromKv,
  parseKv,
  parseProbe,
  parseScan,
  type Reply,
  timeoutFor,
  toReason,
  validateCmd,
} from "./commands";

export const BLE_NAME = "grokbot-buddy";
// Canonical text: grokbot-buddy firmware/main/ble_desk.h (vendored in test/parity).
export const UUID = {
  svc: "8d7c4b10-6e2a-4f91-a3c5-67726f6b6465",
  status: "8d7c4b11-6e2a-4f91-a3c5-67726f6b6465",
  url: "8d7c4b12-6e2a-4f91-a3c5-67726f6b6465",
  token: "8d7c4b13-6e2a-4f91-a3c5-67726f6b6465",
  wifi: "8d7c4b14-6e2a-4f91-a3c5-67726f6b6465",
  reboot: "8d7c4b15-6e2a-4f91-a3c5-67726f6b6465",
  scan: "8d7c4b16-6e2a-4f91-a3c5-67726f6b6465",
  verify: "8d7c4b17-6e2a-4f91-a3c5-67726f6b6465",
} as const;

export interface Gatt {
  read(uuid: string): Promise<string>;
  write(uuid: string, data: Uint8Array): Promise<void>;
  disconnect(): void;
}

const encode = (text: string) => new TextEncoder().encode(text);
const POLL_MS = 1000;

export class BleLink implements DeviceLink {
  readonly kind = "ble" as const;

  constructor(
    private readonly gatt: Gatt,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async send(cmd: Cmd): Promise<Reply> {
    try {
      validateCmd(cmd);
      return await this.run(cmd);
    } catch (err) {
      if (err instanceof FieldError) return { ok: false, error: err.message };
      return { ok: false, error: `Bluetooth: ${(err as Error).message}` };
    }
  }

  close(): void {
    this.gatt.disconnect();
  }

  private async run(cmd: Cmd): Promise<Reply> {
    switch (cmd.op) {
      case "status":
        return { ok: true, info: infoFromKv(parseKv(await this.gatt.read(UUID.status))) };
      case "url":
        await this.gatt.write(UUID.url, encode(cmd.value));
        return { ok: true };
      case "token":
        // A zero-length ATT write is easy to drop. One newline strips to empty on the desk.
        await this.gatt.write(UUID.token, encode(cmd.value === "" ? "\n" : cmd.value));
        return { ok: true };
      case "wifi":
        await this.gatt.write(UUID.wifi, encode(`${cmd.ssid}\n${cmd.pass}`));
        return { ok: true };
      case "reboot":
        try {
          await this.gatt.write(UUID.reboot, encode("reboot"));
        } catch {
          // The desk resets as it handles the write, so the link often drops first.
        }
        return { ok: true };
      case "scan": {
        await this.gatt.write(UUID.scan, encode("scan"));
        const body = await this.pollUntil(UUID.scan, ["ready", "fail"], timeoutFor(cmd));
        if (body === null) return { ok: false, error: "The desk did not finish scanning in 30 seconds." };
        const { state, aps } = parseScan(body);
        return state === "ready" ? { ok: true, aps } : { ok: false, error: "The desk could not scan for networks." };
      }
      case "verify": {
        await this.gatt.write(UUID.verify, encode(`${cmd.ssid}\n${cmd.pass}`));
        const body = await this.pollUntil(UUID.verify, ["ok", "fail"], timeoutFor(cmd));
        if (body === null) return { ok: false, reason: "timeout", error: describeProbeFailure(cmd.ssid, "timeout") };
        const probe = parseProbe(body);
        if (probe.state === "ok") return { ok: true };
        return { ok: false, reason: toReason(probe.reason), error: describeProbeFailure(probe.ssid || cmd.ssid, probe.reason) };
      }
    }
  }

  private async pollUntil(uuid: string, done: string[], timeoutMs: number): Promise<string | null> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const body = await this.gatt.read(uuid);
      if (done.includes(parseKv(body).state ?? "")) return body;
      await this.sleep(POLL_MS);
    }
    return null;
  }
}

export async function connectBle(onClosed: () => void): Promise<BleLink> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: BLE_NAME }],
    optionalServices: [UUID.svc],
  });
  if (!device.gatt) throw new Error("This device has no GATT server.");
  device.addEventListener("gattserverdisconnected", onClosed, { once: true });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(UUID.svc);
  const chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  const char = async (uuid: string) => {
    let c = chars.get(uuid);
    if (!c) {
      c = await service.getCharacteristic(uuid);
      chars.set(uuid, c);
    }
    return c;
  };
  const decoder = new TextDecoder();
  return new BleLink({
    async read(uuid) {
      const view = await (await char(uuid)).readValue();
      return decoder.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    },
    async write(uuid, data) {
      await (await char(uuid)).writeValueWithResponse(data);
    },
    disconnect: () => server.disconnect(),
  });
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test src/renderer/src/device`
Expected: all passed. The UUID parity test reads `test/parity/ble_desk.h` relative to the repo root, which is Vitest's working directory.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(device): add the shared command model and the BLE link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: USB link and protocol doc

**Files:**
- Create: `docs/usb-console-protocol.md`, `src/renderer/src/device/usb.ts`
- Test: `src/renderer/src/device/usb.test.ts`

**Interfaces:**
- Consumes: `Cmd`, `Reply`, `DeviceLink`, `validateCmd`, `timeoutFor`, `secretsOf`, `FieldError`, `toReason`, `DeskInfo`, `Ap` (Task 15).
- Produces: `interface LineTransport { write(line: string): Promise<void>; close(): Promise<void> | void }`, `class LineSplitter { push(chunk: string): string[] }`, `class UsbLink implements DeviceLink { constructor(transport: LineTransport, onLog: (line: string) => void); handleLine(line: string): void }`, `toReply(obj: Record<string, unknown>): Reply`, `connectUsb(onLog: (line: string) => void, onClosed: () => void): Promise<UsbLink>`.

- [ ] **Step 1: Write the protocol doc**

`docs/usb-console-protocol.md`:

```markdown
# USB console protocol

The contract between calico and grokbot-buddy firmware over USB. The firmware side is a separate spec in grokbot-buddy; this file is the source of truth both sides follow.

## Transport

- USB-Serial-JTAG (CDC). Calico opens it at 115200 baud; the baud rate does not matter on CDC.
- UTF-8 text, one message per line, `\n` terminated. A trailing `\r` is ignored.
- Lines longer than 512 bytes are dropped by the firmware with an error reply if the line had an id.

## Requests

One JSON object per line:

```json
{"id": 7, "op": "verify", "ssid": "home", "pass": "hunter22"}
```

| op | fields | behavior |
|---|---|---|
| `status` | none | Reply with `name`, `fw`, `ssid`, `url`, `token` (`"set"` or `"none"`). Empty ssid or url is `""`. |
| `scan` | none | Block until the scan finishes (up to 25 s). Reply with `aps`: up to 16 `{"rssi": -40, "ssid": "home"}`, strongest first. |
| `verify` | `ssid`, `pass` | Associate in RAM without touching NVS. Block up to 20 s. `ok: true` if it joined, else `ok: false` with `reason`. |
| `wifi` | `ssid`, `pass` | Same as the BLE `wifi` write: update the password of an existing SSID and keep its url and token, or append a new one. Calico only sends this after `verify` succeeded. |
| `url` | `value` | Set the global companion URL. |
| `token` | `value` | Set the global bearer token. `""` clears it. |
| `reboot` | none | Reply first, then restart. |

Field limits match `ble_desk.h`: ssid 1 to 32 bytes, pass empty or 8 to 64 bytes, url up to 127 bytes and starting with `http://` or `https://`, token up to 127 bytes. No CR, LF, or NUL in any field. A violation is `ok: false`.

## Replies

```json
{"id": 7, "ok": true}
{"id": 7, "ok": false, "error": "auth failed", "reason": "auth"}
```

- `id` echoes the request. Requests are handled one at a time, in order.
- `reason` (verify only): `auth`, `missing`, `timeout`, `radio`, `other`.
- `error`: short human text.

## Logs

Any line that does not start with `{` is ordinary ESP log output. Calico shows it in the Console pane. The firmware must never log a password or token value. Calico also redacts any secret it sent during the session from log lines, as a second guard.
```

- [ ] **Step 2: Write the failing tests**

`src/renderer/src/device/usb.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineSplitter, toReply, UsbLink } from "./usb";

afterEach(() => vi.useRealTimers());

function link() {
  const sent: string[] = [];
  const logs: string[] = [];
  const usb = new UsbLink(
    {
      async write(line) {
        sent.push(line);
      },
      close() {},
    },
    (line) => logs.push(line),
  );
  return { usb, sent, logs };
}

describe("LineSplitter", () => {
  it("joins partial chunks and strips CR", () => {
    const s = new LineSplitter();
    expect(s.push('{"id":1,')).toEqual([]);
    expect(s.push('"ok":true}\r\nI (12) boot\n')).toEqual(['{"id":1,"ok":true}', "I (12) boot"]);
  });
});

describe("UsbLink", () => {
  it("sends NDJSON and resolves the matching reply", async () => {
    const { usb, sent } = link();
    const pending = usb.send({ op: "url", value: "http://h:8787" });
    await Promise.resolve();
    expect(sent).toEqual(['{"id":1,"op":"url","value":"http://h:8787"}\n']);
    usb.handleLine('{"id":1,"ok":true}');
    expect(await pending).toEqual({ ok: true });
  });

  it("routes non-JSON and unknown ids to the log", () => {
    const { usb, logs } = link();
    usb.handleLine("I (100) wifi: connected");
    usb.handleLine('{"id":99,"ok":true}');
    expect(logs).toEqual(["I (100) wifi: connected", '{"id":99,"ok":true}']);
  });

  it("times out after 10 s", async () => {
    vi.useFakeTimers();
    const { usb } = link();
    const pending = usb.send({ op: "status" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, error: "The desk did not answer in 10 seconds." });
  });

  it("redacts secrets the device echoes", async () => {
    const { usb, logs } = link();
    const pending = usb.send({ op: "verify", ssid: "home", pass: "hunter22" });
    await Promise.resolve();
    usb.handleLine("W (5) wifi: trying home with hunter22");
    usb.handleLine('{"id":1,"ok":true}');
    await pending;
    usb.handleLine("later hunter22 again");
    expect(logs).toEqual(["W (5) wifi: trying home with ••••", "later •••• again"]);
  });

  it("fails pending requests when closed", async () => {
    const { usb } = link();
    const pending = usb.send({ op: "status" });
    usb.close();
    expect(await pending).toEqual({ ok: false, error: "The USB link closed." });
  });

  it("rejects invalid fields without sending", async () => {
    const { usb, sent } = link();
    expect((await usb.send({ op: "wifi", ssid: "", pass: "" })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("maps replies", () => {
    expect(toReply({ ok: true, name: "grokbot-buddy", fw: "1", ssid: "", url: "", token: "none" })).toEqual({
      ok: true,
      info: { name: "grokbot-buddy", fw: "1", ssid: "", url: "", token: "none" },
    });
    expect(toReply({ ok: true, aps: [{ rssi: -40, ssid: "home" }, { bad: 1 }] })).toEqual({ ok: true, aps: [{ rssi: -40, ssid: "home" }] });
    expect(toReply({ ok: false, error: "auth failed", reason: "auth" })).toEqual({ ok: false, error: "auth failed", reason: "auth" });
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm test src/renderer/src/device/usb.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`src/renderer/src/device/usb.ts`:

```ts
import {
  type Ap,
  type Cmd,
  type DeviceLink,
  FieldError,
  type Reply,
  secretsOf,
  timeoutFor,
  toReason,
  validateCmd,
} from "./commands";

export interface LineTransport {
  write(line: string): Promise<void>;
  close(): Promise<void> | void;
}

export class LineSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, ""));
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function toReply(obj: Record<string, unknown>): Reply {
  if (obj.ok !== true) {
    const reply: Reply = { ok: false, error: str(obj.error) || "The desk reported an error." };
    if (typeof obj.reason === "string") reply.reason = toReason(obj.reason);
    return reply;
  }
  const reply: Reply = { ok: true };
  if (typeof obj.name === "string") {
    reply.info = { name: obj.name, fw: str(obj.fw), ssid: str(obj.ssid), url: str(obj.url), token: obj.token === "set" ? "set" : "none" };
  }
  if (Array.isArray(obj.aps)) {
    reply.aps = obj.aps.flatMap((ap): Ap[] =>
      ap && typeof ap === "object" && typeof (ap as Ap).rssi === "number" && typeof (ap as Ap).ssid === "string"
        ? [{ rssi: (ap as Ap).rssi, ssid: (ap as Ap).ssid }]
        : [],
    );
  }
  return reply;
}

interface Pending {
  resolve: (reply: Reply) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class UsbLink implements DeviceLink {
  readonly kind = "usb" as const;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  // Secrets sent this session. Redacted from any log line, even after the reply.
  private readonly secrets = new Set<string>();

  constructor(
    private readonly transport: LineTransport,
    private readonly onLog: (line: string) => void,
  ) {}

  handleLine(line: string): void {
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const entry = typeof obj.id === "number" ? this.pending.get(obj.id) : undefined;
        if (entry && typeof obj.id === "number") {
          clearTimeout(entry.timer);
          this.pending.delete(obj.id);
          entry.resolve(toReply(obj));
          return;
        }
      } catch {
        // Not JSON after all. Fall through to the log.
      }
    }
    this.onLog(this.redact(line));
  }

  async send(cmd: Cmd): Promise<Reply> {
    try {
      validateCmd(cmd);
    } catch (err) {
      return { ok: false, error: (err as FieldError).message };
    }
    for (const secret of secretsOf(cmd)) this.secrets.add(secret);
    const id = this.nextId++;
    const seconds = timeoutFor(cmd) / 1000;
    const reply = new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `The desk did not answer in ${seconds} seconds.` });
      }, timeoutFor(cmd));
      this.pending.set(id, { resolve, timer });
    });
    try {
      await this.transport.write(`${JSON.stringify({ id, ...cmd })}\n`);
    } catch (err) {
      this.settle(id, { ok: false, error: `USB: ${(err as Error).message}` });
    }
    return reply;
  }

  close(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { ok: false, error: "The USB link closed." });
    void this.transport.close();
  }

  private settle(id: number, reply: Reply): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(reply);
  }

  private redact(line: string): string {
    let out = line;
    for (const secret of this.secrets) out = out.split(secret).join("••••");
    return out;
  }
}

export async function connectUsb(onLog: (line: string) => void, onClosed: () => void): Promise<UsbLink> {
  // 0x303a is Espressif. The S3's USB-Serial-JTAG enumerates with it.
  const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
  await port.open({ baudRate: 115200 });
  if (!port.readable || !port.writable) throw new Error("The serial port opened without streams.");
  const writer = port.writable.getWriter();
  const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
  const encoder = new TextEncoder();
  const usb = new UsbLink(
    {
      write: (line) => writer.write(encoder.encode(line)),
      close: async () => {
        await reader.cancel().catch(() => undefined);
        writer.releaseLock();
        await port.close().catch(() => undefined);
      },
    },
    onLog,
  );
  const splitter = new LineSplitter();
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of splitter.push(value)) usb.handleLine(line);
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      usb.close();
      onClosed();
    });
  return usb;
}
```

If `tsc` complains that `TextDecoderStream` does not match `port.readable`'s stream type, cast once at that call: `port.readable.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)`.

- [ ] **Step 5: Run the tests**

Run: `pnpm test src/renderer/src/device && pnpm typecheck`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(device): add the USB NDJSON link and its protocol contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: Pickers, Device view, provisioning, Console

**Files:**
- Create: `src/main/devices.ts`, `src/renderer/src/lib/panel-online.ts`, `src/renderer/src/lib/panel-online.test.ts`, `src/renderer/src/device/Picker.tsx`, `DeviceView.tsx`, `ProvisionFlow.tsx`, `LinkActions.tsx`, `src/renderer/src/console/ConsoleView.tsx`
- Modify: `src/main/index.ts` (call `wireDevicePickers`), `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `connectBle` (Task 15), `connectUsb` (Task 16), `DeviceLink`, `Reply`, `Ap`, `DeskInfo`, `CalicoInfo`, `Candidate`, `window.calico.*` (Task 12).
- Produces: `wireDevicePickers(win: BrowserWindow): void`; `panelOnlineSince(lastPanelPoll: number | null, since: number): boolean`; `<DeviceView info link setLink onLog />`; `<ConsoleView lines onClear />`; App-level state `link: DeviceLink | null`, `log: string[]` (cap 500).

- [ ] **Step 1: Write the failing helper test**

`src/renderer/src/lib/panel-online.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { panelOnlineSince } from "./panel-online";

describe("panelOnlineSince", () => {
  it("needs a poll after the reboot", () => {
    expect(panelOnlineSince(null, 1000)).toBe(false);
    expect(panelOnlineSince(900, 1000)).toBe(false);
    expect(panelOnlineSince(1500, 1000)).toBe(true);
  });
});
```

Run: `pnpm test src/renderer/src/lib/panel-online.test.ts` → FAIL. Then create `src/renderer/src/lib/panel-online.ts`:

```ts
export function panelOnlineSince(lastPanelPoll: number | null, since: number): boolean {
  return lastPanelPoll !== null && lastPanelPoll > since;
}
```

Run again → PASS.

- [ ] **Step 2: Main-side pickers and permissions**

`src/main/devices.ts`:

```ts
import { type BrowserWindow, ipcMain } from "electron";
import type { Candidate } from "../shared/ipc";

/** Electron has no device picker UI. Forward candidates to the renderer and wait for its choice. */
export function wireDevicePickers(win: BrowserWindow): void {
  const contents = win.webContents;
  const session = contents.session;
  let bleCallback: ((id: string) => void) | null = null;
  let serialCallback: ((id: string) => void) | null = null;

  contents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    bleCallback = callback;
    const list: Candidate[] = devices.map((d) => ({ id: d.deviceId, name: d.deviceName || d.deviceId }));
    contents.send("device:ble-candidates", list);
  });
  ipcMain.on("device:ble-choose", (_event, id: unknown) => {
    bleCallback?.(typeof id === "string" ? id : "");
    bleCallback = null;
  });

  session.on("select-serial-port", (event, ports, _wc, callback) => {
    event.preventDefault();
    serialCallback = callback;
    const list: Candidate[] = ports.map((p) => ({ id: p.portId, name: p.displayName || p.portName }));
    contents.send("device:serial-candidates", list);
  });
  ipcMain.on("device:serial-choose", (_event, id: unknown) => {
    serialCallback?.(typeof id === "string" ? id : "");
    serialCallback = null;
  });

  const allowed = new Set(["serial", "clipboard-sanitized-write"]);
  session.setPermissionCheckHandler((wc, permission) => wc === contents && allowed.has(permission));
  session.setDevicePermissionHandler((details) => details.deviceType === "serial");
}
```

In `src/main/index.ts`, import `wireDevicePickers` and call it in `createWindow()` right after `new BrowserWindow(...)`: `wireDevicePickers(w);`.

- [ ] **Step 3: Picker dialog**

`src/renderer/src/device/Picker.tsx`:

```tsx
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import type { Candidate } from "../../../shared/ipc";

type Kind = "ble" | "serial";

export function Picker() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [list, setList] = useState<Candidate[]>([]);

  useEffect(() => {
    const offBle = window.calico.onBleCandidates((next) => {
      setKind("ble");
      setList(next);
    });
    const offSerial = window.calico.onSerialCandidates((next) => {
      setKind("serial");
      setList(next);
    });
    return () => {
      offBle();
      offSerial();
    };
  }, []);

  function choose(id: string) {
    if (kind === "ble") window.calico.chooseBle(id);
    if (kind === "serial") window.calico.chooseSerial(id);
    setKind(null);
    setList([]);
  }

  return (
    <Dialog.Root open={kind !== null} onOpenChange={(open) => !open && choose("")}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-glass/80" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 w-96 -translate-x-1/2 -translate-y-1/2 border border-stroke bg-surface">
          <Dialog.Title className="section-title">{kind === "ble" ? "Bluetooth desks nearby" : "USB serial ports"}</Dialog.Title>
          {list.length === 0 ? (
            <p className="px-4 pb-3 text-muted">{kind === "ble" ? "Scanning. Make sure Bluetooth is on in the panel's Control Center." : "No Espressif ports found. Plug the panel in with a data cable."}</p>
          ) : (
            <ul>
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" className="row w-full text-left hover:bg-selected" onClick={() => choose(c.id)}>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end px-4 py-3">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Link actions (status, URL, token, reboot)**

`src/renderer/src/device/LinkActions.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import type { DeskInfo, DeviceLink } from "./commands";

export function LinkActions({ info, link }: { info: CalicoInfo; link: DeviceLink }) {
  const [desk, setDesk] = useState<DeskInfo | null>(null);
  const [url, setUrl] = useState(info.lanUrls[0] ?? "");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const reply = await link.send({ op: "status" });
    if (reply.ok && reply.info) setDesk(reply.info);
    else if (!reply.ok) setNotice(reply.error);
  };

  useEffect(() => {
    void refresh();
  }, [link]);

  async function setPanelUrl() {
    const reply = await link.send({ op: "url", value: url });
    if (!reply.ok) return setNotice(reply.error);
    if (info.port && url.endsWith(`:${info.port}`)) await window.calico.adoptPort();
    setNotice("URL saved on the desk. It applies after a reboot.");
    await refresh();
  }

  async function sendToken() {
    const reply = await link.send({ op: "token", value: info.webhookToken });
    setNotice(reply.ok ? (info.webhookToken ? "Token sent." : "Token cleared on the desk.") : reply.error);
    await refresh();
  }

  async function reboot() {
    const reply = await link.send({ op: "reboot" });
    setNotice(reply.ok ? "Rebooting the desk." : reply.error);
  }

  return (
    <section>
      <h2 className="section-title">Desk</h2>
      {desk ? (
        <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-y-1 px-4">
          <dt className="text-muted">Firmware</dt>
          <dd>{desk.fw || "unknown"}</dd>
          <dt className="text-muted">Wi-Fi</dt>
          <dd>{desk.ssid || "none"}</dd>
          <dt className="text-muted">Companion</dt>
          <dd className="font-mono">{desk.url || "none"}</dd>
          <dt className="text-muted">Token</dt>
          <dd>{desk.token}</dd>
        </dl>
      ) : (
        <p className="px-4 text-muted">Reading the desk.</p>
      )}
      <div className="flex max-w-2xl items-end gap-3 px-4 pt-3">
        <label className="label flex-1">
          Companion URL for the desk
          <input className="field mt-1 font-mono" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button type="button" className="btn" onClick={() => void setPanelUrl()}>
          Set URL
        </button>
      </div>
      <div className="flex gap-3 px-4 pt-3">
        <button type="button" className="btn" onClick={() => void sendToken()}>
          {info.webhookToken ? "Send webhook token" : "Clear desk token"}
        </button>
        <button type="button" className="btn" onClick={() => void reboot()}>
          Reboot desk
        </button>
      </div>
      {notice ? <p role="status" className="px-4 pt-2 text-muted">{notice}</p> : null}
    </section>
  );
}
```

- [ ] **Step 5: Provisioning flow**

`src/renderer/src/device/ProvisionFlow.tsx`:

```tsx
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { panelOnlineSince } from "../lib/panel-online";
import type { Ap, DeviceLink } from "./commands";

type Stage = "idle" | "scanning" | "pick" | "verifying" | "saving" | "waiting" | "online" | "silent";

export function ProvisionFlow({ info, link, onSilent }: { info: CalicoInfo; link: DeviceLink; onSilent: () => void }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [aps, setAps] = useState<Ap[]>([]);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  async function scan() {
    setError("");
    setStage("scanning");
    const reply = await link.send({ op: "scan" });
    if (!reply.ok) {
      setError(reply.error);
      return setStage("idle");
    }
    setAps(reply.aps ?? []);
    setStage("pick");
  }

  async function connect() {
    setError("");
    setStage("verifying");
    const verify = await link.send({ op: "verify", ssid, pass });
    if (!verify.ok) {
      setError(verify.error);
      return setStage("pick");
    }
    setStage("saving");
    const lan = info.lanUrls[0];
    const steps = [
      link.send.bind(link, { op: "wifi", ssid, pass }),
      ...(lan ? [link.send.bind(link, { op: "url", value: lan })] : []),
      link.send.bind(link, { op: "token", value: info.webhookToken }),
    ];
    for (const step of steps) {
      const reply = await step();
      if (!reply.ok) {
        setError(reply.error);
        return setStage("pick");
      }
    }
    setPass("");
    if (lan) await window.calico.adoptPort();
    const rebootAt = Date.now();
    await link.send({ op: "reboot" });
    setStage("waiting");
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const next = await window.calico.info();
      if (panelOnlineSince(next.lastPanelPoll, rebootAt)) return setStage("online");
    }
    setStage("silent");
    onSilent();
  }

  const busy = stage === "scanning" || stage === "verifying" || stage === "saving" || stage === "waiting";
  return (
    <section>
      <h2 className="section-title">Set up Wi-Fi</h2>
      <p className="max-w-2xl px-4 text-muted">
        The desk tries the network first. A wrong password is not saved. When it joins, calico also sends this computer's URL and the webhook token, then reboots the desk.
      </p>
      <div className="flex max-w-2xl flex-wrap items-end gap-3 px-4 pt-3">
        <button type="button" className="btn" disabled={busy} onClick={() => void scan()}>
          {stage === "scanning" ? "Scanning (up to 30 s)" : "Scan networks"}
        </button>
        {aps.length > 0 ? (
          <label className="label">
            Network
            <select className="field mt-1 w-56" value={ssid} onChange={(e) => setSsid(e.target.value)}>
              <option value="">Choose a network</option>
              {aps.map((ap) => (
                <option key={ap.ssid} value={ap.ssid}>
                  {ap.ssid} ({ap.rssi} dBm)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="label">
          Or type an SSID
          <input className="field mt-1 w-48" value={ssid} onChange={(e) => setSsid(e.target.value)} />
        </label>
        <label className="label">
          Password
          <input type="password" className="field mt-1 w-48" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !ssid} onClick={() => void connect()}>
          {stage === "verifying" ? "Testing (up to 30 s)" : stage === "saving" ? "Saving" : "Test and save"}
        </button>
      </div>
      <p role="status" className="px-4 pt-2">
        {error ? <span className="text-red">{error}</span> : null}
        {stage === "waiting" ? <span className="text-amber">Rebooted. Waiting up to 30 s for the panel to poll calico.</span> : null}
        {stage === "online" ? <span className="text-sage">Panel online.</span> : null}
        {stage === "silent" ? <span className="text-amber">The panel joined Wi-Fi but has not reached calico. See below.</span> : null}
      </p>
    </section>
  );
}
```

- [ ] **Step 6: Device view**

`src/renderer/src/device/DeviceView.tsx`:

```tsx
import { useRef, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { connectBle } from "./ble";
import type { DeviceLink } from "./commands";
import { LinkActions } from "./LinkActions";
import { ProvisionFlow } from "./ProvisionFlow";
import { connectUsb } from "./usb";

interface Props {
  info: CalicoInfo;
  link: DeviceLink | null;
  setLink: (link: DeviceLink | null) => void;
  onLog: (line: string) => void;
}

export function DeviceView({ info, link, setLink, onLog }: Props) {
  const [error, setError] = useState("");
  const [, setAssist] = useState<"firewall" | "serial" | null>(null);
  const manualClose = useRef(false);

  async function open(kind: "usb" | "ble") {
    setError("");
    const lost = () => {
      setLink(null);
      if (manualClose.current) {
        manualClose.current = false;
        return;
      }
      setError("Lost the connection to the desk. Connect again.");
    };
    try {
      setLink(kind === "usb" ? await connectUsb(onLog, lost) : await connectBle(lost));
    } catch (err) {
      const e = err as Error;
      if (e.name === "NotFoundError" || e.name === "AbortError") return; // picker cancelled
      setError(e.message);
      if (kind === "usb") setAssist("serial");
    }
  }

  if (!link) {
    return (
      <div>
        <h2 className="section-title">Connect to the desk</h2>
        <div className="flex gap-3 px-4">
          <button type="button" className="btn btn-primary" onClick={() => void open("usb")}>
            Connect over USB
          </button>
          <button type="button" className="btn" onClick={() => void open("ble")}>
            Connect over Bluetooth
          </button>
        </div>
        <p className="max-w-2xl px-4 pt-2 text-muted">
          USB works with any firmware that has the serial console and is the only way to recover a desk that will not boot. Bluetooth works without a cable once the desk is advertising.
        </p>
        {error ? <p role="alert" className="px-4 pt-2 text-red">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="text-sage">Connected over {link.kind === "usb" ? "USB" : "Bluetooth"}</span>
        <button
          type="button"
          className="btn"
          onClick={() => {
            manualClose.current = true;
            link.close();
            setLink(null);
          }}
        >
          Disconnect
        </button>
      </div>
      <LinkActions info={info} link={link} />
      <ProvisionFlow info={info} link={link} onSilent={() => setAssist("firewall")} />
    </div>
  );
}
```

(The `setAssist` state renders assist panels in Task 18.)

- [ ] **Step 7: Console view**

`src/renderer/src/console/ConsoleView.tsx`:

```tsx
import { useEffect, useRef } from "react";

export function ConsoleView({ lines, usbConnected, onClear }: { lines: string[]; usbConnected: boolean; onClear: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-stroke/40 px-4 py-2">
        <span className="text-muted">{usbConnected ? "Serial output from the desk" : "Connect over USB in Device to see serial output."}</span>
        <button type="button" className="btn ml-auto" onClick={onClear}>
          Clear
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-xs leading-5 whitespace-pre-wrap">
        {lines.join("\n")}
        <div ref={end} />
      </pre>
    </div>
  );
}
```

- [ ] **Step 8: Wire App state**

In `src/renderer/src/App.tsx` add:

```tsx
import { ConsoleView } from "./console/ConsoleView";
import type { DeviceLink } from "./device/commands";
import { DeviceView } from "./device/DeviceView";
import { Picker } from "./device/Picker";
```

Inside `App()` add state:

```tsx
  const [link, setLink] = useState<DeviceLink | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const onLog = (line: string) => setLog((prev) => [...prev.slice(-499), line]);
```

Replace the remaining placeholder line in `<main>` with:

```tsx
          {view === "device" && info ? <DeviceView info={info} link={link} setLink={setLink} onLog={onLog} /> : null}
          {view === "console" ? <ConsoleView lines={log} usbConnected={link?.kind === "usb"} onClear={() => setLog([])} /> : null}
```

and render `<Picker />` once, just before the closing `</div>` of the outer flex container.

- [ ] **Step 9: Verify with hardware**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`, then `pnpm dev`.

Bluetooth (works against current firmware):
1. Device → Connect over Bluetooth. The picker lists `grokbot-buddy`. Choose it.
2. The Desk section shows firmware, Wi-Fi, companion URL, token.
3. Scan networks lists nearby SSIDs strongest first. A wrong password gives "The password was rejected. Nothing was saved."
4. A right password saves, reboots, and within 30 s shows "Panel online".

If `navigator.bluetooth` is undefined, or `requestDevice` rejects with "Web Bluetooth API globally disabled", add `app.commandLine.appendSwitch("enable-experimental-web-platform-features")` on Linux at the top of `src/main/index.ts` (before `app.whenReady`), rebuild, and retry. Note the outcome in the PR description.

USB: blocked until the grokbot-buddy serial console ships. Verify only that Connect over USB opens the picker, lists the board's port, and that serial log lines appear in Console. Commands will time out with "The desk did not answer in 10 seconds." until the firmware lands. Say so in the PR description.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(device): add device pickers, provisioning flow, and serial console

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Assists: firewall, serial permission, port drift

**Files:**
- Create: `src/main/assist.ts`, `src/renderer/src/device/FirewallAssist.tsx`, `src/renderer/src/device/SerialAssist.tsx`, `src/renderer/src/shell/DriftBanner.tsx`
- Modify: `src/main/ipc.ts`, `src/renderer/src/device/DeviceView.tsx`, `src/renderer/src/App.tsx`, `src/main/index.ts` (fill `serverError.holders`)
- Test: `test/main/assist.test.ts`

**Interfaces:**
- Produces (`assist.ts`, no Electron import):

```ts
export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>;
export const execFileP: Exec;
export function detectFirewall(exec: Exec): Promise<FirewallKind>;
export function firewallFix(kind: FirewallKind, port: number): string[] | null;   // argv after pkexec
export function serialGroup(osRelease: string): "uucp" | "dialout";
export function serialFix(group: string, user: string): string[];
export function displayCommand(argv: string[]): string;
export function deniedSerialPorts(devDir?: string): string[];
export function parseSsHolders(stdout: string): string[];
export function portHolders(port: number, exec: Exec): Promise<string[]>;
export function validPort(value: unknown): value is number;
```

- [ ] **Step 1: Write the failing tests**

`test/main/assist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  detectFirewall,
  displayCommand,
  type Exec,
  firewallFix,
  parseSsHolders,
  serialFix,
  serialGroup,
  validPort,
} from "../../src/main/assist";

const fakeExec = (active: string[]): Exec => async (_file, args) => ({
  code: active.includes(args[1] ?? "") ? 0 : 3,
  stdout: active.includes(args[1] ?? "") ? "active\n" : "inactive\n",
});

describe("firewall assist", () => {
  it("detects the active firewall", async () => {
    expect(await detectFirewall(fakeExec(["ufw"]))).toBe("ufw");
    expect(await detectFirewall(fakeExec(["firewalld"]))).toBe("firewalld");
    expect(await detectFirewall(fakeExec(["nftables"]))).toBe("nftables");
    expect(await detectFirewall(fakeExec([]))).toBe("none");
  });

  it("builds fixes only from a valid port", () => {
    expect(firewallFix("ufw", 8787)).toEqual(["ufw", "allow", "8787/tcp", "comment", "calico"]);
    expect(firewallFix("firewalld", 8788)).toEqual([
      "sh",
      "-c",
      "firewall-cmd --permanent --add-port=8788/tcp && firewall-cmd --reload",
    ]);
    expect(firewallFix("nftables", 8787)).toBeNull();
    expect(firewallFix("ufw", 0)).toBeNull();
    expect(firewallFix("ufw", 8787.5)).toBeNull();
  });

  it("displays commands for copying", () => {
    expect(displayCommand(["sudo", "ufw", "allow", "8787/tcp", "comment", "calico"])).toBe("sudo ufw allow 8787/tcp comment calico");
    expect(displayCommand(["sh", "-c", "a && b"])).toBe("sudo sh -c 'a && b'");
  });
});

describe("serial assist", () => {
  it("picks the distro's group", () => {
    expect(serialGroup('NAME="CachyOS Linux"\nID=cachyos\nID_LIKE=arch\n')).toBe("uucp");
    expect(serialGroup("ID=arch\n")).toBe("uucp");
    expect(serialGroup('ID=ubuntu\nID_LIKE="debian"\n')).toBe("dialout");
    expect(serialGroup("")).toBe("dialout");
    expect(serialFix("uucp", "jonn")).toEqual(["usermod", "-aG", "uucp", "jonn"]);
  });
});

describe("port holders", () => {
  it("parses ss output", () => {
    const out = 'LISTEN 0 511 0.0.0.0:8787 0.0.0.0:* users:(("python3",pid=4242,fd=3))\n';
    expect(parseSsHolders(out)).toEqual(["python3 (pid 4242)"]);
    expect(parseSsHolders("")).toEqual([]);
  });

  it("validates ports from IPC", () => {
    expect(validPort(8787)).toBe(true);
    expect(validPort("8787")).toBe(false);
    expect(validPort(70000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test test/main/assist.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement assist.ts**

`src/main/assist.ts`:

```ts
import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FirewallKind } from "../shared/ipc";

export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>;

export const execFileP: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stdout: `${stdout}${stderr}` });
    });
  });

export function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export async function detectFirewall(exec: Exec): Promise<FirewallKind> {
  for (const kind of ["ufw", "firewalld", "nftables"] as const) {
    const { stdout } = await exec("systemctl", ["is-active", kind]);
    if (stdout.trim() === "active") return kind;
  }
  return "none";
}

export function firewallFix(kind: FirewallKind, port: number): string[] | null {
  if (!validPort(port)) return null;
  if (kind === "ufw") return ["ufw", "allow", `${port}/tcp`, "comment", "calico"];
  if (kind === "firewalld") {
    return ["sh", "-c", `firewall-cmd --permanent --add-port=${port}/tcp && firewall-cmd --reload`];
  }
  return null;
}

export function displayCommand(argv: string[]): string {
  if (argv[0] === "sh" && argv[1] === "-c") return `sudo sh -c '${argv[2] ?? ""}'`;
  return argv.join(" ");
}

export function serialGroup(osRelease: string): "uucp" | "dialout" {
  const ids = [...osRelease.matchAll(/^(?:ID|ID_LIKE)=(.*)$/gm)].flatMap((m) => (m[1] ?? "").replace(/"/g, "").split(/\s+/));
  return ids.includes("arch") ? "uucp" : "dialout";
}

export function serialFix(group: string, user: string): string[] {
  return ["usermod", "-aG", group, user];
}

export function deniedSerialPorts(devDir = "/dev"): string[] {
  let names: string[];
  try {
    names = readdirSync(devDir).filter((n) => /^tty(ACM|USB)\d+$/.test(n));
  } catch {
    return [];
  }
  return names
    .map((n) => join(devDir, n))
    .filter((path) => {
      try {
        accessSync(path, constants.R_OK | constants.W_OK);
        return false;
      } catch {
        return true;
      }
    });
}

export function parseSsHolders(stdout: string): string[] {
  return [...stdout.matchAll(/\("([^"]+)",pid=(\d+)/g)].map((m) => `${m[1]} (pid ${m[2]})`);
}

export async function portHolders(port: number, exec: Exec): Promise<string[]> {
  if (!validPort(port)) return [];
  const { stdout } = await exec("ss", ["-ltnpH", `sport = :${port}`]);
  return parseSsHolders(stdout);
}
```

`ss -p` only shows processes owned by the current user without root. That is fine: other users' processes show as an empty list, and the UI says so.

- [ ] **Step 4: Register the IPC handlers**

Append to `registerIpc` in `src/main/ipc.ts` (add the imports `readFileSync` from `node:fs`, `userInfo` from `node:os`, and the assist functions):

```ts
  const osRelease = () => {
    try {
      return readFileSync("/etc/os-release", "utf8");
    } catch {
      return "";
    }
  };

  ipcMain.handle("calico:firewall", async () => {
    const kind = await detectFirewall(execFileP);
    const port = deps.boundPort();
    const argv = port ? firewallFix(kind, port) : null;
    return { kind, command: argv ? displayCommand(argv[0] === "sh" ? argv : ["sudo", ...argv]) : null };
  });

  ipcMain.handle("calico:serial-access", () => {
    const group = serialGroup(osRelease());
    return {
      denied: deniedSerialPorts(),
      group,
      command: displayCommand(["sudo", ...serialFix(group, userInfo().username)]),
    };
  });

  ipcMain.handle("calico:run-fix", async (_e, fix: unknown) => {
    let argv: string[] | null = null;
    if (fix === "firewall") {
      const port = deps.boundPort();
      argv = port ? firewallFix(await detectFirewall(execFileP), port) : null;
    } else if (fix === "serial") {
      argv = serialFix(serialGroup(osRelease()), userInfo().username);
    }
    if (!argv) return { ok: false, output: "Nothing to run for this setup." };
    const { code, stdout } = await execFileP("pkexec", argv);
    return { ok: code === 0, output: stdout.trim() || (code === 0 ? "Done." : `pkexec exited with ${code}.`) };
  });

  ipcMain.handle("calico:port-holders", (_e, port: unknown) => (validPort(port) ? portHolders(port, execFileP) : []));
```

In `src/main/index.ts`, after a `PortsBusyError` is caught, fill the holders:

```ts
    serverError = { first: err.first, last: err.last, holders: await portHolders(err.first, execFileP) };
```

and add `holders` to `ServerErrorPanel`: below the existing paragraphs render

```tsx
      {error.holders.length ? <p className="mt-2 font-mono text-xs">Port {error.first}: {error.holders.join(", ")}</p> : null}
```

- [ ] **Step 5: Firewall and serial assist components**

`src/renderer/src/device/FirewallAssist.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { FirewallInfo, FixResult } from "../../../shared/ipc";

export function FirewallAssist({ port }: { port: number | null }) {
  const [fw, setFw] = useState<FirewallInfo | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);

  useEffect(() => {
    void window.calico.firewall().then(setFw);
  }, []);

  if (!fw) return <p className="px-4 text-muted">Checking for a firewall.</p>;
  return (
    <section className="border-t border-stroke/40">
      <h2 className="section-title">Panel cannot reach calico</h2>
      {fw.kind === "none" ? (
        <p className="max-w-2xl px-4 text-muted">
          No firewall service is active here. Check that the panel and this computer are on the same network, and that the router does not isolate wireless clients.
        </p>
      ) : fw.command ? (
        <div className="px-4">
          <p className="max-w-2xl text-muted">
            {fw.kind} is active and may be blocking TCP port {port}. This command allows it:
          </p>
          <pre className="mt-2 max-w-2xl border border-stroke bg-field px-3 py-2 font-mono text-xs">{fw.command}</pre>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(fw.command ?? "")}>
              Copy
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void window.calico.runFix("firewall").then(setResult)}>
              Run (asks for your password)
            </button>
          </div>
        </div>
      ) : (
        <p className="max-w-2xl px-4 text-muted">
          {fw.kind} is active. Allow inbound TCP port {port} from your LAN in its ruleset, then reboot the desk.
        </p>
      )}
      {result ? <p role="status" className={`px-4 pt-2 ${result.ok ? "text-sage" : "text-red"}`}>{result.output}</p> : null}
    </section>
  );
}
```

`src/renderer/src/device/SerialAssist.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { FixResult, SerialAccess } from "../../../shared/ipc";

const UDEV = 'SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", MODE="0660", TAG+="uaccess"';

export function SerialAssist() {
  const [access, setAccess] = useState<SerialAccess | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);

  useEffect(() => {
    void window.calico.serialAccess().then(setAccess);
  }, []);

  if (!access || access.denied.length === 0) return null;
  return (
    <section className="border-t border-stroke/40">
      <h2 className="section-title">USB permission</h2>
      <p className="max-w-2xl px-4 text-muted">
        Your user cannot open {access.denied.join(", ")}. Add yourself to the {access.group} group, then log out and back in:
      </p>
      <pre className="mx-4 mt-2 max-w-2xl border border-stroke bg-field px-3 py-2 font-mono text-xs">{access.command}</pre>
      <div className="flex gap-3 px-4 pt-2">
        <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(access.command)}>
          Copy
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void window.calico.runFix("serial").then(setResult)}>
          Run (asks for your password)
        </button>
      </div>
      <p className="max-w-2xl px-4 pt-3 text-muted">
        Or, without a group change, save this as /etc/udev/rules.d/60-calico.rules and run sudo udevadm control --reload && sudo udevadm trigger:
      </p>
      <pre className="mx-4 mt-2 max-w-2xl border border-stroke bg-field px-3 py-2 font-mono text-xs">{UDEV}</pre>
      {result ? <p role="status" className={`px-4 pt-2 ${result.ok ? "text-sage" : "text-red"}`}>{result.ok ? "Done. Log out and back in, then connect again." : result.output}</p> : null}
    </section>
  );
}
```

- [ ] **Step 6: Show assists in DeviceView**

In `src/renderer/src/device/DeviceView.tsx`, change `const [, setAssist]` to `const [assist, setAssist]`, import both assist components, and render before the closing tag of **both** return branches:

```tsx
      {assist === "serial" ? <SerialAssist /> : null}
      {assist === "firewall" ? <FirewallAssist port={info.port} /> : null}
```

In the connected branch also add a manual entry point below `ProvisionFlow`:

```tsx
      <button type="button" className="btn mx-4 mt-4" onClick={() => setAssist("firewall")}>
        Panel not connecting?
      </button>
```

- [ ] **Step 7: Drift banner**

`src/renderer/src/shell/DriftBanner.tsx`:

```tsx
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";

export function DriftBanner({ info, onRepoint }: { info: CalicoInfo; onRepoint: () => void }) {
  const [holders, setHolders] = useState<string[] | null>(null);
  if (!info.port || info.port === info.expectedPort) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-amber/60 bg-surface px-4 py-2">
      <span className="text-amber">
        The panel is set to port {info.expectedPort}, but calico is on {info.port} because {info.expectedPort} was busy.
      </span>
      <button type="button" className="btn" onClick={onRepoint}>
        Re-point panel
      </button>
      <button type="button" className="btn" onClick={() => void window.calico.portHolders(info.expectedPort).then(setHolders)}>
        What holds {info.expectedPort}?
      </button>
      {holders ? (
        <span className="font-mono text-xs text-muted">
          {holders.length ? holders.join(", ") : "Nothing you own. It may be another user's process."}
        </span>
      ) : null}
    </div>
  );
}
```

In `App.tsx`, import it and render inside `<main>` before `ServerErrorPanel`:

```tsx
          {info ? <DriftBanner info={info} onRepoint={() => setView("device")} /> : null}
```

`LinkActions` already prefills the LAN URL with the bound port and calls `adoptPort()` after a successful `url` write, which clears the banner on the next info poll.

- [ ] **Step 8: Verify**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`.

Drift: `python3 -m http.server 8787 &` then `CALICO_USER_DATA=<a dir with config.json containing {"port": 8787}> pnpm dev`.
Expected: the amber banner names 8787 and 8788; "What holds 8787?" shows `python3 (pid N)`. Kill the Python server.

Firewall (on a machine with ufw active): Device → Panel not connecting? shows `sudo ufw allow 8787/tcp comment calico`; Run opens the polkit prompt.

- [ ] **Step 9: Commit and open the Phase D pull request**

```bash
git add -A
git commit -m "feat(device): add firewall, serial permission, and port drift assists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/devices
gh pr create --title "Device links: BLE, USB, provisioning, assists" --body "$(cat <<'EOF'
- One command model over Web Bluetooth (existing GATT) and Web Serial (NDJSON, docs/usb-console-protocol.md).
- Provisioning: scan, verify, save, push URL and token, reboot, wait for the first panel poll.
- Assists for firewall, serial group, and port drift. Privileged fixes run through pkexec after a click.

USB commands need the grokbot-buddy serial console, which is not merged yet. Bluetooth was verified on hardware.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr ready
```

Stop for the user to merge.

---

## Phase E: Release (branch `feat/release`)

Start: `git switch main && git pull && git switch -c feat/release`

### Task 19: Electron smoke test in CI

**Files:**
- Create: `playwright.config.ts`, `test/e2e/smoke.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: built app in `out/` (Task 12), `CALICO_USER_DATA` override (Task 12).

- [ ] **Step 1: Write the smoke test**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  reporter: [["list"]],
});
```

`test/e2e/smoke.spec.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("launches, serves status, and renders the dashboard", async () => {
  const userData = mkdtempSync(join(tmpdir(), "calico-e2e-"));
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, CALICO_USER_DATA: userData },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("navigation", { name: "Views" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
    // The e2e tsconfig has no DOM types, so reach the bridge through globalThis.
    const info = await page.evaluate(() =>
      (globalThis as unknown as { calico: { info(): Promise<{ serverUrl: string | null }> } }).calico.info(),
    );
    expect(info.serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const status = await (await fetch(`${info.serverUrl}/api/status`)).json();
    expect(status.phase).toBe("idle");
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run it locally**

Run: `pnpm build && pnpm test:e2e`
Expected: 1 passed. If it fails because 8787 is in use by a running calico, that is fine: the test reads the bound port from `info.serverUrl`.

- [ ] **Step 3: Add it to CI**

Append to the `ci` job steps in `.github/workflows/ci.yml`:

```yaml
      - run: xvfb-run -a pnpm test:e2e
```

Run `scripts/pin-actions.sh` (no new actions, so it should print nothing) and commit.

```bash
git add -A
git commit -m "test: add Electron smoke test and run it in CI under xvfb

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Linux packaging and release workflow

**Files:**
- Create: `electron-builder.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: Packaging config**

`electron-builder.yml`:

```yaml
appId: io.github.newtosh.calico
productName: Calico
directories:
  buildResources: resources
  output: dist
files:
  - out/**
  - package.json
artifactName: ${productName}-${version}-${arch}.${ext}
publish: null
linux:
  target: [AppImage, deb, pacman]
  category: Development
  executableName: calico
  icon: resources/icon.png
  synopsis: Desktop companion for the grokbot-buddy desk panel
  description: Runs the companion server the panel polls, shows agent status, and sets up the panel over USB or Bluetooth.
```

- [ ] **Step 2: Build locally**

Run: `pnpm dist && ls dist`
Expected: `Calico-0.1.0-x86_64.AppImage`, `Calico-0.1.0-amd64.deb` (name may vary by arch label), `Calico-0.1.0-x64.pacman`. Run the AppImage: the tray appears, the window opens, `curl -s http://127.0.0.1:8787/api/status` answers. Settings → Startup is enabled and checked; `cat ~/.config/autostart/calico.desktop` shows the AppImage path with `--hidden`. Uncheck it to remove the entry. Quit from the tray.

- [ ] **Step 3: Release workflow**

`.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
jobs:
  linux:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: sudo apt-get update && sudo apt-get install -y libarchive-tools
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm dist
      - run: cd dist && sha256sum *.AppImage *.deb *.pacman > SHA256SUMS
      - uses: actions/attest-build-provenance@v3
        with:
          subject-path: |
            dist/*.AppImage
            dist/*.deb
            dist/*.pacman
      - run: gh release create "$GITHUB_REF_NAME" --draft --generate-notes --verify-tag dist/*.AppImage dist/*.deb dist/*.pacman dist/SHA256SUMS
        env:
          GH_TOKEN: ${{ github.token }}
```

Run: `scripts/pin-actions.sh && grep -n uses: .github/workflows/release.yml`
Expected: all `uses:` pinned by SHA.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "build: package AppImage, deb, and pacman and draft releases from tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: UI audit pass and README refresh

**Files:**
- Modify: files under `src/renderer/src/` as findings require, `README.md`

- [ ] **Step 1: Install the audit skills (ask the user first)**

Ask the user to approve installing these skills for this project. For each, read the repo's README for its install command before running it:

```bash
gh api repos/pbakaus/impeccable/readme --jq .content | base64 -d | grep -niA4 'install'
gh api repos/ibelick/ui-skills/readme --jq .content | base64 -d | grep -niA4 'install'
gh api repos/emilkowalski/skills/readme --jq .content | base64 -d | grep -niA4 'install'
```

Run the install commands those READMEs give, scoped to the project if they offer a project scope.

- [ ] **Step 2: Run the audits**

With the app running (`pnpm dev`), run Impeccable's audit in product mode with `DESIGN.md` as context, then ui-skills `baseline-ui` and `fixing-accessibility` against `src/renderer/src`, then Emil Kowalski's animation review against any `transition` classes. Collect findings into one list.

- [ ] **Step 3: Fix findings**

Fix every finding that conflicts with `DESIGN.md` or the PR template checklist. For findings that contradict `DESIGN.md` (for example, a suggestion to add cards or a web font), keep the design brief and note the finding as declined in the PR description. Re-run `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

- [ ] **Step 4: Refresh the README**

Take screenshots of Dashboard and Device (`resources/screenshots/dashboard.png`, `device.png`, with no tokens or SSIDs you consider private visible). Add them under "What it does" in `README.md`:

```markdown
![Dashboard](resources/screenshots/dashboard.png)
![Device setup](resources/screenshots/device.png)
```

Change the status line to `> Status: alpha. v0.1 targets Linux.`

- [ ] **Step 5: Commit and open the Phase E pull request**

```bash
git add -A
git commit -m "style(renderer): apply UI audit findings and refresh README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/release
gh pr create --title "Release pipeline, smoke test, UI audit" --body "$(cat <<'EOF'
- Electron smoke test under xvfb in CI.
- electron-builder for AppImage, deb, pacman. Tag pushes build, checksum, attest, and draft a release.
- UI audit findings applied; declined findings listed below with reasons.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr ready
```

After the user merges, they tag the release themselves:

```bash
git switch main && git pull
git tag -s v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Then they review the draft release on GitHub and publish it.
