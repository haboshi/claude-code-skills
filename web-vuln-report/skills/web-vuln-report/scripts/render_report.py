#!/usr/bin/env python3
"""
render_report.py - 所見 JSON から自己完結 HTML 報告書を生成（Phase 4a）

scored.json（scoring.py の出力）と、任意の narrative（Claude が加筆する
エグゼクティブ総括・改善ロードマップ）を受け取り、templates/report.html.j2 を
レンダリングして自己完結 HTML（CSS インライン）を出力する。生成 HTML は
ブラウザで直接閲覧でき、report_to_pdf.py で PDF 化もできる。

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run --with jinja2 render_report.py --scored scored.json --out report.html \
        [--narrative narrative.json] [--assessor "AllAmbitious セキュリティ診断"] \
        [--tools nuclei,testssl.sh]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError as e:  # pragma: no cover
    print(f"[render] 依存不足: {e}\n  uv run --with jinja2 render_report.py ... で実行してください。",
          file=sys.stderr)
    raise

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"


def _load_json(path: str | None) -> dict:
    if not path:
        return {}
    with open(path, encoding="utf-8") as fp:
        return json.load(fp)


def _fmt_date(iso: str | None) -> str:
    if not iso:
        return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    try:
        return datetime.fromisoformat(iso).astimezone().strftime("%Y-%m-%d")
    except Exception:
        return iso[:10]


def _fmt_datetime(iso: str | None) -> str:
    """生の ISO タイムスタンプを 'YYYY-MM-DD HH:MM (UTC)' に整形（報告書の品位確保）。"""
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M (UTC)")
    except Exception:
        return iso[:16].replace("T", " ")


def render(scored: dict, narrative: dict | None = None, assessor: str = "",
           tools_used: list[str] | None = None, issued_date: str | None = None) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template("report.html.j2")
    css = (TEMPLATES_DIR / "report.css").read_text(encoding="utf-8")
    scope = scored.get("scope", {})

    return template.render(
        css=css,
        target=scored.get("target", ""),
        scope=scope,
        authorized_by=scope.get("authorized_by", "（要記載）"),
        assessor=assessor,
        assessed_date=_fmt_date(scope.get("started_at")),
        issued_date=issued_date or datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d"),
        assessed_datetime=_fmt_datetime(scope.get("started_at")),
        summary=scored.get("summary", {}),
        findings=scored.get("findings", []),
        pages=scored.get("pages", []),  # assess.py が crawl の pages を合流させる
        narrative=narrative or {},
        tools_used=tools_used or [],
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="所見 JSON → HTML 報告書")
    ap.add_argument("--scored", required=True, help="scored.json のパス")
    ap.add_argument("--out", default="report.html")
    ap.add_argument("--narrative", help="narrative.json（executive/roadmap を含む）")
    ap.add_argument("--assessor", default="", help="実施者名（任意）")
    ap.add_argument("--tools", default="", help="使用した外部ツール（カンマ区切り）")
    ap.add_argument("--pages", help="crawl.json（付録の巡回一覧に使用）")
    args = ap.parse_args(argv)

    scored = _load_json(args.scored)
    if args.pages:
        crawl = _load_json(args.pages)
        scored.setdefault("pages", crawl.get("pages", []))
    narrative = _load_json(args.narrative) if args.narrative else {}
    tools = [t.strip() for t in args.tools.split(",") if t.strip()]

    html = render(scored, narrative=narrative, assessor=args.assessor, tools_used=tools)
    Path(args.out).write_text(html, encoding="utf-8")
    print(f"[render] HTML 報告書を {args.out} に出力しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
