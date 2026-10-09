"""Host checks for the simulator's idle art. Skipped without Pillow or rsvg-convert."""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import shutil
import sys
from pathlib import Path

import pytest

pytest.importorskip("PIL")
if not shutil.which("rsvg-convert"):
    pytest.skip("rsvg-convert is not installed", allow_module_level=True)
from PIL import Image  # noqa: E402

HERE = Path(__file__).resolve().parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


sim = load("gen_simulator_assets")
cat_tool = sim.cat_tool
cat = cat_tool.build()


def committed() -> dict:
    text = sim.OUT.read_text()
    body = text.split("const IDLE_ART = ", 1)[1].rsplit(";", 1)[0]
    return json.loads(body)


def alpha_of(data_uri: str) -> Image.Image:
    assert data_uri.startswith("data:image/png;base64,")
    png = base64.b64decode(data_uri.split(",", 1)[1])
    return Image.open(io.BytesIO(png)).convert("RGBA").split()[-1]


def test_each_pose_is_the_frame_the_panel_shows():
    art = committed()
    poses = {"rest": (0, 0), "ear1": (1, 0), "ear2": (2, 0), "tail1": (0, 1), "tail2": (0, 2)}
    assert set(art["frames"]) == set(poses)
    for name, (ear, tail) in poses.items():
        expect = cat_tool.compose(cat, ear=ear, tail=tail)
        assert alpha_of(art["frames"][name]).tobytes() == expect.tobytes(), name


def test_the_sizes_and_positions_match_the_firmware_layout():
    art = committed()
    assert (art["cat"]["w"], art["cat"]["h"]) == (cat.canvas.w, cat.canvas.h)
    face = (HERE.parent / "main" / "face_cover.h").read_text()
    assert art["cat"]["y"] % 2 == 0 and art["cat"]["x"] % 2 == 0
    assert art["cat"]["x"] == (480 - cat.canvas.w) // 2
    assert art["linkdown"]["icon"] == int(face.split("FACE_LINKDOWN_ICON =")[1].split(",")[0])


def test_the_linkdown_icon_matches_the_firmware_icon_closely():
    art = committed()
    fresh = sim.linkdown_tool.render()
    mine = alpha_of(art["linkdown"]["image"])
    assert mine.size == fresh.size
    off = sum(1 for a, b in zip(mine.tobytes(), fresh.tobytes()) if abs(a - b) > 48)
    assert off <= len(fresh.tobytes()) * 0.002
