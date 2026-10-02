# Grok desk buddy

A LAN desk companion for Jon’s Waveshare ESP32-S3-Touch-AMOLED-2.16. The panel shows whether Grok Bot or Cursor agents are running, idle, or blocked. A small Python process on the LAN is the bridge, because Grok Bot has no device SDK. The browser UI configures that bridge and can inject demo events without the board.

This sits next to [VibePulse](https://github.com/niclasvestlund-YT/vibepulse) and [XiaoZhi](https://github.com/78/xiaozhi-esp32). It does not replace either, and it does not use a Xiaozhi cloud account.

```mermaid
flowchart LR
  grok[Grok Bot routine]
  cursor[Cursor Cloud Agents API]
  web[React UI]
  comp[Companion]
  panel[AMOLED panel]

  grok -->|POST /api/webhook/grok-bot| comp
  cursor -->|GET /v1/agents optional| comp
  web -->|status, config, inject| comp
  panel -->|GET /api/status| comp
```

## Quickstart

From the repo root, with Python 3.11+ and Node 22:

```bash
cd web && npm install && npm run build && cd ..
PYTHONPATH=companion/src python3 -m grok_desk_buddy
```

Open http://127.0.0.1:8787. The Inject buttons post `agent.launched`, `agent.finished`, `agent.needs_you`, and `note`. The dashboard polls `/api/status` every two seconds.

Dev UI with live reload, while the companion is already running:

```bash
cd web && npm run dev
```

Vite proxies `/api` to port 8787.

Optional Cursor list polling starts when `CURSOR_API_KEY` is set. It maps `ACTIVE` to running and `IDLE` / `ARCHIVED` to idle. It never raises NEEDS YOU. That signal is only the webhook. Copy `.env.example` and export the variables you need, or set them in the web config form. Secrets go to `companion/data/config.json`, which is gitignored.

## Flash the panel

See [firmware/README.md](firmware/README.md). ESP-IDF 5.4, target `esp32s3`, BSP `waveshare/esp32_s3_touch_amoled_2_16`. Without a toolchain, run the `desk_view` host test and open `firmware/simulator/index.html`.

## Grok Bot

Point a Scaffold routine at the companion on launch and on finish. Full schema and a curl example: [docs/grok-bot-integration.md](docs/grok-bot-integration.md).

```bash
curl -s -X POST http://127.0.0.1:8787/api/webhook/grok-bot \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent.needs_you","agent_id":"scaffold","title":"Scaffold","message":"Pick one"}'
```

If a webhook bearer token is set, add `-H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN"`. `GET /api/status` stays open so the panel can poll before anyone types a token into NVS.

## Security

Bind is `0.0.0.0:8787` so a phone or the panel on the same LAN can connect. There is no account system. Anyone on the LAN can read status. Writes (webhook, dismiss, config) require the bearer token only when one is configured. Do not port-forward this process and do not put it on a shared network you do not trust. The token is a shared LAN secret, not a user login.

## Tests

```bash
cd companion && python3 -m pytest && python3 -m ruff check src tests && python3 -m black --check src tests
cd ../web && npm test -- --run && npm run build
gcc -Wall -Werror -I firmware/main firmware/host/test_desk_view.c firmware/main/desk_view.c -o /tmp/test_desk_view && /tmp/test_desk_view
```

## License

MIT. See [LICENSE](LICENSE).
