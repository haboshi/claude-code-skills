#!/usr/bin/env python3
"""
generate_zhipu.py のテスト

TDD: RED → GREEN → REFACTOR
"""

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))

from generate_zhipu import generate_image, main


class TestAPIKeyValidation(unittest.TestCase):
    """APIキー未設定時の振る舞い"""

    def test_missing_api_key_shows_setup_instructions(self):
        """GLM_API_KEY / ZAI_API_KEY 両方未設定時にセットアップ手順を表示して終了"""
        env = os.environ.copy()
        env.pop("GLM_API_KEY", None)
        env.pop("ZAI_API_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                generate_image("テスト")
            self.assertEqual(ctx.exception.code, 1)

    def test_missing_api_key_message_contains_instructions(self):
        """エラーメッセージに環境変数名とセット方法が含まれる"""
        env = os.environ.copy()
        env.pop("GLM_API_KEY", None)
        env.pop("ZAI_API_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with patch("builtins.print") as mock_print:
                with self.assertRaises(SystemExit):
                    generate_image("テスト")
                output = " ".join(str(c) for c in mock_print.call_args_list)
                self.assertIn("GLM_API_KEY", output)
                self.assertIn("export", output)


    @patch("generate_zhipu.urllib.request.urlretrieve")
    @patch("generate_zhipu.requests.post")
    def test_glm_api_key_is_used(self, mock_post, mock_urlretrieve):
        """GLM_API_KEY が優先して使用される"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "created": 1760335349,
            "data": [{"url": "https://example.com/image.png"}],
        }
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GLM_API_KEY": "glm-key", "ZAI_API_KEY": "zai-key"}):
            generate_image("テスト", output_path="/tmp/test_zhipu.png")

        headers = mock_post.call_args[1]["headers"]
        self.assertEqual(headers["Authorization"], "Bearer glm-key")

    @patch("generate_zhipu.urllib.request.urlretrieve")
    @patch("generate_zhipu.requests.post")
    def test_zai_api_key_fallback(self, mock_post, mock_urlretrieve):
        """GLM_API_KEY 未設定時に ZAI_API_KEY にフォールバック"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "created": 1760335349,
            "data": [{"url": "https://example.com/image.png"}],
        }
        mock_post.return_value = mock_response

        env = os.environ.copy()
        env.pop("GLM_API_KEY", None)
        env["ZAI_API_KEY"] = "zai-fallback"
        with patch.dict(os.environ, env, clear=True):
            generate_image("テスト", output_path="/tmp/test_zhipu.png")

        headers = mock_post.call_args[1]["headers"]
        self.assertEqual(headers["Authorization"], "Bearer zai-fallback")


class TestImageGeneration(unittest.TestCase):
    """画像生成の正常系"""

    @patch("generate_zhipu.urllib.request.urlretrieve")
    @patch("generate_zhipu.requests.post")
    def test_successful_generation_saves_file(self, mock_post, mock_urlretrieve):
        """正常にAPIレスポンスから画像をダウンロード・保存"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "created": 1760335349,
            "data": [{"url": "https://example.com/image.png"}],
        }
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GLM_API_KEY": "test-key"}):
            result = generate_image("かわいい猫", output_path="/tmp/test_zhipu.png")

        mock_urlretrieve.assert_called_once()
        self.assertIn("test_zhipu.png", result)

    @patch("generate_zhipu.requests.post")
    def test_api_sends_correct_parameters(self, mock_post):
        """APIに正しいパラメータが送信される"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "created": 1760335349,
            "data": [{"url": "https://example.com/image.png"}],
        }
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GLM_API_KEY": "test-key"}):
            with patch("generate_zhipu.urllib.request.urlretrieve"):
                generate_image(
                    "テスト", size="1568x1056", quality="standard"
                )

        call_kwargs = mock_post.call_args
        body = call_kwargs[1]["json"]
        self.assertEqual(body["model"], "glm-image")
        self.assertEqual(body["prompt"], "テスト")
        self.assertEqual(body["size"], "1568x1056")
        self.assertEqual(body["quality"], "standard")

    @patch("generate_zhipu.requests.post")
    def test_api_sends_auth_header(self, mock_post):
        """APIリクエストに認証ヘッダーが含まれる"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "created": 1760335349,
            "data": [{"url": "https://example.com/image.png"}],
        }
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GLM_API_KEY": "my-secret-key"}):
            with patch("generate_zhipu.urllib.request.urlretrieve"):
                generate_image("テスト")

        call_kwargs = mock_post.call_args
        headers = call_kwargs[1]["headers"]
        self.assertEqual(headers["Authorization"], "Bearer my-secret-key")


class TestAPIErrorHandling(unittest.TestCase):
    """APIエラーハンドリング"""

    @patch("generate_zhipu.requests.post")
    def test_api_error_response(self, mock_post):
        """APIがエラーを返した場合、エラーメッセージを表示して終了"""
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.json.return_value = {
            "code": 400,
            "message": "Invalid prompt",
        }
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GLM_API_KEY": "test-key"}):
            with self.assertRaises(SystemExit) as ctx:
                generate_image("テスト")
            self.assertEqual(ctx.exception.code, 1)

    @patch("generate_zhipu.requests.post")
    def test_empty_data_response(self, mock_post):
        """APIが空データを返した場合"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"created": 1760335349, "data": []}
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GLM_API_KEY": "test-key"}):
            result = generate_image("テスト")
            self.assertEqual(result, "")


class TestCLIArguments(unittest.TestCase):
    """CLIの引数パース"""

    @patch("generate_zhipu.generate_image")
    def test_default_arguments(self, mock_gen):
        """デフォルト引数が正しく設定される"""
        mock_gen.return_value = "/tmp/test.png"
        with patch("sys.argv", ["generate_zhipu.py", "テストプロンプト"]):
            main()
        mock_gen.assert_called_once()
        kwargs = mock_gen.call_args[1]
        self.assertEqual(kwargs["size"], "1280x1280")
        self.assertEqual(kwargs["quality"], "hd")

    @patch("generate_zhipu.generate_image")
    def test_custom_arguments(self, mock_gen):
        """カスタム引数が正しく渡される"""
        mock_gen.return_value = "/tmp/test.png"
        with patch(
            "sys.argv",
            [
                "generate_zhipu.py",
                "猫の絵",
                "-o",
                "cat.png",
                "-s",
                "1568x1056",
                "-q",
                "standard",
            ],
        ):
            main()
        kwargs = mock_gen.call_args[1]
        self.assertEqual(kwargs["output_path"], "cat.png")
        self.assertEqual(kwargs["size"], "1568x1056")
        self.assertEqual(kwargs["quality"], "standard")


if __name__ == "__main__":
    unittest.main()
