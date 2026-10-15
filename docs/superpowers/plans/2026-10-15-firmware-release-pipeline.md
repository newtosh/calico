# Firmware Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the panel firmware on its own `fw-v*` tag with a real semver, signed artifacts and a `firmware.json` manifest, separate from the app's release.

**Architecture:** `firmware/VERSION` and `firmware/RELEASE.json` are the source of truth. CMake bakes the version into the image and the panel reports it as `fw`. A small Python helper (`firmware/scripts/fw_release.py`) checks the tag and writes the manifest. A new `firmware-release.yml` builds in the ESP-IDF container with no secrets, then a second job signs, attests and opens a draft release. No OTA, no app change.

**Tech Stack:** ESP-IDF 5.5.5 (`espressif/idf:v5.5.5`), CMake, C (firmware), Python 3 + pytest (helper and its tests), GitHub Actions, GPG (the existing release key), `gh`.

**Spec:** `docs/superpowers/specs/2026-10-15-firmware-release-pipeline-design.md`

## Global Constraints

- Tags are `fw-v<semver>`; the semver is `X.Y.Z` only, no pre-release suffix. The first versioned firmware is `0.2.0`. `min_app` for it is `0.1.13`.
- `firmware/VERSION` holds one line of semver. The tag must equal `fw-v` plus its contents.
- The panel reports `fw=<semver>`. `DESK_FW_SHA` stays in the image for debugging and appears in the boot log. A panel that reports a hash predates the scheme and counts as older than every release (this matters to piece B, not here).
- The tagged commit must be on `main`. Only a tag push can publish. No dependency cache. No secrets in the container build job.
- Artifacts: `ginger-<version>-app.bin`, `firmware.json`, `SHA256SUMS`, a detached `.sig` made with the release key and verified only against the committed `packaging/calico-release.asc`, and a build attestation. The release is a draft.
- `firmware.json` fields: `version`, `min_app`, `artifact`, `sha256`, `size`, `notes_url`.
- No wireless updates: do not touch `firmware/partitions.csv`, and add no OTA code or Bluetooth characteristic.
- Releasing never touches NVS. Do not erase.
- Firmware releases are never "latest": pass `--latest=false`, because the app's stable download URL (`releases/latest/download/Calico-x64.pacman`) depends on the latest release being an app release.
- Pin every third-party action to a full commit SHA with a version comment, as `release.yml` does.
- No Claude session links in PR bodies. Minimize em-dashes in prose and comments.

## Review Focus

- A `VERSION` file with a trailing newline or spaces must still match its tag. A tag with a missing `v`, or `fw-v0.2.0-rc1`, must fail. (Task 2)
- `RELEASE.json` whose `version` differs from `VERSION`, or whose `min_app` is not `X.Y.Z`, must fail the release before anything builds. (Task 2)
- A missing or empty artifact must fail the manifest step instead of writing a manifest for nothing. (Task 2)
- The workflow must not publish from a manual run or a non-tag ref: a `workflow_dispatch` run builds and uploads only. (Task 3)
- The signing key must never reach the container build job. (Task 3)

## File Structure

- Create `firmware/VERSION`: one line, `0.2.0`.
- Create `firmware/RELEASE.json`: `{"version": "0.2.0", "min_app": "0.1.13"}`.
- Modify `firmware/main/CMakeLists.txt`: read `VERSION`, define `DESK_FW_VERSION`.
- Modify `firmware/main/ble_link.c`: report `DESK_FW_VERSION` instead of `DESK_FW_SHA`.
- Modify `firmware/main/main.c`: one boot log line with both.
- Create `firmware/scripts/fw_release.py` and `firmware/scripts/test_fw_release.py`: tag check, release-file check, manifest.
- Create `firmware/scripts/test_fw_version.py`: pins the VERSION, RELEASE.json and wiring.
- Create `.github/workflows/firmware-release.yml`, and `firmware/scripts/test_fw_workflow.py` to pin its safety properties.
- Modify `firmware/README.md`: how to release firmware.

---

### Task 1: Version source and wiring

**Files:**

- Create: `firmware/VERSION`, `firmware/RELEASE.json`
- Modify: `firmware/main/CMakeLists.txt`, `firmware/main/ble_link.c:36-38,340,353`, `firmware/main/main.c`
- Test: `firmware/scripts/test_fw_version.py`

**Interfaces:**

- Consumes: nothing.
- Produces: the macro `DESK_FW_VERSION` (a string literal such as `"0.2.0"`) and the files `firmware/VERSION`, `firmware/RELEASE.json` that Task 2 reads.

- [ ] **Step 1: Write the failing test**

```python
"""Pins the firmware version source and where the panel reports it."""

from __future__ import annotations

import json
import re
from pathlib import Path

FW = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def test_version_is_one_line_of_semver():
    text = (FW / "VERSION").read_text(encoding="utf-8")
    assert SEMVER.match(text.strip()), text
    assert len(text.strip().splitlines()) == 1


def test_release_file_matches_version():
    version = (FW / "VERSION").read_text(encoding="utf-8").strip()
    data = json.loads((FW / "RELEASE.json").read_text(encoding="utf-8"))
    assert data["version"] == version
    assert SEMVER.match(data["min_app"])


def test_cmake_bakes_the_version_in():
    cmake = (FW / "main" / "CMakeLists.txt").read_text(encoding="utf-8")
    assert 'file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/../VERSION"' in cmake
    assert 'DESK_FW_VERSION=' in cmake


def test_status_reports_the_version_not_the_hash():
    link = (FW / "main" / "ble_link.c").read_text(encoding="utf-8")
    assert "DESK_FW_VERSION" in link
    assert "ble_desk_format_status(body, sizeof(body), DESK_FW_VERSION" in link
    assert "ble_desk_format_status_locked(body, sizeof(body), DESK_FW_VERSION" in link
    assert "DESK_FW_SHA, ssid" not in link
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd firmware/scripts && python3 -m pytest -q test_fw_version.py`
Expected: FAIL (`VERSION` not found, then the CMake and ble_link assertions).

- [ ] **Step 3: Implement**

`firmware/VERSION`: the single line `0.2.0` and a trailing newline.

`firmware/RELEASE.json`:

```json
{
  "version": "0.2.0",
  "min_app": "0.1.13"
}
```

`firmware/main/CMakeLists.txt`: add after the `DESK_FW_SHA` block and before `idf_component_register`:

```cmake
file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/../VERSION" DESK_FW_VERSION LIMIT_COUNT 1)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/../VERSION")
```

and add next to the existing `target_compile_definitions` line:

```cmake
target_compile_definitions(${COMPONENT_LIB} PRIVATE "DESK_FW_VERSION=\"${DESK_FW_VERSION}\"")
```

`firmware/main/ble_link.c`: next to the `#ifndef DESK_FW_SHA` fallback (line 36) add the same for the version:

```c
#ifndef DESK_FW_VERSION
#define DESK_FW_VERSION "unknown"
#endif
```

and change both status calls (lines 340 and 353) to pass `DESK_FW_VERSION` instead of `DESK_FW_SHA`.

`firmware/main/main.c`: in `app_main`, as the first statement after any existing banner, add one line using the file's existing log tag (read the file for its `TAG` name):

```c
ESP_LOGI(TAG, "ginger %s (%s)", DESK_FW_VERSION, DESK_FW_SHA);
```

If `main.c` does not see the macros, add the same `#ifndef` fallbacks near its includes.

- [ ] **Step 4: Run the test, the host tests, and the Python suite**

Run: `cd firmware/scripts && python3 -m pytest -q --deselect test_ble_provision.py::test_wifi_join_and_glass_scan_use_psram_stacks` and `firmware/host/run.sh`
Expected: all pass. (The deselected test fails on `main` already; leave it.)

- [ ] **Step 5: Commit**

```bash
git add firmware/VERSION firmware/RELEASE.json firmware/main/CMakeLists.txt firmware/main/ble_link.c firmware/main/main.c firmware/scripts/test_fw_version.py
git commit -m "Report a semver from the panel and keep the git hash in the boot log"
```

---

### Task 2: Release helper

**Files:**

- Create: `firmware/scripts/fw_release.py`
- Test: `firmware/scripts/test_fw_release.py`

**Interfaces:**

- Consumes: `firmware/VERSION` and `firmware/RELEASE.json` from Task 1.
- Produces, for Task 3's workflow: the CLI `python3 firmware/scripts/fw_release.py check-tag <tag>` (exit 0 or a message and exit 1) and `python3 firmware/scripts/fw_release.py manifest <artifact> <out.json> --repo <owner/name>`; the functions `read_version(path) -> str`, `read_release(path, version) -> dict`, `check_tag(tag, version) -> None`, `make_manifest(version, min_app, artifact, repo) -> dict`; the exception `ReleaseError`.

- [ ] **Step 1: Write the failing tests**

```python
"""Host checks for the firmware release helper."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

import fw_release as r


def test_version_trims_whitespace(tmp_path: Path):
    p = tmp_path / "VERSION"
    p.write_text("  0.2.0 \n", encoding="utf-8")
    assert r.read_version(p) == "0.2.0"


@pytest.mark.parametrize("bad", ["0.2", "v0.2.0", "0.2.0-rc1", "", "0.2.0\n0.3.0"])
def test_version_must_be_plain_semver(tmp_path: Path, bad: str):
    p = tmp_path / "VERSION"
    p.write_text(bad, encoding="utf-8")
    with pytest.raises(r.ReleaseError):
        r.read_version(p)


def test_tag_must_be_fw_v_plus_version():
    r.check_tag("fw-v0.2.0", "0.2.0")
    for tag in ["v0.2.0", "fw-0.2.0", "app-v0.2.0", "fw-v0.2.0-rc1", "fw-v0.2.1"]:
        with pytest.raises(r.ReleaseError):
            r.check_tag(tag, "0.2.0")


def write_release(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "RELEASE.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def test_release_file_must_agree_with_version(tmp_path: Path):
    ok = write_release(tmp_path, {"version": "0.2.0", "min_app": "0.1.13"})
    assert r.read_release(ok, "0.2.0")["min_app"] == "0.1.13"
    bad_version = write_release(tmp_path, {"version": "0.3.0", "min_app": "0.1.13"})
    with pytest.raises(r.ReleaseError):
        r.read_release(bad_version, "0.2.0")
    for min_app in ["", "0.1", "latest", None]:
        bad = write_release(tmp_path, {"version": "0.2.0", "min_app": min_app})
        with pytest.raises(r.ReleaseError):
            r.read_release(bad, "0.2.0")


def test_manifest_has_the_hash_size_and_notes_link(tmp_path: Path):
    art = tmp_path / "ginger-0.2.0-app.bin"
    art.write_bytes(b"firmware bytes")
    m = r.make_manifest("0.2.0", "0.1.13", art, "newtosh/calico")
    assert m == {
        "version": "0.2.0",
        "min_app": "0.1.13",
        "artifact": "ginger-0.2.0-app.bin",
        "sha256": hashlib.sha256(b"firmware bytes").hexdigest(),
        "size": len(b"firmware bytes"),
        "notes_url": "https://github.com/newtosh/calico/releases/tag/fw-v0.2.0",
    }


def test_manifest_refuses_a_missing_or_empty_artifact(tmp_path: Path):
    with pytest.raises(r.ReleaseError):
        r.make_manifest("0.2.0", "0.1.13", tmp_path / "nope.bin", "newtosh/calico")
    empty = tmp_path / "empty.bin"
    empty.write_bytes(b"")
    with pytest.raises(r.ReleaseError):
        r.make_manifest("0.2.0", "0.1.13", empty, "newtosh/calico")


def test_cli_check_tag_reads_the_repo_files(capsys):
    version = r.read_version(r.FW_DIR / "VERSION")
    assert r.main(["check-tag", f"fw-v{version}"]) == 0
    assert r.main(["check-tag", "fw-v9.9.9"]) == 1
    assert "does not match" in capsys.readouterr().err


def test_cli_manifest_writes_json(tmp_path: Path):
    art = tmp_path / "a.bin"
    art.write_bytes(b"x")
    out = tmp_path / "firmware.json"
    assert r.main(["manifest", str(art), str(out), "--repo", "newtosh/calico"]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["artifact"] == "a.bin"
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd firmware/scripts && python3 -m pytest -q test_fw_release.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'fw_release'`.

- [ ] **Step 3: Implement**

```python
#!/usr/bin/env python3
"""Release helpers for the firmware workflow: the tag check and the manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

FW_DIR = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


class ReleaseError(Exception):
    pass


def read_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not SEMVER.match(text):
        raise ReleaseError(f"VERSION must be X.Y.Z, got {text!r}")
    return text


def read_release(path: Path, version: str) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != version:
        raise ReleaseError(
            f"RELEASE.json version {data.get('version')!r} does not match VERSION {version!r}"
        )
    if not SEMVER.match(str(data.get("min_app") or "")):
        raise ReleaseError(f"RELEASE.json min_app must be X.Y.Z, got {data.get('min_app')!r}")
    return data


def check_tag(tag: str, version: str) -> None:
    if tag != f"fw-v{version}":
        raise ReleaseError(f"tag {tag!r} does not match fw-v{version}")


def make_manifest(version: str, min_app: str, artifact: Path, repo: str) -> dict:
    if not artifact.is_file():
        raise ReleaseError(f"artifact {artifact} does not exist")
    data = artifact.read_bytes()
    if not data:
        raise ReleaseError(f"artifact {artifact} is empty")
    return {
        "version": version,
        "min_app": min_app,
        "artifact": artifact.name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "notes_url": f"https://github.com/{repo}/releases/tag/fw-v{version}",
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    tag = sub.add_parser("check-tag")
    tag.add_argument("tag")
    man = sub.add_parser("manifest")
    man.add_argument("artifact", type=Path)
    man.add_argument("out", type=Path)
    man.add_argument("--repo", required=True)
    args = parser.parse_args(argv)
    try:
        version = read_version(FW_DIR / "VERSION")
        release = read_release(FW_DIR / "RELEASE.json", version)
        if args.cmd == "check-tag":
            check_tag(args.tag, version)
        else:
            manifest = make_manifest(version, release["min_app"], args.artifact, args.repo)
            args.out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    except ReleaseError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd firmware/scripts && python3 -m pytest -q test_fw_release.py test_fw_version.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add firmware/scripts/fw_release.py firmware/scripts/test_fw_release.py
git commit -m "Add the firmware release helper: tag check and manifest"
```

---

### Task 3: Release workflow

**Files:**

- Create: `.github/workflows/firmware-release.yml`
- Test: `firmware/scripts/test_fw_workflow.py`

**Interfaces:**

- Consumes: the CLI from Task 2 and the version files from Task 1.
- Produces: a workflow that builds on every `fw-v*` tag and on manual dispatch, and publishes a draft release only on a tag.

- [ ] **Step 1: Write the failing test**

```python
"""Pins the safety properties of the firmware release workflow."""

from __future__ import annotations

import re
from pathlib import Path

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "firmware-release.yml"


def text() -> str:
    return WF.read_text(encoding="utf-8")


def job(name: str) -> str:
    body = text().split(f"\n  {name}:\n", 1)[1]
    return re.split(r"\n  [a-z-]+:\n", body, maxsplit=1)[0]


def test_triggers_on_fw_tags_and_manual_runs_only():
    on = text().split("\njobs:", 1)[0]
    assert 'tags: ["fw-v*"]' in on
    assert "workflow_dispatch:" in on
    assert "pull_request" not in on


def test_every_action_is_pinned_to_a_commit():
    for line in text().splitlines():
        if "uses:" in line:
            assert re.search(r"@[0-9a-f]{40}\b", line), line


def test_build_job_has_no_secrets_and_no_write_permission():
    build = job("build")
    assert "secrets." not in build
    assert "contents: write" not in build
    assert "espressif/idf:v5.5.5" in build
    assert "git merge-base --is-ancestor" in build
    assert "fw_release.py check-tag" in build


def test_publish_only_runs_for_a_tag_and_after_build():
    publish = job("publish")
    assert "needs: build" in publish
    assert "startsWith(github.ref, 'refs/tags/fw-v')" in publish
    assert "RELEASE_GPG_KEY" in publish
    assert "--draft" in publish
    assert "--latest=false" in publish
    assert "packaging/calico-release.asc" in publish
    assert "actions/attest@" in publish
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd firmware/scripts && python3 -m pytest -q test_fw_workflow.py`
Expected: FAIL (`FileNotFoundError` for the workflow).

- [ ] **Step 3: Resolve the two action pins you do not have yet**

`actions/checkout` and `actions/attest` pins are in `.github/workflows/release.yml`; copy them. For `actions/upload-artifact` and `actions/download-artifact`, find the newest release at least two weeks old and its commit SHA:

```bash
for a in upload-artifact download-artifact; do
  tag=$(gh api repos/actions/$a/releases --jq '[.[] | select(.prerelease==false)][0].tag_name')
  echo "$a $tag $(gh api repos/actions/$a/git/ref/tags/$tag --jq .object.sha)"
done
```

If the printed object is an annotated tag (`gh api repos/actions/$a/git/tags/<sha> --jq .object.sha` returns a commit), use the commit SHA it points to. Record each as `uses: actions/<name>@<40-hex-sha> # <tag>`.

- [ ] **Step 4: Write the workflow**

```yaml
name: firmware-release
on:
  push:
    tags: ["fw-v*"]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    # No secrets here: this job runs the vendor toolchain and fetches components.
    container: espressif/idf:v5.5.5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - name: Mark the workspace safe for git
        run: git config --global --add safe.directory "$GITHUB_WORKSPACE"
      - name: Tagged commit is on main
        if: startsWith(github.ref, 'refs/tags/fw-v')
        run: git merge-base --is-ancestor "$GITHUB_SHA" origin/main
      - name: Tag matches firmware/VERSION and RELEASE.json
        if: startsWith(github.ref, 'refs/tags/fw-v')
        run: python3 firmware/scripts/fw_release.py check-tag "$GITHUB_REF_NAME"
      - name: Host tests
        run: firmware/host/run.sh
      - name: Build
        run: |
          . "$IDF_PATH/export.sh"
          cd firmware
          idf.py build
      - name: Collect artifacts
        run: |
          version="$(tr -d '[:space:]' < firmware/VERSION)"
          mkdir dist
          cp firmware/build/ginger.bin "dist/ginger-${version}-app.bin"
          python3 firmware/scripts/fw_release.py manifest "dist/ginger-${version}-app.bin" dist/firmware.json --repo "$GITHUB_REPOSITORY"
          cd dist && sha256sum ./*.bin > SHA256SUMS
      - uses: actions/upload-artifact@<SHA> # <tag from step 3>
        with:
          name: firmware-dist
          path: dist/
          if-no-files-found: error
  publish:
    needs: build
    if: startsWith(github.ref, 'refs/tags/fw-v')
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      id-token: write
      attestations: write
      artifact-metadata: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/download-artifact@<SHA> # <tag from step 3>
        with:
          name: firmware-dist
          path: dist
      - name: Sign the firmware
        env:
          RELEASE_GPG_KEY: ${{ secrets.RELEASE_GPG_KEY }}
        run: |
          test -n "$RELEASE_GPG_KEY" || { echo "::error::RELEASE_GPG_KEY is not set"; exit 1; }
          export GNUPGHOME="$(mktemp -d)"
          printf '%s\n' "$RELEASE_GPG_KEY" | gpg --batch --quiet --import
          for f in dist/*.bin; do gpg --batch --detach-sign --output "$f.sig" "$f"; done
          # Verify against only the public key committed in the repo, which is
          # what users trust, so a stale or wrong secret fails here.
          export GNUPGHOME="$(mktemp -d)"
          gpg --batch --quiet --import packaging/calico-release.asc
          for f in dist/*.bin; do gpg --batch --verify "$f.sig" "$f"; done
      - uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2
        with:
          subject-path: dist/*.bin
      - name: Draft release
        run: gh release create "$GITHUB_REF_NAME" --draft --latest=false --generate-notes --verify-tag dist/*.bin dist/*.bin.sig dist/firmware.json dist/SHA256SUMS
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 5: Run the tests and lint the workflow**

Run: `cd firmware/scripts && python3 -m pytest -q test_fw_workflow.py` and, if `actionlint` is installed, `actionlint .github/workflows/firmware-release.yml`.
Expected: PASS. If `actionlint` is missing, say so in the report; do not install it.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/firmware-release.yml firmware/scripts/test_fw_workflow.py
git commit -m "Build and release the firmware on its own fw-v tag"
```

---

### Task 4: Spike, then document

**Files:**

- Modify: `firmware/README.md` (a new "Releasing" section)
- Output: a short report in the PR description, not a file.

**Interfaces:**

- Consumes: the workflow from Task 3, run by manual dispatch on the PR branch.
- Produces: proof the CI build works and a releasing checklist. Blocks the owner hardware step.

- [ ] **Step 1: Run the build by manual dispatch**

After the branch is pushed: `gh workflow run firmware-release.yml --ref <branch>` and `gh run watch`. Expected: `build` passes and `publish` is skipped. If `build` fails, fix the cause in the workflow (dependency pinning, `managed_components`, disk, time) with a test where one makes sense, and rerun. Do not weaken the container, the pins or the tag checks to get a pass.

- [ ] **Step 2: Compare the CI image with the flashed one**

Download `firmware-dist`. Record the image size, and compare with `firmware/build/ginger.bin` from a local build if one exists (`ls -l`). A difference over a few percent needs an explanation in the PR (different IDF patch version, different `sdkconfig`). Check `firmware/sdkconfig` is not generated differently in CI than the committed `sdkconfig.defaults` implies; the README says to delete `firmware/sdkconfig` after changing defaults.

- [ ] **Step 3: Document releasing**

Add to `firmware/README.md`:

```markdown
## Releasing

Firmware releases separately from the app, on tags named `fw-v<version>`.

1. Set the new version in `firmware/VERSION` (X.Y.Z) and in `firmware/RELEASE.json`. In the same file set `min_app` to the oldest app version that can talk to this firmware.
2. Open a pull request, get the checks green, and merge it.
3. Tag the merge commit `fw-v<version>` and push the tag. The `firmware-release` workflow builds in the ESP-IDF container, runs the host tests, signs the binary and opens a draft release with `ginger-<version>-app.bin`, `firmware.json`, `SHA256SUMS` and a signature.
4. Check the draft, flash the binary once with `esptool.py` or `idf.py app-flash` on a spare panel, then publish it with `gh release edit fw-v<version> --draft=false --latest=false`. Do not use the web form's publish button without unticking "Set as latest", or the app's stable download link will point at the firmware.

A manual run of the workflow builds and uploads the artifacts but never publishes. Releases never erase NVS. There are no wireless updates: the panel has one application slot.
```

- [ ] **Step 4: Run everything and commit**

Run: `cd firmware/scripts && python3 -m pytest -q --deselect test_ble_provision.py::test_wifi_join_and_glass_scan_use_psram_stacks`, `firmware/host/run.sh`, and the repo's pre-commit hooks.
Expected: all pass.

```bash
git add firmware/README.md
git commit -m "Document the firmware release steps"
```

---

### Task 5: Owner hardware check (owner required)

Not for an executor. One checklist, one reply.

1. Flash the CI-built `ginger-0.2.0-app.bin` from the spike run: `esptool.py --chip esp32s3 -p /dev/ttyACM0 write_flash 0x10000 ginger-0.2.0-app.bin`. The factory partition offset is the one `idf.py app-flash` reports; confirm it from `firmware/build/flash_args` before flashing. Do not erase.
2. The panel boots and reconnects to Wi-Fi with its saved networks.
3. Over Bluetooth, the Device page shows `Firmware 0.2.0`, and the saved networks and the pairing are still there.
4. `Panel online` returns on the sidebar after the first poll.
5. Boot log (USB console if available) shows `ginger 0.2.0 (<sha>)`.

## Self-review

- **Spec coverage:** version file and wiring (Task 1); tag, release-file and manifest checks (Task 2); separate workflow, container build, signing, attestation, draft release, `main`-only, tag-only publish (Task 3); the CI build spike, release docs (Task 4); the hardware check from the spec's testing section (Task 5). The manifest's `min_app` flows from `RELEASE.json`. No OTA, no partition change. Pieces B and C are out of scope.
- **Placeholder scan:** the only deliberate blanks are the two action SHAs, which Task 3 step 3 resolves with a command.
- **Names:** `DESK_FW_VERSION`, `read_version`, `read_release`, `check_tag`, `make_manifest`, `ReleaseError`, `FW_DIR`, `firmware-dist`, `ginger-<version>-app.bin` are used the same way in every task.
