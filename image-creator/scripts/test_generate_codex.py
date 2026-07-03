#!/usr/bin/env python3
"""
generate_codex.py のテスト

subprocess（codex CLI）をモックして、可用性検出・プロンプト構築・偽装検証・
env からの OPENAI_API_KEY 除去・パス抽出・コピーを検証する。
"""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))

import generate_codex
from generate_codex import (
    EXIT_NO_IMAGE,
    EXIT_TOKEN_EXPIRED,
    EXIT_UNAVAILABLE,
    build_prompt,
    check_availability,
    extract_reported_paths,
    generate_image,
    main,
    select_fresh_images,
)


class TestAvailability(unittest.TestCase):
    """可用性検出"""

    @patch("generate_codex.shutil.which", return_value=None)
    def test_codex_not_installed(self, _which):
        available, msg = check_availability()
        self.assertFalse(available)
        self.assertIn("codex", msg)

    @patch("generate_codex.subprocess.run")
    @patch("generate_codex.shutil.which", return_value="/usr/local/bin/codex")
    def test_logged_in_with_chatgpt(self, _which, mock_run):
        mock_run.return_value = MagicMock(stdout="Logged in using ChatGPT", stderr="", returncode=0)
        available, msg = check_availability()
        self.assertTrue(available)
        self.assertIn("ChatGPT", msg)

    @patch("generate_codex.subprocess.run")
    @patch("generate_codex.shutil.which", return_value="/usr/local/bin/codex")
    def test_not_logged_in(self, _which, mock_run):
        mock_run.return_value = MagicMock(stdout="Not logged in", stderr="", returncode=1)
        available, msg = check_availability()
        self.assertFalse(available)


class TestBuildPrompt(unittest.TestCase):
    """プロンプト構築"""

    def test_contains_anti_fake_and_imagegen_token(self):
        p = build_prompt("猫のイラスト")
        self.assertIn("image_gen", p)
        self.assertIn("IMAGEGEN-UNAVAILABLE", p)
        self.assertIn("$imagegen", p)
        self.assertTrue(p.rstrip().endswith("$imagegen"))

    def test_aspect_hint_injected(self):
        p = build_prompt("風景", aspect="16:9")
        self.assertIn("16:9", p)

    def test_multi_image_shared_style(self):
        p = build_prompt("章扉", n=3)
        self.assertIn("3", p)
        self.assertIn("スタイル", p)

    def test_augment_on_by_default_adds_quality_bar(self):
        p = build_prompt("インフォグラフィック")
        self.assertIn("expert designer", p)
        self.assertIn("professional", p)

    def test_no_augment_omits_quality_bar(self):
        p = build_prompt("インフォグラフィック", augment=False)
        self.assertNotIn("expert designer", p)
        # 偽装禁止と $imagegen は augment 無効でも残る
        self.assertIn("$imagegen", p)
        self.assertIn("image_gen", p)

    def test_augment_respects_explicit_taste(self):
        """品質バーは明示テイストを尊重する文言を含む（シンプル/フラットを壊さない）"""
        p = build_prompt("シンプルでフラットなアイコン")
        self.assertIn("do NOT add", p)

    def test_aspect_clause_orientation(self):
        self.assertIn("portrait", build_prompt("x", aspect="3:4"))
        self.assertIn("landscape", build_prompt("x", aspect="16:9"))
        self.assertIn("square", build_prompt("x", aspect="1:1"))


class TestExtractPaths(unittest.TestCase):
    """報告パスの抽出"""

    def test_extracts_plain_path(self):
        text = "生成しました\n/tmp/codexhome/generated_images/sess/ig_1.png\n完了"
        paths = extract_reported_paths(text)
        self.assertEqual(paths, ["/tmp/codexhome/generated_images/sess/ig_1.png"])

    def test_extracts_path_with_space(self):
        # 実環境の orca パスは "Application Support" に空白を含む。空白を跨いで拾えることを検証。
        text = "/tmp/App Support/orca/codex-runtime-home/home/generated_images/s/ig_2.png"
        paths = extract_reported_paths(text)
        self.assertEqual(len(paths), 1)
        self.assertTrue(paths[0].endswith("ig_2.png"))
        self.assertIn("generated_images", paths[0])

    def test_ignores_non_generated_images_paths(self):
        text = "保存先: /tmp/downloads/foo.png"
        self.assertEqual(extract_reported_paths(text), [])


class TestSelectFreshImages(unittest.TestCase):
    """偽装検証（mtime）"""

    def _make_png(self, directory, name):
        p = Path(directory) / name
        p.write_bytes(b"\x89PNG\r\n")
        return p

    def test_rejects_stale_file(self):
        """marker より古いファイル（既存流用の偽装）は棄却"""
        with tempfile.TemporaryDirectory() as d:
            gen = Path(d) / "generated_images"
            gen.mkdir()
            old = self._make_png(gen, "ig_old.png")
            old_mtime = time.time() - 100
            os.utime(old, (old_mtime, old_mtime))
            marker = time.time() - 10  # marker はファイルより新しい
            fresh = select_fresh_images([str(old)], marker, [gen], limit=1)
            self.assertEqual(fresh, [])

    def test_accepts_fresh_file(self):
        with tempfile.TemporaryDirectory() as d:
            gen = Path(d) / "generated_images"
            gen.mkdir()
            marker = time.time() - 5
            new = self._make_png(gen, "ig_new.png")  # 現在時刻 = marker より新しい
            fresh = select_fresh_images([str(new)], marker, [gen], limit=1)
            self.assertEqual(len(fresh), 1)
            self.assertTrue(fresh[0].name == "ig_new.png")

    def test_rejects_path_outside_generated_images(self):
        with tempfile.TemporaryDirectory() as d:
            other = Path(d) / "elsewhere"
            other.mkdir()
            marker = time.time() - 5
            f = self._make_png(other, "fake.png")
            fresh = select_fresh_images([str(f)], marker, [], limit=1)
            self.assertEqual(fresh, [])

    def test_reported_path_wins_over_newer_concurrent_file(self):
        """並行実行の別セッション生成物（より新しい）より、codex 報告パスを優先する"""
        with tempfile.TemporaryDirectory() as d:
            gen = Path(d) / "generated_images"
            gen.mkdir()
            marker = time.time() - 20
            mine = self._make_png(gen, "ig_mine.png")
            mine_mtime = time.time() - 10
            os.utime(mine, (mine_mtime, mine_mtime))
            # 別セッションがより新しい画像を同じ共有ディレクトリに生成
            other = self._make_png(gen, "ig_other_session.png")  # 現在時刻 = より新しい
            fresh = select_fresh_images([str(mine)], marker, [gen], limit=1)
            self.assertEqual([p.name for p in fresh], ["ig_mine.png"])
            self.assertNotIn(other.name, [p.name for p in fresh])


class TestGenerateImage(unittest.TestCase):
    """生成オーケストレーション（subprocess モック）"""

    def _fake_generated(self, gen_dir):
        gen_dir.mkdir(parents=True, exist_ok=True)
        png = gen_dir / "ig_out.png"
        png.write_bytes(b"\x89PNG\r\n")
        return png

    @patch("generate_codex.check_availability", return_value=(False, "no codex"))
    def test_unavailable_exits_3(self, _avail):
        with self.assertRaises(SystemExit) as ctx:
            generate_image("テスト", output_path="/tmp/x.png")
        self.assertEqual(ctx.exception.code, EXIT_UNAVAILABLE)

    @patch("generate_codex.check_availability", return_value=(True, "ok"))
    @patch("generate_codex.subprocess.run")
    def test_env_removes_openai_api_key(self, mock_run, _avail):
        with tempfile.TemporaryDirectory() as d:
            gen = Path(d) / "generated_images"
            png = self._fake_generated(gen)
            mock_run.return_value = MagicMock(stdout="", stderr="", returncode=0)
            out = Path(d) / "out.png"

            def fake_write(out_txt_path):
                # codex が out.txt にパス報告した体で書き込む
                Path(out_txt_path).write_text(str(png), encoding="utf-8")

            # -o の一時ファイルへ報告を書くために run 呼び出し時に副作用を仕込む
            def run_side_effect(cmd, **kwargs):
                oidx = cmd.index("-o")
                fake_write(cmd[oidx + 1])
                return MagicMock(stdout="", stderr="", returncode=0)

            mock_run.side_effect = run_side_effect

            with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-should-be-removed"}):
                with patch("generate_codex.candidate_image_dirs", return_value=[gen]):
                    generate_image("テスト", output_path=str(out), workdir=d)

            passed_env = mock_run.call_args.kwargs["env"]
            self.assertNotIn("OPENAI_API_KEY", passed_env)
            self.assertTrue(out.exists())

    @patch("generate_codex.check_availability", return_value=(True, "ok"))
    @patch("generate_codex.subprocess.run")
    def test_imagegen_unavailable_exits_2(self, mock_run, _avail):
        def run_side_effect(cmd, **kwargs):
            oidx = cmd.index("-o")
            Path(cmd[oidx + 1]).write_text("IMAGEGEN-UNAVAILABLE", encoding="utf-8")
            return MagicMock(stdout="", stderr="", returncode=0)

        mock_run.side_effect = run_side_effect
        with self.assertRaises(SystemExit) as ctx:
            generate_image("テスト", output_path="/tmp/x.png")
        self.assertEqual(ctx.exception.code, EXIT_NO_IMAGE)

    @patch("generate_codex.check_availability", return_value=(True, "ok"))
    @patch("generate_codex.subprocess.run")
    def test_token_expired_exits_4(self, mock_run, _avail):
        def run_side_effect(cmd, **kwargs):
            oidx = cmd.index("-o")
            Path(cmd[oidx + 1]).write_text("error: token_expired", encoding="utf-8")
            return MagicMock(stdout="", stderr="", returncode=1)

        mock_run.side_effect = run_side_effect
        with self.assertRaises(SystemExit) as ctx:
            generate_image("テスト", output_path="/tmp/x.png")
        self.assertEqual(ctx.exception.code, EXIT_TOKEN_EXPIRED)

    @patch("generate_codex.check_availability", return_value=(True, "ok"))
    @patch("generate_codex.subprocess.run")
    def test_bare_401_number_is_not_token_expired(self, mock_run, _avail):
        """本文中の数値 401（画素数等）を期限切れと誤検知しない（偽陽性回帰）"""
        with tempfile.TemporaryDirectory() as d:
            gen = Path(d) / "generated_images"
            gen.mkdir()
            png = gen / "ig_dog.png"
            png.write_bytes(b"\x89PNG\r\n")

            def run_side_effect(cmd, **kwargs):
                oidx = cmd.index("-o")
                # "401" が寸法・トークン数として現れるが認証エラーではない
                Path(cmd[oidx + 1]).write_text(
                    f"生成完了 size 1672x941 tokens 4013\n{png}", encoding="utf-8"
                )
                return MagicMock(stdout="", stderr="", returncode=0)

            mock_run.side_effect = run_side_effect
            with patch("generate_codex.candidate_image_dirs", return_value=[gen]):
                out = Path(d) / "dog.png"
                generate_image("柴犬", output_path=str(out), workdir=d)
                self.assertTrue(out.exists())

    @patch("generate_codex.check_availability", return_value=(True, "ok"))
    @patch("generate_codex.subprocess.run")
    def test_no_fresh_image_exits_2(self, mock_run, _avail):
        """報告も新しい画像も無ければ偽装疑いで exit 2"""
        with tempfile.TemporaryDirectory() as d:
            gen = Path(d) / "generated_images"
            gen.mkdir()
            mock_run.return_value = MagicMock(stdout="", stderr="", returncode=0)
            with patch("generate_codex.candidate_image_dirs", return_value=[gen]):
                with self.assertRaises(SystemExit) as ctx:
                    generate_image("テスト", output_path=str(Path(d) / "o.png"), workdir=d)
            self.assertEqual(ctx.exception.code, EXIT_NO_IMAGE)


class TestCLIArguments(unittest.TestCase):
    """CLI 引数"""

    @patch("generate_codex.generate_image")
    def test_default_arguments(self, mock_gen):
        mock_gen.return_value = "/tmp/x.png"
        with patch("sys.argv", ["generate_codex.py", "テストプロンプト"]):
            main()
        kwargs = mock_gen.call_args[1]
        self.assertEqual(kwargs["effort"], "low")
        self.assertEqual(kwargs["n"], 1)

    @patch("generate_codex.check_availability", return_value=(True, "Logged in using ChatGPT"))
    def test_check_flag_available_exits_0(self, _avail):
        with patch("sys.argv", ["generate_codex.py", "--check"]):
            with self.assertRaises(SystemExit) as ctx:
                main()
        self.assertEqual(ctx.exception.code, 0)

    @patch("generate_codex.check_availability", return_value=(False, "no codex"))
    def test_check_flag_unavailable_exits_3(self, _avail):
        with patch("sys.argv", ["generate_codex.py", "--check"]):
            with self.assertRaises(SystemExit) as ctx:
                main()
        self.assertEqual(ctx.exception.code, EXIT_UNAVAILABLE)


if __name__ == "__main__":
    unittest.main()
