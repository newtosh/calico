# Contributing

Thanks for looking. Calico is a solo project built in public, so the process is small but strict.

## Setup

```bash
pnpm install
pre-commit install
pnpm dev
```

`pre-commit` runs eslint, prettier, and gitleaks before each commit.

## Branches and pull requests

- `main` is protected. Every change lands through a pull request with a green `ci` check and a linear history.
- Branch names: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
- Commit subjects follow Conventional Commits (`feat: add BLE picker`).
- Keep pull requests to one concern.

## Review order

1. CI is green.
2. Self-review the diff against [docs/review-rules.md](docs/review-rules.md). Resolve every review thread before merging.
3. Renderer changes get a UI audit against [DESIGN.md](DESIGN.md) and the checklist in the pull request template.
4. Merge with squash.

## Rules that reviewers enforce

- `src/server/` never imports Electron. ESLint fails the build if it does.
- The panel's HTTP contract is frozen. `test/contract` must pass unchanged.
- Never log Wi-Fi passwords or tokens.
- No new runtime dependency without a reason in the pull request description.

## Firmware

The firmware lives in `firmware/` (see [firmware/README.md](firmware/README.md) for building and flashing). Run its host tests with `firmware/host/run.sh`. A change to the Bluetooth or USB protocol touches both sides in one pull request: `docs/usb-console-protocol.md` is the contract, and a test in `src/renderer/src/device/ble.test.ts` fails if the BLE UUIDs in `firmware/main/ble_desk.h` and the app drift apart.

## Project site

`site/` is a static page served from a VM by Caddy at https://calico.newto.sh. It no longer goes through GitHub Pages, so a merge does not update it. After a site change lands on `main`, deploy by hand:

```bash
pnpm deploy:site
```

That runs `scripts/deploy-site.sh`: one `rsync` of `site/` over SSH, then a check that the page answers. It uses the SSH host alias `nitpub` and the directory `/var/www/calico`. Override them with `SITE_HOST` and `SITE_DIR`, and the checked page with `SITE_URL`. The script refuses a directory shallower than three levels or containing `..`, and refuses to run without `site/index.html`, because `rsync --delete` empties its target. No key or password lives in the repository.

The VM needs this once: `rsync` installed, ports 80 and 443 open for Caddy's certificate check, a DNS A record for `calico` pointing at it, the directory `/var/www/calico` writable by the SSH user, and a Caddy block that serves it. Caddy fetches the certificate.

```
calico.newto.sh {
	encode gzip
	root * /var/www/calico
	file_server
}
```
