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


def test_project_version_comes_from_the_version_file():
    top = (FW / "CMakeLists.txt").read_text(encoding="utf-8")
    assert 'file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/VERSION" PROJECT_VER' in top
    # It must be set before project(), or the image header keeps a git describe.
    assert top.index("PROJECT_VER") < top.index("project(ginger)")
