"""
OpenAI画像生成スクリプトのダウンロード安全性テスト

テスト対象: generate_openai.py の画像保存処理
- ソースコード安全性チェック（urlretrieve未使用、SSRF保護パターンの存在確認）
- _validate_download_url() の実関数テスト（SSRF保護の動作確認）
"""

import sys
import unittest
from pathlib import Path

# テスト対象のモジュールをインポート
sys.path.insert(0, str(Path(__file__).parent))

from generate_openai import _validate_download_url


class TestOpenaiDownloadSafety(unittest.TestCase):
    """generate_openai.py のソースコード安全性テスト"""

    def test_no_urlretrieve_usage(self):
        """urllib.request.urlretrieve が使われていないことを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        self.assertNotIn(
            "urlretrieve",
            source,
            "urlretrieve は SSRF 脆弱性があるため使用禁止"
        )

    def test_no_urllib_request_import(self):
        """urllib.request のインポートがないことを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        self.assertNotIn(
            "import urllib.request",
            source,
            "urllib.request は urlretrieve の代わりに requests を使用すべき"
        )

    def test_url_download_validates_scheme(self):
        """URL ダウンロード時に HTTPS スキームを検証することを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        has_scheme_check = (
            "https://" in source and
            ("validate_download_url" in source or "validate_url" in source or
             'startswith("https://"' in source)
        )
        self.assertTrue(
            has_scheme_check,
            "URL ダウンロード時に HTTPS スキーム検証が必要"
        )

    def test_url_download_has_timeout(self):
        """URL ダウンロード時にタイムアウトが設定されていることを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        self.assertIn(
            "timeout",
            source,
            "URL ダウンロード時にタイムアウト設定が必要"
        )

    def test_url_download_has_size_limit(self):
        """URL ダウンロード時にサイズ上限チェックがあることを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        has_size_check = (
            "MAX_DOWNLOAD_SIZE" in source or
            "content-length" in source.lower() or
            "downloaded" in source
        )
        self.assertTrue(
            has_size_check,
            "URL ダウンロード時にサイズ上限チェックが必要"
        )

    def test_url_download_disables_redirects(self):
        """URL ダウンロード時に allow_redirects=False を使用することを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        if "requests.get" in source:
            self.assertIn(
                "allow_redirects=False",
                source,
                "requests.get には allow_redirects=False が必要"
            )

    def test_has_private_ip_validation(self):
        """プライベートIP検証コードが存在することを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        self.assertIn(
            "_is_dangerous_ip",
            source,
            "プライベートIP検証関数 (_is_dangerous_ip) が必要"
        )

    def test_has_validate_download_url(self):
        """_validate_download_url 関数が存在することを確認"""
        source_path = Path(__file__).parent / "generate_openai.py"
        source = source_path.read_text()
        self.assertIn(
            "_validate_download_url",
            source,
            "URL検証関数 (_validate_download_url) が必要"
        )


class TestValidateDownloadUrl(unittest.TestCase):
    """_validate_download_url() 実関数テスト（SSRF保護）"""

    # --- スキーム検証 ---

    def test_accepts_https_url(self):
        """HTTPS URLを許可する"""
        # 例外が出なければOK
        _validate_download_url("https://cdn.example.com/image.png")

    def test_rejects_http_url(self):
        """HTTP URLを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("http://example.com/image.png")

    def test_rejects_file_scheme(self):
        """file:// スキームを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("file:///etc/passwd")

    def test_rejects_empty_url(self):
        """空URLを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("")

    def test_rejects_none_url(self):
        """NoneURLを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url(None)

    # --- プライベートIP ---

    def test_rejects_localhost(self):
        """localhost を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://localhost/image.png")

    def test_rejects_loopback(self):
        """127.0.0.1 を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://127.0.0.1/image.png")

    def test_rejects_private_10(self):
        """10.0.0.1 を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://10.0.0.1/image.png")

    def test_rejects_private_192(self):
        """192.168.1.1 を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://192.168.1.1/image.png")

    def test_rejects_private_172(self):
        """172.16.0.1 を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://172.16.0.1/image.png")

    def test_rejects_link_local(self):
        """169.254.169.254 リンクローカルを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://169.254.169.254/image.png")

    def test_rejects_shared_address_space(self):
        """100.64.0.1 RFC 6598 共有アドレス空間を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://100.64.0.1/image.png")

    def test_rejects_zero(self):
        """0.0.0.0 を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://0.0.0.0/image.png")

    # --- IPv6 ---

    def test_rejects_ipv6_loopback(self):
        """::1 IPv6ループバックを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://[::1]/image.png")

    def test_rejects_ipv6_link_local(self):
        """fe80::1 IPv6リンクローカルを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://[fe80::1]/image.png")

    def test_rejects_ipv4_mapped_ipv6(self):
        """::ffff:127.0.0.1 IPv4マップドIPv6を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://[::ffff:127.0.0.1]/image.png")

    def test_rejects_ipv4_mapped_ipv6_private(self):
        """::ffff:10.0.0.1 IPv4マップドIPv6プライベートを拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://[::ffff:10.0.0.1]/image.png")

    # --- 8進数/10進数バイパス ---

    def test_rejects_octal_ip(self):
        """0177.0.0.1 8進数IP表記を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://0177.0.0.1/image.png")

    def test_rejects_decimal_ip(self):
        """2130706433 10進数IP表記を拒否する"""
        with self.assertRaises(ValueError):
            _validate_download_url("https://2130706433/image.png")

    # --- パブリック許可 ---

    def test_accepts_public_ip(self):
        """パブリックIP 8.8.8.8 を許可する"""
        _validate_download_url("https://8.8.8.8/image.png")

    def test_accepts_public_domain(self):
        """パブリックドメインを許可する"""
        _validate_download_url("https://oaidalleapiprodscus.blob.core.windows.net/image.png")


if __name__ == "__main__":
    unittest.main()
