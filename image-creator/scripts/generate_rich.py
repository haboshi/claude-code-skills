#!/usr/bin/env python3
"""
パターン/モード対応リッチ画像生成スクリプト

9つのテンプレートモードを使い、Gemini APIでリッチ画像を生成する。
既存の generate.py を拡張し、サムネイルや説明画像のテンプレートシステムを提供。

Copyright (c) 2026 haboshi
Licensed under the MIT License.

Usage:
    uv run --with google-genai --with pillow --with requests \
      scripts/generate_rich.py \
      --output <path> \
      --prompt "入力テキストまたはJSON" \
      [--pattern thumbnail|illustration] \
      [--mode anime-wow|anime-impact|anime-pop|anime-bright|formal-default|real-default|comparison|graphrec|custom] \
      [--aspect 16:9|1:1|9:16|4:3|3:4|21:9] \
      [--model pro|flash] \
      [--ref-image <path>] \
      [--ref-search <query>] \
      [--ref-instruction <text>]
"""

import argparse
import ipaddress
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

# テンプレートエンジンを同ディレクトリからインポート
sys.path.insert(0, str(Path(__file__).parent))
from template_engine import build_prompt, parse_user_input


CONFIG_FILE = Path(__file__).parent.parent / "config" / "rich_patterns.json"

# パターン→モードの対応表
PATTERN_MODES = {
    "thumbnail": [
        "anime-wow", "anime-impact", "anime-pop", "anime-bright",
        "formal-default", "real-default"
    ],
    "illustration": [
        "comparison", "graphrec", "process", "custom"
    ],
}

VALID_ASPECTS = ["16:9", "1:1", "9:16", "4:3", "3:4", "21:9"]


def load_config() -> dict:
    """設定ファイルを読み込む"""
    if not CONFIG_FILE.exists():
        print(f"エラー: 設定ファイルが見つかりません: {CONFIG_FILE}")
        sys.exit(1)

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_pattern_mode(config: dict, pattern: str | None, mode: str | None) -> tuple[str, str]:
    """
    パターンとモードを解決する。

    - pattern未指定 + mode指定 → modeからpatternを推定
    - pattern指定 + mode未指定 → patternのデフォルトmodeを使用
    - 両方未指定 → デフォルト設定を使用
    """
    defaults = config.get("defaults", {})

    if mode and not pattern:
        for pat, modes in PATTERN_MODES.items():
            if mode in modes:
                pattern = pat
                break
        if not pattern:
            print(f"エラー: 不明なモード: {mode}")
            print(f"有効なモード: {', '.join(m for modes in PATTERN_MODES.values() for m in modes)}")
            sys.exit(1)

    if not pattern:
        pattern = defaults.get("pattern", "thumbnail")

    if not mode:
        # mode_by_pattern から取得（なければフォールバック）
        mode_by_pattern = defaults.get("mode_by_pattern", {})
        mode = mode_by_pattern.get(pattern)
        if not mode:
            mode = defaults.get("mode", "anime-wow")

    # バリデーション
    valid_modes = PATTERN_MODES.get(pattern, [])
    if mode not in valid_modes:
        print(f"エラー: パターン '{pattern}' にモード '{mode}' は存在しません")
        print(f"有効なモード: {', '.join(valid_modes)}")
        sys.exit(1)

    return pattern, mode


def get_template(config: dict, pattern: str, mode: str) -> tuple[str, str]:
    """テンプレートとデフォルトアスペクト比を取得する"""
    patterns = config.get("patterns", {})
    pat_config = patterns.get(pattern, {})
    modes = pat_config.get("modes", {})
    mode_config = modes.get(mode, {})

    template = mode_config.get("template", "")
    default_aspect = mode_config.get("default_aspect", "16:9")

    if not template:
        print(f"エラー: テンプレートが見つかりません: {pattern}/{mode}")
        sys.exit(1)

    return template, default_aspect


MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024  # 20MB

# SSRF保護: 8進数/10進数IPアドレス表記のバイパス検出パターン
_OCTAL_IP_PATTERN = re.compile(r"^0\d+\.")  # 0177.x.x.x 等
_DECIMAL_IP_PATTERN = re.compile(r"^\d{4,}$")  # 2130706433 等


def validate_url(url: str | None) -> bool:
    """
    URLがSSRF攻撃に使われないか検証する。

    - HTTPSのみ許可
    - Python ipaddress モジュールで包括的にプライベート/予約済みIPをブロック
    - IPv4マップドIPv6、8進数表記、10進数表記のバイパスも検出
    """
    if not url:
        return False

    if not url.startswith("https://"):
        return False

    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
    except Exception:
        return False

    if not hostname:
        return False

    # localhost 拒否
    if hostname == "localhost":
        return False

    # 8進数/10進数表記のIPアドレスバイパス検出
    if _OCTAL_IP_PATTERN.match(hostname) or _DECIMAL_IP_PATTERN.match(hostname):
        return False

    # IPアドレス形式のホスト名のみ検証
    # ドメイン名の場合はDNS解決しない（TOCTOU/DNS Rebinding回避）
    # ドメイン名経由のSSRF保護はネットワークレベル（egress filter等）で対応すべき
    try:
        addr = ipaddress.ip_address(hostname)
        if _is_dangerous_ip(addr):
            return False
    except ValueError:
        # IPアドレスでない場合（ドメイン名）はスキーム・localhost検証のみで通過
        pass

    return True


# RFC 6598 共有アドレス空間 (100.64.0.0/10) — is_private に含まれない場合に備え明示的に定義
_SHARED_ADDRESS_SPACE = ipaddress.IPv4Network("100.64.0.0/10")


def _is_dangerous_ip(addr) -> bool:
    """IPアドレスが危険（プライベート/ループバック/リンクローカル/予約済み）かを判定する。"""

    # IPv4マップドIPv6 の場合、内包する IPv4 アドレスも検証
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            if _is_dangerous_ip(addr.ipv4_mapped):
                return True
        # 6to4, Teredo 等のトンネリングアドレス
        if addr.sixtofour:
            if _is_dangerous_ip(addr.sixtofour):
                return True
        if addr.teredo:
            for teredo_addr in addr.teredo:
                if _is_dangerous_ip(teredo_addr):
                    return True

    # RFC 6598 共有アドレス空間
    if isinstance(addr, ipaddress.IPv4Address) and addr in _SHARED_ADDRESS_SPACE:
        return True

    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def search_reference_image(query: str) -> str | None:
    """
    SerpAPI で参照画像を検索する（任意機能）。

    環境変数 SERPAPI_KEY が設定されている場合のみ動作。
    """
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        print("警告: SERPAPI_KEY 未設定のため参照画像検索をスキップ")
        return None

    try:
        import requests

        params = {
            "q": query,
            "tbm": "isch",
            "api_key": api_key,
            "num": 1,
        }
        response = requests.get(
            "https://serpapi.com/search.json",
            params=params,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()

        images = data.get("images_results", [])
        if images:
            url = images[0].get("original")
            if url and validate_url(url):
                print(f"参照画像: {url}")
                return url
    except Exception as e:
        print(f"警告: 参照画像検索失敗: {e}")

    return None


_MAX_REDIRECTS = 5


def download_reference_image(url: str, dest: Path) -> Path:
    """URLから参照画像をダウンロードする（SSRF保護 + リダイレクト検証 + サイズ上限: 20MB）"""
    import tempfile

    import requests

    # SSRF保護
    if not validate_url(url):
        raise ValueError(f"安全でないURLです（HTTPSのみ・プライベートIP禁止）: {url}")

    # リダイレクトを手動で追跡し、各リダイレクト先を検証
    current_url = url
    for _ in range(_MAX_REDIRECTS):
        response = requests.get(current_url, timeout=30, stream=True, allow_redirects=False)
        if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
            raw_location = response.headers.get("location", "")
            redirect_url = urljoin(current_url, raw_location)
            if not validate_url(redirect_url):
                raise ValueError(f"リダイレクト先が安全でないURLです: {redirect_url}")
            current_url = redirect_url
            continue
        break
    else:
        raise ValueError(f"リダイレクト回数が上限({_MAX_REDIRECTS})を超えました")

    response.raise_for_status()

    content_length = int(response.headers.get("content-length", 0))
    if content_length > MAX_DOWNLOAD_SIZE:
        raise ValueError(f"参照画像が大きすぎます: {content_length} bytes (上限: {MAX_DOWNLOAD_SIZE})")

    dest.parent.mkdir(parents=True, exist_ok=True)

    # 一時ファイルに書き込み、完了後にリネーム（破損ファイル防止）
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dest.parent, suffix=dest.suffix)
    try:
        downloaded = 0
        with os.fdopen(tmp_fd, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_SIZE:
                    raise ValueError(f"ダウンロードが上限を超えました: {MAX_DOWNLOAD_SIZE} bytes")
                f.write(chunk)
        Path(tmp_path).rename(dest)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise

    print(f"参照画像ダウンロード: {dest}")
    return dest


def generate_image(
    prompt: str,
    output_path: str,
    aspect_ratio: str = "16:9",
    model_type: str = "pro",
    reference_image: str | None = None,
    ref_instruction: str | None = None,
) -> str:
    """Gemini APIを使用してリッチ画像を生成する"""
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("エラー: 環境変数 GEMINI_API_KEY が設定されていません")
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    model_ids = {
        "flash": "gemini-2.5-flash-image",
        "pro": "gemini-3-pro-image-preview",
    }
    model_id = model_ids.get(model_type, model_ids["pro"])

    final_prompt = prompt
    if ref_instruction:
        final_prompt = f"{prompt}\n\nReference image instruction: {ref_instruction}"

    print(f"モデル: {model_id}")
    print(f"アスペクト比: {aspect_ratio}")
    print(f"プロンプト: {final_prompt[:200]}...")
    print("生成中...")

    contents = []
    if reference_image:
        ref_path = Path(reference_image)
        if ref_path.exists():
            from PIL import Image
            ref_img = Image.open(ref_path)
            contents.append(ref_img)
            print(f"参照画像: {ref_path}")

    contents.append(final_prompt)

    response = client.models.generate_content(
        model=model_id,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["image", "text"],
            imageConfig=types.ImageConfig(
                aspectRatio=aspect_ratio,
            ),
        ),
    )

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    for part in response.parts:
        if part.inline_data is not None:
            image = part.as_image()
            image.save(output_file)
            print(f"保存完了: {output_file.absolute()}")
            return str(output_file.absolute())

    if hasattr(response, "text") and response.text:
        print(f"レスポンス: {response.text}")

    print("警告: 画像が生成されませんでした")
    return ""


def get_character_preset(config: dict, preset_name: str | None) -> str | None:
    """キャラクタープリセットを取得する"""
    if not preset_name:
        return None

    presets = config.get("character_presets", {})
    preset = presets.get(preset_name)
    if not preset:
        valid_presets = list(presets.keys())
        print(f"エラー: 不明なキャラクタープリセット: {preset_name}")
        print(f"有効なプリセット: {', '.join(valid_presets)}")
        sys.exit(1)

    return preset.get("prompt", "")


def list_presets():
    """利用可能なキャラクタープリセットを一覧表示する"""
    config = load_config()
    presets = config.get("character_presets", {})

    print("\n利用可能なキャラクタープリセット:\n")
    for name, data in presets.items():
        print(f"  {name}: {data.get('description', '')}")
    print()


def list_modes():
    """利用可能なパターンとモードを一覧表示する"""
    config = load_config()
    patterns = config.get("patterns", {})

    print("\n利用可能なパターン/モード:\n")
    for pat_name, pat_data in patterns.items():
        print(f"  {pat_name}: {pat_data.get('description', '')}")
        modes = pat_data.get("modes", {})
        for mode_name, mode_data in modes.items():
            aspect = mode_data.get("default_aspect", "16:9")
            print(f"    - {mode_name}: {mode_data.get('description', '')} [{aspect}]")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="パターン/モード対応リッチ画像生成（Gemini）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  # anime-wow モードでサムネイル生成
  uv run --with google-genai --with pillow --with requests \\
    scripts/generate_rich.py \\
    --output /tmp/test.png \\
    --prompt '{"title": "Claude Code完全攻略"}' \\
    --pattern thumbnail --mode anime-wow

  # graphrec モードで説明画像
  uv run --with google-genai --with pillow --with requests \\
    scripts/generate_rich.py \\
    --output /tmp/graphrec.png \\
    --prompt '{"content": "AI駆動開発の3つの原則"}' \\
    --pattern illustration --mode graphrec

  # テキスト直接指定（JSONでなくてもOK）
  uv run --with google-genai --with pillow --with requests \\
    scripts/generate_rich.py \\
    --output /tmp/simple.png \\
    --prompt "プログラミング入門ガイド"

  # 利用可能なモード一覧
  uv run --with google-genai --with pillow --with requests \\
    scripts/generate_rich.py --list-modes
        """,
    )
    parser.add_argument(
        "--prompt", "-p",
        help="入力テキストまたはJSON（例: '{\"title\": \"タイトル\"}'）",
    )
    parser.add_argument(
        "--output", "-o",
        default="generated_rich.png",
        help="出力ファイルパス（デフォルト: generated_rich.png）",
    )
    parser.add_argument(
        "--pattern",
        choices=["thumbnail", "illustration"],
        help="パターン（thumbnail / illustration）",
    )
    parser.add_argument(
        "--mode",
        choices=[
            "anime-wow", "anime-impact", "anime-pop", "anime-bright",
            "formal-default", "real-default",
            "comparison", "graphrec", "process", "custom",
        ],
        help="モード",
    )
    parser.add_argument(
        "--aspect", "-a",
        choices=VALID_ASPECTS,
        help="アスペクト比（デフォルト: モードに応じて自動設定）",
    )
    parser.add_argument(
        "--model", "-m",
        default="pro",
        choices=["pro", "flash"],
        help="モデル: pro=高品質, flash=高速（デフォルト: pro）",
    )
    parser.add_argument(
        "--ref-image",
        help="参照画像のパス",
    )
    parser.add_argument(
        "--ref-search",
        help="SerpAPIで参照画像を検索するクエリ",
    )
    parser.add_argument(
        "--ref-instruction",
        help="参照画像に対する追加指示",
    )
    parser.add_argument(
        "--list-modes",
        action="store_true",
        help="利用可能なパターン/モードを一覧表示",
    )
    parser.add_argument(
        "--list-presets",
        action="store_true",
        help="利用可能なキャラクタープリセットを一覧表示",
    )
    parser.add_argument(
        "--character-preset", "-c",
        choices=["default", "idol", "vtuber", "business", "tech", "teacher", "mascot", "cool"],
        help="キャラクタープリセット（character未指定時に適用）",
    )

    args = parser.parse_args()

    if args.list_modes:
        list_modes()
        sys.exit(0)

    if args.list_presets:
        list_presets()
        sys.exit(0)

    if not args.prompt:
        parser.error("--prompt は必須です（--list-modes / --list-presets で一覧表示）")

    # 設定読み込み
    config = load_config()

    # パターン/モード解決
    pattern, mode = resolve_pattern_mode(config, args.pattern, args.mode)
    print(f"パターン: {pattern} / モード: {mode}")

    # キャラクタープリセットの解決
    character_prompt = get_character_preset(config, args.character_preset)
    if character_prompt:
        print(f"キャラクタープリセット: {args.character_preset}")

    # テンプレート取得・展開（キャラクタープリセットを注入）
    template, default_aspect = get_template(config, pattern, mode)

    # プロンプトデータにキャラクタープリセットを注入
    user_data = parse_user_input(args.prompt)
    if character_prompt and not user_data.get("character"):
        user_data["character"] = character_prompt

    final_prompt = build_prompt(template, json.dumps(user_data, ensure_ascii=False))

    # アスペクト比
    aspect = args.aspect or default_aspect

    # 参照画像の処理
    ref_image = args.ref_image
    tmp_dir = None
    if args.ref_search and not ref_image:
        ref_url = search_reference_image(args.ref_search)
        if ref_url:
            import tempfile
            tmp_dir = Path(tempfile.mkdtemp())
            ref_image = str(download_reference_image(ref_url, tmp_dir / "ref.png"))

    # 出力パスの拡張子チェック
    output_path = args.output
    if not output_path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        output_path += ".png"

    try:
        # 画像生成
        generate_image(
            prompt=final_prompt,
            output_path=output_path,
            aspect_ratio=aspect,
            model_type=args.model,
            reference_image=ref_image,
            ref_instruction=args.ref_instruction,
        )
    finally:
        # 一時ディレクトリのクリーンアップ
        if tmp_dir and tmp_dir.exists():
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
