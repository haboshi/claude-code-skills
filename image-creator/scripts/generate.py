#!/usr/bin/env python3
"""
Gemini画像生成スクリプト（Nano Banana 2）

Google Gemini の画像生成モデルを使用して画像を生成します。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with google-genai --with pillow scripts/generate.py "プロンプト"
"""

import argparse
import os
import sys
import time
from pathlib import Path


MAX_REF_SIZE = 1024
MAX_RETRIES = 2
RETRY_BASE_DELAY = 10

# モデル別タイムアウト（ミリ秒）
MODEL_TIMEOUT_MS = {
    "nb2": 300_000,    # 300秒 — NB2(Preview)
    "pro": 300_000,    # 300秒 — Pro(Preview)
    "flash": 600_000,  # 600秒 — Flash(GA安定モデル)
}

# フォールバック対象のHTTPステータスコード
RETRYABLE_CODES = {503, 429, 408}
FALLBACK_CODES = {503, 504, 429, 408}


def _get_status_code(exc):
    """例外からHTTPステータスコードを抽出"""
    for attr in ("status_code", "code"):
        code = getattr(exc, attr, None)
        if isinstance(code, int):
            return code
    err_msg = str(exc)
    exc_name = type(exc).__name__
    for code in (503, 504, 429, 408):
        if str(code) in err_msg:
            return code
    if "DEADLINE_EXCEEDED" in err_msg:
        return 504
    if "ReadTimeout" in exc_name or "timeout" in err_msg.lower():
        return 504
    return 0


def load_reference_image(image_path: str):
    """参照画像を読み込み（長辺1024pxにリサイズ）"""
    from PIL import Image

    path = Path(image_path)
    if not path.exists():
        print(f"エラー: 参照画像が見つかりません: {image_path}")
        sys.exit(1)

    img = Image.open(path)
    w, h = img.size
    if max(w, h) > MAX_REF_SIZE:
        img.thumbnail((MAX_REF_SIZE, MAX_REF_SIZE), Image.LANCZOS)
        print(f"参照画像: {path.absolute()} ({w}x{h} → {img.size[0]}x{img.size[1]})")
    else:
        print(f"参照画像: {path.absolute()} ({w}x{h})")
    return img


def _extract_image(response, output_file):
    """レスポンスから画像を抽出して保存。成功時はパスを返す。"""
    parts = response.parts
    if parts is None:
        return None
    for part in parts:
        if part.inline_data is not None:
            image = part.as_image()
            image.save(output_file)
            return str(output_file.absolute())
    return None


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    aspect_ratio: str = "1:1",
    model_type: str = "pro",
    magenta_bg: bool = False,
    reference_image: str = None,
    no_fallback: bool = False,
) -> str:
    """Gemini APIを使用して画像を生成"""
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("エラー: 環境変数 GEMINI_API_KEY が設定されていません")
        sys.exit(1)

    if magenta_bg:
        bg_instruction = (
            "BACKGROUND: solid flat uniform magenta pink (#FF00FF) color only. "
            "NO borders, NO outlines, NO frames, NO shadows, NO gradients. "
            "Subject has natural colors, floating directly on pure magenta background."
        )
        final_prompt = f"{prompt}. {bg_instruction}"
    else:
        final_prompt = prompt

    model_ids = {
        "nb2": "gemini-3.1-flash-image-preview",
        "flash": "gemini-2.5-flash-image",
        "pro": "gemini-3-pro-image-preview",
    }
    model_id = model_ids.get(model_type, model_ids["nb2"])
    timeout_ms = MODEL_TIMEOUT_MS.get(model_type, MODEL_TIMEOUT_MS["nb2"])

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=timeout_ms,
        ),
    )

    print(f"モデル: {model_id}")
    print(f"プロンプト: {final_prompt[:100]}...")
    if magenta_bg:
        print("オプション: マゼンタ背景")
    if reference_image:
        print("オプション: 参照画像あり")
    print("生成中...")

    contents = [final_prompt]
    if reference_image:
        ref_img = load_reference_image(reference_image)
        contents.append(ref_img)

    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio=aspect_ratio,
        ),
    )

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    last_error = None
    for attempt in range(MAX_RETRIES):
        if attempt > 0:
            delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
            print(f"リトライ {attempt}/{MAX_RETRIES - 1} ({delay}秒待機)...")
            time.sleep(delay)

        try:
            response = client.models.generate_content(
                model=model_id,
                contents=contents,
                config=config,
            )

            saved = _extract_image(response, output_file)
            if saved:
                print(f"保存完了: {output_file.absolute()}")
                return saved

            if hasattr(response, 'text') and response.text:
                print(f"レスポンス: {response.text}")
            print("警告: 画像が生成されませんでした")
            return ""

        except Exception as e:
            last_error = e
            status = _get_status_code(e)
            if status in RETRYABLE_CODES and attempt < MAX_RETRIES - 1:
                print(f"サーバー一時障害 ({status}): {type(e).__name__}")
                continue
            if status in FALLBACK_CODES:
                print(f"サーバー容量超過 ({status}): {type(e).__name__}")
            break

    # フォールバックチェーン: Pro→NB2→Flash, NB2→Flash
    if last_error is not None and not no_fallback:
        status = _get_status_code(last_error)
        if status in FALLBACK_CODES:
            fallback_chain = {
                "pro": ["nb2", "flash"],
                "nb2": ["flash"],
            }
            chain = fallback_chain.get(model_type, [])
            for fb_key in chain:
                fb_id = model_ids[fb_key]
                fb_timeout = MODEL_TIMEOUT_MS.get(fb_key, MODEL_TIMEOUT_MS["flash"])
                print(f"\n{model_id} が応答しません。{fb_id} にフォールバック...")
                fb_client = genai.Client(
                    api_key=api_key,
                    http_options=types.HttpOptions(timeout=fb_timeout),
                )
                try:
                    response = fb_client.models.generate_content(
                        model=fb_id,
                        contents=contents,
                        config=config,
                    )
                    saved = _extract_image(response, output_file)
                    if saved:
                        print(f"保存完了 ({fb_key}): {output_file.absolute()}")
                        return saved
                except Exception as fb_err:
                    last_error = fb_err
                    status = _get_status_code(fb_err)
                    if status not in FALLBACK_CODES:
                        print(f"フォールバック失敗: {type(fb_err).__name__}: {str(fb_err)[:200]}")
                        break
                    print(f"フォールバック失敗 ({status}): {type(fb_err).__name__}")
                    continue

    if last_error:
        print(f"エラー: {type(last_error).__name__}: {str(last_error)[:200]}")
    print("警告: 画像が生成されませんでした")
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="Gemini画像生成（Nano Banana 2）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with google-genai --with pillow generate.py "かわいい猫のイラスト"
  uv run --with google-genai --with pillow generate.py "夕焼けの風景" -a 16:9 -o sunset.png
  uv run --with google-genai --with pillow generate.py "アイコン" --magenta-bg -o icon.png
        """
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument("-o", "--output", default="generated_image.png", help="出力ファイルパス")
    parser.add_argument("-a", "--aspect-ratio", default="1:1", choices=["1:1", "16:9", "9:16", "4:3", "3:4", "1:4", "4:1"], help="アスペクト比")
    parser.add_argument("-m", "--model", default="nb2", choices=["flash", "nb2", "pro"], help="モデル: nb2=Nano Banana 2(推奨), flash=Nano Banana(高速), pro=Nano Banana Pro(最高品質)")
    parser.add_argument("--magenta-bg", action="store_true", help="マゼンタ背景で生成")
    parser.add_argument("-r", "--reference", default=None, help="参照画像のパス")
    parser.add_argument("--no-fallback", action="store_true", help="Proモデル失敗時にFlashへのフォールバックを無効化")

    args = parser.parse_args()

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        aspect_ratio=args.aspect_ratio,
        model_type=args.model,
        magenta_bg=args.magenta_bg,
        reference_image=args.reference,
        no_fallback=args.no_fallback,
    )


if __name__ == "__main__":
    main()
