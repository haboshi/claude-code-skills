#!/usr/bin/env python3
"""
マゼンタ/ピンク背景を色ベースで透過にするツール

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py input.png
"""

import argparse
import sys
from pathlib import Path


def remove_background_magenta(image_path: str, output_path: str = None) -> bool:
    """マゼンタ/ピンク背景を色ベースで透過にする（エッジデフリンジ付き）"""
    from PIL import Image
    import numpy as np
    from scipy.ndimage import binary_erosion, binary_dilation

    output = output_path or image_path
    print(f"入力: {image_path}")
    print("背景を除去中（マゼンタ/ピンク色除去 + デフリンジ）...")

    try:
        img = Image.open(image_path).convert("RGBA")
        data = np.array(img, dtype=np.float32)

        r, g, b, _a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]

        # マゼンタ検出
        magenta_strong = (r > 180) & (g < 100) & (b > 100)
        magenta_weak = (r > 150) & (g < 150) & (b > g + 30) & (r > b)
        magenta_mask = magenta_strong | magenta_weak

        data[magenta_mask] = [0, 0, 0, 0]

        # エッジ検出
        alpha = data[:, :, 3]
        alpha_mask = alpha > 0
        dilated = binary_dilation(alpha_mask, iterations=2)
        eroded = binary_erosion(alpha_mask, iterations=2)
        edge_mask = dilated & ~eroded & alpha_mask

        # エッジピクセルのデフリンジ処理
        edge_indices = np.where(edge_mask)
        for y, x in zip(edge_indices[0], edge_indices[1]):
            pixel = data[y, x]
            r_val, g_val, b_val, a_val = pixel
            if a_val > 0:
                magenta_contamination = min(r_val - g_val, b_val - g_val)
                if magenta_contamination > 20:
                    reduction = magenta_contamination * 0.7
                    data[y, x, 0] = max(0, r_val - reduction)
                    data[y, x, 2] = max(0, b_val - reduction)
                    if magenta_contamination > 50:
                        data[y, x, 3] = a_val * 0.7

        # 最外周1pxを透過
        alpha_final = data[:, :, 3] > 0
        eroded_final = binary_erosion(alpha_final, iterations=1)
        data[~eroded_final] = [0, 0, 0, 0]

        result = Image.fromarray(data.astype(np.uint8), 'RGBA')
        result.save(output, "PNG")
        print(f"出力: {output}")
        print("背景除去完了（デフリンジ + 1px収縮済）")
        return True
    except Exception as e:
        print(f"エラー: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="マゼンタ背景除去ツール")
    parser.add_argument("input", help="入力画像パス")
    parser.add_argument("-o", "--output", help="出力画像パス（省略時は上書き）")

    args = parser.parse_args()
    success = remove_background_magenta(args.input, args.output)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
