#!/usr/bin/env python3
"""
OpenAI GPT Image 画像生成スクリプト

OpenAI の gpt-image-1 / gpt-image-1.5 モデルを使用して画像を生成・編集します。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with openai --with pillow scripts/generate_openai.py "プロンプト"
"""

import argparse
import base64
import os
import sys
from pathlib import Path


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1024x1024",
    model: str = "gpt-image-1.5",
    quality: str = "medium",
    background: str = "auto",
    output_format: str = "png",
    reference_image: str = None,
    n: int = 1
) -> str:
    """OpenAI APIを使用して画像を生成"""
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("エラー: 環境変数 OPENAI_API_KEY が設定されていません")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    print(f"モデル: {model}")
    print(f"プロンプト: {prompt[:100]}...")
    print(f"サイズ: {size}, 品質: {quality}, 背景: {background}")
    if reference_image:
        print(f"参照画像: {reference_image}")
    print("生成中...")

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    if reference_image:
        with open(reference_image, "rb") as f:
            response = client.images.edit(
                model=model,
                image=f,
                prompt=prompt,
                size=size,
            )
    else:
        response = client.images.generate(
            model=model,
            prompt=prompt,
            size=size,
            quality=quality,
            background=background,
            output_format=output_format,
            n=n,
        )

    if response.data:
        for i, image_data in enumerate(response.data):
            if n > 1:
                stem = output_file.stem
                suffix = output_file.suffix
                save_path = output_file.parent / f"{stem}_{i+1:02d}{suffix}"
            else:
                save_path = output_file

            if hasattr(image_data, 'b64_json') and image_data.b64_json:
                image_bytes = base64.b64decode(image_data.b64_json)
                with open(save_path, "wb") as f:
                    f.write(image_bytes)
                print(f"保存完了: {save_path.absolute()}")
            elif hasattr(image_data, 'url') and image_data.url:
                import urllib.request
                urllib.request.urlretrieve(image_data.url, save_path)
                print(f"保存完了: {save_path.absolute()}")

        return str(output_file.absolute())

    print("警告: 画像が生成されませんでした")
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="OpenAI GPT Image 画像生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with openai generate_openai.py "かわいい猫のイラスト"
  uv run --with openai generate_openai.py "夕焼けの風景" -s 1536x1024 -o sunset.png
  uv run --with openai generate_openai.py "アイコン" -b transparent -o icon.png

モデル:
  gpt-image-1      標準モデル
  gpt-image-1-mini 軽量・高速
  gpt-image-1.5    最新・高品質（推奨）
        """
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument("-o", "--output", default="generated_image.png", help="出力ファイルパス")
    parser.add_argument("-s", "--size", default="1024x1024",
                        choices=["1024x1024", "1536x1024", "1024x1536", "auto"],
                        help="画像サイズ")
    parser.add_argument("-m", "--model", default="gpt-image-1.5",
                        choices=["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5"],
                        help="モデル")
    parser.add_argument("-q", "--quality", default="medium",
                        choices=["low", "medium", "high"],
                        help="品質")
    parser.add_argument("-b", "--background", default="auto",
                        choices=["transparent", "opaque", "auto"],
                        help="背景（transparent=透過）")
    parser.add_argument("-f", "--format", default="png",
                        choices=["png", "jpeg", "webp"],
                        help="出力形式")
    parser.add_argument("-r", "--reference", default=None,
                        help="参照/編集する画像のパス")
    parser.add_argument("-n", "--number", type=int, default=1,
                        choices=range(1, 11),
                        help="生成枚数（1-10）")

    args = parser.parse_args()

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        size=args.size,
        model=args.model,
        quality=args.quality,
        background=args.background,
        output_format=args.format,
        reference_image=args.reference,
        n=args.number
    )


if __name__ == "__main__":
    main()
