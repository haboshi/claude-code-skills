#!/usr/bin/env python3
"""
透過PNG画像を個々のオブジェクトに分割

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with opencv-python --with numpy scripts/split_transparent.py input.png [output_dir]
"""

import sys
from pathlib import Path


def split_transparent_image(input_path: str, output_dir: str, padding: int = 5, min_area: int = 1000):
    """
    透過PNG画像を個々のオブジェクトに分割

    Args:
        input_path: 入力画像パス（透過PNG）
        output_dir: 出力ディレクトリ
        padding: 切り出し時の余白
        min_area: 最小面積（これより小さいものは無視）

    Returns:
        list: 保存したファイルパスのリスト
    """
    import cv2
    import numpy as np

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"Error: Cannot read image: {input_path}")
        return []

    if img.shape[2] != 4:
        print("Error: Image does not have alpha channel")
        return []

    height, width = img.shape[:2]
    alpha = img[:, :, 3]
    _, mask = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    max_area = width * height * 0.8
    valid_contours = [c for c in contours if min_area < cv2.contourArea(c) < max_area]

    print(f"検出数: {len(valid_contours)}")

    objects = []
    for contour in valid_contours:
        x, y, w, h = cv2.boundingRect(contour)
        objects.append({
            'x': x, 'y': y, 'w': w, 'h': h,
            'center_x': x + w // 2,
            'center_y': y + h // 2
        })

    row_threshold = height // 3
    objects.sort(key=lambda o: (o['center_y'] // row_threshold, o['center_x']))

    output_files = []
    for i, obj in enumerate(objects):
        x1 = max(0, obj['x'] - padding)
        y1 = max(0, obj['y'] - padding)
        x2 = min(width, obj['x'] + obj['w'] + padding)
        y2 = min(height, obj['y'] + obj['h'] + padding)

        cropped = img[y1:y2, x1:x2].copy()
        output_file = output_path / f"sticker_{i+1:02d}.png"
        cv2.imwrite(str(output_file), cropped)
        output_files.append(str(output_file))
        print(f"保存: {output_file}")

    return output_files


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run --with opencv-python --with numpy split_transparent.py <input.png> [output_dir]")
        sys.exit(1)

    input_image = sys.argv[1]
    output_directory = sys.argv[2] if len(sys.argv) > 2 else "./split_output"
    split_transparent_image(input_image, output_directory)
