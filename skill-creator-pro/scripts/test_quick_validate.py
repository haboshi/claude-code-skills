#!/usr/bin/env python3
"""
quick_validate.py のユニットテスト。

外部依存なし（純粋な frontmatter / 命名 / パス参照の検証ロジック）。

実行:
    uv run --with pytest pytest skill-creator-pro/scripts/ -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from quick_validate import (  # noqa: E402
    validate_skill,
    find_invalid_frontmatter_indentation,
    find_path_references,
)


VALID_FRONTMATTER = (
    "---\n"
    "name: my-skill\n"
    'description: "何かを配布する。パッケージ化・配布したいときに使う。"\n'
    "---\n\n"
    "# My Skill\n\n"
    "本文。\n"
)


def _make_skill(tmp_path: Path, body: str) -> Path:
    (tmp_path / "SKILL.md").write_text(body, encoding="utf-8")
    return tmp_path


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------

def test_valid_skill(tmp_path: Path) -> None:
    skill = _make_skill(tmp_path, VALID_FRONTMATTER)
    valid, message = validate_skill(skill)
    assert valid is True
    assert "valid" in message.lower()


# ---------------------------------------------------------------------------
# frontmatter の欠落・不正
# ---------------------------------------------------------------------------

def test_missing_skill_md(tmp_path: Path) -> None:
    valid, message = validate_skill(tmp_path)
    assert valid is False
    assert "SKILL.md" in message


def test_no_frontmatter(tmp_path: Path) -> None:
    skill = _make_skill(tmp_path, "# No frontmatter\n")
    valid, message = validate_skill(skill)
    assert valid is False


def test_missing_name(tmp_path: Path) -> None:
    body = "---\ndescription: 説明のみ。\n---\n\n# X\n"
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is False
    assert "name" in message


def test_missing_description(tmp_path: Path) -> None:
    body = "---\nname: my-skill\n---\n\n# X\n"
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is False
    assert "description" in message


# ---------------------------------------------------------------------------
# 命名規約
# ---------------------------------------------------------------------------

def test_invalid_name_uppercase(tmp_path: Path) -> None:
    body = VALID_FRONTMATTER.replace("name: my-skill", "name: MySkill")
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is False
    assert "hyphen-case" in message


def test_invalid_name_consecutive_hyphens(tmp_path: Path) -> None:
    body = VALID_FRONTMATTER.replace("name: my-skill", "name: my--skill")
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is False


# ---------------------------------------------------------------------------
# description の山括弧禁止
# ---------------------------------------------------------------------------

def test_description_with_angle_brackets(tmp_path: Path) -> None:
    body = (
        "---\n"
        "name: my-skill\n"
        "description: use <skill-name> here\n"
        "---\n\n# X\n"
    )
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is False
    assert "angle brackets" in message


# ---------------------------------------------------------------------------
# パス参照の実在チェック
# ---------------------------------------------------------------------------

def test_missing_referenced_path(tmp_path: Path) -> None:
    body = VALID_FRONTMATTER + "\n実行: scripts/does_not_exist.py\n"
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is False
    assert "scripts/does_not_exist.py" in message


def test_existing_referenced_path(tmp_path: Path) -> None:
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "run.py").write_text("print('ok')\n", encoding="utf-8")
    body = VALID_FRONTMATTER + "\n実行: scripts/run.py\n"
    skill = _make_skill(tmp_path, body)
    valid, message = validate_skill(skill)
    assert valid is True


# ---------------------------------------------------------------------------
# ヘルパ関数の単体挙動
# ---------------------------------------------------------------------------

def test_find_invalid_indentation_detects_tab() -> None:
    frontmatter = "name: x\n\tdescription: y"
    issues = find_invalid_frontmatter_indentation(frontmatter)
    assert issues
    assert issues[0][1] == "\t"


def test_find_invalid_indentation_accepts_spaces() -> None:
    frontmatter = "name: x\n  description: y"
    assert find_invalid_frontmatter_indentation(frontmatter) == []


def test_find_path_references_skips_example_lines() -> None:
    content = "Example: scripts/example_thing.py\n実行: references/real_guide.md\n"
    refs = find_path_references(content)
    assert "references/real_guide.md" in refs
    assert "scripts/example_thing.py" not in refs


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
