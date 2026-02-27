#!/usr/bin/env python3
"""
LINE スタンプパック 整理スクリプト

生成されたスタンプ画像を LINE Creators Market 提出形式のディレクトリ構成に整理する。

Usage:
    uv run scripts/organize_pack.py source/ -o pack/ --title "My Stickers"
"""

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

# main/tab/summary はスタンプ画像として扱わない
EXCLUDE_STEMS = {"main", "tab"}
EXCLUDE_PREFIXES = ("summary",)


def organize_pack(
    source_dir: str,
    output_dir: str = "sticker_pack",
    title: str = "Sticker Pack",
    author: str = "",
    sticker_type: str = "static",
    create_zip: bool = False,
) -> str:
    """スタンプ画像を LINE 提出形式に整理する。

    ソースディレクトリの構成:
        source_dir/
        |- main.png       (240x240)
        |- tab.png        (96x74)
        |- 01.png         (sticker)
        |- 02.png         (sticker)
        +- ...
    または任意の PNG（自動ナンバリング）。
    """
    src = Path(source_dir)
    out = Path(output_dir)

    if not src.exists():
        print(f"エラー: ソースディレクトリが見つかりません: {src}")
        sys.exit(1)

    out.mkdir(parents=True, exist_ok=True)

    all_pngs = sorted(src.glob("*.png"))
    if not all_pngs:
        print(f"エラー: {src} にPNGファイルが見つかりません")
        sys.exit(1)

    main_img = None
    tab_img = None
    sticker_imgs = []

    for png in all_pngs:
        stem = png.stem.lower()
        if stem == "main":
            main_img = png
        elif stem == "tab":
            tab_img = png
        elif stem in EXCLUDE_STEMS or any(stem.startswith(p) for p in EXCLUDE_PREFIXES):
            continue
        else:
            sticker_imgs.append(png)

    if main_img:
        shutil.copy2(main_img, out / "main.png")
        print(f"メイン画像: {main_img.name} -> main.png")
    else:
        print("警告: メイン画像（main.png）がありません")

    if tab_img:
        shutil.copy2(tab_img, out / "tab.png")
        print(f"タブ画像: {tab_img.name} -> tab.png")
    else:
        print("警告: タブ画像（tab.png）がありません")

    valid_sets = [8, 16, 24, 32, 40] if sticker_type == "static" else [8, 16, 24]
    sticker_count = len(sticker_imgs)

    print(f"\nスタンプ画像: {sticker_count} 枚")
    if sticker_count not in valid_sets:
        closest = min(valid_sets, key=lambda x: abs(x - sticker_count))
        print(f"警告: LINE仕様のセット数は {valid_sets} のいずれかです（現在: {sticker_count}）")
        print(f"   最も近いセット数: {closest}")

    stickers_dir = out / "png"
    stickers_dir.mkdir(exist_ok=True)

    for i, img in enumerate(sticker_imgs, 1):
        dest = stickers_dir / f"{i:02d}.png"
        shutil.copy2(img, dest)
        print(f"  {img.name} -> png/{i:02d}.png")

    summary = {
        "title": title,
        "author": author,
        "type": sticker_type,
        "sticker_count": sticker_count,
        "has_main": main_img is not None,
        "has_tab": tab_img is not None,
        "files": [f"{i:02d}.png" for i in range(1, sticker_count + 1)],
    }

    summary_path = out / "pack_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\nパック整理完了: {out.absolute()}")
    print(f"   メイン: {'OK' if main_img else 'なし'}")
    print(f"   タブ:   {'OK' if tab_img else 'なし'}")
    print(f"   スタンプ: {sticker_count} 枚")
    print(f"   サマリー: {summary_path}")

    if create_zip:
        zip_path = out.parent / f"{out.name}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in sorted(out.rglob("*")):
                if file.is_file():
                    arcname = file.relative_to(out)
                    zf.write(file, arcname)
        zip_size = zip_path.stat().st_size
        print(f"   ZIP: {zip_path} ({zip_size / 1024:.1f}KB)")
        if zip_size > 60 * 1024 * 1024:
            print("   警告: ZIPサイズが60MBを超えています（LINE上限）")

    return str(out.absolute())


def main():
    parser = argparse.ArgumentParser(
        description="LINE スタンプパック 整理",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run scripts/organize_pack.py generated/ -o my_pack/
  uv run scripts/organize_pack.py generated/ -o my_pack/ --title "ネコスタンプ"
  uv run scripts/organize_pack.py generated/ -o my_pack/ --type animated

出力形式:
  my_pack/
  |- main.png           (メイン画像)
  |- tab.png            (タブ画像)
  |- png/               (スタンプ画像フォルダ)
  |  |- 01.png
  |  |- 02.png
  |  +- ...
  +- pack_summary.json  (サマリー情報)
        """,
    )
    parser.add_argument("source", help="ソースディレクトリ")
    parser.add_argument("-o", "--output", default="sticker_pack", help="出力ディレクトリ")
    parser.add_argument("--title", default="Sticker Pack", help="スタンプタイトル")
    parser.add_argument("--author", default="", help="作成者名")
    parser.add_argument(
        "--type",
        default="static",
        choices=["static", "animated"],
        help="スタンプタイプ",
    )
    parser.add_argument(
        "--zip",
        action="store_true",
        help="パック整理後にZIPファイルを作成",
    )

    args = parser.parse_args()
    organize_pack(args.source, args.output, args.title, args.author, args.type, args.zip)


if __name__ == "__main__":
    main()
