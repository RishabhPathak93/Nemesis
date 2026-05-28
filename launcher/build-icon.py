#!/usr/bin/env python3
"""Generate CortexView app icons (.icns).

Run from the project root:
    python3 launcher/build-icon.py            # build both launcher + stopper icons
    python3 launcher/build-icon.py launcher   # just CortexView.app icon
    python3 launcher/build-icon.py stopper    # just Stop CortexView.app icon
"""
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Variant configs
VARIANTS = {
    "launcher": {
        "out": PROJECT_ROOT / "CortexView.app" / "Contents" / "Resources" / "AppIcon.icns",
        "bg_top": (31, 58, 110),     # navy
        "bg_bottom": (79, 70, 229),  # indigo
        "monogram": "CV",
        "monogram_color": (31, 58, 110),
        "accent": (99, 102, 241),
    },
    "stopper": {
        "out": PROJECT_ROOT / "Stop CortexView.app" / "Contents" / "Resources" / "AppIcon.icns",
        "bg_top": (127, 29, 29),     # red-900
        "bg_bottom": (220, 38, 38),  # red-600
        "monogram": "CV",
        "monogram_color": (127, 29, 29),
        "accent": (252, 165, 165),
        "stop_overlay": True,
    },
}

SHIELD_FILL = (255, 255, 255)


def linear_gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size, radius_ratio=0.22):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    d.rounded_rectangle((0, 0, size, size), radius=r, fill=255)
    return mask


def draw_shield(canvas, cfg):
    w = canvas.size[0]
    cx = w // 2
    pad = int(w * 0.18)

    shield_w = int(w * 0.62)
    shield_h = int(w * 0.70)
    sx = cx - shield_w // 2
    sy = pad
    ex = sx + shield_w
    ey = sy + shield_h
    radius = int(shield_w * 0.22)

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)

    od.rounded_rectangle(
        (sx, sy, ex, sy + int(shield_h * 0.7)),
        radius=radius,
        fill=SHIELD_FILL + (240,),
    )
    bottom_top = sy + int(shield_h * 0.55)
    od.polygon(
        [
            (sx + int(shield_w * 0.05), bottom_top),
            (ex - int(shield_w * 0.05), bottom_top),
            (cx, ey),
        ],
        fill=SHIELD_FILL + (240,),
    )

    if w >= 128:
        inset = max(2, w // 64)
        inner = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        id_ = ImageDraw.Draw(inner)
        id_.rounded_rectangle(
            (sx + inset, sy + inset, ex - inset, sy + int(shield_h * 0.7) - inset),
            radius=max(2, radius - inset - 2),
            outline=(180, 190, 230, 80),
            width=max(1, w // 256),
        )
        overlay = Image.alpha_composite(overlay, inner)

    od2 = ImageDraw.Draw(overlay)

    if cfg.get("stop_overlay") and w >= 32:
        # Stop variant: red filled square (a "stop" cue) in top half of shield
        sq_w = int(shield_w * 0.42)
        sq_x = cx - sq_w // 2
        sq_y = sy + int(shield_h * 0.16)
        od2.rounded_rectangle(
            (sq_x, sq_y, sq_x + sq_w, sq_y + sq_w),
            radius=max(2, sq_w // 8),
            fill=cfg["bg_bottom"] + (255,),
        )
    elif w >= 32:
        font_size = max(10, int(w * 0.30))
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        except Exception:
            font = ImageFont.load_default()
        text = cfg["monogram"]
        bbox = od2.textbbox((0, 0), text, font=font, stroke_width=0)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = cx - tw // 2 - bbox[0]
        ty = sy + int(shield_h * 0.32) - th // 2 - bbox[1]
        od2.text((tx, ty), text, font=font, fill=cfg["monogram_color"] + (255,))

    if w >= 32:
        dot_r = int(w * 0.03)
        dot_y = sy + int(shield_h * 0.62)
        od2.ellipse(
            (cx - dot_r, dot_y - dot_r, cx + dot_r, dot_y + dot_r),
            fill=cfg["accent"] + (255,),
        )

    canvas.alpha_composite(overlay)


def render(size, cfg):
    grad = linear_gradient(size, cfg["bg_top"], cfg["bg_bottom"]).convert("RGBA")
    mask = rounded_mask(size)
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg.paste(grad, (0, 0), mask)
    draw_shield(bg, cfg)
    return bg


def build(variant_key):
    cfg = VARIANTS[variant_key]
    cfg["out"].parent.mkdir(parents=True, exist_ok=True)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()
        for s in sizes:
            img = render(s, cfg)
            img.save(iconset / f"icon_{s}x{s}.png", "PNG")
            if s <= 512:
                img2x = render(s * 2, cfg)
                img2x.save(iconset / f"icon_{s}x{s}@2x.png", "PNG")
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(cfg["out"])],
            check=True,
        )
    print(f"✓ {variant_key} → {cfg['out']}")


def main():
    args = sys.argv[1:]
    keys = args if args else list(VARIANTS.keys())
    for k in keys:
        if k not in VARIANTS:
            print(f"Unknown variant: {k}. Choose from: {', '.join(VARIANTS)}")
            sys.exit(1)
        build(k)


if __name__ == "__main__":
    main()
