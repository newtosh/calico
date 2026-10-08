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

The server refuses any request that carries an `Origin` header (403). The panel, agent webhooks, and the packaged app send none, while browsers always do on cross-origin requests. This keeps web pages you visit from reading the panel token or changing settings. Writes still need the webhook token when one is set; without one, anything on your LAN can post events.
