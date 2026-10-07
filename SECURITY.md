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
