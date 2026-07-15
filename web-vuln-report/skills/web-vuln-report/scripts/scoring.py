#!/usr/bin/env python3
"""
scoring.py - CVSS 採点と集計（Phase 3）

各所見について CVSS 4.0 基本値（CVSS-B）から重大度（Critical/High/Medium/Low/Info）を
付与し、セキュリティグレード（A＝安全）・OWASP カバレッジを集計して scored.json を生成する。

CVSS 4.0 は 270 macrovector のルックアップ表で算出され算術式が無いため、`cvss` PyPI
ライブラリ（`CVSS4`）に委譲する。各所見はカタログの**事前計算スコア `cvss_score`** を
持つため、ランタイムでは通常ライブラリ不在でも採点できる（外部ツール所見など事前計算値の
無いものだけライブラリで算出。ライブラリも事前計算値も無い場合は黙って Medium にせず
「未算出」を明示する）。CVSS 3.1 とはスコアが非互換（4.0 は低〜中影響を高めに出す傾向）。

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run --with cvss scoring.py --findings findings.json --out scored.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

# cvss ライブラリがあれば使う。CVSS 4.0 は算術式が無いため内蔵フォールバックは持たない。
try:
    from cvss import CVSS4
    _HAS_CVSS_LIB = True
except ImportError:
    _HAS_CVSS_LIB = False


def compute_cvss(vector: str):
    """CVSS 4.0 基本値を返す。ライブラリがあれば算出、無ければ None（未算出）。"""
    if not _HAS_CVSS_LIB or not vector:
        return None
    try:
        return float(CVSS4(vector).base_score)
    except Exception:
        return None


# CVSS 4.0 の定性重大度しきい値（3.1 と同一）
SEVERITY_ORDER = ["Critical", "High", "Medium", "Low", "Info"]
SEVERITY_JA = {"Critical": "緊急", "High": "重要", "Medium": "警告", "Low": "注意", "Info": "情報"}

# ===== セキュリティグレード（A＝安全） =====
# ベストプラクティス（SSL Labs / Mozilla Observatory）に倣い、満点 100 からの減点式スコアと
# 「最も重い所見による上限（キャップ）」を組み合わせて決定する。方向は一貫して「A/高いほど安全」。
GRADE_BANDS = [(95, "A+"), (90, "A"), (85, "A-"), (80, "B+"), (75, "B"), (70, "B-"),
               (65, "C+"), (60, "C"), (55, "C-"), (50, "D+"), (45, "D"), (40, "D-"), (0, "F")]
GRADE_ORDER = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"]
# 所見1件あたりの減点（重大度別）× 確度係数
SEV_DEDUCTION = {"Critical": 45, "High": 25, "Medium": 8, "Low": 2.5, "Info": 0}
CONF_FACTOR = {"High": 1.0, "Medium": 0.7, "Low": 0.5}
# 最も重い所見の重大度による上限グレード（これより上には行かない）
WORST_CAP = {"Critical": "D", "High": "C", "Medium": "B", "Low": "A-", "Info": "A+"}
GRADE_RATING = {"A": "優良", "B": "良好", "C": "要改善", "D": "要注意", "F": "危険"}
# 評価語（GRADE_RATING）を繰り返さず、重大度ラベル語（緊急/重要/警告/注意）も避ける。
# 「緊急」等はデータ（Critical 件数）と矛盾しうるため、緊急度は一般語で表す。
GRADE_MEANING = {
    "A": "重大な問題は検出されず、良好なセキュリティ姿勢を保っています。",
    "B": "深刻な問題はなく、改善余地のある指摘に留まります。",
    "C": "対応が推奨される問題が見つかりました。",
    "D": "看過できない不足があり、優先的な対応が必要です。",
    "F": "早急に対応すべき深刻な問題が確認されました。",
}


def _letter_from_score(score: float) -> str:
    for threshold, letter in GRADE_BANDS:
        if score >= threshold:
            return letter
    return "F"


def _min_grade(a: str, b: str) -> str:
    """2つのグレードの低い方（安全でない方）を返す。"""
    return a if GRADE_ORDER.index(a) <= GRADE_ORDER.index(b) else b


def compute_grade(findings: list[dict], by_sev: dict[str, int]) -> dict:
    deduction = sum(SEV_DEDUCTION.get(f.get("severity", "Info"), 0)
                    * CONF_FACTOR.get(f.get("confidence", "High"), 1.0) for f in findings)
    security_score = max(0, round(100 - deduction))
    base_letter = _letter_from_score(security_score)
    worst = next((s for s in SEVERITY_ORDER if by_sev.get(s, 0) > 0), "Info")
    cap = WORST_CAP.get(worst, "A+")
    grade = _min_grade(base_letter, cap)
    crit = by_sev.get("Critical", 0)
    high = by_sev.get("High", 0)

    # 低評価（D/F）の根拠を明示する。特に Critical/High 不在で累積的に低下した場合、
    # 「単一の緊急・重大な脆弱性がある」との誤読を防ぐ（過大な危険宣言の抑止）。
    if grade[0] in ("D", "F"):
        if crit > 0:
            context = ""
        elif high > 0:
            context = ("緊急（Critical）級の脆弱性は検出されていません。低評価は重要（High）級所見と"
                       "設定不備の累積によるものです。")
        else:
            context = ("緊急・重大な単一の脆弱性は検出されていません。低評価は多数の設定不備"
                       "（Medium／Low）の累積によるものです。")
    elif grade != base_letter:
        context = f"最も重い所見（{SEVERITY_JA.get(worst, '情報')}）の重大度によりグレードの上限を適用しています。"
    else:
        context = ""

    return {
        "security_score": security_score,
        "grade": grade,
        "grade_base": base_letter,
        "grade_capped": grade != base_letter,
        "grade_rating": GRADE_RATING.get(grade[0], "要改善"),
        "grade_meaning": GRADE_MEANING.get(grade[0], ""),
        "grade_context": context,
        "severe_present": (crit + high) > 0,
        "worst_severity": worst,
        "worst_severity_ja": SEVERITY_JA.get(worst, "情報"),
    }


def severity_from_score(score: float) -> str:
    if score >= 9.0:
        return "Critical"
    if score >= 7.0:
        return "High"
    if score >= 4.0:
        return "Medium"
    if score > 0.0:
        return "Low"
    return "Info"


def score_finding(finding: dict) -> dict:
    scored = dict(finding)
    # (1) カタログの事前計算スコアを優先（ランタイムでライブラリ不要）
    score = finding.get("cvss_score")
    # (2) 事前計算値が無ければライブラリで算出（外部ツール所見など）
    if score is None:
        score = compute_cvss(finding.get("cvss_vector", ""))
    if score is None:
        # (3) ライブラリも事前計算値も無い: 黙って Medium にせず「未算出」を明示する
        scored["cvss_score"] = None
        scored["cvss_unscored"] = True
        scored["severity"] = "Info"
    else:
        scored["cvss_score"] = float(score)
        scored["severity"] = severity_from_score(float(score))
    scored["severity_ja"] = SEVERITY_JA[scored["severity"]]
    return scored


_CONF_RANK = {"High": 3, "Medium": 2, "Low": 1}


def merge_findings(findings: list[dict]) -> list[dict]:
    """同一の検出（check_id + title）を1件に集約し、該当箇所を affected に集める。

    ヘッダ欠落等がページ単位で重複計上されるのを防ぎ、プロの報告書標準
    （1課題 + 該当資産の列挙）に合わせる。確度は最も高いものを採用。
    """
    grouped: dict[tuple, dict] = {}
    order: list[tuple] = []
    for f in findings:
        key = (f.get("check_id"), f.get("title"))
        if key not in grouped:
            g = dict(f)
            g["affected"] = list(f.get("affected", []))
            g["_evidence"] = []
            grouped[key] = g
            order.append(key)
        g = grouped[key]
        for a in f.get("affected", []):
            if a not in g["affected"]:
                g["affected"].append(a)
        ev = f.get("evidence", "")
        if ev and ev not in g["_evidence"]:
            g["_evidence"].append(ev)
        if _CONF_RANK.get(f.get("confidence"), 0) > _CONF_RANK.get(g.get("confidence"), 0):
            g["confidence"] = f.get("confidence")

    merged = []
    for key in order:
        g = grouped[key]
        evs = g.pop("_evidence")
        g["evidence"] = evs[0] if evs else g.get("evidence", "")
        n = len(g["affected"])
        if n > 1:
            g["evidence"] += f"\n（該当 {n} 箇所。詳細は「対象」欄を参照）"
        merged.append(g)
    return merged


def aggregate(findings: list[dict]) -> dict:
    by_sev = {s: 0 for s in SEVERITY_ORDER}
    owasp_cov: dict[str, int] = {}
    max_score = 0.0
    weighted = 0.0
    # 件数ボーナスの重み（総合リスクスコアの寄与。深刻度主導のため小さめ）
    weights = {"Critical": 15, "High": 8, "Medium": 3, "Low": 1, "Info": 0}
    for fi in findings:
        sev = fi.get("severity", "Info")
        by_sev[sev] = by_sev.get(sev, 0) + 1
        owasp_cov[fi.get("owasp", "N/A")] = owasp_cov.get(fi.get("owasp", "N/A"), 0) + 1
        max_score = max(max_score, float(fi.get("cvss_score") or 0.0))
        weighted += weights.get(sev, 0)

    # 総合リスクスコア: 0-100。最悪所見の深刻さ（最大 CVSS）を主軸に、件数を上限付きで加味。
    # 最大 CVSS が支配的（*9）で、件数ボーナスは 25 点上限。Critical があればほぼ 100 に達する。
    risk_score = min(100, round(max_score * 9 + min(weighted, 25)))
    if by_sev["Critical"] > 0:
        rating = "非常に高い"
    elif by_sev["High"] > 0:
        rating = "高い"
    elif by_sev["Medium"] > 0:
        rating = "中程度"
    elif by_sev["Low"] > 0:
        rating = "低い"
    else:
        rating = "軽微"

    summary = {
        "total": len(findings),
        "by_severity": by_sev,
        "by_severity_ja": {SEVERITY_JA[k]: v for k, v in by_sev.items()},
        "owasp_coverage": dict(sorted(owasp_cov.items())),
        "max_cvss": max_score,
        # 総合評価はセキュリティグレード（A＝安全）を主軸にする
        "risk_score": risk_score,   # 後方互換のため保持（表示には用いない）
        "risk_rating": rating,
    }
    summary.update(compute_grade(findings, by_sev))
    return summary


def score_all(data: dict) -> dict:
    merged = merge_findings(data.get("findings", []))
    findings = [score_finding(fi) for fi in merged]
    # 重大度→CVSS 降順で並べ替え（報告書の提示順）
    sev_rank = {s: i for i, s in enumerate(SEVERITY_ORDER)}
    findings.sort(key=lambda x: (sev_rank.get(x["severity"], 99), -float(x.get("cvss_score") or 0)))
    # 集約・並べ替え後に ID を振り直す（提示順と一致させる）
    for i, f in enumerate(findings, 1):
        f["id"] = f"VWR-{i:03d}"
    out = dict(data)
    out["findings"] = findings
    out["summary"] = aggregate(findings)
    out["scored_at"] = datetime.now(timezone.utc).isoformat()
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="CVSS 採点と集計")
    ap.add_argument("--findings", required=True, help="findings.json のパス")
    ap.add_argument("--out", default="scored.json")
    args = ap.parse_args(argv)

    with open(args.findings, encoding="utf-8") as fp:
        data = json.load(fp)
    scored = score_all(data)
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(scored, fp, ensure_ascii=False, indent=2)
    s = scored["summary"]
    print(f"[scoring] 総合リスクスコア {s['risk_score']}/100（{s['risk_rating']}）/ "
          f"件数 {s['total']} を {args.out} に保存しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
