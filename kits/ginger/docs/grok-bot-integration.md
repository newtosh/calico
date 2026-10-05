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
| `title`, `message` | Shown on the panel. Either may be empty. |
| `source` | Optional. Defaults to `grok-bot`. The inject buttons send `manual`. |
| `color` | Optional. `#RRGGBB` or `RRGGBB`. Drawn as the row’s accent. Any other value is stored and shown with the neutral mark. |
| `shape` | Optional. `circle`, `square`, `diamond`, or `triangle`. Anything else is stored and drawn as the neutral circle. |
| `icon` | Optional. A short name, or an `http`/`https` URL. The dashboard shows a URL as a small image and any other string as text. The panel does not draw icons. |

Leave `color`, `shape`, and `icon` off when you have nothing to send. An empty string, or a non-string, keeps the previous value for that agent. Omitted fields are not filled in from the agent id. Every session without a color and shape uses the same neutral circle, `#a39b88`.

Grok Bot’s own webhook body, as used by this companion today, has no icon, accent, or avatar. Cursor’s `GET /v1/agents` list items (`id`, `name`, `status`, `env`, `url`, `createdAt`, `updatedAt`, `latestRunId`) do not either. The poll forwards `color`, `shape`, and `icon` only when those exact string keys are present. It does not turn `url` into an icon, and it does not invent a color. A later poll that omits them leaves a webhook-set identity in place.

`agent.launched` marks that agent running. `agent.finished` marks it idle. `agent.needs_you` fills the panel and the dashboard with NEEDS YOU until `POST /api/dismiss` or a tap on the panel. `note` is a line in the event list and does not change agents.

The server assigns `id` and `at` and returns the event with status 201. Unknown `type`, or an agent event with an empty `agent_id`, is 400. A repeat `agent.launched` while that agent is already running or in NEEDS YOU refreshes the row, is not stored again, and does not clear NEEDS YOU.

Grok Bot has no device API here. A session is on the desk only after it POSTs `agent.launched`. Repeat that POST with the same `agent_id` while the routine is running, and post `agent.finished` when it stops. Idle rows stay. `X` in `n/X running` is every agent still in this store.

## Routine sketch

On launch:

```bash
curl -s -X POST "$DESK_URL/api/webhook/grok-bot" \
  -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent.launched","agent_id":"'"$AGENT_ID"'","title":"'"$AGENT_TITLE"'","message":"started","color":"#c45c26","shape":"diamond","icon":"scaffold"}'
```

`color`, `shape`, and `icon` are optional. Drop them to keep the neutral mark.

On finish, the same call with `"type":"agent.finished"`. While the routine is still running, repeat the launch POST with the same `agent_id`. When the routine needs a person, send `"type":"agent.needs_you"` and the question in `message`. Drop the Authorization header when no token is configured.

Dismiss from anything that is not the panel:

```bash
curl -s -X POST "$DESK_URL/api/dismiss" -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN"
```

## What this does not replace

VibePulse already shows Claude Code and Codex activity on this class of board, with its own tokenserver. XiaoZhi is a voice assistant stack and wants its own cloud account. This PoC does neither. It only shows Grok Bot and optional Cursor Cloud Agent list state, and it leaves the microphones unused. Wire the webhook if you want the AMOLED to light up when a Grok routine blocks. Keep VibePulse or XiaoZhi if you want their sessions.
