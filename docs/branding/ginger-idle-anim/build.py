"""Trace the idle cat's centerlines, move points, and re-stroke at constant width.

Reads sk.png (1px skeleton of the approved drawing), writes frames/*.svg and the
rendered white-on-transparent masks, so the stroke never thins or bunches.
"""
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

W = 9.0
SIZE = 480
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

im = Image.open("m.png").convert("L")
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
tail_line = next(p for p in paths if abs(p[0][0] - 363) < 3 or abs(p[-1][0] - 363) < 3)
if tail_line[0][0] < tail_line[-1][0]:
    tail_line = tail_line[::-1]  # runs tip first

EAR_BASE = (150.0, 157.0)  # the ear turns as one piece about the middle of its base
TAIL_PIVOT, TAIL_TIP, TAIL_END = 285.0, 363.0, 405.0


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


def _nearest(path, target):
    return min(range(len(path)), key=lambda i: (path[i][0] - target[0]) ** 2 + (path[i][1] - target[1]) ** 2)


# The tail's lower edge is part of the outline, from under the pivot to where it
# meets the rump. Weight its points by how far along that stretch they are.
_i0, _i1 = sorted((_nearest(outline, (TAIL_PIVOT, 358)), _nearest(outline, (407, 289))))
_run = [0.0]
for _a, _b in zip(outline[_i0:_i1], outline[_i0 + 1 : _i1 + 1]):
    _run.append(_run[-1] + math.dist(_a, _b))
LOWER_EDGE = {
    id(outline[_i0 + k]): _run[k] / _run[-1] for k in range(len(_run))
}


def tail(pt, on_tail_line, sx, sy):
    """Move the tail's free end away from the body, easing to nothing at the pivot."""
    x, y = pt
    if on_tail_line:
        w = smoothstep((x - TAIL_PIVOT) / (TAIL_TIP - TAIL_PIVOT))
    else:
        s = LOWER_EDGE.get(id(pt))
        if s is None:
            return pt
        w = 0.5 * math.sin(math.pi * s)
    return (x + sx * w, y + sy * w)


BELLY_DEPTH = 0.0  # how far inside the tail the body's underside sits at rest


def belly():
    """The body's underside. It sits inside the tail, so it stays hidden until the tail moves."""
    start = TAIL_PIVOT - 30
    run = [p for p in tail_line if start <= p[0] <= 332][::-1]  # start to the bend
    behind = [
        (x, y + BELLY_DEPTH * smoothstep((x - start) / 40.0)) for x, y in run
    ]
    p0, c, p2 = behind[-1], (378.0, 318.0), (404.0, 296.0)
    for i in range(1, 13):
        t = i / 12
        behind.append(
            tuple(
                (1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * c[k] + t * t * p2[k]
                for k in (0, 1)
            )
        )
    return behind


def d_of(q):
    return "M" + " L".join(f"{x + .5:.2f},{y + .5:.2f}" for x, y in q)


def svg(ear_deg=0.0, shift=(0.0, 0.0)):
    drawn = []
    tail_q = outline_q = None
    for p in paths:
        q = p
        if p is tail_line:
            q = tail_q = [tail(pt, True, *shift) for pt in q]
        elif p is outline:
            outline_q = [tail(pt, False, *shift) for pt in q]
            q = [ear(pt, ear_deg) for pt in outline_q]
        drawn.append(q)
    defs = under = ""
    if False:  # the tail lifts toward the body, so nothing behind it is uncovered
        # The tail is opaque: the underside only shows where the tail no longer covers it.
        band = tail_q + outline_q[_i0:][::-1]
        defs = (
            '<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" '
            f'width="{SIZE}" height="{SIZE}"><rect width="{SIZE}" height="{SIZE}" fill="#fff"/>'
            f'<path d="{d_of(band)} Z" fill="#000" stroke="#000"/></mask></defs>'
        )
        under = f'<path mask="url(#m)" d="{d_of(belly())}"/>'
    body = "".join(f'<path d="{d_of(q)}"/>' for q in drawn)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}">{defs}<g fill="none" stroke="#fff" stroke-width="{W}" '
        f'stroke-linecap="round" stroke-linejoin="round">{under}{body}</g></svg>'
    )


frames = {
    "rest": {},
    "ear1": {"ear_deg": -4.0},
    "ear2": {"ear_deg": 6.0},
    "tail1": {"shift": (0.0, -6.0)},
    "tail2": {"shift": (1.0, -11.0)},
}
for name, kw in frames.items():
    f = out / f"{name}.svg"
    f.write_text(svg(**kw))
    subprocess.run(["rsvg-convert", "-o", str(out / f"{name}.png"), str(f)], check=True)
print(len(paths), "paths", sum(len(p) for p in paths), "points")
