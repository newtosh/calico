"""Pins the safety properties of the firmware release workflow."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".github" / "workflows" / "firmware-release.yml"


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


def test_build_sets_the_target_before_building():
    build = job("build")
    assert "idf.py set-target esp32s3" in build
    assert build.index("idf.py set-target esp32s3") < build.index("idf.py build")


def test_dependency_lock_is_tracked_and_pins_the_chip():
    lock = ROOT / "firmware" / "dependencies.lock"
    assert "target: esp32s3" in lock.read_text(encoding="utf-8")
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", "firmware/dependencies.lock"], cwd=ROOT
    )
    assert ignored.returncode == 1, "dependencies.lock must not be git-ignored"


def test_publish_only_runs_for_a_tag_and_after_build():
    publish = job("publish")
    assert "needs: build" in publish
    assert "startsWith(github.ref, 'refs/tags/fw-v')" in publish
    assert "RELEASE_GPG_KEY" in publish
    assert "--draft" in publish
    assert "--latest=false" in publish
    assert "packaging/calico-release.asc" in publish
    assert "actions/attest@" in publish
