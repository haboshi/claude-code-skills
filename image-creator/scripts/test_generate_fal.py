#!/usr/bin/env python3
"""generate_fal.py のテスト"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))

from generate_fal import _is_dangerous_ip, _validate_url, generate_image, VALID_SIZES


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


class TestAPIKeyValidation(unittest.TestCase):
    """APIキー未設定時の振る舞い"""

    def test_missing_api_key_exits(self):
        env = os.environ.copy()
        env.pop("FAL_AI_API_KEY", None)
        env.pop("FAL_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                generate_image("テスト")
            self.assertEqual(ctx.exception.code, 1)

    def test_missing_api_key_message(self):
        env = os.environ.copy()
        env.pop("FAL_AI_API_KEY", None)
        env.pop("FAL_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with patch("builtins.print") as mock_print:
                with self.assertRaises(SystemExit):
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
                generate_image("猫", output_path=f"{tmpdir}/out.png")
                headers = mock_post.call_args[1]["headers"]
                self.assertEqual(headers["Authorization"], "Key fallback-key")


class TestQueuePolling(unittest.TestCase):
    """非同期キューポーリング"""

    @patch("generate_fal.time.sleep")
    @patch("generate_fal._safe_download")
    @patch("generate_fal.requests.get")
    @patch("generate_fal.requests.post")
    def test_queue_polling_success(self, mock_post, mock_get, mock_download, mock_sleep):
        """キュー投入→ポーリング→結果取得の正常系"""
        # POST: キュー投入
        submit_resp = MagicMock()
        submit_resp.status_code = 200
        submit_resp.json.return_value = {
            "status": "IN_QUEUE",
            "status_url": "https://queue.fal.run/status/123",
            "response_url": "https://queue.fal.run/response/123",
        }
        mock_post.return_value = submit_resp

        # GET: ポーリング(IN_PROGRESS → COMPLETED) + 結果取得
        poll_resp = MagicMock()
        poll_resp.json.return_value = {"status": "IN_PROGRESS"}
        completed_resp = MagicMock()
        completed_resp.json.return_value = {"status": "COMPLETED"}
        result_resp = MagicMock()
        result_resp.json.return_value = {
            "images": [{"url": "https://fal.media/files/result.png"}]
        }
        mock_get.side_effect = [poll_resp, completed_resp, result_resp]

        with patch.dict(os.environ, {"FAL_AI_API_KEY": "test-key"}):
            with tempfile.TemporaryDirectory() as tmpdir:
                output = Path(tmpdir) / "result.png"
                result = generate_image("猫", output_path=str(output))
                self.assertEqual(result, str(output.absolute()))
                mock_download.assert_called_once()
                self.assertEqual(mock_get.call_count, 3)  # 2 polls + 1 result

    @patch("generate_fal.time.sleep")
    @patch("generate_fal.requests.get")
    @patch("generate_fal.requests.post")
    def test_queue_polling_failed(self, mock_post, mock_get, mock_sleep):
        """キュージョブ失敗時: 空文字列を返す"""
        submit_resp = MagicMock()
        submit_resp.status_code = 200
        submit_resp.json.return_value = {
            "status": "IN_QUEUE",
            "status_url": "https://queue.fal.run/status/123",
            "response_url": "https://queue.fal.run/response/123",
        }
        mock_post.return_value = submit_resp

        failed_resp = MagicMock()
        failed_resp.json.return_value = {"status": "FAILED", "error": "GPU error"}
        mock_get.return_value = failed_resp

        with patch.dict(os.environ, {"FAL_AI_API_KEY": "test-key"}):
            with tempfile.TemporaryDirectory() as tmpdir:
                result = generate_image("猫", output_path=f"{tmpdir}/out.png")
                self.assertEqual(result, "")


class TestSizeValidation(unittest.TestCase):
    """サイズバリデーション"""

    def test_valid_sizes(self):
        self.assertIn("1024x1024", VALID_SIZES)
        self.assertIn("1536x1024", VALID_SIZES)
        self.assertIn("1024x1536", VALID_SIZES)


if __name__ == "__main__":
    unittest.main()
