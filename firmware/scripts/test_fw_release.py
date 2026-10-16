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
