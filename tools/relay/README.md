# Calico relay

A one-person mailbox on Cloudflare Workers. An agent that runs in the cloud posts an update to it, the update waits, and Calico collects it the next time the computer is on. The design is in `docs/superpowers/specs/2026-10-10-calico-relay-design.md`.

It speaks the part of the [ntfy](https://ntfy.sh) protocol Calico needs, so the app's relay client also works against a self-hosted ntfy.

| Request                                  | Token       | Does                                                         |
| ---------------------------------------- | ----------- | ------------------------------------------------------------ |
| `POST /<topic>`                          | send token  | Stores the body (up to `MAX_BODY_BYTES`) as one message.     |
| `GET /<topic>/json?poll=1&since=<id>`    | read token  | Returns the messages after `id`, oldest first, as NDJSON. `since=all` returns every message. |
| `GET /v1/health`                         | none        | `{"healthy": true, "version": N}`.                           |

A send token cannot read and a read token cannot send. Requests without the right token are refused before they reach storage, so scanning cannot spend the daily budget. If a token is not set, the Worker answers `405` instead of letting anyone in.

## Limits

Set in `wrangler.jsonc` as plain variables.

| Variable               | Default | Meaning                                                           |
| ---------------------- | ------- | ----------------------------------------------------------------- |
| `TOPIC`                | `inbox` | The one topic it serves.                                          |
| `TTL_SECONDS`          | `86400` | A message older than this is dropped.                             |
| `MAX_MESSAGES`         | `200`   | Only the newest this many are kept.                               |
| `MAX_BODY_BYTES`       | `4096`  | Larger bodies are refused with `413`.                             |
| `DAILY_REQUEST_BUDGET` | `60000` | After this many requests in a UTC day, `429` with `Retry-After`. The free plan allows 100,000. |

Every answer carries `x-relay-requests-today` and `x-relay-budget`. The count is kept in memory, so it is a guard and not an exact meter. A restart of the Durable Object resets it.

## Deploy by hand

Calico's Settings can set this up for you. To do it yourself:

```sh
cd tools/relay
npm install
npx wrangler deploy
openssl rand -hex 24 | sed 's/^/send_/' | npx wrangler secret put SEND_TOKEN
openssl rand -hex 24 | sed 's/^/read_/' | npx wrangler secret put READ_TOKEN
```

Then give your agents `https://calico-relay.<your-subdomain>.workers.dev/inbox` and the send token, and give Calico the same address and the read token. Agents must send a `User-Agent` header: Cloudflare turns away Python's default `Python-urllib/*`.

## Tests

```sh
npm install
npm test
```

The tests start the real Worker in a local `workerd` through `wrangler dev`, with small limits (a 5 second window, 5 messages, a budget of 400), and check who may do what, the offline queue, sizes, the rolling window, the budget guard, a restart, and a relay with no tokens. They take about a minute. CI runs them as the `relay worker` job.
