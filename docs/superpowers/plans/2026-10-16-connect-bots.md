# Connect bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stepped "Connect bots" dialog where one pasted prompt makes a coordinator bot announce every bot it can reach, and Calico lists them live as they arrive.

**Architecture:** Renderer only, no server or `/api/status` change. The dialog polls `fetchStatus()` (agents already carry `id`, `title`, `updated_at`) and shows agents that are new or whose `updated_at` changed since a baseline snapshot taken when the dialog opens (not when step 3 starts, since a bot can announce as soon as the prompt is pasted). Both credentials (the webhook token and, when Calico made the relay, the relay send token) are copied through main over IPC, because the renderer has no clipboard-read permission and must never hold the relay send token. This also replaces the "Copy for Grok Bot" button and its `relay:copy-bot` handler. The token comes from `info.webhookToken` (already polled every 2 s by `useInfo`). A checklist in Settings > Agent updates reuses `info`, `fetchRelay()` and `fetchStatus()`.

**Tech Stack:** React 19, `@base-ui/react/dialog`, Tailwind classes already in use, vitest + Testing Library (happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-16-connect-bots-design.md`

## Global Constraints

- Bots post to loopback only: the prompt uses `${info.serverUrl}/api/webhook/grok-bot`, never a LAN address.
- The prompt never contains a token. Neither the webhook token nor the relay send token is displayed in the dialog or logged. The prompt may contain the relay address (public, no secret), only when a relay is configured.
- Clipboard cleared about 30 seconds after a credential copy, only if it still holds that credential. Done in main over IPC, replacing `relay:copy-bot` (`src/main/ipc.ts`; 60 s there), because `src/main/devices.ts` grants the renderer only `clipboard-sanitized-write`, so `navigator.clipboard.readText()` rejects in the real app.
- `info.serverUrl` is `string | null`: when null the dialog shows the same "server is not running" note as `AgentUpdatesSection` and builds no prompt.
- "Copy for Grok Bot" is removed from `RelaySection.tsx` and `SetupDialog.tsx` (done step); both show "Connect bots…" instead. `botNote` in `src/main/relay/service.ts`, `relay:copy-bot`, and their tests go.
- Stuck after 60 seconds without an announce: show the last refusal reason from `info.webhook.refused.last`.
- No manual bot naming anywhere. No new event type, no change to the first key of `/api/status`.
- Copy: minimal em-dashes, no emojis. Reuse `btn`, `btn-primary`, `ErrorNote`, `Stepper` styles. Dialog focuses its title on each step. The live list is `aria-live="polite"`.
- Pre-commit (eslint `--max-warnings=0`, prettier, `npm run typecheck`) must pass.

## Review Focus

- Token not set yet: step 2 must generate one (as "Set a token" does) before Copy token works, and say so.
- Agent already known before the dialog opened re-announces: shows once, as "already connected", not duplicated. `updated_at` has one-second resolution (`isoSeconds` in `src/server/store.ts`), so a re-announce in the same second as the baseline is missed; the dialog also treats a changed `message` or `status` as an announce.
- A bot that announces during step 1 or 2 (before the user reaches Waiting) still appears: polling and the baseline start when the dialog opens.
- Clock skew: `updated_at` is server time, so compare against the first poll's server data, not the renderer clock (use agents' `updated_at` against a baseline snapshot taken at open).
- A bot that changes its id but keeps its title has its idle namesake removed by the store (`src/server/store.ts`), so it shows as new, not "already connected". Accepted; noted, not fixed.
- Server down mid-dialog: polling errors show `ErrorNote`, the list keeps what it had, no crash.
- Rotate while the dialog is open: the copy button uses the new token, and the "bots still hold the old token" note shows.
- Relay set up by hand (no send token): the relay copy button is absent, not disabled-with-no-reason, and the prompt carries no relay address line a bot cannot use.
- Relay set up again: a new send token exists, so the old one the bots hold is stale until step 2 is re-run. Calico keeps no record of the swap, so the Credentials step carries a static line telling the user to copy again after setting up the relay again.

---

### Task 1: Pure helpers

**Files:**

- Create: `src/renderer/src/lib/connect-bots.ts`
- Test: `src/renderer/src/lib/connect-bots.test.ts`

**Interfaces:**

- Produces:
  - `connectPrompt(webhookUrl: string, relayUrl: string | null): string`
  - `type Seen = { id: string; title: string; at: string; known: boolean }`
  - `announced(baseline: DeskAgent[], current: DeskAgent[]): Seen[]` (an agent is listed if absent from `baseline` or its `updated_at`, `message` or `status` changed; `known` is true when it was in `baseline`; ordered by `updated_at` descending)
  - `stuckHint(activity: WebhookActivity): string` (maps `refused.last.reason` to one plain sentence; empty-refusals returns a "nothing has reached Calico" line)

- [ ] **Step 1: Write failing tests** in `connect-bots.test.ts`: `connectPrompt` contains the URL, contains no 64-hex string and no `send_` or `read_` token, includes the relay address, the `Authorization: Bearer` format (token left to the secure input) and the `User-Agent` requirement when `relayUrl` is given, and no relay lines when null, and tells the bot to ask for each credential through its secure input, save it to its native secret store, ask before replacing an existing one, pull the list of bots, announce each with an id and title; `announced` lists a new agent as `known: false`, an updated baseline agent as `known: true`, lists an agent whose only change is `message`, ignores an unchanged one, orders newest first; `stuckHint` returns a sentence naming "token" for `unauthorized` and a different sentence for `bad_event`, and the no-refusal line when `refused.count === 0`.
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

### Task 3: The dialog and the secret copy

**Files:**

- Create: `src/renderer/src/settings/ConnectBotsDialog.tsx`, `src/renderer/src/lib/rotate-token.ts` (+ test)
- Test: `src/renderer/src/settings/ConnectBotsDialog.test.tsx`
- Modify: `src/main/ipc.ts` (new handler `bots:copy-secret`; add dep `secret(kind: "webhook" | "relay"): string | null` to `IpcDeps`), `src/main/index.ts` (wire `secret` from config: `webhook_token` / `relay_send_token`, `null` when empty), `src/preload/index.ts`, `src/shared/ipc.ts` (`botsCopySecret(kind: "webhook" | "relay"): Promise<boolean>`), `src/renderer/src/settings/AgentUpdatesSection.tsx` (use the extracted helper), tests in `test/main/ipc.test.ts` (fixture gets `secret: () => null`; the electron mock's `clipboard: {}` gets `writeText`, `readText`, `clear` stubs) and `test/main/preload.test.ts` (method list)

**Interfaces:**

- Consumes: Task 1 helpers, Task 2 `Stepper`, `fetchStatus`, `fetchRelay`, `putConfig`, `putPanel`, `fetchPanel`, `configureApi`, `newWebhookToken`, `useInfo` (`src/renderer/src/lib/use-info.ts`, returns `CalicoInfo | null`).
- Produces:
  - `rotateWebhookToken(info: CalicoInfo): Promise<{ token: string; note: string }>`, the body of `AgentUpdatesSection.apply` (new token, `putConfig`, `configureApi`, then the same panel update with `putPanel`), extracted so Generate in the dialog keeps the panel's dismiss token in sync. `AgentUpdatesSection` calls it and its tests stay green.
  - `ConnectBotsDialog({ open, onClose }: { open: boolean; onClose: () => void })`. It reads `info` through `useInfo()` itself, so the relay entry points (which have no `info`) can open it. Renders nothing while `info` is null.

Steps (stages `["Prompt", "Credentials", "Waiting", "Done"]`):

1. Prompt: shows the prompt text and a Copy prompt button (`aria-label="Copy prompt"`), Next. The relay address goes in only when `fetchRelay()` reports `can_copy` (a relay joined by hand has no send token, so naming it would give the bot nothing it can use).
2. Credentials: "Copy webhook token" (`aria-label="Copy webhook token"`) and, only when `can_copy`, "Copy relay send token" (`aria-label="Copy relay send token"`). Text under the relay button: "Set up the relay again? Copy this again: bots keep the old send token until you do." If `info.webhookToken` is empty, show "Calico will make a token for you" and a Generate button calling `rotateWebhookToken`. Each copy calls `window.calico.botsCopySecret(kind)`; main returns false for any `kind` other than the literals `"webhook"` and `"relay"` or when that credential is unset, otherwise writes it to the clipboard and after 30 s clears it if `clipboard.readText()` still equals it. Neither is rendered.
3. Waiting: the baseline is taken from `fetchStatus()` when the dialog opens and kept across steps; polling runs from open at 2 s; render `announced(baseline, agents)` in an `aria-live="polite"` list ("Title, id, time", "already connected" when `known`). After 60 s with nothing listed show `stuckHint(info.webhook)`. A polling error shows `ErrorNote` and keeps the list.
4. Done: lists what connected, "Connect another bot" (back to step 1) and Done.

- [ ] **Step 1: Write failing tests** (mock `fetchStatus`, `fetchRelay` via `vi.mock("../lib/api")`, fake timers): (a) Copy prompt writes text containing `http://127.0.0.1:8787/api/webhook/grok-bot` and no token, and contains the relay address only when `can_copy`; (b) with no token, step 2 shows Generate, which calls `putConfig` with a 64-hex `webhook_token` and `putPanel` with the same token; (c) Copy webhook token calls `botsCopySecret("webhook")` and the token text is not in the DOM; (c2) with `can_copy` true a Copy relay send token button calls `botsCopySecret("relay")`, and with `can_copy` false it is absent; (d) main tests in `test/main/ipc.test.ts`: `bots:copy-secret` writes the right secret for each kind, clears after 30 s only when the clipboard still holds it, returns false when that secret is unset and for `kind` values such as `"constructor"` or `undefined`; (i) `serverUrl: null` shows the not-running note and no prompt; (j) an agent that appears while on step 1 is listed on reaching step 3; (e) step 3 baseline `[]` then poll returns a new agent: row "Jeeves" appears, a second poll with the same agent does not duplicate it; (f) a baseline agent with changed `updated_at` shows "already connected"; (g) after 60 s with no rows the refusal hint shows; (h) a rejected `fetchStatus` shows an alert and keeps rows.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/settings/ConnectBotsDialog.test.tsx test/main/ipc.test.ts test/main/preload.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `ConnectBotsDialog` following `SetupDialog.tsx` structure: `Dialog.Root`/`Portal`/`Backdrop`/`Popup` with the same classes, `Stepper` above, title focused on each step (`useEffect` on `step`), state `step: 1|2|3|4`. Copy prompt uses `navigator.clipboard.writeText` (write is permitted), wrapped in `.catch` showing "Copy failed" as `Copy` in `AgentUpdatesSection` does. Extract `rotateWebhookToken` first and confirm `AgentUpdatesSection` tests still pass.
- [ ] **Step 4: Run** the same command plus `npx vitest run src/renderer/src/settings`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/renderer/src/settings/ConnectBotsDialog.* src/renderer/src/lib/rotate-token.* src/renderer/src/settings/AgentUpdatesSection.tsx src/main/ipc.ts src/main/index.ts src/preload/index.ts src/shared/ipc.ts test/main/ipc.test.ts test/main/preload.test.ts && git commit -m "Add the stepped Connect bots dialog and the secret copy"`

### Task 3b: Retire "Copy for Grok Bot"

**Files:**

- Modify: `src/renderer/src/settings/RelaySection.tsx` (owns the `ConnectBotsDialog` open state; the button "Connect bots…" shows whenever a relay is connected, including one joined by hand, since the dialog handles a missing send token), `src/renderer/src/settings/SetupDialog.tsx` (new prop `onConnect: () => void`; the done step's button calls it after the setup dialog closes, so dialogs never nest), `src/main/ipc.ts` (delete `relay:copy-bot` and the `botNote` dep), `src/main/index.ts` (delete the `botNote` closure at about line 293 and its import), `src/main/relay/service.ts` (delete `botNote`), `src/shared/ipc.ts` and `src/preload/index.ts` (delete `relayCopyForBot`), `src/renderer/src/lib/use-copy.ts` (delete; its only caller was the old buttons, remove its callers in `RelaySection.tsx` and `SetupDialog.tsx`), `test/main/ipc.test.ts` (drop the `botNote: () => null` fixture), `test/main/preload.test.ts` (drop `relayCopyForBot` from the list), `test/main/relay-service.test.ts` (delete `describe("botNote")` at about lines 183 to 191 and its import)
- Test: `src/renderer/src/settings/RelaySection.test.tsx` (the old Copy for Grok Bot cases at about lines 203 to 226 become "Connect bots… opens the dialog" for a made relay and for one joined by hand), `src/renderer/src/settings/SetupDialog.test.tsx` (the cases at about lines 98 to 111 and 191 to 212 become: the done step shows "Connect bots…" and no "Copy for Grok Bot", and pressing it closes setup and calls `onConnect`)

**Interfaces:**

- Consumes: Task 3 `ConnectBotsDialog`.
- Produces: no `Copy for Grok Bot` text, no `relay:copy-bot` channel anywhere (`grep -rn "Copy for Grok Bot\|relayCopyForBot\|botNote" src test` returns nothing).

Carry the relay posting instructions the old `botNote` held: when the prompt names the relay, `connectPrompt` also says to post events as JSON with `Authorization: Bearer <the relay send token from your secure store>` and a `User-Agent` header of the bot's own (Cloudflare turns away Python's default `Python-urllib`). This text lives in Task 1's `connectPrompt`, with a Task 1 test that it appears only when `relayUrl` is given.

- [ ] **Step 1: Write the failing tests** named above, and a grep check as the last assertion step.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/settings test/main`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the deletions and the two button swaps.
- [ ] **Step 4: Run** `npx vitest run` then `npm run typecheck && npm run lint`, and the grep above. Expected: all PASS, grep empty.
- [ ] **Step 5: Commit** the files named in this task: `git commit -m "Replace Copy for Grok Bot with Connect bots"`.

### Task 4: Entry points, rotate, checklist

**Files:**

- Create: `src/renderer/src/settings/BotChecklist.tsx`, `src/renderer/src/settings/BotChecklist.test.tsx`
- Modify: `src/renderer/src/settings/AgentUpdatesSection.tsx` (and its test), `src/renderer/src/dashboard/EmptyAgents.tsx` (new `onConnect` prop and button, and its test), `src/renderer/src/dashboard/Dashboard.tsx` (passes `onConnect` through)

**Interfaces:**

- Consumes: `ConnectBotsDialog`, `fetchStatus`, `fetchRelay`, `ago` from `../lib/time`, `CalicoInfo`.
- Produces: `BotChecklist({ info }: { info: CalicoInfo })` rendering four lines: "Token saved" (`info.webhookToken` set), "Server listening" (`info.serverUrl` set), "Relay reachable" (`fetchRelay().status.ok`, "not set up" when `!configured`), then one row per agent: title, `ago(updated_at)`. Only agents the store already holds appear, since Calico cannot know bots that never announced. Polls every 5 s and tolerates fetch errors.

- [ ] **Step 1: Write failing tests**: `BotChecklist` shows the three status lines from mocked `info`/`fetchRelay`, and a row "Jeeves" with a relative time from a mocked agent; a rejected `fetchStatus` leaves the status lines and shows no rows. `AgentUpdatesSection` shows a "Connect bots…" button that opens the dialog; the old "Replace the token…" button is renamed "Rotate token…"; after a successful rotate the note "Bots still hold the old token until you copy the new one and they announce again." shows and clears when `info.webhook.accepted.at` is later than the rotate time. `EmptyAgents` shows a "Connect bots" button that calls a new `onConnect` prop (`Dashboard` passes it through; builder picks the smaller wiring, opening the dialog directly or via the navigation `onSetup` uses).
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
