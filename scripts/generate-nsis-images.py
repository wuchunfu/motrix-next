#!/usr/bin/env python3
"""Generate NSIS installer BMP images from existing brand assets.

Composites existing PNG assets onto M3-colored BMP backgrounds.
No new brand art — 100% reuse of existing codebase assets.

Uses multi-step downscaling with sharpening for maximum clarity
at NSIS's small target dimensions.

Usage:
    python scripts/generate-nsis-images.py

Dependencies:
    pip install Pillow

Source assets:
    - src/assets/logo-bolt-dark.png  (4096×4096) → sidebar.bmp
    - src/assets/logo.png            (512×512)   → header.bmp

Output:
    - src-tauri/nsis/sidebar.bmp  (164×314, 24-bit BMP)
    - src-tauri/nsis/header.bmp   (150×57,  24-bit BMP)
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# ── M3 colour tokens (from src/styles/variables.css) ────────────────────────
SURFACE_CONTAINER = (0xF3, 0xEF, 0xE8)  # --m3-surface-container
BRAND_GOLD = (0xE0, 0xA4, 0x22)  # --color-primary

# ── Paths (relative to project root) ────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BOLT_DARK_SRC = PROJECT_ROOT / "src" / "assets" / "logo-bolt-dark.png"
LOGO_ICON_SRC = PROJECT_ROOT / "src" / "assets" / "logo.png"
NSIS_DIR = PROJECT_ROOT / "src-tauri" / "nsis"
SIDEBAR_OUT = NSIS_DIR / "sidebar.bmp"
HEADER_OUT = NSIS_DIR / "header.bmp"

# ── NSIS dimension requirements ─────────────────────────────────────────────
SIDEBAR_W, SIDEBAR_H = 164, 314
HEADER_W, HEADER_H = 150, 57

# ── Preview scale factor (for visual inspection on HiDPI) ──────────────────
PREVIEW_SCALE = 4


def high_quality_resize(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Multi-step downscale with sharpening for maximum clarity.

    When downscaling from very large sources (e.g. 4096 → 140px),
    a single LANCZOS pass can lose detail. This halves iteratively
    until within 2× of the target, then does a final LANCZOS pass
    followed by an unsharp-mask to restore edge definition.
    """
    w, h = img.size

    # Step 1: iterative halving while > 2× target
    while w > target_w * 2 and h > target_h * 2:
        w //= 2
        h //= 2
        img = img.resize((w, h), Image.LANCZOS)

    # Step 2: final precision resize
    img = img.resize((target_w, target_h), Image.LANCZOS)

    # Step 3: unsharp mask to restore edge crispness lost in downscaling
    # radius=1.0: tight kernel (no halo artefacts at small sizes)
    # percent=120: moderate sharpening strength
    # threshold=2: only sharpen edges, ignore flat areas (reduces noise)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=120, threshold=2))

    return img


def trim_transparent(img: Image.Image) -> Image.Image:
    """Crop transparent padding from a RGBA image to maximise content area."""
    if img.mode != "RGBA":
        return img
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        return img.crop(bbox)
    return img


def generate_sidebar() -> None:
    """Create 164×314 sidebar BMP: bolt logo centred on surface-container bg."""
    canvas = Image.new("RGB", (SIDEBAR_W, SIDEBAR_H), SURFACE_CONTAINER)

    bolt = Image.open(BOLT_DARK_SRC).convert("RGBA")

    # Trim any transparent padding to maximise usable content
    bolt = trim_transparent(bolt)

    # Scale to fill canvas width with 12px padding on each side
    target_w = SIDEBAR_W - 24  # 140px
    scale = target_w / bolt.width
    target_h = int(bolt.height * scale)

    # Clamp height to fit vertically with margins
    max_h = SIDEBAR_H - 40  # leave room for gold line + padding
    if target_h > max_h:
        target_h = max_h
        target_w = int(bolt.width * (max_h / bolt.height))

    bolt = high_quality_resize(bolt, target_w, target_h)

    # Centre horizontally, position slightly above vertical centre
    x = (SIDEBAR_W - target_w) // 2
    y = (SIDEBAR_H - target_h) // 2 - 10

    # Composite (use alpha mask for transparency)
    canvas.paste(bolt, (x, y), bolt)

    # Draw gold accent line below logo
    draw = ImageDraw.Draw(canvas)
    line_y = y + target_h + 12
    draw.rectangle([16, line_y, SIDEBAR_W - 16, line_y + 1], fill=BRAND_GOLD)

    canvas.save(str(SIDEBAR_OUT), "BMP")


def generate_header() -> None:
    """Create 150×57 header BMP: M·O icon right-aligned on surface-container bg."""
    canvas = Image.new("RGB", (HEADER_W, HEADER_H), SURFACE_CONTAINER)

    logo = Image.open(LOGO_ICON_SRC).convert("RGBA")
    logo = trim_transparent(logo)

    # Maximise icon size: fill vertical space minus gold line and padding
    icon_size = HEADER_H - 2 - 8  # 47px (leave 2px gold + 4px top/bottom padding)
    logo = high_quality_resize(logo, icon_size, icon_size)

    # Right-align with 6px margin, vertically centred above gold line
    x = HEADER_W - icon_size - 6
    y = (HEADER_H - 2 - icon_size) // 2

    canvas.paste(logo, (x, y), logo)

    # Draw bottom gold accent line
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, HEADER_H - 2, HEADER_W, HEADER_H], fill=BRAND_GOLD)

    canvas.save(str(HEADER_OUT), "BMP")


def generate_preview(bmp_path: Path) -> Path:
    """Create an upscaled PNG preview for HiDPI visual inspection."""
    img = Image.open(bmp_path)
    w, h = img.size
    # Use NEAREST to show exact pixels without interpolation blur
    preview = img.resize((w * PREVIEW_SCALE, h * PREVIEW_SCALE), Image.NEAREST)
    preview_path = bmp_path.with_suffix(".preview.png")
    preview.save(str(preview_path), "PNG")
    return preview_path


def validate_bmp(path: Path, expected_w: int, expected_h: int) -> None:
    """Verify output file is a valid 24-bit BMP with correct dimensions."""
    assert path.exists(), f"Output file missing: {path}"

    with open(path, "rb") as f:
        header = f.read(30)

    # Magic bytes
    assert header[:2] == b"BM", f"Not a BMP file: {path}"

    # Dimensions (offsets 18 and 22, 4-byte signed LE)
    width = struct.unpack_from("<i", header, 18)[0]
    height = abs(struct.unpack_from("<i", header, 22)[0])
    assert width == expected_w, f"Width mismatch: got {width}, expected {expected_w}"
    assert height == expected_h, f"Height mismatch: got {height}, expected {expected_h}"

    # Bits per pixel (offset 28, 2-byte LE) — must be 24 for NSIS
    bpp = struct.unpack_from("<H", header, 28)[0]
    assert bpp == 24, f"BPP mismatch: got {bpp}, expected 24 (NSIS requires no alpha)"


def main() -> None:
    """Generate, validate, and preview NSIS brand images."""
    # Verify source assets exist
    for src in (BOLT_DARK_SRC, LOGO_ICON_SRC):
        if not src.exists():
            print(f"✗ Source asset missing: {src}", file=sys.stderr)
            sys.exit(1)

    # Ensure output directory exists
    NSIS_DIR.mkdir(parents=True, exist_ok=True)

    # Generate
    print(f"Generating {SIDEBAR_OUT.relative_to(PROJECT_ROOT)} ...")
    generate_sidebar()

    print(f"Generating {HEADER_OUT.relative_to(PROJECT_ROOT)} ...")
    generate_header()

    # Self-validate
    validate_bmp(SIDEBAR_OUT, SIDEBAR_W, SIDEBAR_H)
    validate_bmp(HEADER_OUT, HEADER_W, HEADER_H)

    # Generate upscaled previews for visual inspection
    for bmp_path in (SIDEBAR_OUT, HEADER_OUT):
        preview = generate_preview(bmp_path)
        print(f"  → Preview: {preview.relative_to(PROJECT_ROOT)}  ({PREVIEW_SCALE}× upscale)")

    print(f"✓ {SIDEBAR_OUT.relative_to(PROJECT_ROOT)}  ({SIDEBAR_W}×{SIDEBAR_H}, 24-bit BMP)")
    print(f"✓ {HEADER_OUT.relative_to(PROJECT_ROOT)}  ({HEADER_W}×{HEADER_H}, 24-bit BMP)")


if __name__ == "__main__":
    main()
