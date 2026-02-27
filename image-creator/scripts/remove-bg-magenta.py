#!/usr/bin/env python3
"""
色ベース背景除去ツール（マゼンタ/グリーン対応・フラッドフィル方式）

マゼンタまたはグリーン背景を透過にする。
フラッドフィルで画像端から連結した背景のみ除去し、内部の同系色コンテンツを保護する。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py input.png
    uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py input.png --color green
"""

import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np


# 背景色ごとの検出条件とデフリンジ設定
BG_PROFILES = {
    "magenta": {
        "detect": lambda r, g, b: (
            ((r > 180) & (g < 100) & (b > 100))  # strong
            | ((r > 150) & (g < 150) & (b > g + 30) & (r > b))  # weak
        ),
        "defringe": lambda r, g, b: min(r - g, b - g),  # magenta contamination
        "defringe_channels": (0, 2),  # reduce R and B
        # 閉じ込め背景判定: マゼンタBGはG(非背景チャンネル)が低い
        "trapped_channel": lambda r, g, b: g,
    },
    "green": {
        "detect": lambda r, g, b: (
            ((g > 150) & (r < 100) & (b < 100))  # strong: pure green
            | ((g > 120) & (g > r + 20) & (g > b + 20))  # medium: green dominant
            | ((g > 100) & (r < 200) & (b < 200) & (g > r) & (g > b) & ((g - r) + (g - b) > 40))  # weak: green tint
        ),
        "defringe": lambda r, g, b: g - max(r, b),  # green contamination
        "defringe_channels": (1,),  # reduce G
        # 閉じ込め背景判定: グリーンBGはmax(R,B)(非背景チャンネル)が低い
        "trapped_channel": lambda r, g, b: np.maximum(r, b),
    },
}

# フラッドフィルで除去しきれない小領域の閾値（px）
MIN_CLUSTER_SIZE = 200


def remove_background(image_path: str, output_path: str = None, bg_color: str = "magenta") -> bool:
    """背景を色ベース + フラッドフィルで透過にする"""
    from PIL import Image
    import numpy as np
    from scipy.ndimage import binary_erosion, binary_dilation, label

    profile = BG_PROFILES.get(bg_color)
    if not profile:
        print(f"エラー: 未対応の背景色: {bg_color} (対応: {list(BG_PROFILES.keys())})")
        return False

    output = output_path or image_path
    print(f"入力: {image_path}")
    print(f"背景を除去中（{bg_color}色 フラッドフィル + デフリンジ）...")

    try:
        img = Image.open(image_path).convert("RGBA")
        data = np.array(img, dtype=np.float32)
        h, w = data.shape[:2]

        r, g, b = data[:, :, 0], data[:, :, 1], data[:, :, 2]

        # 背景色ピクセル検出
        bg_pixels = profile["detect"](r, g, b)

        # Phase 1: フラッドフィル（画像端から連結した背景のみ除去）
        bg_mask = np.zeros((h, w), dtype=bool)
        visited = np.zeros((h, w), dtype=bool)
        queue = deque()

        for x in range(w):
            for y in [0, h - 1]:
                if bg_pixels[y, x] and not visited[y, x]:
                    queue.append((y, x))
                    visited[y, x] = True
        for y in range(h):
            for x in [0, w - 1]:
                if bg_pixels[y, x] and not visited[y, x]:
                    queue.append((y, x))
                    visited[y, x] = True

        while queue:
            cy, cx = queue.popleft()
            bg_mask[cy, cx] = True
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1),
                           (-1, -1), (-1, 1), (1, -1), (1, 1)]:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and bg_pixels[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))

        # Phase 2: 残留背景の小クラスタ除去
        remaining = bg_pixels & ~bg_mask
        if remaining.any():
            labeled, num_features = label(remaining)
            trapped = 0
            for i in range(1, num_features + 1):
                cluster = labeled == i
                if cluster.sum() < MIN_CLUSTER_SIZE:
                    bg_mask[cluster] = True
                    trapped += cluster.sum()
            if trapped > 0:
                print(f"  閉じ込め背景除去: {trapped}px")

        data[bg_mask] = [0, 0, 0, 0]

        # エッジデフリンジ
        alpha = data[:, :, 3]
        alpha_mask = alpha > 0
        dilated = binary_dilation(alpha_mask, iterations=3)
        eroded = binary_erosion(alpha_mask, iterations=3)
        edge_mask = dilated & ~eroded & alpha_mask

        defringe_fn = profile["defringe"]
        defringe_chs = profile["defringe_channels"]
        edge_indices = np.where(edge_mask)
        defringe_count = 0
        for y, x in zip(edge_indices[0], edge_indices[1]):
            pixel = data[y, x]
            r_val, g_val, b_val, a_val = pixel
            if a_val > 0:
                contamination = defringe_fn(r_val, g_val, b_val)
                if contamination > 10:
                    reduction = contamination * 0.9
                    for ch in defringe_chs:
                        data[y, x, ch] = max(0, data[y, x, ch] - reduction)
                    if contamination > 30:
                        data[y, x, 3] = a_val * 0.6
                    defringe_count += 1
        if defringe_count > 0:
            print(f"  デフリンジ: {defringe_count}px")

        # Phase 4: グローバル色汚染補正（透過 or 色補正を判別）
        alpha_current = data[:, :, 3]
        visible_mask = alpha_current > 0
        rv = data[:, :, 0]
        gv = data[:, :, 1]
        bv = data[:, :, 2]
        contamination_map = np.zeros((h, w), dtype=np.float32)
        contamination_map[visible_mask] = np.vectorize(defringe_fn)(
            rv[visible_mask], gv[visible_mask], bv[visible_mask]
        )

        # 高汚染 = 閉じ込め背景 → 透過にする
        # 判定: 汚染度が高い AND 非背景チャンネルが低い
        # マゼンタBG: G < 100 → 閉じ込め背景、グリーンBG: max(R,B) < 150 → 閉じ込め背景
        trapped_check_fn = profile["trapped_channel"]
        non_bg_values = np.zeros((h, w), dtype=np.float32)
        non_bg_values[visible_mask] = trapped_check_fn(
            rv[visible_mask], gv[visible_mask], bv[visible_mask]
        )
        trapped_bg = visible_mask & (contamination_map > 50) & (non_bg_values < 100)
        trapped_count = trapped_bg.sum()
        if trapped_count > 0:
            data[trapped_bg] = [0, 0, 0, 0]
            print(f"  閉じ込め背景透過: {trapped_count}px")

        # 低〜中汚染 = コンテンツへの色混入 → G補正のみ
        fix_mask = visible_mask & ~trapped_bg & (contamination_map > 15)
        fix_count = fix_mask.sum()
        if fix_count > 0:
            reduction = contamination_map[fix_mask] * 0.85
            for ch in defringe_chs:
                channel = data[:, :, ch]
                channel[fix_mask] = np.maximum(0, channel[fix_mask] - reduction)
            print(f"  グローバル色補正: {fix_count}px")

        # 最外周1px収縮
        alpha_final = data[:, :, 3] > 0
        eroded_final = binary_erosion(alpha_final, iterations=1)
        data[~eroded_final] = [0, 0, 0, 0]

        result = Image.fromarray(data.astype(np.uint8), "RGBA")
        result.save(output, "PNG")
        print(f"出力: {output}")
        print("背景除去完了（フラッドフィル + デフリンジ + 1px収縮済）")
        return True
    except Exception as e:
        print(f"エラー: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="色ベース背景除去ツール（マゼンタ/グリーン対応）")
    parser.add_argument("input", help="入力画像パス")
    parser.add_argument("-o", "--output", help="出力画像パス（省略時は上書き）")
    parser.add_argument(
        "--color",
        default="magenta",
        choices=list(BG_PROFILES.keys()),
        help="背景色（デフォルト: magenta）",
    )

    args = parser.parse_args()
    success = remove_background(args.input, args.output, bg_color=args.color)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
