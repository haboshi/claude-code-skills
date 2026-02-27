#!/usr/bin/env python3
"""
LINE スタンプ サマリー合成画像生成スクリプト

スタンプ画像をグリッド状に並べた一覧画像を生成する。

Usage:
    uv run --with pillow scripts/create_summary.py input_dir/ -o summary.png
    uv run --with pillow scripts/create_summary.py input_dir/ --cols 4 --title "My Stickers"
"""

import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# main.png, tab.png, summary を除外するパターン
EXCLUDE_STEMS = {"main", "tab", "summary"}


def find_sticker_images(input_dir: Path) -> list[Path]:
    """ディレクトリからスタンプ画像を名前順で取得する（main/tab/summary除外）。"""
    images = []
    for p in sorted(input_dir.glob("*.png")):
        if p.stem.lower() not in EXCLUDE_STEMS and not p.stem.lower().startswith("summary"):
            images.append(p)
    return images


def calc_grid(count: int, cols: int | None = None) -> tuple[int, int]:
    """画像数からグリッドの列数・行数を計算する。"""
    if cols is not None:
        rows = math.ceil(count / cols)
        return cols, rows

    # 既知のセット数に対する最適グリッド
    presets = {
        8: (4, 2),
        16: (4, 4),
        24: (6, 4),
        32: (8, 4),
        40: (8, 5),
    }
    if count in presets:
        return presets[count]

    # その他: ceil(sqrt(n)) 列
    c = math.ceil(math.sqrt(count))
    r = math.ceil(count / c)
    return c, r


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """フォントを読み込む。ヒラギノ角ゴシック優先、フォールバックでPILデフォルト。"""
    font_paths = [
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


def create_summary(
    input_dir: str,
    output: str = "summary.png",
    cols: int | None = None,
    padding: int = 20,
    bg_color: str = "#F5F5F5",
    title: str = "",
    show_labels: bool = True,
    cell_size: int = 200,
) -> str:
    """スタンプ画像のグリッドサマリーを生成する。

    Args:
        input_dir: スタンプ画像のディレクトリ
        output: 出力ファイルパス
        cols: グリッド列数（None で自動計算）
        padding: 画像間パディング（px）
        bg_color: 背景色
        title: 上部タイトル
        show_labels: 番号ラベルを表示するか
        cell_size: セルの最大サイズ（px）

    Returns:
        出力ファイルの絶対パス
    """
    src = Path(input_dir)
    if not src.exists():
        print(f"エラー: ディレクトリが見つかりません: {src}")
        sys.exit(1)

    images = find_sticker_images(src)
    if not images:
        print(f"エラー: {src} にスタンプ画像が見つかりません")
        sys.exit(1)

    count = len(images)
    grid_cols, grid_rows = calc_grid(count, cols)

    print(f"スタンプ画像: {count} 枚")
    print(f"グリッド: {grid_cols} x {grid_rows}")

    # タイトル領域の高さ
    title_height = 0
    title_font = None
    if title:
        title_font = load_font(32)
        title_height = 60

    # キャンバスサイズ計算
    canvas_w = padding + grid_cols * (cell_size + padding)
    canvas_h = title_height + padding + grid_rows * (cell_size + padding)

    canvas = Image.new("RGBA", (canvas_w, canvas_h), bg_color)
    draw = ImageDraw.Draw(canvas)

    # タイトル描画
    if title and title_font:
        bbox = draw.textbbox((0, 0), title, font=title_font)
        text_w = bbox[2] - bbox[0]
        tx = (canvas_w - text_w) // 2
        ty = (title_height - (bbox[3] - bbox[1])) // 2
        draw.text((tx, ty), title, fill="#333333", font=title_font)

    # ラベル用フォント
    label_font = load_font(16) if show_labels else None

    # 各画像を配置
    for idx, img_path in enumerate(images):
        row = idx // grid_cols
        col = idx % grid_cols

        x = padding + col * (cell_size + padding)
        y = title_height + padding + row * (cell_size + padding)

        try:
            img = Image.open(img_path).convert("RGBA")
        except (OSError, ValueError) as e:
            print(f"警告: {img_path.name} を読み込めません: {e}")
            continue

        # アスペクト比を維持してリサイズ
        img.thumbnail((cell_size, cell_size), Image.LANCZOS)

        # セル内で中央配置
        offset_x = x + (cell_size - img.width) // 2
        offset_y = y + (cell_size - img.height) // 2

        # 透過画像を合成
        canvas.paste(img, (offset_x, offset_y), img)

        # 番号ラベル
        if show_labels and label_font:
            label = str(idx + 1)
            lx = x + 4
            ly = y + cell_size - 24
            # 背景付きラベル
            lbbox = draw.textbbox((lx, ly), label, font=label_font)
            draw.rectangle(
                [lbbox[0] - 2, lbbox[1] - 1, lbbox[2] + 2, lbbox[3] + 1],
                fill=(0, 0, 0, 160),
            )
            draw.text((lx, ly), label, fill="#FFFFFF", font=label_font)

    # 保存
    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(str(out_path), "PNG")

    abs_path = str(out_path.absolute())
    print(f"\nサマリー画像を生成しました: {abs_path}")
    print(f"  サイズ: {canvas_w} x {canvas_h} px")
    print(f"  画像数: {count} 枚")
    return abs_path


def main():
    parser = argparse.ArgumentParser(
        description="LINE スタンプ サマリー合成画像生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with pillow scripts/create_summary.py output/resized/ -o summary.png
  uv run --with pillow scripts/create_summary.py output/resized/ --cols 4 --title "ネコスタンプ"
  uv run --with pillow scripts/create_summary.py output/resized/ --no-label --bg-color "#FFFFFF"

グリッドレイアウト（自動計算）:
  8個: 4x2, 16個: 4x4, 24個: 6x4, 32個: 8x4, 40個: 8x5
  その他: ceil(sqrt(n)) 列
        """,
    )
    parser.add_argument("input_dir", help="スタンプ画像のディレクトリ")
    parser.add_argument("-o", "--output", default="summary.png", help="出力ファイルパス")
    parser.add_argument("--cols", type=int, default=None, help="グリッド列数（省略時: 自動計算）")
    parser.add_argument("--padding", type=int, default=20, help="画像間パディング（px）")
    parser.add_argument("--bg-color", default="#F5F5F5", help="背景色")
    parser.add_argument("--title", default="", help="上部タイトル")
    parser.add_argument("--no-label", action="store_true", help="番号ラベルなし")
    parser.add_argument("--cell-size", type=int, default=200, help="セルの最大サイズ（px）")

    args = parser.parse_args()
    create_summary(
        input_dir=args.input_dir,
        output=args.output,
        cols=args.cols,
        padding=args.padding,
        bg_color=args.bg_color,
        title=args.title,
        show_labels=not args.no_label,
        cell_size=args.cell_size,
    )


if __name__ == "__main__":
    main()
