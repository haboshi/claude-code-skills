#!/usr/bin/env python3
"""
透過画像のエッジを収縮するツール

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with pillow --with numpy --with scipy scripts/erode.py input.png
"""

import argparse
import sys


def erode_image(image_path: str, output_path: str = None, iterations: int = 1) -> bool:
    """透過画像のエッジを収縮"""
    from PIL import Image
    import numpy as np
    from scipy.ndimage import binary_erosion

    output = output_path or image_path
    print(f"入力: {image_path}")
    print(f"収縮: {iterations}px")

    try:
        img = Image.open(image_path).convert("RGBA")
        data = np.array(img)

        alpha = data[:, :, 3]
        alpha_mask = alpha > 0
        eroded_mask = binary_erosion(alpha_mask, iterations=iterations)
        data[~eroded_mask] = [0, 0, 0, 0]

        result = Image.fromarray(data, 'RGBA')
        result.save(output, "PNG")
        print(f"出力: {output}")
        return True
    except Exception as e:
        print(f"エラー: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="透過画像エッジ収縮ツール")
    parser.add_argument("input", help="入力画像パス")
    parser.add_argument("-o", "--output", help="出力画像パス（省略時は上書き）")
    parser.add_argument("-i", "--iterations", type=int, default=1, help="収縮量（ピクセル数、デフォルト: 1）")

    args = parser.parse_args()
    success = erode_image(args.input, args.output, args.iterations)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
