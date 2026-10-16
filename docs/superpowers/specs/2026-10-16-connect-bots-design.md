# Connect bots: guided setup design

Date: 2026-10-16. Status: draft for review.

## Intent

Connecting bots to Calico today is manual: the user copies a webhook URL and a token from Settings > Agent updates and works out the rest in each bot. It works, but it sits outside Calico's own screens. This design adds a guided setup in Calico that connects a whole group of bots from one paste, and confirms each bot when it announces itself.

The owner's words: "A bot, either the default or the one the user is interacting with, should announce a connection." Calico "guides a user through a stepped setup with the option to copy the token to the clipboard when the bot prompts for this info. The final stage is a direct announce the setup assistant detects and confirms." Naming bots by hand "is a hard blocker that prevents adoption", so the list of bots must come from the bots, never from the user typing.

## Goals

- One guided dialog, "Connect bots", reachable from Settings > Agent updates and from the first-run state when no bot has announced.
- The user pastes one prompt into one bot (the coordinator). That bot pulls the list of the other bots it can reach and announces each one to Calico. The owner confirmed bots can talk to each other and pull a list.
- The prompt contains no token. The user copies the token separately, only when the bot asks for it. The bot saves it once to the shared secret file for all bots on the box.
- Calico shows bots appearing live as they announce, each with its title and time. The user presses Finish when the expected ones are there. There is no expected count.
- Re-running the same prompt adds new bots. Bots already known show "already connected" and are not duplicated.
- A checklist in Settings > Agent updates shows: token saved, server listening, relay reachable, and each known bot's last event time. Bots seen only through earlier events appear there too.
- A stuck setup explains itself: after 60 seconds without an announce, show the last refusal reason Calico recorded (wrong token, missing User-Agent header, wrong address, bad body).

## Non-goals and anti-goals

- No manual naming of bots in Calico. Any design that needs the user to type bot names has failed.
- No per-bot tokens. One shared token stays.
- No change to how bots post today. Existing bots keep working with no action.
- The token never appears in the prompt, on screen, or in the chat. It is not logged.
- The prompt never points bots at a LAN address. Bots run on this desktop, so they post to loopback (the desktop changes networks).

## Constraints

- Electron 44, React 19, Vite 8. Reuse the relay setup dialog (`src/renderer/src/settings/SetupDialog.tsx`) and `Stepper.tsx` patterns for the dialog, `useCopy`, and `newWebhookToken` for token handling.
- The webhook is `POST /api/webhook/grok-bot` with `Authorization: Bearer <webhook_token>`. Wrong token gives 401. Calico already records the last refusal (`stats.webhook.refused`, with a reason) and the last accept (`stats.webhook.accepted`) in memory.
- The existing event types are `agent.launched` and `agent.finished` (`src/server/store.ts`). Bots identify themselves with an id and a title.
- The panel adopts `/api/status` data as it does now. Nothing in this feature may change the first key of `/api/status`.
- UI follows the existing Calico style (dark theme, amber and sage accents, `btn` buttons, `ErrorNote`). Accessibility audits apply to the new dialog (focus on open, `aria-live` for the filling list, keyboard use).
- Copy rules: minimal em-dashes, no emojis.

## How it works

1. The user opens Connect bots. Step 1 shows the prompt and a Copy prompt button. The prompt names the loopback address, says to ask the user for the token only when needed, to save it once to the shared secret file (asking before replacing an existing one), to pull the list of bots it can reach, and to announce each one as connected with a stable id and a title.
2. Step 2 offers Copy token for when the bot asks. The token is not displayed. The clipboard is cleared after about 30 seconds if it still holds the token.
3. Step 3 listens. Calico lists every bot that announces while the dialog is open: title, id, time. A bot already known shows "already connected". The list is `aria-live`. No expected count.
4. Step 4 (Finish) summarizes what connected. If nothing arrived after 60 seconds, Calico shows the last refusal reason and a plain hint for it.
5. Settings > Agent updates gets the checklist described above, and a Rotate token button that issues a new token and invalidates the old one. After rotating the user re-copies the token to the bot and re-runs step 2.

## Decisions made with the owner

- A coordinator bot enumerates the others. The user does not name bots.
- A stepped dialog, with a copy-token button, not a masked field in chat.
- The final step is confirmation from a real announce, detected by Calico.

## Decisions made without the owner (my calls)

- Rotate token is included.
- The clipboard auto-clear is about 30 seconds.
- The 60-second stuck timer and showing the last refusal reason.
- The prompt asks the bot to confirm before replacing an existing secret file.
- Loopback is the only address in the prompt.
- Rotate token: Calico stores the new token and shows "bots still hold the old token" until the next accepted announce, which clears it. Bots read the token from the shared file, so the user re-runs steps 1 to 2 once. A run of 401s after a rotate is reported as that state, not as a failed setup.
- No new event type and no `/api/status` change. A "connected" announce reuses `agent.launched` then `agent.finished`, so a bot's card appears idle on the desk, which is what the owner described ("a card actually showing up").
- Known bots are derived from the agents the store already holds, so "already connected" survives restarts. No new persistence.
- Dedupe key for "already connected" is the primary agent id the store keys cards by. The builder checks how the two ids in commit 33caafb relate and picks the one the card uses.
- The live list needs per-event notification to the renderer. The builder uses whatever transport the renderer already uses to refresh agents (polling `/api/status` is acceptable) and filters on events newer than the dialog's open time.
- The checklist shows last-known status for server and relay, reusing existing status data. No new probes.

## Left to the builder

- Whether "connected" reuses `agent.launched` followed by `agent.finished`, or adds a light event type that registers a bot without a running card. Either way the dialog must key off any accepted event during the session, not only one type.
- The exact prompt wording, tuned so GrokBot and other agents follow it reliably.
- Where the shared secret file lives and how the prompt names it (the GrokBot suggestion used `/home/box/shared/secrets/calico-relay-token`, which is for the relay token and may not be the right name for the webhook token).
- How "known bots" are persisted and shown in the checklist, since `stats.webhook` is in memory and resets on app start.
- Whether the checklist's relay and server items reuse existing status helpers.

## Success

A user with several Grok Bot bots pastes one prompt and one token, watches each bot appear in the dialog, and presses Finish with no typing of bot names. A wrong token or missing header shows its reason in Calico rather than in a bot's chat.
