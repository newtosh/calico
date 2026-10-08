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
