#!/usr/bin/env python3
"""mark.py: build the Miharchy mark. Run it from a dev checkout only: it writes the SVGs in icons/.

The geometry comes from the c.1991 Manga Video logo (the cross and sunburst, no lettering),
measured with the cross's half-length L = 1: an equal-arm cross of half-thickness 0.31;
behind it a solid disk of radius 0.63; 3 rays per quadrant at 45 deg and +-15 deg, wedges
about 7 deg wide whose ends lie on a circle of radius 0.97.

Two marks share that structure:
  full  the measured proportions, with a 1-unit gap around the cross so it also works in
        one color. The launcher, notifications, the site, the README and the reading card.
  bar   for 16-24 px in one color: no disk, fewer and wider wedges, a smaller cross and a
        2.5-unit gap. At 20 px the thin 1991 rays merge into one blur around the cross.

It writes flat polygons (no mask, clipPath or transform), so QtSvg, QML PathSvg and
browsers draw them alike, and it prints each mark's burst and cross paths for the files
that embed them: plugin/MiharchyIcon.qml (bar), window/ReadingCard.qml and the hero in
site/index.html (full).
"""
import math, os

C = 24.0  # the 48x48 grid's center

FULL = dict(L=21, t=6.6, disk=13.2, ri=0, ro=20.4, ha=3.6, spread=15, gap=1.0)
BAR = dict(L=16, t=4, disk=0, ri=11, ro=23.5, ha=7, spread=23, gap=2.5)

NIGHT, LIFTED, RED, FG, GREEN = "#1a1b26", "#24283b", "#f7768e", "#c0caf5", "#9ece6a"


def arc(r, deg):
    return (C + r * math.cos(math.radians(deg)), C - r * math.sin(math.radians(deg)))


def wedge(deg, m, n=4):  # a ray: from ri (or the center) out to ro, ends on circles
    a0, a1 = deg - m["ha"], deg + m["ha"]
    outer = [arc(m["ro"], a0 + (a1 - a0) * i / n) for i in range(n + 1)]
    inner = [arc(m["ri"], a1 - (a1 - a0) * i / n) for i in range(n + 1)] if m["ri"] else [(C, C)]
    return outer + inner


def clip(poly, keep):  # Sutherland-Hodgman against one half-plane, keep(p) >= 0 stays
    out = []
    for i, cur in enumerate(poly):
        prev = poly[i - 1]
        dc, dp = keep(cur), keep(prev)
        if (dc >= 0) != (dp >= 0):
            k = dp / (dp - dc)
            out.append((prev[0] + (cur[0] - prev[0]) * k, prev[1] + (cur[1] - prev[1]) * k))
        if dc >= 0:
            out.append(cur)
    return out


def quadrant(m):
    """The top-left quadrant's burst pieces, clipped to the corner outside the cross and its gap."""
    edge = C - m["t"] - m["gap"]
    pieces = [wedge(135 + d, m) for d in (-m["spread"], 0, m["spread"])]
    if m["disk"]:
        pieces.insert(0, [arc(m["disk"], 360 * i / 48) for i in range(48)])
    pieces = [clip(clip(p, lambda q: edge - q[0]), lambda q: edge - q[1]) for p in pieces]
    return [p for p in pieces if len(p) >= 3]


def rot(p, k):  # k quarter turns around the center
    x, y = p[0] - C, p[1] - C
    for _ in range(k):
        x, y = -y, x
    return (C + x, C + y)


def burst_d(m):
    # One winding direction for every piece, so overlaps add up under the nonzero rule.
    area = lambda q: sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(q, q[1:] + q[:1]))
    polys = [[rot(p, k) for p in q] for k in range(4) for q in quadrant(m)]
    polys = [q if area(q) > 0 else q[::-1] for q in polys]
    return " ".join("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in q) + "Z" for q in polys)


def cross_d(m):
    a, b, c, d = (f"{v:g}" for v in (C - m["L"], C - m["t"], C + m["t"], C + m["L"]))
    return f"M{b} {a}H{c}V{b}H{d}V{c}H{c}V{d}H{b}V{c}H{a}V{b}H{b}Z"


def svg(m, rays, cross, tile=None):
    rect = f'\n  <rect width="48" height="48" fill="{tile}"/>' if tile else ""
    fill = ' fill="currentColor"' if rays == cross == "currentColor" else ""
    ray_fill = "" if fill else f' fill="{rays}"'
    cross_fill = "" if fill else f' fill="{cross}"'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"{fill}>{rect}\n'
            f'  <path id="burst"{ray_fill} d="{burst_d(m)}"/>\n'
            f'  <path id="cross"{cross_fill} d="{cross_d(m)}"/>\n</svg>\n')


FILES = {
    "miharchy.svg": (FULL, RED, FG, NIGHT),
    "miharchy-burst.svg": (FULL, RED, LIFTED, NIGHT),
    "miharchy-knockout.svg": (FULL, NIGHT, NIGHT, RED),
    "miharchy-mono.svg": (FULL, FG, FG, NIGHT),
    "miharchy-symbolic.svg": (BAR, "currentColor", "currentColor", None),
    "miharchy-active.svg": (BAR, GREEN, FG, None),
}

if __name__ == "__main__":
    for m in (FULL, BAR):  # the check: each quadrant is symmetric about its diagonal
        pts = {(round(x, 3), round(y, 3)) for q in quadrant(m) for x, y in q}
        assert pts == {(y, x) for x, y in pts}, "a quadrant is not symmetric about its diagonal"
    here = os.path.dirname(os.path.abspath(__file__))
    for name, (m, rays, cross, tile) in FILES.items():
        with open(os.path.join(here, name), "w") as f:
            f.write(svg(m, rays, cross, tile))
    for label, m in (("full", FULL), ("bar", BAR)):
        print(f"{label} burst: {burst_d(m)}\n{label} cross: {cross_d(m)}")
