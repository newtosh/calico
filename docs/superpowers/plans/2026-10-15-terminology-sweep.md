# Terminology Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every user-facing word for the two parties consistent: Calico is the desktop app, the panel is the ESP32 hardware, and no label can be read as belonging to the wrong one.

**Architecture:** `docs/terminology.md` is the glossary and the spec. A guard test (`test/terminology.test.ts`) scans app source and docs for the retired words and fails the build when they return. Each task changes the existing tests' expected text first, then the source, until the guard and the suite are green. Strings and comments only: no protocol keys, IPC channels, file names or identifiers change, except the local variable `desk` in `LinkActions.tsx`.

**Tech Stack:** TypeScript, React 19, Vitest, Node `fs`.

**Spec:** `docs/terminology.md`

## Global Constraints

- Calico is the desktop app, including its local server. The panel is the ESP32-S3 AMOLED hardware. Panel firmware is its software. "Ginger" appears only in dev docs, the Bluetooth name, repo paths and logs.
- Never write "the desk", "the device", "desk panel" (as a name), "companion", "companion URL", "companion server", "Device page" or "Device" (as a page name) in user-facing text or comments.
- "Device" is allowed only in a technical compound: "Bluetooth device", "USB device", "serial device".
- A label names the owner with a possessive and states the direction for anything that crosses: "Calico's address (the panel polls this)".
- "Desk panel" is allowed in the README tagline as a plain description.
- Do not rename protocol keys, USB or Bluetooth fields, HTTP fields, IPC channel names, the `device/` source folder, the `"device"` view id, `tools/python-companion/`, `resources/screenshots/device.png`, or the BLE device name.
- Minimize em-dashes. No Claude session links in PR bodies.

## Review Focus

- A string that the old text tests assert on must change in the same task, or the suite goes red for the wrong reason. (Tasks 2, 3)
- The accessible names of the sidebar link and page headings are what screen reader users and tests find. They must say "Panel", not just the visible text. (Task 2)
- Error messages that arrive in `ble.ts` and `usb.ts` are shown verbatim and must follow the pair (Calico, panel). (Task 2)
- The guard must catch a word inside a template literal and a JSX text node, not only inside quotes. (Task 1)
- The docs must not keep "the desk" as a physical-location phrase that reads as the hardware ("On the desk, from firmware/"). (Task 4)

## File Structure

- Create `test/terminology.test.ts`: the guard.
- Modify, strings and comments only: `src/renderer/src/device/{LinkActions,DeviceView,ProvisionFlow,FirewallAssist,RebootWait,address-update,usb,ble}.ts(x)`, `src/renderer/src/console/ConsoleView.tsx`, `src/renderer/src/shell/{Sidebar,AddressBanner,ServerErrorPanel}.tsx`, `src/renderer/src/settings/{PanelSection,PortSection,NetworkForm,NetworksSection}.tsx`, `src/renderer/src/lib/stale.ts`, `src/shared/ipc.ts`, `src/main/autostart.ts`, and the 12 test files that assert old text (found by the guard and by the suite).
- Modify docs: `README.md`, `CONTRIBUTING.md`, `firmware/README.md`, `docs/review-rules.md`, `docs/usb-console-protocol.md`.

---

### Task 1: The guard test

**Files:**

- Create: `test/terminology.test.ts`

**Interfaces:**

- Consumes: `docs/terminology.md` (the rules).
- Produces: a test that fails on every retired word and names the file, line and text.

- [ ] **Step 1: Write the test**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

function files(dir: string, ext: RegExp): string[] {
  return (readdirSync(join(root, dir), { recursive: true }) as string[])
    .filter((f) => ext.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

function hits(paths: string[], banned: RegExp[]): string[] {
  const found: string[] = [];
  for (const path of paths) {
    readFileSync(join(root, path), "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const re of banned)
          if (re.test(line)) found.push(`${path}:${i + 1} ${line.trim()}`);
      });
  }
  return found;
}

// docs/terminology.md explains why each word is retired.
const SOURCE = [/\bdesk\b/i, /(?<!python-)\bcompanion\b/i, /\bDevice\b/];
const DOCS = [
  /(?<!python-)\bcompanion\b/i,
  /\bthe desk\b/i,
  /\bDevice (page|setup|tab)\b/,
];

describe("terminology", () => {
  it("keeps the retired words out of the app's source", () => {
    expect(hits(files("src", /\.tsx?$/), SOURCE)).toEqual([]);
  });

  it("keeps them out of the docs", () => {
    const docs = [
      "README.md",
      "CONTRIBUTING.md",
      "firmware/README.md",
      "docs/review-rules.md",
      "docs/usb-console-protocol.md",
    ];
    expect(hits(docs, DOCS)).toEqual([]);
  });

  it("catches a retired word in JSX text and in a template literal", () => {
    const sample = ["<dt>Companion</dt>", "`The desk did not answer`"];
    for (const line of sample)
      expect(SOURCE.some((re) => re.test(line))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail on the real text**

Run: `pnpm vitest run test/terminology.test.ts`
Expected: the first two tests FAIL listing about 70 lines in source and the doc lines. The third passes (it only checks the regexes). Save the output; later tasks drive it to zero.

- [ ] **Step 3: Commit**

```bash
git add test/terminology.test.ts
git commit -m "Add a guard that keeps the retired panel and app words out"
```

---

### Task 2: The Panel page

**Files:**

- Modify: `src/renderer/src/shell/Sidebar.tsx`, `src/renderer/src/device/{LinkActions,DeviceView,ProvisionFlow,FirewallAssist,RebootWait,usb,ble}.ts(x)`, `src/renderer/src/console/ConsoleView.tsx`
- Test: the existing tests next to those files (`LinkActions.test.tsx`, `DeviceView.test.tsx`, `ProvisionFlow.test.tsx`, `usb.test.ts`, `ble.test.ts`, `App.test.tsx`, and `ConsoleView` if it has one)

**Interfaces:**

- Consumes: the guard from Task 1.
- Produces: the new visible text below. Later tasks (3, 4) reuse "the Panel page" and "Calico's address".

- [ ] **Step 1: Change the tests first**

In each test file above, change every assertion on old text to the new text from the table below. Find them with `grep -nwiE "desk|device|companion" <file>`. Examples of the new assertions: `getByRole("link", { name: "Panel" })`, `getByText("Connect to the panel")`, `getByLabelText("Calico's address (the panel polls this)")`, `"The panel did not answer in 5 seconds."`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm vitest run src/renderer`
Expected: FAIL only on the changed assertions.

- [ ] **Step 3: Change the source to the new text**

Replace exactly (keep the surrounding code; comments follow the same word rule, "desk" becomes "panel"):

| File                                                                       | Old                                                                | New                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `Sidebar.tsx:13`                                                           | `label: "Device"`                                                  | `label: "Panel"`                                                     |
| `ConsoleView.tsx:21`                                                       | `Serial output from the desk`                                      | `Serial output from the panel`                                       |
| `ConsoleView.tsx:22`                                                       | `Connect over USB in Device to see serial output.`                 | `Connect over USB on the Panel page to see serial output.`           |
| `ProvisionFlow.tsx:89,91`                                                  | `The desk tries … reboots the desk.`                               | `The panel tries … reboots the panel.`                               |
| `ProvisionFlow.tsx:135`                                                    | `This network's own companion URL and token (optional)`            | `This network's own Calico address and token (optional)`             |
| `ProvisionFlow.tsx:143`                                                    | `Companion URL for this network`                                   | `Calico's address on this network`                                   |
| `FirewallAssist.tsx:66`                                                    | `reboot the desk.`                                                 | `reboot the panel.`                                                  |
| `usb.ts:37`                                                                | `The desk reported an error.`                                      | `The panel reported an error.`                                       |
| `usb.ts:136`                                                               | `The desk did not answer in ${seconds} seconds.`                   | `The panel did not answer in ${seconds} seconds.`                    |
| `DeviceView.tsx:62`                                                        | `Lost the connection to the desk. Connect again.`                  | `Lost the connection to the panel. Connect again.`                   |
| `DeviceView.tsx:134`                                                       | `Connect to the desk`                                              | `Connect to the panel`                                               |
| `DeviceView.tsx:160-161`                                                   | `recover a desk that will not boot … once the desk is advertising` | `recover a panel that will not boot … once the panel is advertising` |
| `LinkActions.tsx:35`                                                       | `URL saved on the desk. It applies after a reboot.`                | `Calico's address saved on the panel. It applies after a reboot.`    |
| `LinkActions.tsx:45`                                                       | `Token cleared on the desk.`                                       | `Token cleared on the panel.`                                        |
| `LinkActions.tsx:59`                                                       | `Desk` (section title)                                             | `Panel`                                                              |
| `LinkActions.tsx:66`                                                       | `Companion` (row label)                                            | `Calico address`                                                     |
| `LinkActions.tsx:72`                                                       | `Reading the desk.`                                                | `Reading the panel.`                                                 |
| `LinkActions.tsx:76`                                                       | `Companion URL for the desk`                                       | `Calico's address (the panel polls this)`                            |
| `LinkActions.tsx:93`                                                       | `Clear desk token`                                                 | `Clear the panel's token`                                            |
| `LinkActions.tsx:96`                                                       | `Reboot desk`                                                      | `Reboot panel`                                                       |
| `LinkActions.tsx:14,60,63,65,67,69`                                        | local variable `desk` / `setDesk`                                  | `panelInfo` / `setPanelInfo` (identifier only, so the guard passes)  |
| `ble.ts:148`                                                               | `The desk did not finish scanning in 30 seconds.`                  | `The panel did not finish scanning in 30 seconds.`                   |
| `ble.ts:153`                                                               | `The desk could not scan for networks.`                            | `The panel could not scan for networks.`                             |
| `ble.ts:222`                                                               | `This device has no GATT server.`                                  | `This Bluetooth device has no GATT server.`                          |
| `ble.ts:106,135,156`, `usb.ts:81`, `RebootWait.tsx:4`, `DeviceView.tsx:33` | comments saying "the desk"                                         | the same comment with "the panel"                                    |

`ble.ts:217,221,230,280,284,285` use the Web Bluetooth `device` object. They are lowercase code identifiers and stay. The guard only bans capital-D "Device", so they pass.

- [ ] **Step 4: Run tests, typecheck, lint, the guard**

Run: `pnpm vitest run src/renderer && pnpm typecheck && pnpm lint && pnpm vitest run test/terminology.test.ts`
Expected: the renderer suite passes; the guard still fails, but now only on Task 3 and Task 4 files. Read the list to confirm none from this task remain.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "Name the hardware the panel on the Panel page"
```

---

### Task 3: Settings, banners and shell

**Files:**

- Modify: `src/renderer/src/settings/{PanelSection,PortSection,NetworkForm,NetworksSection}.tsx`, `src/renderer/src/shell/{AddressBanner,ServerErrorPanel}.tsx`, `src/renderer/src/device/address-update.ts`, `src/renderer/src/lib/stale.ts`, `src/shared/ipc.ts`, `src/main/autostart.ts`
- Test: `src/renderer/src/shell/AddressBanner.test.tsx`, `src/renderer/src/settings/NetworksSection.test.tsx`, `src/renderer/src/device/LinkActions.test.tsx`, `test/server/config.test.ts`, `test/server/http.test.ts`, `test/contract/contract.test.ts`, and any other test the suite shows red

**Interfaces:**

- Consumes: Task 1's guard and Task 2's phrasing.
- Produces: the guard passes for `src/`.

- [ ] **Step 1: Change the tests first**

Update assertions on the old text in the test files above, using the table below. Find them with `grep -nwiE "desk|device|companion" <file>`. Do not touch test names that only describe the protocol or JSON key names (for example a test about the `"url"` key).

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm vitest run`
Expected: FAIL only on the changed assertions.

- [ ] **Step 3: Change the source**

| File                      | Old                                                                     | New                                                                        |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PanelSection.tsx:43`     | `Sends a companion URL and token to the panel through its status poll.` | `Sends Calico's address and a token to the panel through its status poll.` |
| `PanelSection.tsx:45`     | `use Device.`                                                           | `use the Panel page.`                                                      |
| `PanelSection.tsx:49`     | `Companion URL`                                                         | `Calico's address (the panel polls this)`                                  |
| `PortSection.tsx:38`      | `Companion port`                                                        | `Calico server port`                                                       |
| `NetworkForm.tsx:104`     | `Companion URL for this network`                                        | `Calico's address on this network`                                         |
| `NetworkForm.tsx:128`     | `on the Device page`                                                    | `on the Panel page`                                                        |
| `NetworksSection.tsx:62`  | `use Device.`                                                           | `use the Panel page.`                                                      |
| `NetworksSection.tsx:121` | `on the Device page.`                                                   | `on the Panel page.`                                                       |
| `AddressBanner.tsx:12`    | `… on the Device page` if present                                       | `… on the Panel page`                                                      |
| `AddressBanner.tsx:124`   | `Update on the Device page`                                             | `Update on the Panel page`                                                 |
| `address-update.ts:7`     | `its own companion URL saved on the panel … from the Device page`       | `its own Calico address saved on the panel … from the Panel page`          |
| `address-update.ts:11`    | `… on the Device page`                                                  | `… on the Panel page`                                                      |
| `address-update.ts:15`    | comment `default companion URL`                                         | `default Calico address`                                                   |
| `ServerErrorPanel.tsx:8`  | `The companion server is not running.`                                  | `Calico's server is not running.`                                          |
| `ServerErrorPanel.tsx:12` | `Device setup over USB and Bluetooth`                                   | `Panel setup over USB and Bluetooth`                                       |
| `stale.ts:8`              | comment `a quiet desk`                                                  | `a quiet panel`                                                            |
| `ipc.ts:55`               | comment `the companion URL to give the panel`                           | `Calico's address to give the panel`                                       |
| `autostart.ts:32`         | `Comment=Desk panel companion`                                          | `Comment=Shows your coding agents on the panel`                            |

Read each full line before editing: some strings continue past the first 150 characters. The guard names every remaining line.

- [ ] **Step 4: Run everything**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm vitest run test/terminology.test.ts`
Expected: the guard's source test passes. The docs test still fails (Task 4).

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "Say Calico's address and Calico's server in settings and banners"
```

---

### Task 4: Docs

**Files:**

- Modify: `README.md`, `CONTRIBUTING.md`, `firmware/README.md`, `docs/review-rules.md`, `docs/usb-console-protocol.md`

**Interfaces:**

- Consumes: the glossary.
- Produces: the guard's docs test passes.

- [ ] **Step 1: Run the docs guard to list the lines**

Run: `pnpm vitest run test/terminology.test.ts -t docs`
Expected: FAIL listing each file and line.

- [ ] **Step 2: Rewrite each listed line to the glossary**

Known ones:

| File:line                         | Change                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `README.md:9`                     | `Runs the companion server the panel polls` becomes `Runs Calico's server, which the panel polls`                         |
| `README.md:11`                    | `companion URL` becomes `Calico's address`                                                                                |
| `README.md:19`                    | image alt `Device setup` becomes `Panel setup` (keep the file name `device.png`)                                          |
| `README.md:27`                    | `companion server, tray, dashboard, device setup` becomes `Calico's server, tray, dashboard, panel setup`                 |
| `README.md:30,33`                 | the legacy tool is the `python-companion` folder: say `The original Python version of Calico` and `the legacy Python app` |
| `README.md:126`                   | `The companion listens on your LAN` becomes `Calico's server listens on your LAN`                                         |
| `README.md:3`                     | tagline keeps "desk panel" (allowed)                                                                                      |
| `firmware/README.md:26`           | `On the desk, from firmware/:` becomes `On a machine with ESP-IDF, from firmware/:`                                       |
| `docs/usb-console-protocol.md:25` | `Set the global companion URL.` becomes `Set the panel's default Calico address.` (the key stays `url`)                   |
| `docs/review-rules.md:13`         | `the Python companion it was ported from` becomes `the Python version it was ported from`                                 |

For `firmware/README.md` and `CONTRIBUTING.md`, rewrite every line the guard names. Keep command names, file names and identifiers like `desk_view.c`.

- [ ] **Step 3: Run the guard and the checks**

Run: `pnpm vitest run test/terminology.test.ts && pnpm lint`
Expected: PASS. Run `pre-commit run --all-files`; expected PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md firmware/README.md docs
git commit -m "Use the panel and Calico's address in the docs"
```

---

### Task 5: Owner read-through (owner required)

One checklist, one reply. Run the app from the branch and read, do not click through every flow.

1. Open each sidebar page: the page is called **Panel**, and the Console page text says "Connect over USB on the Panel page".
2. On the Panel page, read the headings and labels: "Connect to the panel", "Calico address", "Calico's address (the panel polls this)", "Reboot panel".
3. In Settings, read the Calico address, Calico server port and Networks text.
4. If you can trigger the address banner, it says "Update on the Panel page" or "Update over Bluetooth".
5. Reply with anything that still reads as ambiguous, with the screenshot.

## Self-review

- **Spec coverage:** the glossary table (Calico, panel, firmware, ginger, Calico's server, Calico's address, Panel page) is covered by Tasks 2 to 4 and enforced by Task 1. The label rules are applied in the mapping tables. Rule 5 (no protocol renames) is a Global Constraint. The README tagline exception is a constraint and the guard allows it.
- **Placeholder scan:** none. Lines the tables do not list are named by the guard's output and edited by rule.
- **Names:** `terminology.test.ts`, `SOURCE`, `DOCS`, `panelInfo` and the phrases "Calico's address", "Calico's server", "the Panel page" are used identically across tasks.
