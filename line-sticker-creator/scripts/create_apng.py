#!/usr/bin/env python3
"""
LINE アニメーションスタンプ APNG 作成スクリプト

フレーム画像群から APNG（Animated PNG）を生成する。
LINE Creators Market のアニメーションスタンプ仕様に準拠。

Usage:
    uv run --with pillow scripts/create_apng.py frames/ -o animated.png
    uv run --with pillow scripts/create_apng.py frames/ --fps 10 --loops 2
"""

import argparse
import sys
from pathlib import Path

MIN_FRAMES = 5
MAX_FRAMES = 20
MAX_PLAYBACK_MS = 4000
MAX_LOOPS = 4


def create_apng(
    frames_dir: str,
    output_path: str = "animated_sticker.png",
    fps: int = 10,
    loops: int = 1,
) -> str:
    """フレーム画像ディレクトリから APNG を生成する。

    Args:
        frames_dir: フレームPNGを含むディレクトリ（ファイル名順でソート）
        output_path: 出力APNGファイルパス
        fps: フレームレート（推奨 10-20）
        loops: ループ回数（1-4）
    """
    from PIL import Image

    frames_path = Path(frames_dir)
    frame_files = sorted(frames_path.glob("*.png"))

    if not frame_files:
        print(f"エラー: {frames_dir} にフレーム画像（PNG）が見つかりません")
        sys.exit(1)

    frame_count = len(frame_files)
    frame_duration_ms = int(1000 / fps)
    total_duration_ms = frame_count * frame_duration_ms * loops

    if frame_count < MIN_FRAMES:
        print(f"エラー: フレーム数不足 ({frame_count}/{MIN_FRAMES}以上必要)")
        sys.exit(1)
    if frame_count > MAX_FRAMES:
        print(f"エラー: フレーム数超過 ({frame_count}/{MAX_FRAMES}以下にしてください)")
        sys.exit(1)
    if loops < 1 or loops > MAX_LOOPS:
        print(
            f"エラー: ループ回数は1-{MAX_LOOPS}の範囲で指定してください（現在: {loops}）"
        )
        sys.exit(1)
    if total_duration_ms > MAX_PLAYBACK_MS:
        max_frames = int(MAX_PLAYBACK_MS / (frame_duration_ms * loops))
        print(f"エラー: 再生時間超過 ({total_duration_ms}ms > {MAX_PLAYBACK_MS}ms)")
        print(f"  現在の設定（{fps}fps, {loops}ループ）では最大{max_frames}フレームです")
        sys.exit(1)

    print(f"フレーム数: {frame_count}")
    print(f"FPS: {fps} ({frame_duration_ms}ms/frame)")
    print(f"ループ: {loops}回")
    print(f"総再生時間: {total_duration_ms}ms ({total_duration_ms / 1000:.1f}秒)")

    frames = []
    for f in frame_files:
        img = Image.open(f)
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        frames.append(img)

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    frames[0].save(
        output_file,
        save_all=True,
        append_images=frames[1:],
        duration=frame_duration_ms,
        loop=loops,
        disposal=2,
    )

    file_size = output_file.stat().st_size
    print(f"\n保存完了: {output_file.absolute()}")
    print(f"ファイルサイズ: {file_size / 1024:.1f}KB")

    if file_size > 1 * 1024 * 1024:
        print("警告: ファイルサイズが1MBを超えています（LINE上限）")

    return str(output_file.absolute())


def main():
    parser = argparse.ArgumentParser(
        description="LINE アニメーションスタンプ APNG 作成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with pillow scripts/create_apng.py frames/ -o sticker_01.png
  uv run --with pillow scripts/create_apng.py frames/ --fps 15 --loops 2

LINE仕様:
  フレーム数: 5-20
  ループ: 1-4回
  総再生時間: 4秒以内
  推奨FPS: 10-20
        """,
    )
    parser.add_argument("frames_dir", help="フレーム画像ディレクトリ")
    parser.add_argument(
        "-o", "--output", default="animated_sticker.png", help="出力APNGファイルパス"
    )
    parser.add_argument("--fps", type=int, default=10, help="フレームレート（デフォルト: 10）")
    parser.add_argument(
        "--loops",
        type=int,
        default=1,
        choices=range(1, MAX_LOOPS + 1),
        help=f"ループ回数（1-{MAX_LOOPS}、デフォルト: 1）",
    )

    args = parser.parse_args()
    create_apng(args.frames_dir, args.output, args.fps, args.loops)


if __name__ == "__main__":
    main()
