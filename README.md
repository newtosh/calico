# Calico

Desktop companion and developer kit for [grokbot-buddy](https://github.com/newtosh/grokbot-buddy), an ESP32-S3 AMOLED desk panel that shows what your coding agents are doing.

> Status: pre-alpha. Built in public. The first release targets Linux.

## What it does

- Runs the companion server the panel polls (`/api/status` on port 8787 by default) and receives agent webhooks.
- Shows a dashboard of agents, events, and the panel's state.
- Sets up the panel over USB or Bluetooth: Wi-Fi (tested before it is saved), companion URL, token, reboot.
- Lives in the tray and starts at login, so the panel keeps working when the window is closed.

Planned: firmware flashing and a first-run wizard, a screen simulator built from the real firmware UI, more agent integrations, macOS and Windows.

## Install

Linux packages (AppImage, deb, pacman) are attached to each [release](https://github.com/newtosh/calico/releases). Each release lists SHA-256 checksums and a build provenance attestation:

```bash
sha256sum -c SHA256SUMS
gh attestation verify Calico-*.AppImage --repo newtosh/calico
```

The tray icon needs a StatusNotifier host. KDE and most panels have one. GNOME needs the AppIndicator extension.

## Develop

Requires Node 22.12+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

The companion listens on your LAN with no accounts. Anyone on the same network can read status. Writes require the bearer token when one is set. Do not port-forward it. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
