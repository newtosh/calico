# Firmware update notice, design

Status: draft for review. Date: 2026-10-16. This is piece B of three. Piece A (the firmware release pipeline) is built and published. Piece C (flashing from the app) follows this one.

## Goal

Calico tells you when a newer panel firmware has been released and what to do about it, without you having to look. It checks for releases itself, compares them with the firmware your panel runs, and shows a notice. It also says so when a firmware needs a newer Calico first. It never changes the panel.

## What was asked, and what is assumed

Asked: an in-app notice when a panel update is available; the check runs automatically, with an off switch; the check runs on launch and twice a day. No wireless updates.

Assumed, and open to correction: the check is one unauthenticated request to GitHub's public releases API for `newtosh/calico`; the notice is a banner, not a dialog; "twice a day" means every 12 hours while Calico runs, plus once on every launch.

## What is already true (read from the repo and the live release)

- Piece A publishes `fw-v<semver>` releases. Each has `ginger-<version>-app.bin`, its `.sig`, `SHA256SUMS`, and `firmware.json` with `version`, `min_app`, `artifact`, `sha256`, `size`, `notes_url`. Firmware releases are marked not latest, so `releases/latest` stays a Calico release.
- A panel flashed before versions reports a git short SHA as `fw`. One flashed from `fw-v0.2.0` or later reports a semver.
- The panel's status poll carries only battery data (`?bat=&chg=&ext=`, `net.c`). Calico learns `fw` only when the Panel page reads the panel's status over Bluetooth or USB.
- Calico's main process already owns outbound network features (the relay, Cloudflare setup) and `config.json`. The window reaches them through the preload bridge.
- Opening links from the window goes through the main process.

## Design

### Where each part lives

- `src/main/firmware-releases.ts`: fetches, validates and ranks releases. Main only; the window never contacts GitHub.
- `src/shared/semver.ts`: strict `X.Y.Z` parse and compare, shared by main and the window.
- `CalicoInfo.firmware`: what the window needs to draw the notice (below).
- A banner next to the existing address banner, a "Panel firmware" block on the Panel page, and one switch in Settings.

### The release check

One `GET https://api.github.com/repos/newtosh/calico/releases?per_page=30` with `Accept: application/vnd.github+json` and `User-Agent: Calico/<version>`. It sends no token, no identifier and no panel data. The unauthenticated limit (60 requests an hour per address) is far above two a day.

1. Keep releases that are not drafts or pre-releases and whose tag matches `^fw-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`. Take the highest by semver, not the newest by date.
2. Fetch that release's `firmware.json` asset (an `https` URL on `github.com`, redirects only to GitHub hosts).
3. Validate it strictly and show nothing that fails: `version` equals the tag, `min_app` is a semver, `artifact` is exactly `ginger-<version>-app.bin`, `sha256` is 64 hex, `size` is an integer up to 8 MiB (the app partition), `notes_url` is exactly `https://github.com/newtosh/calico/releases/tag/fw-v<version>`.
4. Limits: 10 s timeout, 1 MiB for the list, 16 KiB for the manifest.

Any failure (offline, rate limit, bad data) is silent in the banner. The last good result stays, and the Panel page shows "last checked <time>" or "could not check". A failed check never clears a known update.

### Schedule and the off switch

The check runs about 10 s after launch, so startup never waits on it, and then every 12 hours while Calico runs. `config.json` gets `firmware_check` (default `true`). When it is off, nothing runs on a schedule. **Check now** on the Panel page always works, because the person asked. The last successful result and its time are saved in the profile so a fresh launch can show a known update before the first check returns.

### Which panel firmware Calico knows

1. Whenever the Panel page reads the panel's status (Bluetooth or USB), it tells main the `fw` it saw. Main saves it with the time.
2. **Task 5, separable:** the panel adds its version to the status poll it already sends (`&fw=0.2.1`), and the server records it next to the battery. Then Calico knows the version with no connection. Old firmware simply omits it, and Calico falls back to (1). This needs a firmware release and one flash.

A value that is not a semver (a git hash, `unknown`) counts as older than every release, as the pipeline spec says.

### The comparison

`CalicoInfo.firmware` is one of:

- `unknown`: no release known, or no panel version known. No banner.
- `current`: the panel's version is the latest or newer. A status line only.
- `available`: a newer release exists and Calico is new enough for it.
- `needs_calico`: a newer release exists but its `min_app` is above this Calico's version. The banner says to update Calico first, and gives no flash steps.

Separately, a panel below `MIN_FIRMWARE` (`0.2.0`, the first versioned release, set in code) is told it is out of date even if no newer release is known yet, since Calico refuses to send it secrets in some cases. The notice never blocks anything.

### The notice

A banner under the same rules as the address banner: a polite status, no focus change when it appears. Text: "Panel firmware 0.3.0 is available. This panel has 0.2.0." Buttons: **Release notes** (opens `notes_url`, which main checks against the exact allowed prefix before opening) and **Not now**. **Not now** is remembered per version in `config.json` (`firmware_dismissed`), so the next release shows it again. Flashing steps are one link to the firmware README's Releasing section until piece C replaces them.

The Panel page also shows a "Panel firmware" line with the panel's version, "up to date", "<version> available", or "not checked", the last check time, and **Check now**. Settings has one switch, "Check for panel firmware updates", with a sentence saying it contacts GitHub's public releases list and sends nothing about you or your panel.

## Security and privacy

- GET only, to `api.github.com` and the release asset host. No cookies, no token, no panel data. The request reveals the computer's IP address to GitHub, as any download does, and a `Calico/<version>` User-Agent.
- Everything that comes back is validated, bounded and only displayed. Calico downloads and runs no firmware here. `notes_url` is checked against an exact prefix before `openExternal`.
- The off switch stops all scheduled contact.
- Nothing is sent to the panel. No wireless updates.

## Testing

Vitest, written first: semver parse and compare (leading zeros, pre-release, huge numbers); release selection (drafts, pre-releases, wrong tags, highest by semver not by date, an app release in the list); manifest validation (each field bad in turn, a mismatched version, a hostile `notes_url`); the state machine (`unknown`/`current`/`available`/`needs_calico`, a git-hash panel, below `MIN_FIRMWARE`); the schedule (runs after the delay, then every 12 h, never when off, **Check now** when off, a failure keeps the last good result) with an injected clock and fetch; the dismissal per version; and component tests for the banner, the Panel page line and the switch. For Task 5, a host C test for the query builder and a server test for parsing `fw`, then the usual hardware pass.

## Risks

- GitHub's API shape or limits change. Mitigation: strict validation and silent failure.
- A bad `min_app` on a release hides an update from a working Calico. The release review already covers that field.
- Task 5 changes the panel's request, so it must stay inside the query buffer and the RAM budget, and it needs its own release and flash.

## Out of scope

Flashing from the app, downloading or verifying a binary, wireless updates, a changelog viewer, release channels, and notifying when Calico itself has an update.
