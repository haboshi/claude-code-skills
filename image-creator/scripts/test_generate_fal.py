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
