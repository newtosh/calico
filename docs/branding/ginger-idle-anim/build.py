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


def bump(pt, cx, cy, sigma, dx, dy):
    g = math.exp(-((pt[0] - cx) ** 2 + (pt[1] - cy) ** 2) / (2 * sigma**2))
    return (pt[0] + dx * g, pt[1] + dy * g)


def svg(moves):
    body = []
    for p in paths:
        q = p
        for m in moves:
            q = [bump(pt, *m) for pt in q]
        d = "M" + " L".join(f"{x + .5:.2f},{y + .5:.2f}" for x, y in q)
        body.append(f'<path d="{d}"/>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}"><g fill="none" stroke="#fff" stroke-width="{W}" '
        'stroke-linecap="round" stroke-linejoin="round">' + "".join(body) + "</g></svg>"
    )


EAR = (118, 112, 16)  # tip of the ear, and how wide the move reaches
TAIL = (360, 292, 14)  # free tip of the tail
frames = {
    "rest": [],
    "ear1": [(*EAR, 2, 8)],
    "ear2": [(*EAR, 4, 15)],
    "tail1": [(*TAIL, 0, -7)],
    "tail2": [(*TAIL, 0, -13)],
}
for name, moves in frames.items():
    f = out / f"{name}.svg"
    f.write_text(svg(moves))
    subprocess.run(["rsvg-convert", "-o", str(out / f"{name}.png"), str(f)], check=True)
print(len(paths), "paths", sum(len(p) for p in paths), "points")
