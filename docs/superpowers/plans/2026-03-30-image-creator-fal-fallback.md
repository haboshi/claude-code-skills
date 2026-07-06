# image-creator fal.ai フォールバック 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** image-creator に fal.ai プロバイダーを追加し、Gemini Pro/NB2 障害時のフォールバック先として機能させる

**Architecture:** generate_zhipu.py と同パターンで generate_fal.py を新規作成（requests ベースの REST API 呼び出し + SSRF 保護 + アトミック書き込み）。generate.py のフォールバックチェーンに "fal" を挿入し、subprocess で generate_fal.py を呼び出す。

**Tech Stack:** Python 3, requests, uv run

**Spec:** `docs/superpowers/specs/2026-03-30-image-creator-fal-fallback-design.md`

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `image-creator/scripts/generate_fal.py` | 新規作成 | fal.ai REST API 呼び出し、SSRF 保護、アトミック書き込み |
| `image-creator/scripts/test_generate_fal.py` | 新規作成 | generate_fal.py のユニットテスト |
| `image-creator/scripts/generate.py` | 変更 | フォールバックチェーンに fal.ai 追加 |
| `image-creator/skills/image-creator/SKILL.md` | 変更 | プロバイダー表・フォールバック説明更新 |

---

### Task 1: generate_fal.py — SSRF 保護 + URL 検証

**Files:**
- Create: `image-creator/scripts/generate_fal.py`
- Create: `image-creator/scripts/test_generate_fal.py`

- [ ] **Step 1: テストファイルのスケルトンと SSRF テストを書く**

```python
#!/usr/bin/env python3
"""generate_fal.py のテスト"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from generate_fal import _is_dangerous_ip, _validate_url


class TestSSRFProtection(unittest.TestCase):
    """SSRF保護: URL検証"""

    def test_reject_http(self):
        self.assertFalse(_validate_url("http://example.com/image.png"))

    def test_accept_https(self):
        self.assertTrue(_validate_url("https://example.com/image.png"))

    def test_reject_empty(self):
        self.assertFalse(_validate_url(""))
        self.assertFalse(_validate_url(None))

    def test_reject_localhost(self):
        self.assertFalse(_validate_url("https://localhost/image.png"))

    def test_reject_private_ip_127(self):
        self.assertFalse(_validate_url("https://127.0.0.1/image.png"))

    def test_reject_private_ip_10(self):
        self.assertFalse(_validate_url("https://10.0.0.1/image.png"))

    def test_reject_private_ip_172(self):
        self.assertFalse(_validate_url("https://172.16.0.1/image.png"))

    def test_reject_private_ip_192(self):
        self.assertFalse(_validate_url("https://192.168.1.1/image.png"))

    def test_reject_shared_address_space(self):
        self.assertFalse(_validate_url("https://100.64.0.1/image.png"))

    def test_reject_octal_ip(self):
        self.assertFalse(_validate_url("https://0177.0.0.1/image.png"))

    def test_reject_decimal_ip(self):
        self.assertFalse(_validate_url("https://2130706433/image.png"))

    def test_reject_ipv4_mapped_ipv6(self):
        import ipaddress
        addr = ipaddress.ip_address("::ffff:127.0.0.1")
        self.assertTrue(_is_dangerous_ip(addr))

    def test_accept_public_cdn(self):
        self.assertTrue(_validate_url("https://fal.media/files/image.png"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: テスト実行 — FAIL を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py 2>&1 | head -20`
Expected: ModuleNotFoundError（generate_fal が存在しない）

- [ ] **Step 3: generate_fal.py の SSRF 保護部分を実装**

```python
#!/usr/bin/env python3
"""
fal.ai GPT Image 1.5 画像生成スクリプト

fal.ai の GPT Image 1.5 モデルを使用して画像を生成します。
Gemini Pro/NB2 障害時のフォールバック先として利用。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with requests scripts/generate_fal.py "プロンプト"
"""

import argparse
import ipaddress
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

API_ENDPOINT = "https://queue.fal.run/fal-ai/gpt-image-1.5"

VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"]

MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024  # 20MB
_MAX_REDIRECTS = 5

_OCTAL_IP_PATTERN = re.compile(r"^0\d+\.")
_DECIMAL_IP_PATTERN = re.compile(r"^\d{4,}$")
_SHARED_ADDRESS_SPACE = ipaddress.IPv4Network("100.64.0.0/10")


def _is_dangerous_ip(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """IPアドレスがプライベート/ループバック/リンクローカル/予約済みかチェック"""
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            if _is_dangerous_ip(addr.ipv4_mapped):
                return True
        if addr.sixtofour:
            if _is_dangerous_ip(addr.sixtofour):
                return True
        if addr.teredo:
            for teredo_addr in addr.teredo:
                if _is_dangerous_ip(teredo_addr):
                    return True
    if isinstance(addr, ipaddress.IPv4Address) and addr in _SHARED_ADDRESS_SPACE:
        return True
    return (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_reserved or addr.is_multicast or addr.is_unspecified
    )


def _validate_url(url: str) -> bool:
    """URLの安全性を検証する（SSRF保護）"""
    if not url or not url.startswith("https://"):
        return False
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
    except Exception:
        return False
    if not hostname:
        return False
    if hostname == "localhost":
        return False
    if _OCTAL_IP_PATTERN.match(hostname) or _DECIMAL_IP_PATTERN.match(hostname):
        return False
    try:
        addr = ipaddress.ip_address(hostname)
        if _is_dangerous_ip(addr):
            return False
    except ValueError:
        pass
    return True
```

- [ ] **Step 4: テスト実行 — PASS を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py -v 2>&1`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
cd /Users/haboshi/Projects/claude-code-skills
git add image-creator/scripts/generate_fal.py image-creator/scripts/test_generate_fal.py
git commit -m "feat(image-creator): generate_fal.py SSRF保護の実装とテスト"
```

---

### Task 2: generate_fal.py — 安全ダウンロード

**Files:**
- Modify: `image-creator/scripts/generate_fal.py`
- Modify: `image-creator/scripts/test_generate_fal.py`

- [ ] **Step 1: ダウンロードのテストを追加**

test_generate_fal.py に以下のクラスを追加:

```python
import tempfile
from unittest.mock import MagicMock, patch


class TestSafeDownload(unittest.TestCase):
    """安全なダウンロード: リダイレクト追跡・サイズ制限・アトミック書き込み"""

    @patch("generate_fal.requests.get")
    def test_download_success(self, mock_get):
        """正常ダウンロード: 画像データが保存される"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_redirect = False
        mock_resp.headers = {"content-length": "1000"}
        mock_resp.iter_content.return_value = [b"x" * 1000]
        mock_get.return_value = mock_resp

        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test.png"
            from generate_fal import _safe_download
            _safe_download("https://fal.media/files/test.png", dest)
            self.assertTrue(dest.exists())
            self.assertEqual(dest.read_bytes(), b"x" * 1000)

    @patch("generate_fal.requests.get")
    def test_download_rejects_oversized(self, mock_get):
        """サイズ上限超過: ValueError"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_redirect = False
        mock_resp.headers = {"content-length": str(30 * 1024 * 1024)}
        mock_get.return_value = mock_resp

        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test.png"
            from generate_fal import _safe_download
            with self.assertRaises(ValueError):
                _safe_download("https://fal.media/files/big.png", dest)

    def test_download_rejects_unsafe_url(self):
        """安全でないURL: ValueError"""
        from generate_fal import _safe_download
        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test.png"
            with self.assertRaises(ValueError):
                _safe_download("https://127.0.0.1/image.png", dest)

    @patch("generate_fal.requests.get")
    def test_download_follows_redirect(self, mock_get):
        """リダイレクト追跡: 安全なリダイレクト先をフォロー"""
        redirect_resp = MagicMock()
        redirect_resp.status_code = 302
        redirect_resp.is_redirect = True
        redirect_resp.headers = {"location": "https://cdn.fal.media/final.png"}
        redirect_resp.close = MagicMock()

        final_resp = MagicMock()
        final_resp.status_code = 200
        final_resp.is_redirect = False
        final_resp.headers = {"content-length": "500"}
        final_resp.iter_content.return_value = [b"y" * 500]

        mock_get.side_effect = [redirect_resp, final_resp]

        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test.png"
            from generate_fal import _safe_download
            _safe_download("https://fal.media/files/test.png", dest)
            self.assertTrue(dest.exists())

    @patch("generate_fal.requests.get")
    def test_download_rejects_unsafe_redirect(self, mock_get):
        """リダイレクト先が安全でない場合: ValueError"""
        redirect_resp = MagicMock()
        redirect_resp.status_code = 302
        redirect_resp.is_redirect = True
        redirect_resp.headers = {"location": "https://127.0.0.1/evil.png"}
        redirect_resp.close = MagicMock()

        mock_get.return_value = redirect_resp

        with tempfile.TemporaryDirectory() as tmpdir:
            dest = Path(tmpdir) / "test.png"
            from generate_fal import _safe_download
            with self.assertRaises(ValueError):
                _safe_download("https://fal.media/files/test.png", dest)
```

- [ ] **Step 2: テスト実行 — FAIL を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py -v 2>&1 | tail -10`
Expected: `_safe_download` が存在しないため FAIL

- [ ] **Step 3: _safe_download を実装**

generate_fal.py に以下を追加（`_validate_url` の後）:

```python
def _safe_download(url: str, dest: Path) -> None:
    """URLから安全に画像をダウンロードする（SSRF保護+アトミック書き込み）"""
    if not _validate_url(url):
        raise ValueError(f"安全でないURLです（HTTPSのみ・プライベートIP禁止）: {url}")

    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

    current_url = url
    resp = None
    for _ in range(_MAX_REDIRECTS):
        resp = requests.get(
            current_url, headers=headers, timeout=60,
            stream=True, allow_redirects=False,
        )
        if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
            resp.close()
            raw_location = resp.headers.get("location", "")
            redirect_url = urljoin(current_url, raw_location)
            if not _validate_url(redirect_url):
                raise ValueError(f"リダイレクト先が安全でないURLです: {redirect_url}")
            current_url = redirect_url
            continue
        break
    else:
        raise ValueError(f"リダイレクト回数が上限({_MAX_REDIRECTS})を超えました")

    resp.raise_for_status()

    content_length = resp.headers.get("content-length")
    try:
        content_length_int = int(content_length) if content_length else 0
    except (ValueError, TypeError):
        content_length_int = 0
    if content_length_int > MAX_DOWNLOAD_SIZE:
        raise ValueError(f"ファイルサイズが上限を超えています: {content_length} bytes")

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dest.parent, suffix=dest.suffix)
    try:
        downloaded = 0
        with os.fdopen(tmp_fd, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_SIZE:
                    raise ValueError(f"ダウンロードが上限を超えました: {MAX_DOWNLOAD_SIZE} bytes")
                f.write(chunk)
        Path(tmp_path).rename(dest)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise
```

- [ ] **Step 4: テスト実行 — PASS を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py -v 2>&1`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
cd /Users/haboshi/Projects/claude-code-skills
git add image-creator/scripts/generate_fal.py image-creator/scripts/test_generate_fal.py
git commit -m "feat(image-creator): generate_fal.py 安全ダウンロード実装"
```

---

### Task 3: generate_fal.py — API 呼び出し + CLI

**Files:**
- Modify: `image-creator/scripts/generate_fal.py`
- Modify: `image-creator/scripts/test_generate_fal.py`

- [ ] **Step 1: API 呼び出し・CLI のテストを追加**

test_generate_fal.py に以下のクラスを追加:

```python
class TestAPIKeyValidation(unittest.TestCase):
    """APIキー未設定時の振る舞い"""

    def test_missing_api_key_exits(self):
        env = os.environ.copy()
        env.pop("FAL_AI_API_KEY", None)
        env.pop("FAL_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                from generate_fal import generate_image
                generate_image("テスト")
            self.assertEqual(ctx.exception.code, 1)

    def test_missing_api_key_message(self):
        env = os.environ.copy()
        env.pop("FAL_AI_API_KEY", None)
        env.pop("FAL_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with patch("builtins.print") as mock_print:
                with self.assertRaises(SystemExit):
                    from generate_fal import generate_image
                    generate_image("テスト")
                output = " ".join(str(c) for c in mock_print.call_args_list)
                self.assertIn("FAL_AI_API_KEY", output)


class TestGenerateImage(unittest.TestCase):
    """画像生成のAPI呼び出し"""

    @patch("generate_fal._safe_download")
    @patch("generate_fal.requests.post")
    def test_success_with_url_response(self, mock_post, mock_download):
        """正常系: URL レスポンスから画像をダウンロード"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "images": [{"url": "https://fal.media/files/output.png"}]
        }
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"FAL_AI_API_KEY": "test-key"}):
            with tempfile.TemporaryDirectory() as tmpdir:
                output = Path(tmpdir) / "result.png"
                from generate_fal import generate_image
                result = generate_image("猫", output_path=str(output))
                self.assertEqual(result, str(output.absolute()))
                mock_download.assert_called_once()

    @patch("generate_fal.requests.post")
    def test_api_error_returns_empty(self, mock_post):
        """APIエラー時: 空文字列を返す"""
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.json.return_value = {"detail": "Internal error"}
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"FAL_AI_API_KEY": "test-key"}):
            with tempfile.TemporaryDirectory() as tmpdir:
                from generate_fal import generate_image
                result = generate_image("猫", output_path=f"{tmpdir}/out.png")
                self.assertEqual(result, "")

    @patch("generate_fal.requests.post")
    def test_empty_images_returns_empty(self, mock_post):
        """画像なしレスポンス: 空文字列を返す"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"images": []}
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"FAL_AI_API_KEY": "test-key"}):
            with tempfile.TemporaryDirectory() as tmpdir:
                from generate_fal import generate_image
                result = generate_image("猫", output_path=f"{tmpdir}/out.png")
                self.assertEqual(result, "")

    @patch("generate_fal._safe_download")
    @patch("generate_fal.requests.post")
    def test_size_passed_to_api(self, mock_post, mock_download):
        """サイズパラメータがAPIに渡される"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "images": [{"url": "https://fal.media/files/out.png"}]
        }
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"FAL_AI_API_KEY": "test-key"}):
            with tempfile.TemporaryDirectory() as tmpdir:
                from generate_fal import generate_image
                generate_image("猫", output_path=f"{tmpdir}/out.png", size="1024x1024")
                payload = mock_post.call_args[1]["json"]
                self.assertEqual(payload["image_size"], "1024x1024")

    @patch("generate_fal._safe_download")
    @patch("generate_fal.requests.post")
    def test_fal_key_fallback(self, mock_post, mock_download):
        """FAL_AI_API_KEY 未設定時に FAL_KEY にフォールバック"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "images": [{"url": "https://fal.media/files/out.png"}]
        }
        mock_post.return_value = mock_resp

        env = os.environ.copy()
        env.pop("FAL_AI_API_KEY", None)
        env["FAL_KEY"] = "fallback-key"
        with patch.dict(os.environ, env, clear=True):
            with tempfile.TemporaryDirectory() as tmpdir:
                from generate_fal import generate_image
                generate_image("猫", output_path=f"{tmpdir}/out.png")
                headers = mock_post.call_args[1]["headers"]
                self.assertEqual(headers["Authorization"], "Key fallback-key")


class TestSizeValidation(unittest.TestCase):
    """サイズバリデーション"""

    def test_valid_sizes(self):
        from generate_fal import VALID_SIZES
        self.assertIn("1024x1024", VALID_SIZES)
        self.assertIn("1536x1024", VALID_SIZES)
        self.assertIn("1024x1536", VALID_SIZES)
```

- [ ] **Step 2: テスト実行 — FAIL を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py -v 2>&1 | tail -15`
Expected: `generate_image` が存在しないため FAIL

- [ ] **Step 3: generate_image 関数と CLI を実装**

generate_fal.py に以下を追加:

```python
def _print_setup_instructions():
    """APIキーのセットアップ手順を表示"""
    print("=" * 60)
    print("エラー: 環境変数 FAL_AI_API_KEY が設定されていません")
    print("=" * 60)
    print()
    print("fal.ai を使用するには API キーが必要です。")
    print()
    print("■ APIキーの取得方法:")
    print("  1. https://fal.ai/dashboard/keys にアクセス")
    print("  2. アカウントを作成 / ログイン")
    print("  3. API Keys ページでキーを発行")
    print()
    print("■ 環境変数の設定:")
    print()
    print("  # 一時的に設定（現在のターミナルのみ）")
    print('  export FAL_AI_API_KEY="your-api-key-here"')
    print()
    print("  # 永続的に設定（~/.zshrc.local に追記）")
    print('  echo \'export FAL_AI_API_KEY="your-api-key-here"\' >> ~/.zshrc.local')
    print()
    print("  ※ FAL_KEY でも動作します（FAL_AI_API_KEY を優先）")
    print("=" * 60)


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1536x1024",
    quality: str = "low",
) -> str:
    """fal.ai GPT Image 1.5 APIを使用して画像を生成

    Args:
        prompt: 画像生成プロンプト
        output_path: 出力ファイルパス
        size: 画像サイズ（1024x1024, 1536x1024, 1024x1536）
        quality: 品質（low, medium, high）

    Returns:
        保存先の絶対パス。生成失敗時は空文字列。
    """
    api_key = os.environ.get("FAL_AI_API_KEY") or os.environ.get("FAL_KEY")
    if not api_key:
        _print_setup_instructions()
        sys.exit(1)

    if size not in VALID_SIZES:
        print(f"警告: 無効なサイズ '{size}'。1536x1024 を使用します。")
        size = "1536x1024"

    print(f"モデル: fal-ai/gpt-image-1.5")
    print(f"プロンプト: {prompt[:100]}...")
    print(f"サイズ: {size}, 品質: {quality}")
    print("生成中...")

    headers = {
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "prompt": prompt,
        "image_size": size,
        "quality": quality,
    }

    try:
        response = requests.post(
            API_ENDPOINT, json=payload, headers=headers, timeout=120,
        )
    except requests.RequestException as e:
        print(f"APIリクエストエラー: {type(e).__name__}: {str(e)[:200]}")
        return ""

    if response.status_code != 200:
        try:
            detail = response.json().get("detail", response.text[:200])
        except Exception:
            detail = response.text[:200]
        print(f"APIエラー ({response.status_code}): {detail}")
        return ""

    data = response.json()
    images = data.get("images", [])
    if not images:
        print("警告: 画像が生成されませんでした")
        return ""

    image_url = images[0].get("url", "")
    if not image_url:
        print("警告: 画像URLが取得できませんでした")
        return ""

    output_file = Path(output_path)
    try:
        _safe_download(image_url, output_file)
    except (ValueError, requests.RequestException) as e:
        print(f"ダウンロードエラー: {e}")
        return ""

    print(f"保存完了: {output_file.absolute()}")
    return str(output_file.absolute())


def main():
    parser = argparse.ArgumentParser(
        description="fal.ai GPT Image 1.5 画像生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with requests generate_fal.py "かわいい猫のイラスト"
  uv run --with requests generate_fal.py "夕焼けの風景" -s 1536x1024 -o sunset.png
  uv run --with requests generate_fal.py "アイコン" -q high -o icon.png

サイズ:
  1024x1024 (正方形)、1536x1024 (横長)、1024x1536 (縦長)

品質:
  low     高速、参考画像向け
  medium  バランス型
  high    最高品質、日本語テキスト向け
        """,
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument(
        "-o", "--output", default="generated_image.png", help="出力ファイルパス"
    )
    parser.add_argument(
        "-s", "--size", default="1536x1024",
        choices=VALID_SIZES, help="画像サイズ",
    )
    parser.add_argument(
        "-q", "--quality", default="low",
        choices=["low", "medium", "high"],
        help="品質（low=高速, medium=バランス, high=最高品質）",
    )

    args = parser.parse_args()

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        size=args.size,
        quality=args.quality,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: テスト実行 — PASS を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py -v 2>&1`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
cd /Users/haboshi/Projects/claude-code-skills
git add image-creator/scripts/generate_fal.py image-creator/scripts/test_generate_fal.py
git commit -m "feat(image-creator): generate_fal.py API呼び出し・CLI実装"
```

---

### Task 4: generate.py — フォールバックチェーン拡張

**Files:**
- Modify: `image-creator/scripts/generate.py:197-231`

- [ ] **Step 1: generate.py のフォールバックチェーンを変更**

`image-creator/scripts/generate.py` の行197-231のフォールバック部分を以下に変更:

```python
    # フォールバックチェーン: Pro→NB2→fal→Flash, NB2→fal→Flash
    if last_error is not None and not no_fallback:
        status = _get_status_code(last_error)
        if status in FALLBACK_CODES:
            fallback_chain = {
                "pro": ["nb2", "fal", "flash"],
                "nb2": ["fal", "flash"],
            }
            chain = fallback_chain.get(model_type, [])
            for fb_key in chain:
                # fal.ai フォールバック: subprocess で generate_fal.py を呼び出す
                if fb_key == "fal":
                    fal_api_key = os.environ.get("FAL_AI_API_KEY") or os.environ.get("FAL_KEY")
                    if not fal_api_key:
                        print("\nFAL_AI_API_KEY 未設定。fal.ai をスキップ...")
                        continue
                    import subprocess
                    aspect_to_fal_size = {
                        "1:1":  "1024x1024",
                        "16:9": "1536x1024",
                        "9:16": "1024x1536",
                        "4:3":  "1536x1024",
                        "3:4":  "1024x1536",
                        "1:4":  "1024x1536",
                        "4:1":  "1536x1024",
                    }
                    fal_size = aspect_to_fal_size.get(aspect_ratio, "1536x1024")
                    script_dir = Path(__file__).parent
                    print(f"\n{model_id} が応答しません。fal.ai にフォールバック...")
                    try:
                        result = subprocess.run(
                            [sys.executable, str(script_dir / "generate_fal.py"),
                             prompt, "-o", str(output_file), "-s", fal_size, "-q", "low"],
                            capture_output=True, text=True, timeout=120,
                        )
                        if result.returncode == 0 and output_file.exists():
                            print(f"保存完了 (fal.ai): {output_file.absolute()}")
                            return str(output_file.absolute())
                        if result.stderr:
                            print(f"fal.ai エラー: {result.stderr[:200]}")
                    except subprocess.TimeoutExpired:
                        print("fal.ai タイムアウト（120秒）")
                    except Exception as fal_err:
                        print(f"fal.ai 呼び出しエラー: {type(fal_err).__name__}")
                    continue

                # Gemini モデル間フォールバック（既存ロジック）
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
```

注意: `import subprocess` は関数内で遅延インポート。`prompt` はフォールバック時に `final_prompt` ではなく元の `prompt` 引数を使用（fal.ai は背景指示が不要なため）。

ただし、fal.ai にも背景指示を含めたい場合は `final_prompt` を使用する。ここでは `prompt`（元のプロンプト）を使用する — fal.ai は Gemini と異なるモデルなので、Gemini 固有の背景ハックは不要。

**修正**: subprocess に渡すプロンプトは `final_prompt` ではなく元の `prompt` を使うが、generate_image 関数のスコープでは引数名が `prompt` なので、fal.ai に渡す値を明確にする必要がある。フォールバック部分では `prompt` 引数（L88）がそのまま使えるが、背景指示が付加された `final_prompt`（L112-121）もスコープ内にある。fal.ai には元のプロンプトを渡すため `prompt` を使用。

- [ ] **Step 2: 手動テスト（APIキー未設定時のスキップ動作確認）**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && FAL_AI_API_KEY="" FAL_KEY="" uv run --with google-genai --with pillow scripts/generate.py "test" --no-fallback 2>&1 | head -5`
Expected: `--no-fallback` なので fal.ai フォールバックは発動しない（正常動作確認）

- [ ] **Step 3: コミット**

```bash
cd /Users/haboshi/Projects/claude-code-skills
git add image-creator/scripts/generate.py
git commit -m "feat(image-creator): フォールバックチェーンにfal.ai追加 (Pro→NB2→fal→Flash)"
```

---

### Task 5: SKILL.md 更新

**Files:**
- Modify: `image-creator/skills/image-creator/SKILL.md`

- [ ] **Step 1: SKILL.md のプロバイダー表にfal.aiを追加**

プロバイダー別の特徴テーブルに以下の行を追加:

```markdown
| **fal.ai** | Geminiフォールバック、GPT Image 1.5 | `FAL_AI_API_KEY` |
```

フォールバック動作の説明セクションを追加/更新:

```markdown
### フォールバック動作

Gemini Pro/NB2 が応答しない場合（HTTP 503/504/429/408）、自動的に以下の順でフォールバックします:

- Pro → NB2 → fal.ai → Flash
- NB2 → fal.ai → Flash

`--no-fallback` オプションで無効化可能。fal.ai フォールバックには `FAL_AI_API_KEY` 環境変数が必要です（未設定時はスキップ）。
```

推奨設定テーブルに追加:

```markdown
| Gemini障害時 | fal.ai | gpt-image-1.5 | 不要 |
```

- [ ] **Step 2: SKILL.md の変更を確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills && head -200 image-creator/skills/image-creator/SKILL.md`
Expected: プロバイダー表に fal.ai が含まれること

- [ ] **Step 3: コミット**

```bash
cd /Users/haboshi/Projects/claude-code-skills
git add image-creator/skills/image-creator/SKILL.md
git commit -m "docs(image-creator): SKILL.mdにfal.aiフォールバック説明追加"
```

---

### Task 6: 全体テスト実行 + 最終確認

**Files:** なし（検証のみ）

- [ ] **Step 1: generate_fal.py の全テスト実行**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run scripts/test_generate_fal.py -v 2>&1`
Expected: 全テスト PASS

- [ ] **Step 2: 既存テストが壊れていないことを確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run --with google-genai --with pillow --with requests scripts/test_url_safety.py -v 2>&1 | tail -5`
Expected: 全テスト PASS

- [ ] **Step 3: generate_fal.py の CLI ヘルプ確認**

Run: `cd /Users/haboshi/Projects/claude-code-skills/image-creator && uv run --with requests scripts/generate_fal.py --help 2>&1`
Expected: ヘルプメッセージが表示され、サイズ・品質の選択肢が正しい
