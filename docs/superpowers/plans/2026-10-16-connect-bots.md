# Connect bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stepped "Connect bots" dialog where one pasted prompt makes a coordinator bot announce every bot it can reach, and Calico lists them live as they arrive.

**Architecture:** Renderer only, no server or `/api/status` change. The dialog polls `fetchStatus()` (agents already carry `id`, `title`, `updated_at`) and shows agents whose `updated_at` is newer than the dialog's open time. The token comes from `info.webhookToken` (already polled every 2 s by `useInfo`). A checklist in Settings > Agent updates reuses `info`, `fetchRelay()` and `fetchStatus()`.

**Tech Stack:** React 19, `@base-ui/react/dialog`, Tailwind classes already in use, vitest + Testing Library (happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-16-connect-bots-design.md`

## Global Constraints

- Bots post to loopback only: the prompt uses `${info.serverUrl}/api/webhook/grok-bot`, never a LAN address.
- The prompt never contains the token. The token is never displayed in the dialog, never logged.
- Clipboard cleared about 30 seconds after Copy token, only if it still holds the token.
- Stuck after 60 seconds without an announce: show the last refusal reason from `info.webhook.refused.last`.
- No manual bot naming anywhere. No new event type, no change to the first key of `/api/status`.
- Copy: minimal em-dashes, no emojis. Reuse `btn`, `btn-primary`, `ErrorNote`, `Stepper` styles. Dialog focuses its title on each step. The live list is `aria-live="polite"`.
- Pre-commit (eslint `--max-warnings=0`, prettier, `npm run typecheck`) must pass.

## Review Focus

- Token not set yet: step 2 must generate one (as "Set a token" does) before Copy token works, and say so.
- Agent already known before the dialog opened re-announces: shows once, as "already connected", not duplicated.
- Clock skew: `updated_at` is server time, so compare against the first poll's server data, not the renderer clock (use agents' `updated_at` against a baseline snapshot taken at open).
- Server down mid-dialog: polling errors show `ErrorNote`, the list keeps what it had, no crash.
- Rotate while the dialog is open: the copy button uses the new token, and the "bots still hold the old token" note shows.

---

### Task 1: Pure helpers

**Files:**

- Create: `src/renderer/src/lib/connect-bots.ts`
- Test: `src/renderer/src/lib/connect-bots.test.ts`

**Interfaces:**

- Produces:
  - `connectPrompt(webhookUrl: string): string`
  - `type Seen = { id: string; title: string; at: string; known: boolean }`
  - `announced(baseline: DeskAgent[], current: DeskAgent[]): Seen[]` (an agent is listed if absent from `baseline` or its `updated_at` changed; `known` is true when it was in `baseline`; ordered by `updated_at` descending)
  - `stuckHint(activity: WebhookActivity): string` (maps `refused.last.reason` to one plain sentence; empty-refusals returns a "nothing has reached Calico" line)

- [ ] **Step 1: Write failing tests** in `connect-bots.test.ts`: `connectPrompt` contains the URL, contains no 64-hex string, and tells the bot to ask for the token, save it once, ask before replacing an existing file, pull the list of bots, announce each with an id and title; `announced` lists a new agent as `known: false`, an updated baseline agent as `known: true`, ignores an unchanged one, orders newest first; `stuckHint` returns a sentence naming "token" for `unauthorized` and a different sentence for `bad_event`, and the no-refusal line when `refused.count === 0`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/connect-bots.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the three functions and `Seen` in `connect-bots.ts` using `DeskAgent` from `./api` and `WebhookActivity` from `../../../shared/ipc`. Reasons come from the `RefusalReason` union already used in `webhook-activity.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/renderer/src/lib/connect-bots.ts src/renderer/src/lib/connect-bots.test.ts && git commit -m "Add the pure helpers for connecting bots"`

### Task 2: Stepper takes its labels

**Files:**

- Modify: `src/renderer/src/settings/Stepper.tsx`
- Test: `src/renderer/src/settings/SetupDialog.test.tsx` (existing relay tests must stay green), add one case in a new `Stepper.test.tsx`

**Interfaces:**

- Produces: `Stepper({ at, failed, stages = STAGES }: { at: number; failed: boolean; stages?: readonly string[] })`

- [ ] **Step 1: Write failing test** `Stepper.test.tsx`: rendering `stages={["Prompt","Token","Waiting","Done"]}` at 3 shows those four labels and marks "Waiting" `aria-current="step"`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/settings/Stepper.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the optional `stages` prop, defaulting to the relay `STAGES`. Do not change relay markup.
- [ ] **Step 4: Run** `npx vitest run src/renderer/src/settings`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Let the stepper take its own labels"` (add the new test file first).

### Task 3: The dialog

**Files:**

- Create: `src/renderer/src/settings/ConnectBotsDialog.tsx`
- Test: `src/renderer/src/settings/ConnectBotsDialog.test.tsx`

**Interfaces:**

- Consumes: Task 1 helpers, Task 2 `Stepper`, `fetchStatus`, `putConfig`, `configureApi`, `newWebhookToken`, `webhookUrl` is NOT used (loopback only: use `info.serverUrl`).
- Produces: `ConnectBotsDialog({ open, info, onClose }: { open: boolean; info: CalicoInfo; onClose: () => void })`

Steps (stages `["Prompt", "Token", "Waiting", "Done"]`):

1. Prompt: shows the prompt text and a Copy prompt button (`aria-label="Copy prompt"`), Next.
2. Token: Copy token (`aria-label="Copy token"`). If `info.webhookToken` is empty, show "Calico will make a token for you" and a Generate button that does what `AgentUpdatesSection.apply` does for the config part (`putConfig({ webhook_token })`, then `configureApi`). Copy clears the clipboard after 30 s if `navigator.clipboard.readText()` still equals the token. The token is never rendered.
3. Waiting: on entry take a baseline from `fetchStatus()`, poll every 2 s, render `announced(baseline, agents)` in an `aria-live="polite"` list ("Title, id, time", "already connected" when `known`). After 60 s with nothing listed show `stuckHint(info.webhook)`. A polling error shows `ErrorNote` and keeps the list.
4. Done: lists what connected, "Connect another bot" (back to step 1) and Done.

- [ ] **Step 1: Write failing tests** (mock `fetchStatus` via `vi.mock("../lib/api")`, fake timers): (a) Copy prompt writes text containing `http://127.0.0.1:8787/api/webhook/grok-bot` and no token; (b) with no token, step 2 shows Generate and calls `putConfig` with a 64-hex `webhook_token`; (c) Copy token writes `info.webhookToken` and the token text is not in the DOM; (d) after 30 s `writeText("")` is called only if `readText` still returns the token; (e) step 3 baseline `[]` then poll returns a new agent: row "Jeeves" appears, a second poll with the same agent does not duplicate it; (f) a baseline agent with changed `updated_at` shows "already connected"; (g) after 60 s with no rows the refusal hint shows; (h) a rejected `fetchStatus` shows an alert and keeps rows.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/settings/ConnectBotsDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `ConnectBotsDialog` following `SetupDialog.tsx` structure: `Dialog.Root`/`Portal`/`Backdrop`/`Popup` with the same classes, `Stepper` above, title focused on each step (`useEffect` on `step`), state `step: 1|2|3|4`. Clipboard calls are wrapped in `.catch` showing "Copy failed" as `Copy` in `AgentUpdatesSection` does.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/renderer/src/settings/ConnectBotsDialog.* && git commit -m "Add the stepped Connect bots dialog"`

### Task 4: Entry points, rotate, checklist

**Files:**

- Create: `src/renderer/src/settings/BotChecklist.tsx`, `src/renderer/src/settings/BotChecklist.test.tsx`
- Modify: `src/renderer/src/settings/AgentUpdatesSection.tsx` (and its test), `src/renderer/src/dashboard/Dashboard.tsx` (`EmptyAgents` button, and its test)

**Interfaces:**

- Consumes: `ConnectBotsDialog`, `fetchStatus`, `fetchRelay`, `ago` from `../lib/time`, `CalicoInfo`.
- Produces: `BotChecklist({ info }: { info: CalicoInfo })` rendering four lines: "Token saved" (`info.webhookToken` set), "Server listening" (`info.serverUrl` set), "Relay reachable" (`fetchRelay().status.ok`, "not set up" when `!configured`), then one row per agent: title, `ago(updated_at)`. Only agents the store already holds appear, since Calico cannot know bots that never announced. Polls every 5 s and tolerates fetch errors.

- [ ] **Step 1: Write failing tests**: `BotChecklist` shows the three status lines from mocked `info`/`fetchRelay`, and a row "Jeeves" with a relative time from a mocked agent; a rejected `fetchStatus` leaves the status lines and shows no rows. `AgentUpdatesSection` shows a "Connect bots…" button that opens the dialog; the old "Replace the token…" button is renamed "Rotate token…"; after a successful rotate the note "Bots still hold the old token until you copy the new one and they announce again." shows and clears when `info.webhook.accepted.at` is later than the rotate time. `EmptyAgents` shows a "Connect bots" button that calls a new `onConnect` prop (wired in `Dashboard` to open the dialog, or to the same navigation `onSetup` uses plus opening it; builder picks the smaller change).
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/settings src/renderer/src/dashboard`. Expected: FAIL on the new cases only.
- [ ] **Step 3: Implement** `BotChecklist`, mount it under the received/refused lines in `AgentUpdatesSection`, add the Connect bots button next to the token button, rename the rotate button and add the old-token note state, add the Dashboard empty-state button.
- [ ] **Step 4: Run** `npx vitest run` then `npm run typecheck && npm run lint`. Expected: all PASS, no warnings.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Connect bots from Settings and the empty dashboard, with a checklist"` (stage only the files named above, not `.impeccable/`).

### Task 5: Hardware check and docs

**Files:**

- Modify: `README.md` (one short paragraph under agent setup, if the README covers it)

- [ ] **Step 1:** Run the dev app, open Connect bots, copy the prompt into Grok Bot, and confirm the bots list fills as they announce. Record the actual prompt wording that worked in the PR body. Preflight alone, one checklist, one reply.
- [ ] **Step 2:** Adjust `connectPrompt` wording if the coordinator bot misreads it, with a test update.
- [ ] **Step 3: Commit** `git commit -am "Document connecting bots"`.
