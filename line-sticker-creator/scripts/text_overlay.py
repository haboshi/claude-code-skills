#!/usr/bin/env python3
"""
LINE スタンプ テキストオーバーレイ スクリプト

透過背景のスタンプ画像にテキストを合成する。
白縁取り＋カラーテキストで視認性を確保。

Usage:
    uv run --with pillow scripts/text_overlay.py input.png "こんにちは！" -o output.png
    uv run --with pillow scripts/text_overlay.py --batch input_dir/ texts.json -o output_dir/
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """フォントを読み込む。ヒラギノ角ゴシック W8 優先。"""
    font_paths = [
        "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for fp in font_paths:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except (OSError, ValueError):
                continue
    return ImageFont.load_default()


def auto_font_size(
    text: str, max_width: int, max_size: int = 64, min_size: int = 16
) -> int:
    """テキストが max_width に収まる最大フォントサイズを探索する。"""
    for size in range(max_size, min_size - 1, -2):
        font = load_font(size)
        dummy = Image.new("RGBA", (1, 1))
        draw = ImageDraw.Draw(dummy)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        if text_w <= max_width:
            return size
    return min_size


def overlay_text(
    input_path: str,
    text: str,
    output_path: str | None = None,
    text_color: str = "#FF6600",
    outline_color: str = "#FFFFFF",
    outline_width: int | None = None,
    font_size: int | None = None,
    position: str = "bottom",
    margin: int = 10,
) -> str:
    """画像にテキストを合成する。

    Args:
        input_path: 入力画像パス（RGBA推奨）
        text: 描画するテキスト
        output_path: 出力パス（None で自動生成）
        text_color: テキスト色（hex）
        outline_color: 縁取り色（hex）
        outline_width: 縁取り幅（None でフォントサイズの1/10）
        font_size: フォントサイズ（None で自動計算）
        position: テキスト位置（top / center / bottom）
        margin: テキスト配置のマージン（px）

    Returns:
        出力ファイルの絶対パス
    """
    img = Image.open(input_path).convert("RGBA")

    # フォントサイズ決定
    max_text_width = int(img.width * 0.85)
    if font_size is None:
        font_size = auto_font_size(text, max_text_width)
    font = load_font(font_size)

    # 縁取り幅
    if outline_width is None:
        outline_width = max(1, font_size // 10)

    # テキストレイヤー作成
    text_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_layer)

    # テキスト位置計算
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    tx = (img.width - text_w) // 2

    if position == "top":
        ty = margin
    elif position == "center":
        ty = (img.height - text_h) // 2
    else:  # bottom
        ty = img.height - text_h - margin - outline_width

    # 白縁取り描画（8方向オフセット）
    for dx in range(-outline_width, outline_width + 1):
        for dy in range(-outline_width, outline_width + 1):
            if dx * dx + dy * dy <= outline_width * outline_width:
                draw.text((tx + dx, ty + dy), text, fill=outline_color, font=font)

    # テキスト本体描画
    draw.text((tx, ty), text, fill=text_color, font=font)

    # 合成
    result = Image.alpha_composite(img, text_layer)

    # 保存
    if output_path is None:
        p = Path(input_path)
        output_path = str(p.parent / f"{p.stem}_text{p.suffix}")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path, "PNG")
    print(f"テキスト合成: {Path(output_path).name} (「{text}」, {font_size}px)")
    return str(Path(output_path).absolute())


def batch_overlay(
    input_dir: str,
    texts_file: str,
    output_dir: str,
    text_color: str = "#FF6600",
    outline_color: str = "#FFFFFF",
    position: str = "bottom",
) -> list[str]:
    """バッチモード: JSON マッピングファイルに基づいて複数画像にテキストを合成。

    texts.json の形式:
        {
          "01.png": "こんにちは！",
          "02.png": "ありがとう",
          ...
        }
    または配列形式（ファイル名順に適用）:
        ["こんにちは！", "ありがとう", ...]
    """
    src = Path(input_dir)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    with open(texts_file, encoding="utf-8") as f:
        texts_data = json.load(f)

    # 配列形式の場合、ファイル名順にマッピング
    if isinstance(texts_data, list):
        exclude = {"main", "tab"}
        images = sorted(
            p for p in src.glob("*.png")
            if p.stem.lower() not in exclude and not p.stem.lower().startswith("summary")
        )
        if len(texts_data) != len(images):
            print(f"警告: テキスト数({len(texts_data)})と画像数({len(images)})が一致しません")
        texts_map = {}
        for img_path, txt in zip(images, texts_data):
            texts_map[img_path.name] = txt
    else:
        texts_map = texts_data

    results = []
    for filename, text in texts_map.items():
        input_path = src / filename
        if not input_path.exists():
            print(f"警告: {filename} が見つかりません。スキップ")
            continue
        output_path = str(out / filename)
        result = overlay_text(
            str(input_path),
            text,
            output_path,
            text_color=text_color,
            outline_color=outline_color,
            position=position,
        )
        results.append(result)

    print(f"\nバッチ完了: {len(results)} 枚のテキスト合成")
    return results


def main():
    parser = argparse.ArgumentParser(
        description="LINE スタンプ テキストオーバーレイ",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  # 単体
  uv run --with pillow scripts/text_overlay.py input.png "こんにちは！" -o output.png
  uv run --with pillow scripts/text_overlay.py input.png "OK！" --text-color "#0066CC"

  # バッチ（JSON辞書形式）
  uv run --with pillow scripts/text_overlay.py --batch input_dir/ texts.json -o output_dir/

  # バッチ（JSON配列形式 - ファイル名順に適用）
  echo '["こんにちは！", "ありがとう", "OK！"]' > texts.json
  uv run --with pillow scripts/text_overlay.py --batch input_dir/ texts.json -o output_dir/

テキスト描画仕様:
  フォント: ヒラギノ角ゴシック W8（macOS）
  サイズ: 画像幅の85%に収まるよう自動計算
  縁取り: 白色、フォントサイズの1/10幅
        """,
    )
    # 単体モード引数
    parser.add_argument("input", nargs="?", help="入力画像パス")
    parser.add_argument("text", nargs="?", help="描画するテキスト")

    # バッチモード引数
    parser.add_argument("--batch", nargs=2, metavar=("INPUT_DIR", "TEXTS_JSON"),
                        help="バッチモード: 入力ディレクトリ と テキストJSONファイル")

    # 共通オプション
    parser.add_argument("-o", "--output", default=None, help="出力パス（単体: ファイル、バッチ: ディレクトリ）")
    parser.add_argument("--text-color", default="#FF6600", help="テキスト色（hex）")
    parser.add_argument("--outline-color", default="#FFFFFF", help="縁取り色（hex）")
    parser.add_argument("--outline-width", type=int, default=None, help="縁取り幅（px、省略で自動）")
    parser.add_argument("--font-size", type=int, default=None, help="フォントサイズ（省略で自動）")
    parser.add_argument("--position", default="bottom", choices=["top", "center", "bottom"],
                        help="テキスト位置（デフォルト: bottom）")

    args = parser.parse_args()

    if args.batch:
        input_dir, texts_file = args.batch
        output_dir = args.output or "text_overlay_output"
        batch_overlay(
            input_dir, texts_file, output_dir,
            text_color=args.text_color,
            outline_color=args.outline_color,
            position=args.position,
        )
    elif args.input and args.text:
        overlay_text(
            args.input, args.text, args.output,
            text_color=args.text_color,
            outline_color=args.outline_color,
            outline_width=args.outline_width,
            font_size=args.font_size,
            position=args.position,
        )
    else:
        parser.print_help()
        print("\nエラー: 単体モードでは input と text が必要です。バッチモードでは --batch を使用してください。")
        sys.exit(1)


if __name__ == "__main__":
    main()
