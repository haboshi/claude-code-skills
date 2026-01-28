#!/usr/bin/env python3
"""
Vision API（macOS）を使用して背景を除去するツール

macOS 14.0以降が必要

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    python3 scripts/remove-bg-vision.py input.png
"""

import argparse
import subprocess
import sys
from pathlib import Path


def remove_background_vision(image_path: str, output_path: str = None) -> bool:
    """Vision APIで背景を除去"""
    script_dir = Path(__file__).parent
    swift_script = script_dir / "remove-bg.swift"
    output = output_path or image_path

    print(f"入力: {image_path}")
    print("背景を除去中（Vision API）...")

    if not swift_script.exists():
        print(f"エラー: {swift_script} が見つかりません")
        return False

    try:
        result = subprocess.run(
            ["swift", str(swift_script), image_path, output],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print(f"出力: {output}")
            print("背景除去完了（Vision API）")
            return True
        else:
            print(f"エラー: {result.stderr}")
            return False
    except Exception as e:
        print(f"エラー: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Vision API背景除去ツール (macOS 14.0+)")
    parser.add_argument("input", help="入力画像パス")
    parser.add_argument("-o", "--output", help="出力画像パス（省略時は上書き）")

    args = parser.parse_args()
    success = remove_background_vision(args.input, args.output)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
