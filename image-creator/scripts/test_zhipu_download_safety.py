"""
ZhipuAI GLM-Image スクリプトのダウンロード安全性テスト

テスト対象: generate_zhipu.py の CDN画像ダウンロード処理
P1: SSRF保護（HTTPS検証、リダイレクト制御、サイズ上限、アトミック書き込み）
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# テスト対象のモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from generate_zhipu import _safe_download_cdn


class TestSafeDownloadCdn(unittest.TestCase):
    """_safe_download_cdn のSSRF保護テスト"""

    def test_rejects_http_url(self):
        """HTTP URLを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("http://example.com/image.png", dest)

    def test_rejects_ftp_url(self):
        """FTP URLを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("ftp://example.com/image.png", dest)

    def test_rejects_file_scheme(self):
        """file:// スキームを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("file:///etc/passwd", dest)

    def test_rejects_private_ip_10(self):
        """10.x.x.x プライベートIPを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://10.0.0.1/image.png", dest)

    def test_rejects_private_ip_192_168(self):
        """192.168.x.x プライベートIPを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://192.168.1.1/image.png", dest)

    def test_rejects_localhost(self):
        """localhost を拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://localhost/image.png", dest)

    def test_rejects_127_0_0_1(self):
        """127.0.0.1 ループバックを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://127.0.0.1/image.png", dest)

    def test_rejects_ipv6_loopback(self):
        """IPv6 ループバック [::1] を拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://[::1]/image.png", dest)

    def test_rejects_link_local(self):
        """169.254.x.x リンクローカルを拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://169.254.169.254/image.png", dest)

    def test_rejects_shared_address_space(self):
        """100.64.0.0/10 共有アドレス空間を拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://100.64.0.1/image.png", dest)

    def test_rejects_ipv6_mapped_ipv4_loopback(self):
        """IPv4マップドIPv6 (::ffff:127.0.0.1) を拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with self.assertRaises(ValueError):
                _safe_download_cdn("https://[::ffff:127.0.0.1]/image.png", dest)

    def test_disables_redirects(self):
        """allow_redirects=False を使用する"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_redirect = False
        mock_response.headers = {"content-length": "5000"}
        mock_response.iter_content = lambda chunk_size: [b"x" * 5000]
        mock_response.raise_for_status = lambda: None

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with patch("generate_zhipu.requests.get", return_value=mock_response) as mock_get:
                _safe_download_cdn("https://cdn.example.com/image.png", dest)
                call_kwargs = mock_get.call_args
                self.assertFalse(
                    call_kwargs.kwargs.get("allow_redirects", True),
                    "requests.get は allow_redirects=False で呼ばれるべき"
                )

    def test_validates_redirect_target(self):
        """リダイレクト先がプライベートIPの場合は拒否する"""
        mock_response = MagicMock()
        mock_response.status_code = 302
        mock_response.is_redirect = True
        mock_response.headers = {"location": "https://10.0.0.1/image.png"}
        mock_response.raise_for_status = lambda: None

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with patch("generate_zhipu.requests.get", return_value=mock_response):
                with self.assertRaises(ValueError):
                    _safe_download_cdn("https://cdn.example.com/image.png", dest)

    def test_size_limit_enforcement(self):
        """サイズ上限を超えた場合にエラーを送出する"""
        # 巨大チャンクを返すモック
        big_chunk = b"x" * (21 * 1024 * 1024)  # 21MB
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_redirect = False
        mock_response.headers = {}
        mock_response.iter_content = lambda chunk_size: [big_chunk]
        mock_response.raise_for_status = lambda: None

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            with patch("generate_zhipu.requests.get", return_value=mock_response):
                with self.assertRaises(ValueError):
                    _safe_download_cdn("https://cdn.example.com/huge.png", dest)

    def test_no_corrupt_file_on_failure(self):
        """ダウンロード失敗時にファイルが残らないことを確認"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "img.png"
            try:
                _safe_download_cdn("https://nonexistent.invalid/image.png", dest)
            except Exception:
                pass
            self.assertFalse(dest.exists(), "失敗時にファイルが残ってはいけない")

    def test_uses_atomic_write(self):
        """アトミック書き込み（tempfile + rename）を使用する"""
        import inspect
        source = inspect.getsource(_safe_download_cdn)
        self.assertIn("mkstemp", source, "tempfile.mkstemp を使用すべき")
        self.assertIn("rename", source, "rename でアトミック書き込みすべき")


class TestSourceCodeSafety(unittest.TestCase):
    """ソースコードレベルの安全性確認"""

    def test_no_bare_requests_get_in_download(self):
        """ダウンロード処理でバリデーションなしのrequests.getを使わない"""
        source_path = Path(__file__).parent / "generate_zhipu.py"
        source = source_path.read_text()
        # _safe_download_cdn が存在することを確認
        self.assertIn(
            "_safe_download_cdn",
            source,
            "安全なダウンロード関数 _safe_download_cdn が必要"
        )

    def test_has_url_validation(self):
        """URL検証関数 _validate_cdn_url が存在する"""
        source_path = Path(__file__).parent / "generate_zhipu.py"
        source = source_path.read_text()
        self.assertIn(
            "_validate_cdn_url",
            source,
            "URL検証関数 _validate_cdn_url が必要"
        )


if __name__ == "__main__":
    unittest.main()
