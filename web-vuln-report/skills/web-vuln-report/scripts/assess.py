#!/usr/bin/env python3
"""
assess.py - 脆弱性診断オーケストレータ（Phase 0-4 を統括）

認可ゲート（Phase 0）を強制したうえで、巡回 → 非破壊チェック → 外部ツール併用 →
CVSS 採点 → HTML 生成 → PDF 変換を一貫実行し、中間 JSON を out-dir に残す。
各フェーズは個別スクリプトとしても再実行できる（本ファイルはそれらを import して呼ぶ）。

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run --with httpx --with beautifulsoup4 --with jinja2 --with cvss --with weasyprint \
        assess.py --target https://example.com \
        --authorized-by "運用部 書面認可 #2026-07" \
        --out-dir ./out --max-pages 40 --rate 2

安全境界: --authorized-by は必須（空なら実行拒否）。診断は同一オリジン・非破壊。
data 改変 / DoS / 破壊的操作 / 検出回避 / マスターゲティングは行わない。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import crawl as crawl_mod       # noqa: E402
import checks as checks_mod     # noqa: E402
import scoring as scoring_mod   # noqa: E402
import external_tools           # noqa: E402
import render_report            # noqa: E402
from catalog import get_check   # noqa: E402
from dataclasses import asdict  # noqa: E402

# 外部ツール由来所見を統一スキーマへ正規化する際の代表 CVSS 4.0 ベクタ（重大度帯）と
# 事前計算スコア（cvss ライブラリで検証済み。ランタイムでライブラリ不要にするため同梱）。
REPRESENTATIVE_VECTORS = {
    "Critical": ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:N", 9.9),
    "High":     ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N", 8.7),
    "Medium":   ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N", 6.9),
    "Low":      ("CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N", 2.1),
}


def _normalize_external(ext_findings: list[dict], start_seq: int) -> list[dict]:
    """外部ツールの所見を checks と同じスキーマに合わせる。Info 相当はノイズ低減のため除外。"""
    meta = get_check("external-tool-finding")
    out = []
    seq = start_seq
    for fi in ext_findings:
        sev = fi.get("severity_hint", "Info")
        if sev == "Info":
            continue
        seq += 1
        vector, score = REPRESENTATIVE_VECTORS.get(sev, REPRESENTATIVE_VECTORS["Medium"])
        out.append({
            "id": f"VWR-{seq:03d}",
            "check_id": "external-tool-finding",
            "title": fi.get("title", meta["title"]),
            "owasp": meta["owasp"],
            "cwe": fi.get("cwe", meta["cwe"]),
            "wstg": meta.get("wstg"),
            "asvs": meta.get("asvs"),
            "cvss_vector": vector,
            "cvss_score": score,
            "confidence": "Medium",
            "affected": fi.get("affected", []),
            "evidence": fi.get("evidence", ""),
            "description": meta["description"],
            "impact": meta["impact"],
            "remediation": meta["remediation"],
            "references": fi.get("references", []),
            "source": fi.get("source", "external"),
        })
    return out


def run(args) -> int:
    if not args.authorized_by or not args.authorized_by.strip():
        print("[assess] Phase 0 認可ゲート: --authorized-by が空です。診断を中止します。\n"
              "         対象の所有/認可を確認し、根拠（部署・書面番号等）を渡してください。",
              file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Phase 1: 巡回
    print(f"[assess] Phase 1 巡回: {args.target}")
    crawl_result = crawl_mod.crawl(
        target=args.target, authorized_by=args.authorized_by,
        max_pages=args.max_pages, max_depth=args.max_depth, rate=args.rate,
        timeout=args.timeout, respect_robots=not args.ignore_robots,
        extra_hosts=args.extra_host,
    )
    crawl_dict = asdict(crawl_result)
    (out_dir / "crawl.json").write_text(
        json.dumps(crawl_dict, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"         {len(crawl_dict['pages'])} ページ / {len(crawl_dict['forms'])} フォーム")

    # Phase 2: 非破壊チェック
    print("[assess] Phase 2 チェック")
    if args.active_auth and not args.authorized_active.strip():
        print("[assess] --active-auth が指定されましたが --authorized-active（書面認可）が空です。"
              "能動認証テストは実行しません（非破壊のまま続行）。", file=sys.stderr)
    ledger = checks_mod.Ledger()
    findings = checks_mod.run_checks(
        crawl_dict, timeout=args.timeout, active=not args.passive_only, ledger=ledger,
        active_auth=args.active_auth, active_auth_url=args.login_url,
        active_auth_authorized=args.authorized_active, max_login_attempts=args.max_login_attempts)

    # Phase 2b: 外部ツール併用（任意）
    tools_used: list[str] = []
    if not args.no_external:
        print("[assess] Phase 2b 外部ツール検出")
        ext = external_tools.collect(args.target, timeout=args.external_timeout)
        tools_used = ext.get("tools_used", [])
        findings.extend(_normalize_external(ext.get("findings", []), start_seq=len(findings)))
        (out_dir / "ext_findings.json").write_text(
            json.dumps(ext, ensure_ascii=False, indent=2), encoding="utf-8")

    findings_doc = {
        "target": args.target, "scope": crawl_dict["scope"], "findings": findings,
        "coverage": ledger.rows(), "coverage_summary": ledger.summary(),
        "assessment": ledger.assessment,  # G1: 採点ゲート用の信頼性メタ
    }
    (out_dir / "findings.json").write_text(
        json.dumps(findings_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"         所見 {len(findings)} 件")

    # Phase 3: 採点
    print("[assess] Phase 3 CVSS 採点")
    scored = scoring_mod.score_all(findings_doc)
    scored["pages"] = crawl_dict["pages"]
    (out_dir / "scored.json").write_text(
        json.dumps(scored, ensure_ascii=False, indent=2), encoding="utf-8")
    s = scored["summary"]
    print(f"         セキュリティグレード {s['grade']}（{s['grade_rating']}）/ スコア {s['security_score']}/100")

    # Phase 4a: HTML
    narrative = {}
    if args.narrative and Path(args.narrative).exists():
        narrative = json.loads(Path(args.narrative).read_text(encoding="utf-8"))
    html = render_report.render(scored, narrative=narrative, assessor=args.assessor,
                                tools_used=tools_used)
    html_path = out_dir / "report.html"
    html_path.write_text(html, encoding="utf-8")
    print(f"[assess] Phase 4a HTML: {html_path}")

    # Phase 4b: PDF（ベストエフォート）
    if not args.skip_pdf:
        try:
            import report_to_pdf
            pdf_path = out_dir / "report.pdf"
            report_to_pdf.html_to_pdf(str(html_path), str(pdf_path))
            print(f"[assess] Phase 4b PDF: {pdf_path}")
        except Exception as e:
            print(f"[assess] Phase 4b PDF はスキップ（HTML は有効）: {e}", file=sys.stderr)

    print(f"\n[assess] 完了。成果物: {out_dir}/report.html（および report.pdf）")
    print("[assess] 次の一手: Claude が scored.json を読み、エグゼクティブ総括と改善"
          "ロードマップ（narrative.json）を加筆して HTML を再生成することを推奨。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="脆弱性診断オーケストレータ（認可必須・非破壊）")
    ap.add_argument("--target", required=True, help="診断対象の起点 URL")
    ap.add_argument("--authorized-by", required=True,
                    help="認可の根拠（部署/書面番号等）。空なら実行拒否。")
    ap.add_argument("--out-dir", default="./vuln-out")
    ap.add_argument("--assessor", default="", help="実施者名（任意）")
    ap.add_argument("--narrative", help="narrative.json（Claude 加筆のエグゼクティブ総括等）")
    ap.add_argument("--max-pages", type=int, default=50)
    ap.add_argument("--max-depth", type=int, default=3)
    ap.add_argument("--rate", type=float, default=2.0)
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument("--external-timeout", type=int, default=600)
    ap.add_argument("--ignore-robots", action="store_true")
    ap.add_argument("--extra-host", action="append", default=[])
    ap.add_argument("--passive-only", action="store_true", help="能動プローブを無効化")
    # Phase 3 能動認証テスト（既定 OFF・非破壊・login への POST 限定）。--authorized-active が
    # 空なら能動認証は実行されない（二重ゲート）。--login-url でエンドポイントを明示する。
    ap.add_argument("--active-auth", action="store_true",
                    help="能動認証テストを有効化（既定 OFF・破壊なし・login への POST 限定）")
    ap.add_argument("--authorized-active", default="",
                    help="能動認証テストの書面認可（空なら能動認証は実行しない）")
    ap.add_argument("--login-url", default=None, help="能動認証テストの対象 login エンドポイント")
    ap.add_argument("--max-login-attempts", type=int, default=8,
                    help="ログインレート制限テストの試行上限（ハードキャップ 8 にクランプ）")
    ap.add_argument("--no-external", action="store_true", help="外部ツール併用を無効化")
    ap.add_argument("--skip-pdf", action="store_true", help="PDF 化を行わない")
    return ap


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
