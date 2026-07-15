#!/usr/bin/env python3
"""
package_genspark_skill.py - Genspark アップロード用 .skill バンドル生成

スキルフォルダ（SKILL.md + scripts/ + templates/ + references/）を自己完結の
zip アーカイブにまとめ、拡張子 `.skill` で出力する。Genspark の Skills 取り込みは
SKILL.md（name/description 必須）を含む .zip/.skill/.md を受理する（最大 200MB）。

Claude Code プラグインとしての SKILL.md は `${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/`
起点のパスを使うが、可搬バンドルではその接頭辞をバンドル内相対パスへ書き換える。
スクリプトは Path(__file__).parent 起点で同梱ファイルを解決するため位置非依存。

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run package_genspark_skill.py            # 既定でスキルフォルダを .skill 化
    uv run package_genspark_skill.py --skill-dir <dir> --out web-vuln-report.skill
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

SKILL_DIR_DEFAULT = Path(__file__).resolve().parent.parent  # skills/web-vuln-report/
# examples はリポジトリ閲覧用の重いサンプル（PDF 等）なので可搬バンドルからは除外し、
# 実行に必要な scripts/templates/references + SKILL.md に絞る。
EXCLUDE_DIRS = {"__pycache__", "tests", ".pytest_cache", ".omc", "examples"}
EXCLUDE_SUFFIXES = {".pyc", ".pyo"}
# OS/エディタのゴミファイル（バンドルに混入させない）
EXCLUDE_NAMES = {".DS_Store", "Thumbs.db", ".gitignore"}
# Claude Code 用の絶対起点 → バンドル内相対へ
PATH_PREFIX_RE = re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}/skills/web-vuln-report/")


def _validate_skill_md(skill_dir: Path) -> tuple[bool, str]:
    md = skill_dir / "SKILL.md"
    if not md.exists():
        return False, "SKILL.md が見つかりません"
    text = md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return False, "SKILL.md に YAML frontmatter がありません"
    front = text.split("---", 2)[1] if text.count("---") >= 2 else ""
    if "name:" not in front or "description:" not in front:
        return False, "frontmatter に name/description が必要です"
    return True, "ok"


def _rewrite_skill_md(text: str) -> str:
    """可搬バンドル向けにパス接頭辞を相対化する。"""
    return PATH_PREFIX_RE.sub("", text)


def _should_include(path: Path) -> bool:
    if path.name in EXCLUDE_NAMES:
        return False
    if any(part in EXCLUDE_DIRS for part in path.parts):
        return False
    if path.suffix in EXCLUDE_SUFFIXES:
        return False
    return True


def package(skill_dir: Path, out_path: Path) -> Path:
    ok, msg = _validate_skill_md(skill_dir)
    if not ok:
        raise ValueError(f"バンドル検証に失敗: {msg}")

    files = [p for p in skill_dir.rglob("*") if p.is_file() and _should_include(p)]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            arcname = f.relative_to(skill_dir).as_posix()  # SKILL.md をアーカイブ直下に配置
            if arcname == "SKILL.md":
                zf.writestr(arcname, _rewrite_skill_md(f.read_text(encoding="utf-8")))
            else:
                zf.write(f, arcname)
    return out_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Genspark 用 .skill バンドル生成")
    ap.add_argument("--skill-dir", default=str(SKILL_DIR_DEFAULT),
                    help="スキルフォルダ（SKILL.md を含む）")
    ap.add_argument("--out", default="web-vuln-report.skill", help="出力 .skill パス")
    args = ap.parse_args(argv)

    skill_dir = Path(args.skill_dir).resolve()
    out_path = Path(args.out).resolve()
    try:
        result = package(skill_dir, out_path)
    except ValueError as e:
        print(f"[package] {e}", file=sys.stderr)
        return 2
    size_kb = result.stat().st_size / 1024
    print(f"[package] {result} を生成しました（{size_kb:.1f} KB）。"
          f"Genspark の New Skill → Upload から取り込めます。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
