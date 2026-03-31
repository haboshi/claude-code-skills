#!/usr/bin/env python3
"""generate_fal.py のテスト"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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


if __name__ == "__main__":
    unittest.main()
