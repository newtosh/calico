"""Host checks for the idle cat generator. Needs Pillow; skipped without it."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "gen_idle_cat.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("gen_idle_cat", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses look the module up by name
    spec.loader.exec_module(module)
    return module


tool = load_tool()
cat = tool.build()


def composed(part: str, pose: int) -> Image.Image:
    """The canvas as the panel shows it: the still cat with one patch laid in each hole."""
    img = cat.base.copy()
    for p, hole in cat.holes.items():
        patch = cat.patches[p][pose if p == part else 0]
        img.paste(patch, (hole.x, hole.y))
    return img


@pytest.mark.parametrize("part,names", tool.POSES.items())
def test_every_pose_recomposes_exactly(part, names):
    for pose, name in enumerate(names):
        frame = tool.crop(tool.load_alpha(name), cat.canvas)
        assert composed(part, pose).tobytes() == frame.tobytes(), f"{name} differs"


def test_boxes_are_even_and_inside_the_canvas():
    for box in [cat.canvas, *cat.holes.values()]:
        assert box.x % 2 == 0 and box.y % 2 == 0
        assert box.w % 2 == 0 and box.h % 2 == 0
    for hole in cat.holes.values():
        assert hole.x >= 0 and hole.y >= 0
        assert hole.x + hole.w <= cat.canvas.w and hole.y + hole.h <= cat.canvas.h


def test_the_two_holes_do_not_overlap():
    a, b = cat.holes["ear"], cat.holes["tail"]
    apart = a.x + a.w <= b.x or b.x + b.w <= a.x or a.y + a.h <= b.y or b.y + b.h <= a.y
    assert apart


def test_the_base_is_empty_inside_the_holes():
    for hole in cat.holes.values():
        assert tool.crop(cat.base, hole).getbbox() is None


def test_the_canvas_fits_the_face_band():
    # Panel is 480 wide; the band runs from y=48 to y=381 (see face_cover.h).
    assert cat.canvas.w <= 480 - 2 * 16
    assert cat.canvas.h <= 382 - 48


def test_the_committed_files_are_what_the_generator_writes():
    # Regenerate after changing a frame: python3 firmware/scripts/gen_idle_cat.py
    assert tool.MAIN.joinpath("idle_cat_geom.h").read_text() == tool.geom_header(cat)
    assert tool.MAIN.joinpath("idle_cat.c").read_text() == tool.source(cat)
