# Calico relay: design

Status: proposal for review. Nothing here is built. The spike code is in `~/bin/src/calico-relay-spike/` and is not in this repo.

## Goal

Agents that run in the cloud (Grok Bot today) cannot reach this computer: its LAN address changes with the Wi-Fi network, and the cloud has no route to it. Today every post hops through a connector on the desktop. The relay is a small mailbox on the public internet. An agent posts to it, the message waits, and Calico collects it whenever the computer is on.

## What the spikes established

All verified by running it, not by reading docs, unless marked.

| Question                                               | Result                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does Cloudflare let Grok Bot's cloud post to a Worker? | Yes. 4 of 5 calls passed. The one failure was Python's default `Python-urllib/*` User-Agent (error 1010). Any other User-Agent passes.                             |
| Can one Worker and one Durable Object hold a queue?    | Yes. 25 of 25 local checks: separate send and read tokens, offline queue, resume by id, a rolling window by age and count, a daily budget guard, survives restart. |
| Can the app sign a user in with OAuth?                 | Yes. PKCE, no client secret, loopback redirect `http://127.0.0.1:53682/callback`.                                                                                  |
| What does the sign-in need?                            | Scope `workers-scripts.admin`. The `.edit` scope can read Workers but every write returns 403.                                                                     |
| Can the token set the relay up?                        | Yes: upload a Worker with a Durable Object, SQLite migration and secrets; enable `workers.dev`; delete it; revoke the token.                                       |
| Token lifetime                                         | 3,600 s, no refresh token, no ID token.                                                                                                                            |
| Not tested                                             | A brand-new Cloudflare account (its `workers.dev` name is unregistered). The full end-to-end run with the real relay code. A public OAuth client.                  |

Fly.io has no free tier for new accounts and no general OAuth. Vercel has no built-in store and its deploy API permissions for OAuth are reportedly in private beta. Cloudflare is the only one that fits.

## Design

### The relay (Worker)

Source lives at `tools/relay/` in this repo and ships inside the app as a bundled file. It speaks the part of the ntfy protocol Calico needs (`POST /<topic>`, `GET /<topic>/json?poll=1&since=`), so the app's client also works with a self-hosted ntfy.

- Two random secrets, `SEND_TOKEN` and `READ_TOKEN`, are the only identity. A send token cannot read and a read token cannot send. There is no account system and no database to run.
- One Durable Object keeps a rolling window: at most `MAX_MESSAGES` (200), none older than `TTL_SECONDS` (24 h). The window drops old messages on every read and write.
- A daily request budget (default 60,000 of the free plan's 100,000) makes the relay answer `429` with `Retry-After` before Cloudflare's own limit does.
- Unauthenticated requests are refused before they reach the Durable Object, so scanning cannot spend the budget.
- Messages are at most 4 KB, which is far above an agent event.
- `GET /v1/health` returns `{"healthy": true, "version": N}`. The app compares `N` with its bundled Worker and offers an update.

### Calico side (main process)

New modules, all in `src/main/`:

- `cloudflare/oauth.ts`: PKCE (S256), a loopback listener on the registered port, a random `state`, a 5-minute timeout. Opens the system browser with `shell.openExternal`.
- `cloudflare/api.ts`: a minimal typed client: list accounts, read the `workers.dev` subdomain, upload a Worker, enable its subdomain, delete it, revoke the token. Base URLs are overridable by environment variables so tests can point them at a fake.
- `relay/setup.ts`: runs the steps in order, reports progress, cleans up after itself on failure, and revokes the token at the end whatever happened.
- `relay/client.ts`: the poll loop.

The poll loop:

- Polls every 15 s while a panel or window is active and every 60 s otherwise. It backs off exponentially after errors, up to 5 minutes, and obeys `Retry-After`. It watches `x-relay-requests-today` and slows down well before the budget.
- Remembers the last message id it applied and resumes from it. Duplicates are dropped by id.
- Validates every message with the same rules as the local webhook before it touches the store.
- Replays with the **original time**. The store gains an optional event time that only the relay path can set. A message older than the running timeout then cannot make a bot look Running. This is the one rule that makes catch-up safe.

Config gains `relay: { url, send_token, read_token, cursor }`, stored in `config.json` (mode 0600) like the webhook token and Cursor key. Tokens never go to the renderer: `info()` carries the URL and health only, and "Copy for Grok Bot" is done in the main process.

The HTTP contract the Python companion is frozen to does not change.

### UI (Settings, a new "Relay" section)

DESIGN.md fixes the sidebar at four views and allows modals only for device pickers and destructive confirmation. So this is a section in Settings, after Agent updates, with the inline confirm pattern the token flow already uses. No new colors, no spinner without a label.

States:

1. **Not set up.** Two lines of why, a button `Set up with Cloudflare…`, and a `What this does` disclosure.
2. **Confirm** (inline, amber border, like the token replacement). It says exactly what will happen: Calico opens your browser; Cloudflare asks you to approve **Workers Admin**; Calico deploys a Worker called `calico-relay` to your own account; it sets two secrets; it then revokes its own access. `Continue` and `Cancel`.
3. **Working.** A labelled step list with a status line (`role="status"`): waiting for you in the browser (with Cancel), uploading the relay, turning on its address, checking that it answers, saving. A failure says what failed and what to do.
4. **Connected.** The relay address, `Last checked 12 s ago`, how many messages are waiting, and these actions: `Copy for Grok Bot` (the URL, the send token and a note to send a `User-Agent`), `Rotate tokens` (needs a new sign-in), `Turn off` (a destructive confirm, with an option to also delete the Worker, which needs a sign-in).
5. **Problem.** `Can't reach your relay` with the reason and a retry, or `The relay's daily budget is used. It resumes at 00:00 UTC.`

The sidebar footer adds a muted `Relay connected` or `Relay offline` line under the panel status when a relay is configured. The Dashboard needs no change: its "last update" line already reflects relayed events.

A second, simpler entry point comes first (see phases): `Connect an existing relay`, which takes a URL and a read token. It also works with a self-hosted ntfy.

### Testing

- Unit: PKCE and `state` checks, the API client against a fake `fetch`, the setup state machine (each failure and the cleanup), the poll loop (resume, dedupe, backoff, `Retry-After`, stale replay never shows Running).
- E2E (Playwright, Electron): a local fake of the Cloudflare auth and API servers via the base-URL overrides, driving the real Settings UI through every state. No test touches the real Cloudflare.
- The Worker keeps its own matrix (the 25-check script) and runs it in CI with `wrangler dev`.
- The contract tests stay untouched.

### Risks and open questions

- A first-time Cloudflare account must register a `workers.dev` name. Untested, and it may need a permission the app does not have. Fallback: send the user to the dashboard for that one step.
- A public OAuth client needs a verified domain (`calico.newto.sh`), a logo and a client URL. Making it public is permanent. The consent screen will say "Workers Admin", which is the narrowest scope that can upload code.
- The token lasts an hour with no refresh. Setup is fine. Rotating tokens or updating the Worker needs a fresh sign-in.
- Cloudflare's API can change. The setup flow ends with a real publish and read through the new Worker, so it fails loudly, not silently.
- The Cloudflare free plan has no overage billing. At its limit requests simply stop, which the budget guard is there to prevent.

## Phases

1. **Relay client.** The poll loop, the store's replay-time rule, config, and Settings `Connect an existing relay`. Works with a self-hosted ntfy. This is useful on its own.
2. **The Worker.** `tools/relay/` with its tests, and a bundled copy. The 25-check matrix runs in CI.
3. **Cloudflare setup.** OAuth, the API client, the setup flow, and the Settings states above.
4. **Public client and site.** Verify `calico.newto.sh`, make the OAuth client public, update the page and the README.
5. **Agents.** Point Grok Bot at the relay with a `User-Agent`, and keep the local webhook as the fallback.

Each phase is its own pull request with its own review.
