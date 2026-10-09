"""Host checks for the link-down icon generator. Skipped without Pillow or rsvg-convert."""

from __future__ import annotations

import importlib.util
import re
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


def committed_pixels() -> bytes:
    text = tool.MAIN.joinpath("linkdown_icon.c").read_text()
    body = text.split("s_linkdown_px[", 1)[1].split("= {", 1)[1].split("};", 1)[0]
    return bytes(int(h, 16) for h in re.findall(r"0x([0-9a-f]{2})", body))


def test_the_committed_file_matches_the_svg():
    # Anti-aliasing differs a little between librsvg versions, so compare the pixels with a
    # tolerance. A real change to the SVG moves whole strokes, far past this.
    committed = committed_pixels()
    fresh = icon.tobytes()
    assert len(committed) == len(fresh) == icon.size[0] * icon.size[1]
    off = sum(1 for a, b in zip(committed, fresh) if abs(a - b) > 48)
    assert off <= len(fresh) * 0.002, f"{off} pixels differ; run gen_linkdown_icon.py"


def test_the_line_is_about_ten_pixels_thick():
    # Row 40% down crosses the cat's left cheek, away from the slash and the eyes.
    w, h = icon.size
    row = [icon.getpixel((x, int(h * 0.4))) > 128 for x in range(w)]
    start = row.index(True)
    run = 0
    while row[start + run]:
        run += 1
    assert 8 <= run <= 12, f"the cheek line is {run} px"
