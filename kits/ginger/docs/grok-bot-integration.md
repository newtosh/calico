# Grok Bot webhook

The companion is the device bridge. A Scaffold or Grok Bot routine POSTs here when an agent starts, finishes, or blocks. The panel and the web UI only read the result.

Default URL: `http://<lan-host>:8787/api/webhook/grok-bot`

Send `Authorization: Bearer <token>` when `webhook_token` is set. Leave the header off when the token is empty.

## Event

```json
{
  "type": "agent.launched",
  "agent_id": "scaffold-1",
  "title": "Scaffold",
  "message": "Building the desk buddy",
  "source": "grok-bot"
}
```

| Field | Values |
| --- | --- |
| `type` | `agent.launched`, `agent.finished`, `agent.needs_you`, `note` |
| `agent_id` | Required for the three agent types. Optional on `note`. |
| `title`, `message` | Shown on the panel. JSON `\uXXXX` escapes are decoded to the character. Either may be empty. |
| `source` | Optional. Defaults to `grok-bot`. The inject buttons send `manual`. |
| `color` | Optional. `#RRGGBB` or `RRGGBB`. Drawn as the row’s accent. Any other value is stored and shown with the neutral mark. |
| `shape` | Optional. A name from the shape table. Anything else is stored and drawn as the neutral circle. |
| `icon` | Optional. A short name, or an `http`/`https` URL. The dashboard shows a URL as a small image and any other string as text. The panel does not draw icons. |

Leave `color`, `shape`, and `icon` off when you have nothing to send. An empty string, or a non-string, keeps the previous value for that agent. Omitted fields are not filled in from the agent id. Every session without a color and shape uses the same neutral circle, `#a39b88`. The companion stores a shape string as sent (clipped and lowercased) and does not drop names it does not draw.

## How long a bot stays Running

A bot shows as Running on the panel until it has gone quiet for the **running timeout**. The default is 120 seconds, the same as the old Python companion. A routine that can only fire every few minutes would flicker to idle between pings.

Raise it in Calico's Settings, under Companion, **Running timeout seconds** (30 to 3600), to more than the longest gap between a routine's pings. For Grok Bot routines that run at most every 5 minutes, use 360 or more. The tradeoff is that a bot that stops without sending `agent.finished` keeps showing Running for that long.

It can also be set with `PUT /api/config` and `{"running_timeout_seconds": 600}`, and read back with `GET /api/config?detail=1`. A plain `GET /api/config` is unchanged.

### Shapes

The panel draws a filled 24px silhouette in that agent's color, with two static pixel eyes. The attention mark is that same silhouette at 120px. Nothing circular sits behind it. The eyes are a 3×4 block on that grid (15×20 on the attention mark), starting about 7px down the face, with a 6px gap. Triangle, teardrop, and the other narrow crowns drop the pair into the wide part of the body. The ink is the body color divided by 6, or `#efe7d6` when the body is already dark (luma under 80). They do not blink. `square` and `diamond` are marks this desk already drew. `rounded_square` is the picker squircle. `oval` is the horizontal pebble.

| `shape` | Draws |
| --- | --- |
| `circle` | Circle |
| `oval`, `pebble`, `ellipse` | Horizontal pebble |
| `cloud` | Cloud |
| `rounded_square`, `rounded`, `squircle` | Rounded square |
| `star` | 4-point star |
| `flower`, `clover` | Flower |
| `heart` | Heart |
| `blob`, `splatter` | Splatter |
| `teardrop`, `drop`, `droplet` | Teardrop, point up |
| `pill`, `capsule` | Horizontal capsule |
| `triangle` | Triangle, point up |
| `pentagon`, `shield` | Pentagon |
| `sun`, `gear` | 8-point sun |
| `hexagon`, `hex` | Hexagon, point up |
| `square` | Square, the existing mark |
| `diamond` | Diamond, the existing mark |

An unknown name, or no name, is a circle.

### Colors

Sampled from the center of each swatch in a Grok Bot picker screenshot, left to right, top row then bottom. These are not official tokens. Any other `#RRGGBB` still draws. Leaving `color` off does not pick a swatch; the mark stays `#a39b88`.

| Swatch | Hex |
| --- | --- |
| White | `#ffffff` |
| Terracotta | `#845c39` |
| Red | `#df2638` |
| Orange | `#ff6700` |
| Amber | `#ff9700` |
| Green | `#009858` |
| Teal | `#00a491` |
| Blue | `#1673df` |
| Purple | `#7f4fdf` |
| Pink | `#df2e87` |
| Gray | `#767676` |

Grok Bot’s own webhook body, as used by this companion today, has no icon, accent, or avatar. Cursor’s `GET /v1/agents` list items (`id`, `name`, `status`, `env`, `url`, `createdAt`, `updatedAt`, `latestRunId`) do not either. The poll forwards `color`, `shape`, and `icon` only when those exact string keys are present. It does not turn `url` into an icon, and it does not invent a color. A later poll that omits them leaves a webhook-set identity in place.

Each agent in `GET /api/status` has `attention` (bool) and `message` (the last text for that row). `status` is `needs_you` while `attention` is set, otherwise `running` or `idle`. The top-level `phase` and `needs_you` follow the rows. There is no Grok Bot unread API. The badge is this companion's count.

| Event | Row | Badge |
| --- | --- | --- |
| `agent.launched` (new, or after idle) | `running`. Stores `message` when one is sent. | No change. A launch by itself is not unread. |
| `agent.launched` again while `running` or `attention` | Refreshes `updated_at` so a live routine does not age out. Keeps attention. A new `message` updates that row's aside and is logged once. The same text is not logged again. | No change. |
| `agent.needs_you` | Sets that agent's `attention` and `message`. Phase becomes `needs_you`. | The number of agents waiting. |
| `agent.finished` while that agent has attention | Underlying status goes `idle`. Attention and the question stay, so the lamp and the row stay up. | No change. |
| `agent.finished` otherwise | `idle`. Clears that row's message. | No change. |
| `note` with a `message` | Does not change agents. The note is the face text. | 1 while that note is the latest text and nobody is waiting. A later event or a badge tap clears it. |
| `POST /api/dismiss` | Clears attention and the question on agents that were waiting. A JSON body `{"agent_id":"..."}` clears that agent only and leaves the others up. An empty body, or a body without `agent_id`, clears every waiter. A row that had already finished stays `idle`. A row that was still running stays `running`. Other agents' messages stay. | 0 when nobody is left waiting. Otherwise the number still waiting. |
| `POST /api/unread/dismiss` | No agent change. | Stored count 0, but still the number of agents waiting. |

A `running` row whose `updated_at` is older than the running timeout (120 seconds by default, see [How long a bot stays Running](#how-long-a-bot-stays-running)) is reported as `idle`, and the phase and running count follow. Attention does not age out. Repeat `agent.launched` with the same `agent_id` while the routine is running is the heartbeat. Grok Bot chat unread is not readable from here, so a session that never POSTs stays off the desk.

The server assigns `id` and `at` and returns the event with status 201. Unknown `type`, or an agent event with an empty `agent_id`, is 400. A repeat `agent.launched` while that agent is already running or waiting is not stored again unless the message changed, and it does not clear attention. When one agent is waiting, `last_event.title` and `last_event.message` in the status payload are that agent's name and question, so the face aside binds to that row.

Grok Bot has no device API here. A session is on the desk only after it POSTs `agent.launched`. Repeat that POST with the same `agent_id` while the routine is running, and post `agent.finished` when it stops. Idle rows stay. `X` in `n/X running` is every agent still in this store. `GET /api/status` returns that full list. The panel keeps 24 rows and scrolls them.

## Routine sketch

On launch:

```bash
curl -s -X POST "$DESK_URL/api/webhook/grok-bot" \
  -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent.launched","agent_id":"'"$AGENT_ID"'","title":"'"$AGENT_TITLE"'","message":"started","color":"#c45c26","shape":"diamond","icon":"scaffold"}'
```

`color`, `shape`, and `icon` are optional. Drop them to keep the neutral mark.

On finish, the same call with `"type":"agent.finished"`. While the routine is still running, repeat the launch POST with the same `agent_id` (a new `message` updates the aside; it does not add unread). When the routine needs a person, send `"type":"agent.needs_you"` and the question in `message`. That question stays on the row until `POST /api/dismiss`, including if `agent.finished` arrives first. Drop the Authorization header when no token is configured.

Dismiss from anything that is not the panel. The panel itself dismisses the card on screen (a tap, or a downward swipe) and posts that agent's id. `Dismiss all`, and this curl with no body, clear every waiter:

```bash
curl -s -X POST "$DESK_URL/api/dismiss" -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN"
```

```bash
curl -s -X POST "$DESK_URL/api/dismiss" \
  -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"'"$AGENT_ID"'"}'
```

The face does not keep a second queue. Waiting agents in `GET /api/status` are the stack, newest `updated_at` first. Two events in the same second stay in arrival order. A second `agent.needs_you` while the sheet is up covers the first card. `N new` is how many cards are still underneath. Swipe left for the older card and right to come back. To see that on the simulator or the panel, post two needs-you events before dismissing:

```bash
curl -s -X POST "$DESK_URL/api/webhook/grok-bot" \
  -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent.needs_you","agent_id":"scaffold","title":"Scaffold","message":"Pick one","color":"#1673df","shape":"diamond"}'
curl -s -X POST "$DESK_URL/api/webhook/grok-bot" \
  -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent.needs_you","agent_id":"grove","title":"Grove","message":"Your turn","color":"#c45c26","shape":"cloud"}'
```

The second card is on top, with a terracotta edge, and `1 new` under the cloud. Swipe left to the Scaffold diamond.

Ask the panel for one frame. The next status poll carries `"capture": true` (right after `unread`). The panel then POSTs `image/bmp`. Fetch it without the bearer:

```bash
curl -s -X POST "$DESK_URL/api/frame/request" -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN"
curl -s "$DESK_URL/api/frame" -o /tmp/desk.bmp
```

`GET /api/status` includes `unread`. The badge is the number of agents in attention. If none are waiting, a note that is still the latest event and has text shows 1. A first launch does not raise it. `POST /api/dismiss` clears it along with attention. A badge with no waiting row and no note text is stored back as 0 on the next status read, including a count left over from an older build. Restart the companion after this build so attention, per-agent messages, and that badge rule are loaded. Flash the panel to pick up row binding when `last_event` is not the only copy of the question. A tap on the badge, or:

```bash
curl -s -X POST "$DESK_URL/api/unread/dismiss" -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN"
```

sets the stored count to 0. Agents still waiting keep the badge. The face row is empty at 0.

## What this does not replace

VibePulse already shows Claude Code and Codex activity on this class of board, with its own tokenserver. XiaoZhi is a voice assistant stack and wants its own cloud account. This PoC does neither. It only shows Grok Bot and optional Cursor Cloud Agent list state, and it leaves the microphones unused. Wire the webhook if you want the AMOLED to light up when a Grok routine blocks. Keep VibePulse or XiaoZhi if you want their sessions.
