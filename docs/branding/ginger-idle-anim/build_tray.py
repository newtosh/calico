"""Make resources/tray.png from the idle cat's line drawing (rest.svg).

A thin line vanishes at tray size, so the cat is re-stroked bold in cream with a
thin dark edge, and the closed eye is dropped. Needs rsvg-convert.

Usage: python3 -I build_tray.py
"""
import re
import subprocess
import tempfile
from pathlib import Path

here = Path(__file__).resolve().parent
paths = re.findall(r'<path d="([^"]+)"/>', (here / "rest.svg").read_text())


def width(d):
    xs = [float(p.split(",")[0]) for p in re.findall(r"[-\d.]+,[-\d.]+", d)]
    return max(xs) - min(xs)


keep = [d for d in paths if width(d) > 45]  # the eye is the only short stroke


def layer(stroke, w):
    body = "".join(f'<path d="{d}"/>' for d in keep)
    return (
        f'<g fill="none" stroke="{stroke}" stroke-width="{w}" '
        f'stroke-linecap="round" stroke-linejoin="round">{body}</g>'
    )


svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" '
    'viewBox="48 49 384 384">' + layer("#0c0e09", 42) + layer("#efe7d6", 32) + "</svg>"
)
with tempfile.NamedTemporaryFile("w", suffix=".svg") as f:
    f.write(svg)
    f.flush()
    out = here / "../../../resources/tray.png"
    subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", "-o", str(out), f.name], check=True)
