"""
brave-research extract.py の SSRF保護テスト

テスト対象: extract.py の validate_url / fetch_url
P1: ipaddressモジュールベースの包括的なIP検証、リダイレクト制御
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))
from extract import validate_url


class TestValidateUrl(unittest.TestCase):
    """validate_url の包括的SSRF保護テスト"""

    # --- スキーム検証 ---

    def test_rejects_ftp_url(self):
        """FTP URLを拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("ftp://example.com/page")

    def test_rejects_file_scheme(self):
        """file:// を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("file:///etc/passwd")

    def test_rejects_data_scheme(self):
        """data: スキームを拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("data:text/html,<script>alert(1)</script>")

    def test_accepts_https(self):
        """HTTPS URLを受け入れる"""
        # SystemExit が発生しなければOK
        validate_url("https://example.com/article")

    def test_accepts_http(self):
        """HTTP URLを受け入れる（コンテンツ抽出は HTTP も対象）"""
        validate_url("http://example.com/article")

    # --- プライベートIP拒否（ipaddressモジュールベース） ---

    def test_rejects_localhost(self):
        """localhost を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://localhost/page")

    def test_rejects_127_0_0_1(self):
        """127.0.0.1 を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://127.0.0.1/page")

    def test_rejects_127_0_0_2(self):
        """127.0.0.2（ループバック全範囲）を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://127.0.0.2/page")

    def test_rejects_10_range(self):
        """10.x.x.x プライベートIPを拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://10.0.0.1/page")

    def test_rejects_172_16_range(self):
        """172.16.x.x プライベートIPを拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://172.16.0.1/page")

    def test_rejects_192_168_range(self):
        """192.168.x.x プライベートIPを拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://192.168.0.1/page")

    def test_rejects_link_local(self):
        """169.254.x.x リンクローカルを拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://169.254.169.254/page")

    def test_rejects_0_0_0_0(self):
        """0.0.0.0 を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://0.0.0.0/page")

    def test_rejects_shared_address_space(self):
        """100.64.0.0/10 共有アドレス空間を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://100.64.0.1/page")

    # --- IPv6 ---

    def test_rejects_ipv6_loopback(self):
        """IPv6 ループバック [::1] を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://[::1]/page")

    def test_rejects_ipv6_mapped_ipv4_loopback(self):
        """IPv4マップドIPv6 [::ffff:127.0.0.1] を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://[::ffff:127.0.0.1]/page")

    def test_rejects_ipv6_private_fc00(self):
        """IPv6ユニークローカル [fc00::1] を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://[fc00::1]/page")

    def test_rejects_ipv6_link_local(self):
        """IPv6リンクローカル [fe80::1] を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://[fe80::1]/page")

    # --- バイパス防止 ---

    def test_rejects_octal_ip(self):
        """8進数表記 (0177.0.0.1) を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://0177.0.0.1/page")

    def test_rejects_decimal_ip(self):
        """10進数表記 (2130706433 = 127.0.0.1) を拒否する"""
        with self.assertRaises(SystemExit):
            validate_url("https://2130706433/page")

    # --- パブリックIPは許可 ---

    def test_accepts_public_ip(self):
        """パブリック IPv4 を許可する"""
        validate_url("https://8.8.8.8/page")

    def test_accepts_public_domain(self):
        """パブリックドメインを許可する"""
        validate_url("https://example.com/page")


class TestFetchUrlRedirectControl(unittest.TestCase):
    """fetch_url のリダイレクト制御テスト"""

    def test_uses_no_auto_redirects(self):
        """fetch_url は allow_redirects=False を使用する"""
        import inspect
        from extract import fetch_url
        source = inspect.getsource(fetch_url)
        self.assertIn(
            "allow_redirects=False",
            source,
            "fetch_url は allow_redirects=False を使用すべき"
        )

    def test_validates_redirect_target(self):
        """リダイレクト先のURLを検証する"""
        from extract import fetch_url

        # 302レスポンスモック（リダイレクト先がプライベートIP）
        mock_redirect = MagicMock()
        mock_redirect.status_code = 302
        mock_redirect.is_redirect = True
        mock_redirect.headers = {"location": "https://10.0.0.1/evil"}

        with patch("extract.requests.get", return_value=mock_redirect):
            with self.assertRaises(SystemExit):
                fetch_url("https://example.com/page")


if __name__ == "__main__":
    unittest.main()
