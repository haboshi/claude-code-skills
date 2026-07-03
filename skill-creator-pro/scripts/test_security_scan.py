#!/usr/bin/env python3
"""
security_scan.py の正規表現検出部分に対するユニットテスト。

gitleaks 不在環境でも通るよう、gitleaks 呼び出しに依存しない純粋な
正規表現・分類ロジック（scan_file_patterns / scan_skill_patterns /
categorize_gitleaks_severity / calculate_skill_hash）のみを対象とする。

実行:
    uv run --with pytest pytest skill-creator-pro/scripts/ -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from security_scan import (  # noqa: E402
    scan_file_patterns,
    scan_skill_patterns,
    categorize_gitleaks_severity,
    calculate_skill_hash,
    get_pattern_rules,
)


def _write(tmp_path: Path, name: str, content: str) -> Path:
    file_path = tmp_path / name
    file_path.write_text(content, encoding="utf-8")
    return file_path


# ---------------------------------------------------------------------------
# 絶対パス（ユーザディレクトリ）検出
# ---------------------------------------------------------------------------

def test_detects_unix_home_path(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.py", "path = '/home/alice/secret/data'\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert any(i.category == "paths" for i in issues)
    assert any(i.severity == "HIGH" for i in issues if i.category == "paths")


def test_detects_macos_users_path(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.md", "配置場所: /Users/bob/Downloads/file.pdf\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert any(i.category == "paths" for i in issues)


def test_relative_path_not_flagged(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.py", "path = 'scripts/example.py'\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert not any(i.category == "paths" for i in issues)


# ---------------------------------------------------------------------------
# メールアドレス検出と例外
# ---------------------------------------------------------------------------

def test_detects_real_email(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.md", "問い合わせ: person@company.co.jp まで\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert any(i.category == "emails" for i in issues)


def test_example_email_is_excepted(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.md", "例: user@example.com を使う\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert not any(i.category == "emails" for i in issues)


def test_noreply_anthropic_is_excepted(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.md", "Co-Authored-By: noreply@anthropic.com\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert not any(i.category == "emails" for i in issues)


# ---------------------------------------------------------------------------
# 危険なコードパターン検出
# ---------------------------------------------------------------------------

def test_detects_os_system(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "sample.py", "import os\nos.system('ls')\n")
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert any(i.category == "code_patterns" for i in issues)


def test_detects_shell_true(tmp_path: Path) -> None:
    file_path = _write(
        tmp_path, "sample.py", "subprocess.run('ls', shell=True)\n"
    )
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert any(i.category == "code_patterns" for i in issues)


def test_clean_file_has_no_issues(tmp_path: Path) -> None:
    file_path = _write(
        tmp_path,
        "sample.py",
        "def add(a, b):\n    return a + b\n",
    )
    issues = scan_file_patterns(file_path, get_pattern_rules())
    assert issues == []


# ---------------------------------------------------------------------------
# ディレクトリ全体スキャンと統計
# ---------------------------------------------------------------------------

def test_scan_skill_patterns_aggregates_stats(tmp_path: Path) -> None:
    _write(tmp_path, "a.py", "os.system('x')\n")            # HIGH
    _write(tmp_path, "b.md", "mail: person@company.co.jp\n")  # MEDIUM
    issues, stats = scan_skill_patterns(tmp_path)
    assert stats["HIGH"] >= 1
    assert stats["MEDIUM"] >= 1
    assert len(issues) == stats["HIGH"] + stats["MEDIUM"] + stats["CRITICAL"]


def test_scan_skips_hidden_and_pycache(tmp_path: Path) -> None:
    hidden = tmp_path / ".hidden"
    hidden.mkdir()
    (hidden / "leak.py").write_text("os.system('x')\n", encoding="utf-8")
    pycache = tmp_path / "__pycache__"
    pycache.mkdir()
    (pycache / "leak.py").write_text("os.system('x')\n", encoding="utf-8")
    issues, stats = scan_skill_patterns(tmp_path)
    assert issues == []
    assert sum(stats.values()) == 0


# ---------------------------------------------------------------------------
# gitleaks 深刻度分類（文字列ベース、gitleaks 実行不要）
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "rule_id",
    ["aws-api-key", "generic-token", "stripe-secret", "db-password", "user-credential"],
)
def test_secret_like_rules_are_critical(rule_id: str) -> None:
    assert categorize_gitleaks_severity(rule_id) == "CRITICAL"


def test_non_secret_rule_is_high(rule_id: str = "some-generic-rule") -> None:
    assert categorize_gitleaks_severity(rule_id) == "HIGH"


# ---------------------------------------------------------------------------
# 内容ハッシュの決定性
# ---------------------------------------------------------------------------

def test_hash_is_deterministic(tmp_path: Path) -> None:
    _write(tmp_path, "a.py", "print('hi')\n")
    _write(tmp_path, "b.md", "# doc\n")
    assert calculate_skill_hash(tmp_path) == calculate_skill_hash(tmp_path)


def test_hash_changes_on_content_change(tmp_path: Path) -> None:
    file_path = _write(tmp_path, "a.py", "print('hi')\n")
    before = calculate_skill_hash(tmp_path)
    file_path.write_text("print('bye')\n", encoding="utf-8")
    assert calculate_skill_hash(tmp_path) != before


def test_hash_ignores_marker_file(tmp_path: Path) -> None:
    _write(tmp_path, "a.py", "print('hi')\n")
    before = calculate_skill_hash(tmp_path)
    (tmp_path / ".security-scan-passed").write_text("marker\n", encoding="utf-8")
    assert calculate_skill_hash(tmp_path) == before


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
