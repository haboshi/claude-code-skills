"""
URL安全性チェック（SSRF保護）のテスト

テスト対象: generate_rich.py の validate_url / download_reference_image
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# テスト対象のモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))
from generate_rich import validate_url, download_reference_image


class TestValidateUrl(unittest.TestCase):
    """validate_url のテスト"""

    def test_accepts_https_url(self):
        """HTTPS URLを許可する"""
        self.assertTrue(validate_url("https://example.com/image.png"))

    def test_rejects_http_url(self):
        """HTTP URLを拒否する"""
        self.assertFalse(validate_url("http://example.com/image.png"))

    def test_rejects_ftp_url(self):
        """FTP URLを拒否する"""
        self.assertFalse(validate_url("ftp://example.com/image.png"))

    def test_rejects_localhost(self):
        """localhost を拒否する"""
        self.assertFalse(validate_url("https://localhost/image.png"))
        self.assertFalse(validate_url("https://localhost:8080/image.png"))

    def test_rejects_127_0_0_1(self):
        """127.0.0.1 を拒否する"""
        self.assertFalse(validate_url("https://127.0.0.1/image.png"))
        self.assertFalse(validate_url("https://127.0.0.1:3000/image.png"))

    def test_rejects_ipv6_loopback(self):
        """IPv6 ループバック [::1] を拒否する"""
        self.assertFalse(validate_url("https://[::1]/image.png"))

    def test_rejects_private_10_range(self):
        """10.x.x.x プライベートIP を拒否する"""
        self.assertFalse(validate_url("https://10.0.0.1/image.png"))
        self.assertFalse(validate_url("https://10.255.255.255/image.png"))

    def test_rejects_private_172_range(self):
        """172.16-31.x.x プライベートIP を拒否する"""
        self.assertFalse(validate_url("https://172.16.0.1/image.png"))
        self.assertFalse(validate_url("https://172.31.255.255/image.png"))

    def test_accepts_172_outside_private(self):
        """172.32+ は許可する（プライベート範囲外）"""
        self.assertTrue(validate_url("https://172.32.0.1/image.png"))

    def test_rejects_private_192_168_range(self):
        """192.168.x.x プライベートIP を拒否する"""
        self.assertFalse(validate_url("https://192.168.0.1/image.png"))
        self.assertFalse(validate_url("https://192.168.255.255/image.png"))

    def test_rejects_link_local(self):
        """169.254.x.x リンクローカルを拒否する"""
        self.assertFalse(validate_url("https://169.254.169.254/image.png"))

    def test_rejects_empty_url(self):
        """空のURLを拒否する"""
        self.assertFalse(validate_url(""))

    def test_rejects_none(self):
        """Noneを拒否する"""
        self.assertFalse(validate_url(None))

    def test_accepts_valid_cdn_url(self):
        """一般的なCDN URLを許可する"""
        self.assertTrue(validate_url("https://images.unsplash.com/photo-123.jpg"))
        self.assertTrue(validate_url("https://cdn.example.com/images/test.png"))


    # --- SA-003: ipaddress モジュールベース検証の新規テストケース ---

    def test_rejects_ipv6_mapped_ipv4_loopback(self):
        """IPv4マップドIPv6 (::ffff:127.0.0.1) を拒否する"""
        self.assertFalse(validate_url("https://[::ffff:127.0.0.1]/image.png"))

    def test_rejects_ipv6_mapped_ipv4_private(self):
        """IPv4マップドIPv6 (::ffff:10.0.0.1) を拒否する"""
        self.assertFalse(validate_url("https://[::ffff:10.0.0.1]/image.png"))

    def test_rejects_ipv6_mapped_ipv4_192_168(self):
        """IPv4マップドIPv6 (::ffff:192.168.1.1) を拒否する"""
        self.assertFalse(validate_url("https://[::ffff:192.168.1.1]/image.png"))

    def test_rejects_ipv6_private_fc00(self):
        """IPv6ユニークローカル (fc00::) を拒否する"""
        self.assertFalse(validate_url("https://[fc00::1]/image.png"))

    def test_rejects_ipv6_private_fd00(self):
        """IPv6ユニークローカル (fd00::) を拒否する"""
        self.assertFalse(validate_url("https://[fd12:3456:789a::1]/image.png"))

    def test_rejects_ipv6_link_local(self):
        """IPv6リンクローカル (fe80::) を拒否する"""
        self.assertFalse(validate_url("https://[fe80::1]/image.png"))

    def test_rejects_ipv4_loopback_full_range(self):
        """127.x.x.x ループバック全範囲を拒否する"""
        self.assertFalse(validate_url("https://127.0.0.2/image.png"))
        self.assertFalse(validate_url("https://127.255.255.254/image.png"))

    def test_rejects_zero_address(self):
        """0.0.0.0 を拒否する"""
        self.assertFalse(validate_url("https://0.0.0.0/image.png"))

    def test_rejects_ipv6_unspecified(self):
        """IPv6 未指定アドレス [::] を拒否する"""
        self.assertFalse(validate_url("https://[::]/image.png"))

    def test_rejects_shared_address_space(self):
        """100.64.0.0/10 共有アドレス空間を拒否する"""
        self.assertFalse(validate_url("https://100.64.0.1/image.png"))
        self.assertFalse(validate_url("https://100.127.255.254/image.png"))

    def test_rejects_file_scheme(self):
        """file:// スキームを拒否する"""
        self.assertFalse(validate_url("file:///etc/passwd"))

    def test_rejects_data_scheme(self):
        """data: スキームを拒否する"""
        self.assertFalse(validate_url("data:text/html,<script>alert(1)</script>"))

    def test_accepts_public_ipv4(self):
        """パブリック IPv4 を許可する"""
        self.assertTrue(validate_url("https://8.8.8.8/image.png"))
        self.assertTrue(validate_url("https://1.1.1.1/image.png"))

    def test_accepts_public_ipv6(self):
        """パブリック IPv6 を許可する"""
        self.assertTrue(validate_url("https://[2001:4860:4860::8888]/image.png"))

    def test_rejects_decimal_ip_bypass(self):
        """10進数表記 (2130706433 = 127.0.0.1) の IP を拒否する"""
        # urlparse は 10進数表記を直接 hostname として返す
        # ipaddress モジュールでの検証が必要
        self.assertFalse(validate_url("https://2130706433/image.png"))

    def test_rejects_octal_ip_bypass(self):
        """8進数表記 (0177.0.0.1 = 127.0.0.1) の IP を拒否する"""
        self.assertFalse(validate_url("https://0177.0.0.1/image.png"))


class TestDownloadReferenceImageSafety(unittest.TestCase):
    """download_reference_image のダウンロード安全性テスト"""

    def test_rejects_non_https_url(self):
        """HTTP URLでValueErrorを送出する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ref.png"
            with self.assertRaises(ValueError, msg="HTTPS"):
                download_reference_image("http://example.com/image.png", dest)

    def test_rejects_private_ip(self):
        """プライベートIPでValueErrorを送出する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ref.png"
            with self.assertRaises(ValueError):
                download_reference_image("https://192.168.1.1/image.png", dest)

    def test_no_corrupt_file_on_failure(self):
        """ダウンロード失敗時にファイルが残らないことを確認"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ref.png"
            try:
                download_reference_image("https://nonexistent.invalid/image.png", dest)
            except Exception:
                pass
            self.assertFalse(dest.exists(), "失敗時にファイルが残ってはいけない")


    # --- SA-002: リダイレクト制御テスト ---

    def test_download_uses_no_redirects(self):
        """download_reference_image は allow_redirects=False を使用する"""
        import requests as req_mod

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ref.png"
            mock_response = unittest.mock.MagicMock()
            mock_response.status_code = 200
            mock_response.is_redirect = False
            mock_response.headers = {"content-length": "100"}
            mock_response.iter_content = lambda chunk_size: [b"test"]
            mock_response.raise_for_status = lambda: None

            with patch("requests.get", return_value=mock_response) as mock_get:
                download_reference_image("https://cdn.example.com/image.png", dest)
                # allow_redirects=False が指定されていることを確認
                call_kwargs = mock_get.call_args
                self.assertFalse(
                    call_kwargs.kwargs.get("allow_redirects", True),
                    "requests.get は allow_redirects=False で呼ばれるべき"
                )

    def test_download_validates_redirect_target(self):
        """リダイレクト先がプライベートIPの場合は拒否する"""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ref.png"
            mock_response = unittest.mock.MagicMock()
            mock_response.status_code = 302
            mock_response.is_redirect = True
            mock_response.headers = {"location": "https://10.0.0.1/image.png"}
            mock_response.raise_for_status = lambda: None

            with patch("requests.get", return_value=mock_response):
                with self.assertRaises(ValueError, msg="リダイレクト先のプライベートIP"):
                    download_reference_image("https://cdn.example.com/image.png", dest)

    def test_download_uses_fdopen_not_open(self):
        """temp fd は os.fdopen で開くこと（fd リーク防止）"""
        import inspect
        import re
        source = inspect.getsource(download_reference_image)
        self.assertIn("os.fdopen", source, "os.fdopen を使用すべき（open(fd) ではなく）")
        # os.fdopen 以外の open(tmp_fd パターンがないことを確認
        bare_open = re.findall(r"(?<!os\.fd)open\(tmp_fd", source)
        self.assertEqual(bare_open, [], "open(tmp_fd, ...) は fd リークの原因 — os.fdopen を使用すべき")


class TestSearchReferenceImageFiltering(unittest.TestCase):
    """search_reference_image のURL フィルタリングテスト"""

    @patch.dict(os.environ, {"SERPAPI_KEY": "test-key"})
    def test_rejects_http_from_search_results(self):
        """検索結果のHTTP URLをフィルタリングする"""
        from generate_rich import search_reference_image

        mock_response = type("MockResponse", (), {
            "status_code": 200,
            "raise_for_status": lambda self: None,
            "json": lambda self: {
                "images_results": [
                    {"original": "http://insecure.example.com/image.png"}
                ]
            },
        })()

        with patch("requests.get", return_value=mock_response):
            result = search_reference_image("test query")
            self.assertIsNone(result, "HTTP URLは返すべきではない")


if __name__ == "__main__":
    unittest.main()
