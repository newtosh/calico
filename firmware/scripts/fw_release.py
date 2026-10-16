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
SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")


class ReleaseError(Exception):
    pass


def read_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not SEMVER.fullmatch(text):
        raise ReleaseError(f"VERSION must be X.Y.Z, got {text!r}")
    return text


def read_release(path: Path, version: str) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ReleaseError("RELEASE.json must be a JSON object")
    if data.get("version") != version:
        raise ReleaseError(
            f"RELEASE.json version {data.get('version')!r} does not match VERSION {version!r}"
        )
    if not SEMVER.fullmatch(str(data.get("min_app") or "")):
        raise ReleaseError(f"RELEASE.json min_app must be X.Y.Z, got {data.get('min_app')!r}")
    return data


def check_tag(tag: str, version: str) -> None:
    if tag != f"fw-v{version}":
        raise ReleaseError(f"tag {tag!r} does not match fw-v{version}")


def make_manifest(version: str, min_app: str, artifact: Path, repo: str) -> dict:
    if not REPO.fullmatch(repo):
        raise ReleaseError(f"--repo must look like owner/name, got {repo!r}")
    if artifact.is_dir():
        raise ReleaseError(f"artifact {artifact} is a directory")
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
    except (ReleaseError, OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
