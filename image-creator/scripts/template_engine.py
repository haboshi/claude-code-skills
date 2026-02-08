"""
Mustache風テンプレートエンジン

テンプレート変数の展開、条件セクション、入力パースを提供する。

Copyright (c) 2026 haboshi
Licensed under the MIT License.
"""

import json
import re
import sys


_MAX_TEMPLATE_DEPTH = 10


def process_template(template: str, data: dict, _depth: int = 0) -> str:
    """
    Mustache風テンプレートを展開する。

    対応構文:
      - {{var}} — 変数展開
      - {{#var}}...{{/var}} — 真性セクション（値が存在し truthy なら展開）
      - {{^var}}...{{/var}} — 偽性セクション（値が存在しないか falsy なら展開）

    Args:
        template: テンプレート文字列
        data: 展開用データ辞書
        _depth: 再帰深度（内部用）

    Returns:
        展開後の文字列
    """
    if _depth > _MAX_TEMPLATE_DEPTH:
        raise ValueError(f"Template nesting exceeds maximum depth ({_MAX_TEMPLATE_DEPTH})")

    result = template

    # 真性セクション {{#var}}...{{/var}}
    section_pattern = re.compile(
        r'\{\{#(\w+)\}\}(.*?)\{\{/\1\}\}',
        re.DOTALL
    )

    def replace_section(match):
        key = match.group(1)
        content = match.group(2)
        value = data.get(key)
        if value:
            return process_template(content, data, _depth + 1)
        return ""

    while section_pattern.search(result):
        result = section_pattern.sub(replace_section, result)

    # 偽性セクション {{^var}}...{{/var}}
    inverse_pattern = re.compile(
        r'\{\{\^(\w+)\}\}(.*?)\{\{/\1\}\}',
        re.DOTALL
    )

    def replace_inverse(match):
        key = match.group(1)
        content = match.group(2)
        value = data.get(key)
        if not value:
            return process_template(content, data, _depth + 1)
        return ""

    while inverse_pattern.search(result):
        result = inverse_pattern.sub(replace_inverse, result)

    # 変数展開 {{var}}
    def replace_var(match):
        key = match.group(1)
        return str(data.get(key, ""))

    result = re.sub(r'\{\{(\w+)\}\}', replace_var, result)

    return result


def parse_user_input(input_str: str) -> dict:
    """
    ユーザー入力をパースして辞書に変換する。

    - JSON文字列の場合はパースして返す
    - プレーンテキストの場合は {"content": text, "title": text} として返す

    Args:
        input_str: ユーザー入力文字列

    Returns:
        データ辞書
    """
    stripped = input_str.strip()

    if stripped.startswith("{"):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    return {"content": stripped, "title": stripped}


def build_prompt(template: str, user_input: str) -> str:
    """
    テンプレートとユーザー入力から最終プロンプトを構築する。

    Args:
        template: テンプレート文字列
        user_input: ユーザー入力（JSONまたはプレーンテキスト）

    Returns:
        展開済みプロンプト文字列
    """
    data = parse_user_input(user_input)
    return process_template(template, data)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: template_engine.py <template_string> <input_json_or_text>")
        sys.exit(1)

    template_str = sys.argv[1]
    input_str = sys.argv[2]
    print(build_prompt(template_str, input_str))
