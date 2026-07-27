#!/usr/bin/env python3
"""Regenerate the binary media assets for Meridian Policy Twin.

The three PNG assets (public/auth-topo.png, public/pwa-icon-512.png,
public/og-cover.png) are generated programmatically so the repository
stays text-only. Run once after cloning:

    python scripts/generate-assets.py

Requires: pillow, numpy (matplotlib optional). Deterministic output.
"""
from __future__ import annotations

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")

BG = (11, 18, 32)        # #0B1220 civic ink base
SURFACE = (22, 35, 60)   # #16233C contour lines
TEAL = (63, 174, 158)    # #3FAE9E accent
GOLD = (201, 162, 75)    # #C9A24B executive gold
MUTED = (94, 109, 135)   # #5E6D87


def smooth_field(w: int, h: int, octaves: int = 4, seed: int = 42) -> list[list[float]]:
    rng = random.Random(seed)
    field = [[0.0] * w for _ in range(h)]
    for o in range(octaves):
        cell = max(2, 2 ** (octaves - o) * 8)
        gw, gh = w // cell + 2, h // cell + 2
        grid = [[rng.random() for _ in range(gw)] for _ in range(gh)]
        amp = 1.0 / (o + 1)
        for y in range(h):
            for x in range(w):
                gx, gy = x / cell, y / cell
                x0, y0 = int(gx), int(gy)
                fx, fy = gx - x0, gy - y0
                fx = fx * fx * (3 - 2 * fx)
                fy = fy * fy * (3 - 2 * fy)
                n = (
                    grid[y0][x0] * (1 - fx) * (1 - fy)
                    + grid[y0][x0 + 1] * fx * (1 - fy)
                    + grid[y0 + 1][x0] * (1 - fx) * fy
                    + grid[y0 + 1][x0 + 1] * fx * fy
                )
                field[y][x] += n * amp
    return field


def auth_topo(path: str, w: int = 2560, h: int = 1440) -> None:
    """Dark topographic contour background (#0B1220 base, #16233C contours,
    a few teal ridge lines, soft vignette)."""
    sw, sh = w // 4, h // 4
    field = smooth_field(sw, sh, seed=42)
    img = Image.new("RGB", (sw, sh), BG)
    px = img.load()
    levels = 14
    flat = sorted(v for row in field for v in row)
    thresholds = [flat[int(len(flat) * i / levels)] for i in range(1, levels)]
    for y in range(1, sh - 1):
        for x in range(1, sw - 1):
            v = field[y][x]
            for i, t in enumerate(thresholds):
                if (v < t) != (field[y][x + 1] < t) or (v < t) != (field[y + 1][x] < t):
                    px[x, y] = TEAL if i in (5, 10) else SURFACE
                    break
    img = img.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    # vignette
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=110)
    mask = mask.filter(ImageFilter.GaussianBlur(220))
    dark = Image.new("RGB", (w, h), (4, 8, 18))
    img = Image.composite(img, dark, mask)
    img.save(path, optimize=True)


def draw_seal(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    """Hexagonal civic seal: concentric rings converging on a gold point."""
    for i in range(6, 0, -1):
        rr = r * i / 6
        pts = [
            (
                cx + rr * math.cos(math.radians(a + 30)),
                cy + rr * math.sin(math.radians(a + 30)),
            )
            for a in range(0, 360, 60)
        ]
        draw.polygon(pts, outline=TEAL, width=max(2, int(r * 0.02)))
    draw.ellipse([cx - r * 0.08, cy - r * 0.08, cx + r * 0.08, cy + r * 0.08], fill=GOLD)


def pwa_icon(path: str, size: int = 512) -> None:
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = int(size * 0.12)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.12), outline=SURFACE, width=3)
    draw_seal(d, size / 2, size / 2, size * 0.30)
    img.save(path, optimize=True)


def og_cover(path: str, w: int = 1200, h: int = 630) -> None:
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    for yy in range(0, h, 6):
        shade = tuple(min(255, c + int(6 * math.sin(yy / 40))) for c in SURFACE)
        d.line([(0, yy), (w, yy)], fill=shade, width=1)
    draw_seal(d, 200, h / 2, 110)
    try:
        from PIL import ImageFont

        font_big = ImageFont.truetype("DejaVuSans-Bold.ttf", 64)
        font_small = ImageFont.truetype("DejaVuSans.ttf", 34)
    except Exception:
        font_big = font_small = None
    d.text((360, h / 2 - 70), "Meridian Policy Twin", fill=(230, 236, 245), font=font_big)
    d.line([(360, h / 2 + 12), (w - 80, h / 2 + 12)], fill=GOLD, width=2)
    d.text((360, h / 2 + 34), "Evidence before policy.", fill=MUTED, font=font_small)
    img.save(path, optimize=True)


def main() -> None:
    os.makedirs(PUBLIC, exist_ok=True)
    auth_topo(os.path.join(PUBLIC, "auth-topo.png"))
    pwa_icon(os.path.join(PUBLIC, "pwa-icon-512.png"))
    og_cover(os.path.join(PUBLIC, "og-cover.png"))
    print("generated: auth-topo.png, pwa-icon-512.png, og-cover.png")


if __name__ == "__main__":
    main()
