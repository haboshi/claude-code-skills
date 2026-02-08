"""
generate_rich.py のユニットテスト（API呼び出しを除く）
"""

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from generate_rich import (
    load_config,
    resolve_pattern_mode,
    get_template,
    PATTERN_MODES,
    VALID_ASPECTS,
)
from template_engine import build_prompt


CONFIG_PATH = Path(__file__).parent.parent / "config" / "rich_patterns.json"


# --- load_config テスト ---

def test_load_config():
    """設定ファイルを正常に読み込めること"""
    config = load_config()
    assert "patterns" in config
    assert "thumbnail" in config["patterns"]
    assert "illustration" in config["patterns"]


def test_config_has_all_modes():
    """設定ファイルに全9モードが定義されていること"""
    config = load_config()
    patterns = config["patterns"]

    thumbnail_modes = set(patterns["thumbnail"]["modes"].keys())
    illustration_modes = set(patterns["illustration"]["modes"].keys())

    assert thumbnail_modes == {
        "anime-wow", "anime-impact", "anime-pop", "anime-bright",
        "formal-default", "real-default"
    }
    assert illustration_modes == {"comparison", "graphrec", "process", "custom"}


def test_config_all_modes_have_template():
    """全モードにtemplateが定義されていること"""
    config = load_config()
    for pat_name, pat_data in config["patterns"].items():
        for mode_name, mode_data in pat_data["modes"].items():
            assert "template" in mode_data, f"Missing template: {pat_name}/{mode_name}"
            assert len(mode_data["template"]) > 0, f"Empty template: {pat_name}/{mode_name}"


def test_config_all_modes_have_default_aspect():
    """全モードにdefault_aspectが定義されていること"""
    config = load_config()
    for pat_name, pat_data in config["patterns"].items():
        for mode_name, mode_data in pat_data["modes"].items():
            assert "default_aspect" in mode_data, f"Missing aspect: {pat_name}/{mode_name}"
            assert mode_data["default_aspect"] in VALID_ASPECTS, \
                f"Invalid aspect in {pat_name}/{mode_name}: {mode_data['default_aspect']}"


# --- resolve_pattern_mode テスト ---

def test_resolve_default():
    """パターン・モード未指定時のデフォルト解決"""
    config = load_config()
    pattern, mode = resolve_pattern_mode(config, None, None)
    assert pattern == "thumbnail"
    assert mode == "anime-wow"


def test_resolve_pattern_only():
    """パターンのみ指定"""
    config = load_config()

    pattern, mode = resolve_pattern_mode(config, "thumbnail", None)
    assert pattern == "thumbnail"
    assert mode == "anime-wow"

    pattern, mode = resolve_pattern_mode(config, "illustration", None)
    assert pattern == "illustration"
    assert mode == "graphrec"


def test_resolve_mode_only():
    """モードのみ指定（パターンを自動推定）"""
    config = load_config()

    pattern, mode = resolve_pattern_mode(config, None, "anime-pop")
    assert pattern == "thumbnail"
    assert mode == "anime-pop"

    pattern, mode = resolve_pattern_mode(config, None, "comparison")
    assert pattern == "illustration"
    assert mode == "comparison"


def test_resolve_both():
    """パターン・モード両方指定"""
    config = load_config()
    pattern, mode = resolve_pattern_mode(config, "thumbnail", "formal-default")
    assert pattern == "thumbnail"
    assert mode == "formal-default"


def test_resolve_invalid_mode_for_pattern():
    """パターンに属さないモードを指定するとexit"""
    config = load_config()
    try:
        resolve_pattern_mode(config, "thumbnail", "graphrec")
        assert False, "Should have called sys.exit"
    except SystemExit as e:
        assert e.code == 1


def test_resolve_all_modes():
    """全モードが正しくパターンに解決されること"""
    config = load_config()
    for pat_name, modes in PATTERN_MODES.items():
        for mode_name in modes:
            pattern, mode = resolve_pattern_mode(config, None, mode_name)
            assert pattern == pat_name, f"Mode {mode_name} resolved to {pattern}, expected {pat_name}"
            assert mode == mode_name


# --- get_template テスト ---

def test_get_template():
    """テンプレート取得"""
    config = load_config()
    template, aspect = get_template(config, "thumbnail", "anime-wow")
    assert len(template) > 0
    assert aspect in VALID_ASPECTS


def test_get_template_all_modes():
    """全モードからテンプレートを取得できること"""
    config = load_config()
    for pat_name, modes in PATTERN_MODES.items():
        for mode_name in modes:
            template, aspect = get_template(config, pat_name, mode_name)
            assert isinstance(template, str) and len(template) > 0
            assert aspect in VALID_ASPECTS


# --- テンプレート展開統合テスト ---

def test_template_expansion_thumbnail_modes():
    """サムネイル全モードのテンプレート展開"""
    config = load_config()
    input_data = '{"title": "テストタイトル", "subtitle": "サブタイトル"}'

    for mode_name in PATTERN_MODES["thumbnail"]:
        template, _ = get_template(config, "thumbnail", mode_name)
        result = build_prompt(template, input_data)
        assert "テストタイトル" in result, f"Title missing in {mode_name}: {result[:100]}"


def test_template_expansion_illustration_modes():
    """イラスト全モードのテンプレート展開"""
    config = load_config()
    input_data = '{"content": "テスト内容", "title": "テストタイトル"}'

    for mode_name in PATTERN_MODES["illustration"]:
        template, _ = get_template(config, "illustration", mode_name)
        result = build_prompt(template, input_data)
        assert "テスト" in result, f"Content missing in {mode_name}: {result[:100]}"


def test_template_optional_fields_omitted():
    """オプショナルフィールド未指定時にセクションが除去されること"""
    config = load_config()
    template, _ = get_template(config, "thumbnail", "anime-wow")
    result = build_prompt(template, '{"title": "Only Title"}')
    assert "Only Title" in result
    # subtitle セクションが展開されていないこと
    assert "Subtitle" not in result or "subtitle" not in result.lower().split("only title")[0]


# --- CLI テスト ---

def test_cli_list_modes():
    """--list-modes が正常動作すること"""
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_rich.py"), "--list-modes"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "anime-wow" in result.stdout
    assert "graphrec" in result.stdout
    assert "thumbnail" in result.stdout
    assert "illustration" in result.stdout


def test_cli_missing_prompt():
    """--prompt 未指定でエラーになること"""
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_rich.py")],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0


def test_cli_invalid_mode():
    """不正なモード指定でエラーになること"""
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_rich.py"),
         "--prompt", "test", "--mode", "nonexistent"],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0


def test_cli_help():
    """--help が正常動作すること"""
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_rich.py"), "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "--prompt" in result.stdout
    assert "--pattern" in result.stdout
    assert "--mode" in result.stdout
    assert "--character-preset" in result.stdout


def test_cli_list_presets():
    """--list-presets が正常動作すること"""
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_rich.py"), "--list-presets"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "idol" in result.stdout
    assert "vtuber" in result.stdout
    assert "business" in result.stdout
    assert "default" in result.stdout


def test_config_has_character_presets():
    """設定ファイルにcharacter_presetsが定義されていること"""
    config = load_config()
    assert "character_presets" in config
    presets = config["character_presets"]
    assert "default" in presets
    assert "idol" in presets
    assert "vtuber" in presets
    assert "business" in presets
    for name, data in presets.items():
        assert "prompt" in data, f"Missing prompt in preset: {name}"
        assert "description" in data, f"Missing description in preset: {name}"


def test_config_has_mode_by_pattern():
    """設定ファイルにmode_by_patternが定義されていること"""
    config = load_config()
    defaults = config.get("defaults", {})
    assert "mode_by_pattern" in defaults
    mode_by_pattern = defaults["mode_by_pattern"]
    assert mode_by_pattern.get("thumbnail") == "anime-wow"
    assert mode_by_pattern.get("illustration") == "graphrec"


if __name__ == "__main__":
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    failed = 0

    for test_fn in tests:
        try:
            test_fn()
            passed += 1
            print(f"  PASS: {test_fn.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL: {test_fn.__name__}: {e}")
            traceback.print_exc()

    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    if failed > 0:
        sys.exit(1)
