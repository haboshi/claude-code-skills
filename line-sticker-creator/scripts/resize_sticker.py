#!/usr/bin/env python3
"""
LINE スタンプ リサイズ スクリプト

画像を LINE Creators Market の仕様に合わせてリサイズする。
アスペクト比維持、偶数ピクセル、10px マージン確保。

Usage:
    uv run --with pillow scripts/resize_sticker.py input.png -o output.png
    uv run --with pillow scripts/resize_sticker.py input.png --role main
"""

import argparse
import sys
from pathlib import Path

TARGET_SIZES = {
    "sticker_static": {"max_width": 370, "max_height": 320, "margin": 10},
    "sticker_animated": {"max_width": 320, "max_height": 270, "margin": 10},
    "main": {"width": 240, "height": 240, "margin": 0},
    "tab": {"width": 96, "height": 74, "margin": 0},
}


def make_even(n: int) -> int:
    """偶数に切り捨て"""
    return n if n % 2 == 0 else n - 1


def resize_sticker(
    input_path: str,
    output_path: str = None,
    role: str = "sticker_static",
) -> str:
    """画像を LINE スタンプ仕様にリサイズ"""
    from PIL import Image

    img = Image.open(input_path)

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    spec = TARGET_SIZES[role]

    if role in ("main", "tab"):
        target_w, target_h = spec["width"], spec["height"]

        scale = max(target_w / img.width, target_h / img.height)
        new_w = int(img.width * scale)
        new_h = int(img.height * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)

        left = (new_w - target_w) // 2
        top = (new_h - target_h) // 2
        img = img.crop((left, top, left + target_w, top + target_h))
    else:
        margin = spec["margin"]
        max_w = spec["max_width"] - (margin * 2)
        max_h = spec["max_height"] - (margin * 2)

        if img.width > max_w or img.height > max_h:
            scale = min(max_w / img.width, max_h / img.height)
            new_w = make_even(int(img.width * scale))
            new_h = make_even(int(img.height * scale))
            img = img.resize((new_w, new_h), Image.LANCZOS)

        canvas_w = make_even(img.width + margin * 2)
        canvas_h = make_even(img.height + margin * 2)
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        paste_x = (canvas_w - img.width) // 2
        paste_y = (canvas_h - img.height) // 2
        canvas.paste(img, (paste_x, paste_y), img if img.mode == "RGBA" else None)
        img = canvas

    if img.width % 2 != 0 or img.height % 2 != 0:
        img = img.crop((0, 0, make_even(img.width), make_even(img.height)))

    if output_path is None:
        p = Path(input_path)
        output_path = str(p.parent / f"{p.stem}_resized{p.suffix}")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, "PNG")
    print(f"リサイズ完了: {output_path} ({img.width}x{img.height})")
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="LINE スタンプ リサイズ",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with pillow scripts/resize_sticker.py sticker.png -o resized.png
  uv run --with pillow scripts/resize_sticker.py sticker.png --role main -o main.png
  uv run --with pillow scripts/resize_sticker.py sticker.png --role tab -o tab.png
  uv run --with pillow scripts/resize_sticker.py sticker.png --role sticker_animated
        """,
    )
    parser.add_argument("input", help="入力画像パス")
    parser.add_argument("-o", "--output", default=None, help="出力ファイルパス")
    parser.add_argument(
        "--role",
        default="sticker_static",
        choices=["sticker_static", "sticker_animated", "main", "tab"],
        help="画像の役割（デフォルト: sticker_static）",
    )

    args = parser.parse_args()
    resize_sticker(args.input, args.output, args.role)


if __name__ == "__main__":
    main()
