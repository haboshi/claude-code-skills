#!/usr/bin/env python3
"""
LINE スタンプ バリデーション スクリプト

LINE Creators Market の仕様に準拠しているか検証する。
静止画（PNG）とアニメーション（APNG）の両方に対応。

Usage:
    uv run --with pillow scripts/validate_sticker.py sticker.png
    uv run --with pillow scripts/validate_sticker.py --type animated sticker.png
    uv run --with pillow scripts/validate_sticker.py --batch stickers/
"""

import argparse
import json
import struct
import sys
from pathlib import Path

SPECS = {
    "static": {
        "main": {"width": 240, "height": 240},
        "sticker": {"max_width": 370, "max_height": 320, "min_dim": 80},
        "tab": {"width": 96, "height": 74},
        "max_file_size": 1 * 1024 * 1024,
        "sets": [8, 16, 24, 32, 40],
    },
    "animated": {
        "main": {"width": 240, "height": 240},
        "sticker": {"max_width": 320, "max_height": 270, "min_dim": 270},
        "tab": {"width": 96, "height": 74},
        "max_file_size": 1 * 1024 * 1024,
        "sets": [8, 16, 24],
        "min_frames": 5,
        "max_frames": 20,
        "max_playback_seconds": 4,
        "max_loops": 4,
    },
}


def check_png_transparency(filepath: Path) -> bool:
    """PNG にアルファチャンネル（透過）があるか確認"""
    from PIL import Image

    img = Image.open(filepath)
    return img.mode in ("RGBA", "LA") or "transparency" in img.info


def get_image_dimensions(filepath: Path) -> tuple[int, int]:
    """画像の幅と高さを取得"""
    from PIL import Image

    img = Image.open(filepath)
    return img.size


def count_apng_frames(filepath: Path) -> int:
    """APNG の acTL チャンクからフレーム数を取得"""
    with open(filepath, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            return 1

        while True:
            chunk_header = f.read(8)
            if len(chunk_header) < 8:
                break
            length = struct.unpack(">I", chunk_header[:4])[0]
            chunk_type = chunk_header[4:8]

            if chunk_type == b"acTL":
                data = f.read(length)
                num_frames = struct.unpack(">I", data[:4])[0]
                return num_frames
            else:
                f.seek(length + 4, 1)

    return 1


def validate_sticker(
    filepath: Path,
    sticker_type: str = "static",
    role: str = "sticker",
) -> list[dict]:
    """単一のスタンプ画像を LINE 仕様に対して検証する。

    戻り値: 問題リスト（空 = 合格）
    """
    issues = []
    spec = SPECS[sticker_type]
    role_spec = spec.get(role, spec["sticker"])

    if not filepath.exists():
        return [{"severity": "error", "message": f"ファイルが見つかりません: {filepath}"}]

    if filepath.suffix.lower() != ".png":
        issues.append(
            {
                "severity": "error",
                "message": f"PNG形式である必要があります（現在: {filepath.suffix}）",
            }
        )
        return issues

    file_size = filepath.stat().st_size
    max_size = spec["max_file_size"]
    if file_size > max_size:
        issues.append(
            {
                "severity": "error",
                "message": f"ファイルサイズ超過: {file_size / 1024:.1f}KB（上限: {max_size / 1024:.1f}KB）",
            }
        )

    try:
        width, height = get_image_dimensions(filepath)
    except Exception as e:
        issues.append({"severity": "error", "message": f"画像読み込みエラー: {e}"})
        return issues

    if width % 2 != 0 or height % 2 != 0:
        issues.append(
            {
                "severity": "error",
                "message": f"寸法は偶数である必要があります（現在: {width}x{height}）",
            }
        )

    if role in ("main", "tab"):
        expected_w = role_spec["width"]
        expected_h = role_spec["height"]
        if width != expected_w or height != expected_h:
            label = "メイン画像" if role == "main" else "タブ画像"
            issues.append(
                {
                    "severity": "error",
                    "message": f"{label}は{expected_w}x{expected_h}である必要があります（現在: {width}x{height}）",
                }
            )
    elif role == "sticker":
        if width > role_spec["max_width"] or height > role_spec["max_height"]:
            issues.append(
                {
                    "severity": "error",
                    "message": (
                        f"スタンプ画像の上限超過: {width}x{height}"
                        f"（上限: {role_spec['max_width']}x{role_spec['max_height']}）"
                    ),
                }
            )
        if width < role_spec["min_dim"] and height < role_spec["min_dim"]:
            issues.append(
                {
                    "severity": "error",
                    "message": (
                        f"幅または高さが{role_spec['min_dim']}px以上必要です"
                        f"（現在: {width}x{height}）"
                    ),
                }
            )

    try:
        if role != "tab" and not check_png_transparency(filepath):
            issues.append(
                {
                    "severity": "error",
                    "message": "透過背景が必要です（アルファチャンネルなし）",
                }
            )
    except Exception as e:
        issues.append({"severity": "warning", "message": f"透過チェックエラー: {e}"})

    if sticker_type == "animated" and role == "sticker":
        frame_count = count_apng_frames(filepath)
        if frame_count <= 1:
            issues.append(
                {
                    "severity": "error",
                    "message": "APNGファイルにアニメーションフレームがありません（静止画です）",
                }
            )
        elif frame_count < spec["min_frames"]:
            issues.append(
                {
                    "severity": "error",
                    "message": f"フレーム数不足: {frame_count}（最低{spec['min_frames']}フレーム必要）",
                }
            )
        elif frame_count > spec["max_frames"]:
            issues.append(
                {
                    "severity": "error",
                    "message": f"フレーム数超過: {frame_count}（上限{spec['max_frames']}フレーム）",
                }
            )

    return issues


def validate_batch(directory: Path, sticker_type: str = "static") -> dict:
    """ディレクトリ内の全スタンプを検証"""
    results = {"valid": 0, "invalid": 0, "files": {}}

    png_files = sorted(directory.glob("*.png"))
    if not png_files:
        print(f"警告: {directory} にPNGファイルが見つかりません")
        return results

    for filepath in png_files:
        name = filepath.name
        stem = filepath.stem.lower()

        # summary画像はスタンプではないのでスキップ
        if stem.startswith("summary"):
            continue

        if name == "main.png":
            role = "main"
        elif name == "tab.png":
            role = "tab"
        else:
            role = "sticker"

        issues = validate_sticker(filepath, sticker_type, role)
        results["files"][name] = issues
        if issues:
            results["invalid"] += 1
        else:
            results["valid"] += 1

    return results


def main():
    parser = argparse.ArgumentParser(
        description="LINE スタンプ バリデーション",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with pillow scripts/validate_sticker.py sticker.png
  uv run --with pillow scripts/validate_sticker.py --type animated sticker.apng
  uv run --with pillow scripts/validate_sticker.py --batch stickers/
  uv run --with pillow scripts/validate_sticker.py --role main main.png
        """,
    )
    parser.add_argument("path", help="検証するPNGファイルまたはディレクトリ")
    parser.add_argument(
        "-t",
        "--type",
        default="static",
        choices=["static", "animated"],
        help="スタンプタイプ",
    )
    parser.add_argument(
        "--role",
        default="sticker",
        choices=["main", "sticker", "tab"],
        help="画像の役割",
    )
    parser.add_argument(
        "--batch", action="store_true", help="ディレクトリ内の全PNGを検証"
    )
    parser.add_argument("--json", action="store_true", help="結果をJSON形式で出力")

    args = parser.parse_args()
    target = Path(args.path)

    if args.batch or target.is_dir():
        if not target.is_dir():
            print(f"エラー: ディレクトリが見つかりません: {target}")
            sys.exit(1)
        results = validate_batch(target, args.type)
        if args.json:
            print(json.dumps(results, ensure_ascii=False, indent=2))
        else:
            print(
                f"\n検証結果: {results['valid']} 件OK / {results['invalid']} 件NG"
            )
            for name, issues in results["files"].items():
                if issues:
                    print(f"\n  {name}:")
                    for issue in issues:
                        print(f"     [{issue['severity']}] {issue['message']}")
                else:
                    print(f"  {name}: OK")
        sys.exit(1 if results["invalid"] > 0 else 0)
    else:
        issues = validate_sticker(target, args.type, args.role)
        if args.json:
            print(json.dumps(issues, ensure_ascii=False, indent=2))
        elif issues:
            print(f"{target.name}:")
            for issue in issues:
                print(f"   [{issue['severity']}] {issue['message']}")
            sys.exit(1)
        else:
            print(f"{target.name}: LINE仕様に準拠しています")


if __name__ == "__main__":
    main()
