"""Build the idle cat's frames from the approved drawing.

Traces the centerlines of ../ginger-idle-cat-mask-480.png, moves the ear and the
tail's head-side end as paths, and strokes every frame at one width, so the line
never thins or bunches. The chin line is its own stroke: it stays fixed and runs on
behind the tail, which hides it with a mask.

Usage: python3 -I build.py   (needs rsvg-convert; writes the frames beside this file)
"""
import math
import subprocess
from pathlib import Path

from PIL import Image

W = 9.0
SIZE = 480
out = Path(__file__).resolve().parent
out.mkdir(parents=True, exist_ok=True)

im = Image.open(out / "../ginger-idle-cat-mask-480.png").split()[-1]
px = im.load()
pts = {(x, y) for y in range(SIZE) for x in range(SIZE) if px[x, y] > 128}


def zhang_suen(pts):
    ring = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            kill = []
            for x, y in pts:
                p = [(x + dx, y + dy) in pts for dx, dy in ring]
                b = sum(p)
                if not 2 <= b <= 6:
                    continue
                a = sum(1 for i in range(8) if not p[i] and p[(i + 1) % 8])
                if a != 1:
                    continue
                if step == 0 and (p[0] and p[2] and p[4] or p[2] and p[4] and p[6]):
                    continue
                if step == 1 and (p[0] and p[2] and p[6] or p[0] and p[4] and p[6]):
                    continue
                kill.append((x, y))
            if kill:
                pts.difference_update(kill)
                changed = True


zhang_suen(pts)
N8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]


def nbrs(p):
    return [(p[0] + dx, p[1] + dy) for dx, dy in N8 if (p[0] + dx, p[1] + dy) in pts]


def adj(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1])) == 1


def redundant(p):
    """True when p's neighbours already connect to each other without p."""
    n = nbrs(p)
    if len(n) < 2:
        return False
    group, todo = {n[0]}, [n[0]]
    while todo:
        c = todo.pop()
        for q in n:
            if q not in group and adj(c, q):
                group.add(q)
                todo.append(q)
    return len(group) == len(n)


changed = True
while changed:
    changed = False
    for p in sorted(pts):
        if redundant(p):
            pts.discard(p)
            changed = True

deg = {p: len(nbrs(p)) for p in pts}
nodes = {p for p in pts if deg[p] != 2}
seen_edges = set()
paths = []


def walk(start, first):
    path = [start, first]
    prev, cur = start, first
    while cur not in nodes:
        nxt = [n for n in nbrs(cur) if n != prev and n not in path[-3:]]
        if not nxt:
            break
        prev, cur = cur, nxt[0]
        path.append(cur)
    return path


for n in nodes:
    for m in nbrs(n):
        key = (n, m)
        if key in seen_edges:
            continue
        p = walk(n, m)
        seen_edges.add((p[0], p[1]))
        seen_edges.add((p[-1], p[-2]))
        paths.append(p)

covered = {q for p in paths for q in p}
for start in sorted(pts - covered):  # closed loops with no node
    if start in covered:
        continue
    p = walk(start, nbrs(start)[0])
    covered.update(p)
    paths.append(p)

# Drop short spurs left by thinning: a branch that ends free next to a junction.
paths = [p for p in paths if not (len(p) < 14 and (deg[p[0]] == 1 or deg[p[-1]] == 1))]


def smooth(p, k=3, passes=2):
    f = [(float(x), float(y)) for x, y in p]
    for _ in range(passes):
        g = []
        for i in range(len(f)):
            if i == 0 or i == len(f) - 1:
                g.append(f[i])
                continue
            lo, hi = max(0, i - k), min(len(f) - 1, i + k)
            r = min(i - lo, hi - i)
            sx = sum(f[j][0] for j in range(i - r, i + r + 1)) / (2 * r + 1)
            sy = sum(f[j][1] for j in range(i - r, i + r + 1)) / (2 * r + 1)
            g.append((sx, sy))
        f = g
    return f


paths = [smooth(p) for p in paths]


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


outline = max(paths, key=len)
# The numbers below are read off the 480 px mask (tail tip, pivot, ear base). If the
# drawing is redrawn, re-measure them; the assert catches a tip that has moved.
tail_line = next(
    (p for p in paths if abs(p[0][0] - 363) < 3 or abs(p[-1][0] - 363) < 3), None
)
assert tail_line is not None, "no stroke ends at the tail tip (363, 289): re-measure"
if tail_line[0][0] < tail_line[-1][0]:
    tail_line = tail_line[::-1]  # runs tip first

EAR_BASE = (150.0, 157.0)  # the ear turns as one piece about the middle of its base
TAIL_PIVOT, TAIL_END_X = 255.0, 160.0  # the tail's head-side end moves; it is still by x=255


def ear(pt, deg):
    """Turn the ear rigidly. Only the ear's own line moves, fading out toward the head."""
    x, y = pt
    if x > 200 or y > EAR_BASE[1]:
        return pt
    w = smoothstep((EAR_BASE[1] - y) / 40.0)
    a = math.radians(deg) * w
    dx, dy = x - EAR_BASE[0], y - EAR_BASE[1]
    return (
        EAR_BASE[0] + dx * math.cos(a) - dy * math.sin(a),
        EAR_BASE[1] + dx * math.sin(a) + dy * math.cos(a),
    )


def _nearest(path, target, lo=0):
    return min(
        range(lo, len(path)),
        key=lambda i: (path[i][0] - target[0]) ** 2 + (path[i][1] - target[1]) ** 2,
    )


def _runs(path, i, j):
    run = [0.0]
    for a, b in zip(path[i:j], path[i + 1 : j + 1]):
        run.append(run[-1] + math.dist(a, b))
    return run


# The tail's head-side end is the outline from under the pivot round the curl to the
# junction. It is its own stroke: the cat's chin line is cut loose from it and stays
# put, running on under the tail where the tail hides it.
_ia = _nearest(outline, (TAIL_PIVOT, 361), lo=600)
_back = _runs(outline, _ia, len(outline) - 1)
CURL = outline[_ia:]
CURL_WEIGHT = [smoothstep(d / _back[-1]) for d in _back]
CHIN_ON = [(142.0, 297.0), (165.0, 299.0), (192.0, 304.0)]  # hidden at rest


def tail(pt, sx, sy, w=None):
    """Lift the tail's head-side end toward the body."""
    x, y = pt
    if w is None:
        w = smoothstep((TAIL_PIVOT - x) / (TAIL_PIVOT - 160.0))
    return (x + sx * w, y + sy * w)


def d_of(q):
    return "M" + " L".join(f"{x + .5:.2f},{y + .5:.2f}" for x, y in q)


def svg(ear_deg=0.0, shift=(0.0, 0.0)):
    drawn = []
    tail_q = [tail(pt, *shift) for pt in tail_line]
    curl_q = [tail(pt, *shift, w=w) for pt, w in zip(CURL, CURL_WEIGHT)]
    for p in paths:
        if p is tail_line:
            drawn.append(tail_q)
        elif p is outline:
            drawn.append([ear(pt, ear_deg) for pt in outline[: _ia + 1]])
            drawn.append(curl_q)
    # The tail is opaque: it hides the chin line where it passes behind.
    band = tail_q + curl_q[::-1]
    defs = (
        '<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" '
        f'width="{SIZE}" height="{SIZE}"><rect width="{SIZE}" height="{SIZE}" fill="#fff"/>'
        f'<path d="{d_of(band)} Z" fill="#000" stroke="#000"/></mask></defs>'
    )
    under = f'<path mask="url(#m)" d="{d_of(CHIN_ON)}"/>'
    body = "".join(f'<path d="{d_of(q)}"/>' for q in drawn if len(q) > 1) + "".join(
        f'<path d="{d_of(p)}"/>' for p in paths if p is not tail_line and p is not outline
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}">{defs}<g fill="none" stroke="#fff" stroke-width="{W}" '
        f'stroke-linecap="round" stroke-linejoin="round">{under}{body}</g></svg>'
    )


frames = {
    "rest": {},
    "ear1": {"ear_deg": -4.0},
    "ear2": {"ear_deg": 6.0},
    "tail1": {"shift": (1.0, -6.0)},
    "tail2": {"shift": (2.0, -11.0)},
}
for name, kw in frames.items():
    f = out / f"{name}.svg"
    f.write_text(svg(**kw))
    subprocess.run(["rsvg-convert", "-o", str(out / f"{name}.png"), str(f)], check=True)
print(len(paths), "paths", sum(len(p) for p in paths), "points")
