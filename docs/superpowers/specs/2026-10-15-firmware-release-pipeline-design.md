# Firmware release pipeline, design

Status: draft for review. Date: 2026-10-15. This is piece A of three. B is the in-app update notice, C is one-click USB flashing. Each gets its own spec, plan and pull request, in that order.

## Goal

Release the panel firmware on its own schedule, apart from the desktop app, with a real version number, signed and checksummed artifacts, and a small manifest the app can read. The app and the firmware stop shipping as one thing by coincidence, and each states which versions of the other it works with.

## What was asked, and what is assumed

Asked: separate the release process for the desktop app and the device; show a notice in the app when a device update is available; let the app flash over USB; never update wirelessly over Bluetooth, to avoid breaking connectivity. The notice checks automatically, with an off switch.

Assumed, and open to correction: GitHub Releases stays the host; firmware tags are `fw-v<semver>`; the first versioned firmware is `0.2.0`; the release signing key is the one that already signs the pacman packages.

## What is already true (read from the repo)

- App releases run `.github/workflows/release.yml` on tags `app-v*`. It requires the tagged commit to be on `main` and the tag to equal `package.json`, then lints, tests, builds, signs the pacman package with `packaging/calico-release.asc`'s key, attests, and opens a draft release.
- The panel reports `fw=<short git hash>` (`DESK_FW_SHA` in `firmware/main/CMakeLists.txt`), so nothing can compare two firmwares.
- CI never builds the firmware. `ci.yml` runs the host C tests and Python tools and says the ESP-IDF build "is not run here yet".
- Flashing is manual: `idf.py -p PORT app-flash`, which writes the application only and must not erase NVS (`firmware/README.md`).
- The partition table has one 8 MB `factory` app slot, a 7 MB `storage` partition, and no OTA slots. Wireless updates are not possible without a repartition, and this design keeps it that way.
- The 0.1.11 release notes said the app and firmware must be updated together. Nothing enforces it except the app refusing secrets for a panel without pairing.

## Design

### Version

`firmware/VERSION` holds one line of semver, for example `0.2.0`. CMake reads it into the project version, and the panel reports `fw=0.2.0`. The git hash stays in the image as `DESK_FW_SHA` for debugging and appears in the boot log. A panel that reports a hash instead of a semver predates this scheme and counts as older than every release.

### Tag and workflow

A new `.github/workflows/firmware-release.yml` runs on tags `fw-v*`, separate from the app workflow. It:

1. Checks that the tagged commit is on `main`, and that the tag equals `fw-v` plus the contents of `firmware/VERSION`.
2. Runs `firmware/host/run.sh` and the firmware Python tests.
3. Builds with ESP-IDF 5.5.5 in the `espressif/idf:v5.5.5` container, from `firmware/`, with the committed `sdkconfig.defaults`.
4. Collects `ginger-<version>-app.bin` (the application image that `app-flash` writes), `firmware.json`, and `SHA256SUMS`.
5. Signs the binary with the release key (detached `.sig`), verifies that signature against only the public key committed in the repo, and attests the artifacts, the same way the pacman step does.
6. Opens a draft release `fw-v<version>`. A person reviews it and publishes it, as for the app.

The job has the same permissions model as the app's: no dependency cache, no secrets in PR builds, tag-only trigger.

### Manifest

`firmware.json` is a release asset:

```json
{
  "version": "0.2.0",
  "min_app": "0.1.13",
  "artifact": "ginger-0.2.0-app.bin",
  "sha256": "<hex>",
  "size": 1234567,
  "notes_url": "https://github.com/newtosh/calico/releases/tag/fw-v0.2.0"
}
```

`min_app` is the oldest app that can talk to this firmware. It is set by hand in `firmware/RELEASE.json` and copied into the manifest, so a protocol change forces a deliberate decision. The workflow fails if `version` there does not equal `VERSION`.

### Finding the latest firmware

GitHub's `releases/latest` points at the app, so the app lists releases and takes the highest non-draft, non-prerelease tag starting with `fw-v`. Piece B owns that code. Piece A only guarantees the tag shape and the manifest.

### Compatibility, both directions

- The firmware's `min_app` protects a new panel from an old app.
- The app carries a `MIN_FIRMWARE` constant (set in piece B) and refuses secrets below it, as it does today for a panel without pairing.
- A panel on a hash version is below every `MIN_FIRMWARE`, so it is offered the update.

### No wireless updates

The single `factory` app slot stays. The firmware gets no OTA code and no new Bluetooth characteristic. The only supported ways to update are `idf.py app-flash` today and USB flashing from the app (piece C).

## Security

- Artifacts are signed with the existing release key and checked in CI against the committed public key. A wrong or missing secret fails the build.
- The manifest carries the SHA-256 of the binary. Piece C must verify the signature and the hash before it flashes anything.
- The workflow runs only on tags whose commit is on `main`, so only code that went through a pull request and its checks can ship.
- Releasing firmware never touches NVS. Wi-Fi networks, pairings and tokens survive an `app-flash`.

## Testing

- Shell test or workflow dry-run for the tag check (`fw-v` plus `VERSION`) and the `RELEASE.json` consistency check.
- A small script test for `firmware.json` generation: fields, hash, size.
- Host C test that the status formatter emits the semver from the build.
- A spike before the plan: build the current firmware in `espressif/idf:v5.5.5` on a CI runner and compare the image's size and behavior with the flashed one. The plan does not start until that passes.
- One hardware check: flash the CI-built binary, confirm `fw=0.2.0`, paired Bluetooth still works, and NVS content (networks, bonds) survived.

## Risks

- The first CI build of this firmware may need dependency pinning (`managed_components`, `dependencies.lock`) or may not fit the runner's time or disk. The spike answers this.
- The reported `fw` changes from a hash to a semver. The app handles both until old panels are gone. Anything that parses the hash, including the simulator, needs checking.
- A mistake in `min_app` could hide an update from a working app. The release review includes that field.

## Out of scope

- The in-app notice, the automatic check and its off switch (piece B).
- Flashing from the app, a bundled flasher, and USB serial access handling (piece C).
- Wireless updates, repartitioning, and a differential update.
- A firmware changelog format beyond GitHub's generated notes.
