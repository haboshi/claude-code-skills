"""
template_engine.py のユニットテスト
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from template_engine import process_template, parse_user_input, build_prompt, _MAX_TEMPLATE_DEPTH


def test_variable_expansion():
    """基本的な変数展開"""
    assert process_template("Hello {{name}}!", {"name": "World"}) == "Hello World!"


def test_variable_missing():
    """未定義変数は空文字に展開"""
    assert process_template("Hello {{name}}!", {}) == "Hello !"


def test_multiple_variables():
    """複数変数の展開"""
    result = process_template("{{a}} and {{b}}", {"a": "X", "b": "Y"})
    assert result == "X and Y"


def test_same_variable_multiple():
    """同一変数が複数箇所に出現"""
    result = process_template("{{x}} + {{x}}", {"x": "1"})
    assert result == "1 + 1"


def test_truthy_section_present():
    """真性セクション: 値が存在する場合は展開"""
    result = process_template("{{#show}}Visible{{/show}}", {"show": True})
    assert result == "Visible"


def test_truthy_section_absent():
    """真性セクション: 値が存在しない場合は非表示"""
    result = process_template("{{#show}}Visible{{/show}}", {})
    assert result == ""


def test_truthy_section_falsy_value():
    """真性セクション: falsy値の場合は非表示"""
    assert process_template("{{#show}}Visible{{/show}}", {"show": ""}) == ""
    assert process_template("{{#show}}Visible{{/show}}", {"show": 0}) == ""
    assert process_template("{{#show}}Visible{{/show}}", {"show": None}) == ""
    assert process_template("{{#show}}Visible{{/show}}", {"show": False}) == ""


def test_inverse_section_absent():
    """偽性セクション: 値が存在しない場合は展開"""
    result = process_template("{{^show}}Fallback{{/show}}", {})
    assert result == "Fallback"


def test_inverse_section_present():
    """偽性セクション: 値が存在する場合は非表示"""
    result = process_template("{{^show}}Fallback{{/show}}", {"show": True})
    assert result == ""


def test_section_with_variables():
    """セクション内の変数展開"""
    template = "{{#subtitle}}Sub: {{subtitle}}{{/subtitle}}"
    result = process_template(template, {"subtitle": "Hello"})
    assert result == "Sub: Hello"


def test_section_multiline():
    """複数行にまたがるセクション"""
    template = "Start\n{{#show}}\nLine 1\nLine 2\n{{/show}}\nEnd"
    result = process_template(template, {"show": True})
    assert "Line 1" in result
    assert "Line 2" in result


def test_nested_different_keys():
    """異なるキーのネストされたセクション"""
    template = "{{#a}}A{{#b}}B{{/b}}{{/a}}"
    result = process_template(template, {"a": True, "b": True})
    assert result == "AB"


def test_nested_outer_false():
    """外側が偽の場合、内側も非表示"""
    template = "{{#a}}A{{#b}}B{{/b}}{{/a}}"
    result = process_template(template, {"a": False, "b": True})
    assert result == ""


def test_mixed_sections():
    """真性・偽性セクションの混在"""
    template = "{{#a}}Yes{{/a}}{{^a}}No{{/a}}"
    assert process_template(template, {"a": True}) == "Yes"
    assert process_template(template, {}) == "No"


def test_empty_template():
    """空テンプレート"""
    assert process_template("", {}) == ""


def test_no_template_syntax():
    """テンプレート構文なしのプレーンテキスト"""
    assert process_template("plain text", {}) == "plain text"


def test_depth_limit():
    """再帰深度制限"""
    # process_template 自体に直接深い再帰を発生させるには
    # セクション内にさらにセクションがある構造が必要
    try:
        # _depth パラメータを直接テスト
        process_template("test", {}, _depth=_MAX_TEMPLATE_DEPTH + 1)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "maximum depth" in str(e)


# --- parse_user_input テスト ---

def test_parse_json_input():
    """JSON入力のパース"""
    result = parse_user_input('{"title": "Test", "subtitle": "Sub"}')
    assert result == {"title": "Test", "subtitle": "Sub"}


def test_parse_json_with_whitespace():
    """前後に空白があるJSON入力"""
    result = parse_user_input('  {"title": "Test"}  ')
    assert result == {"title": "Test"}


def test_parse_plain_text():
    """プレーンテキスト入力"""
    result = parse_user_input("Hello World")
    assert result == {"content": "Hello World", "title": "Hello World"}


def test_parse_invalid_json():
    """不正なJSON（{ で始まるが有効なJSONでない）"""
    result = parse_user_input("{invalid json")
    assert result == {"content": "{invalid json", "title": "{invalid json"}


def test_parse_json_array():
    """JSON配列はテキスト扱い（dictでないため）"""
    result = parse_user_input('["a", "b"]')
    assert result["content"] == '["a", "b"]'


def test_parse_empty_string():
    """空文字列"""
    result = parse_user_input("")
    assert result == {"content": "", "title": ""}


def test_parse_japanese_text():
    """日本語テキスト"""
    result = parse_user_input("AI駆動開発の3つの原則")
    assert result["title"] == "AI駆動開発の3つの原則"


# --- build_prompt テスト ---

def test_build_prompt_with_json():
    """JSON入力からプロンプト構築"""
    template = "Title: {{title}}"
    result = build_prompt(template, '{"title": "Hello"}')
    assert result == "Title: Hello"


def test_build_prompt_with_text():
    """テキスト入力からプロンプト構築"""
    template = "Content: {{content}}"
    result = build_prompt(template, "Hello World")
    assert result == "Content: Hello World"


def test_build_prompt_with_sections():
    """セクション付きテンプレートとJSON入力"""
    template = "Title: {{title}}{{#subtitle}}, Sub: {{subtitle}}{{/subtitle}}"
    result = build_prompt(template, '{"title": "Hello", "subtitle": "World"}')
    assert result == "Title: Hello, Sub: World"


def test_build_prompt_without_optional():
    """オプショナルセクションが未指定の場合"""
    template = "Title: {{title}}{{#subtitle}}, Sub: {{subtitle}}{{/subtitle}}"
    result = build_prompt(template, '{"title": "Hello"}')
    assert result == "Title: Hello"


# --- 実テンプレート統合テスト ---

def test_anime_wow_template_integration():
    """anime-wow テンプレートの実テンプレートでの動作確認"""
    import json

    config_path = Path(__file__).parent.parent / "config" / "rich_patterns.json"
    with open(config_path) as f:
        config = json.load(f)

    template = config["patterns"]["thumbnail"]["modes"]["anime-wow"]["template"]

    # JSON入力
    result = build_prompt(template, '{"title": "Claude Code完全攻略"}')
    assert "Claude Code完全攻略" in result
    assert "アニメ" in result

    # subtitle付き
    result = build_prompt(template, '{"title": "Test", "subtitle": "Sub"}')
    assert "Test" in result
    assert "Sub" in result


def test_graphrec_template_integration():
    """graphrec テンプレートの実テンプレートでの動作確認"""
    import json

    config_path = Path(__file__).parent.parent / "config" / "rich_patterns.json"
    with open(config_path) as f:
        config = json.load(f)

    template = config["patterns"]["illustration"]["modes"]["graphrec"]["template"]

    result = build_prompt(template, '{"content": "AI駆動開発の3つの原則"}')
    assert "AI駆動開発の3つの原則" in result
    assert "グラフィック" in result


def test_custom_template_passthrough():
    """custom モードはプロンプト内容をcontentとして展開する"""
    import json

    config_path = Path(__file__).parent.parent / "config" / "rich_patterns.json"
    with open(config_path) as f:
        config = json.load(f)

    template = config["patterns"]["illustration"]["modes"]["custom"]["template"]
    result = build_prompt(template, '{"content": "My custom prompt here"}')
    assert "My custom prompt here" in result


def test_all_templates_expandable():
    """全テンプレートがエラーなく展開できることを確認"""
    import json

    config_path = Path(__file__).parent.parent / "config" / "rich_patterns.json"
    with open(config_path) as f:
        config = json.load(f)

    sample_data = '{"title": "テスト", "content": "テスト内容", "subtitle": "サブ"}'

    for pat_name, pat_data in config["patterns"].items():
        for mode_name, mode_data in pat_data["modes"].items():
            template = mode_data["template"]
            result = build_prompt(template, sample_data)
            assert isinstance(result, str), f"Failed: {pat_name}/{mode_name}"
            assert len(result) > 0, f"Empty result: {pat_name}/{mode_name}"
            # テンプレート変数が残っていないことを確認
            assert "{{" not in result, f"Unexpanded variable in {pat_name}/{mode_name}: {result[:100]}"


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
