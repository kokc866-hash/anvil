#!/usr/bin/env python3
from io import BytesIO
from math import cos, pi, radians, sin
from pathlib import Path
from struct import pack
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public"
BG = (10, 10, 11, 255)
FG = (236, 236, 236, 255)
STEEL = (200, 204, 212, 255)
RING = (138, 160, 184, 255)


def rot(pts, ang, cx, cy):
    a = radians(ang)
    c, s = cos(a), sin(a)
    out = []
    for x, y in pts:
        dx, dy = x - cx, y - cy
        out.append((cx + dx * c - dy * s, cy + dx * s + dy * c))
    return out


def rect_pts(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def star(cx, cy, r_out, r_in, n=4):
    pts = []
    for i in range(n * 2):
        ang = -pi / 2 + i * pi / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + cos(ang) * r, cy + sin(ang) * r))
    return pts


def brace(cx, y0, y1, dir_):
    mid = (y0 + y1) / 2
    bump = 1.6 * dir_
    return [
        (cx, y0),
        (cx + bump * 0.35, y0 + 0.4),
        (cx + bump, mid - 0.6),
        (cx + bump * 1.35, mid),
        (cx + bump, mid + 0.6),
        (cx + bump * 0.35, y1 - 0.4),
        (cx, y1),
    ]


def render(size: int) -> Image.Image:
    s = size / 32
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=8 * s, fill=BG)
    head = rot(rect_pts(19.2 * s, 3.4 * s, 8.2 * s, 2.6 * s), -38, 23.3 * s, 4.7 * s)
    handle = rot(rect_pts(22.4 * s, 4.2 * s, 1.5 * s, 7.2 * s), -38, 23.15 * s, 7.8 * s)
    d.polygon(head, fill=FG)
    d.polygon(handle, fill=FG)
    d.polygon(star(18.6 * s, 10.2 * s, 1.8 * s, 0.7 * s, 4), fill=RING)
    d.polygon([(11 * s, 11.2 * s), (3.4 * s, 15 * s), (11 * s, 18.8 * s)], fill=FG)
    d.rounded_rectangle((10.6 * s, 10.8 * s, 26 * s, 18.8 * s), radius=1 * s, fill=FG)
    d.rounded_rectangle((21.4 * s, 13.2 * s, 23.5 * s, 15.3 * s), radius=0.3 * s, fill=BG)
    w = max(1.4 * s, 1.5)
    d.line([(p[0], p[1]) for p in brace(15.4 * s, 19.1 * s, 23.7 * s, -1)], fill=STEEL, width=int(w), joint="curve")
    d.line([(p[0], p[1]) for p in brace(20.6 * s, 19.1 * s, 23.7 * s, 1)], fill=STEEL, width=int(w), joint="curve")
    d.polygon(
        [(6.4 * s, 23.6 * s), (25.6 * s, 23.6 * s), (28.2 * s, 28.6 * s), (3.8 * s, 28.6 * s)],
        fill=FG,
    )
    return im


def png_bytes(im: Image.Image) -> bytes:
    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def write_ico(path: Path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    blobs = [png_bytes(render(s)) for s in sizes]
    count = len(sizes)
    offset = 6 + 16 * count
    buf = pack("<HHH", 0, 1, count)
    for size, blob in zip(sizes, blobs):
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        buf += pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(buf + b"".join(blobs))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "__grok").mkdir(parents=True, exist_ok=True)
    render(512).save(OUT / "icon.png")
    render(180).save(OUT / "icon-180.png")
    render(180).save(OUT / "__grok" / "icon-180.png")
    render(256).save(OUT / "icon-256.png")
    write_ico(OUT / "icon.ico")
    print("wrote", OUT / "icon.ico")


if __name__ == "__main__":
    main()
