"""Host checks for the link-down icon generator. Skipped without Pillow or rsvg-convert."""

from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path

import pytest

pytest.importorskip("PIL")
if not shutil.which("rsvg-convert"):
    pytest.skip("rsvg-convert is not installed", allow_module_level=True)

SCRIPT = Path(__file__).resolve().parent / "gen_linkdown_icon.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("gen_linkdown_icon", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


tool = load_tool()
icon = tool.render()


def test_the_icon_is_the_size_the_layout_reserves():
    header = (tool.MAIN / "face_cover.h").read_text()
    reserved = int(header.split("FACE_LINKDOWN_ICON =")[1].split(",")[0])
    assert icon.size == (reserved, reserved)


def test_the_slash_runs_corner_to_corner_and_the_cat_is_cut_around_it():
    w, h = icon.size
    px = icon.load()
    # The slash is drawn all the way to both corners of the icon's drawing area.
    assert px[w // 12 + 4, h // 12 + 4] > 128
    assert px[w - w // 12 - 4, h - h // 12 - 4] > 128
    # Just off the slash, inside the cat, is the gap: empty on both sides of it.
    mid = w // 2
    assert px[mid + w // 10, mid - w // 10] < 32
    assert px[mid - w // 10, mid + w // 10] < 32


def test_the_committed_file_is_what_the_generator_writes():
    assert tool.MAIN.joinpath("linkdown_icon.c").read_text() == tool.source(icon)


def test_the_line_is_about_ten_pixels_thick():
    # Row 40% down crosses the cat's left cheek, away from the slash and the eyes.
    w, h = icon.size
    row = [icon.getpixel((x, int(h * 0.4))) > 128 for x in range(w)]
    start = row.index(True)
    run = 0
    while row[start + run]:
        run += 1
    assert 8 <= run <= 12, f"the cheek line is {run} px"
