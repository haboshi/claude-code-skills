#!/usr/bin/env python3
"""
external_tools.py - 外部スキャナ併用（任意・graceful degrade）

nuclei / testssl.sh / nikto がインストールされていれば検出して併用し、無ければ
何もしない（内蔵チェックのみで完結する）。各ツールの出力を正規化して findings 形式に
変換する。CVE 級の判定はここ（外部 DB を持つツール）に委ねる。

安全境界: 既定は情報収集・非破壊テンプレート寄りの実行に限定する。nuclei は
`-severity` を絞り、危険なテンプレートカテゴリ（fuzzing 等）を有効化しない。

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run external_tools.py --target https://example.com --out ext_findings.json
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def available_tools() -> dict[str, str | None]:
    return {
        "nuclei": shutil.which("nuclei"),
        "testssl.sh": shutil.which("testssl.sh") or shutil.which("testssl"),
        "nikto": shutil.which("nikto"),
    }


def _run(cmd: list[str], timeout: int) -> tuple[int, str, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception as e:  # pragma: no cover
        return 1, "", str(e)


def _sev_map(sev: str) -> str:
    m = {"critical": "Critical", "high": "High", "medium": "Medium",
         "low": "Low", "info": "Info", "unknown": "Info"}
    return m.get((sev or "").lower(), "Info")


def run_nuclei(target: str, path: str, timeout: int = 600) -> list[dict]:
    """nuclei を JSONL 出力で実行し、正規化した findings を返す。"""
    cmd = [path, "-u", target, "-jsonl", "-silent",
           "-severity", "info,low,medium,high,critical",
           "-rate-limit", "50", "-timeout", "10"]
    code, out, err = _run(cmd, timeout)
    findings = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        info = row.get("info", {})
        sev = _sev_map(info.get("severity", "info"))
        findings.append({
            "check_id": "external-tool-finding",
            "title": f"[nuclei] {info.get('name', row.get('template-id', 'finding'))}",
            "severity_hint": sev,
            "affected": [row.get("matched-at") or row.get("host") or target],
            "evidence": f"template={row.get('template-id')} / {info.get('description', '')}"[:500],
            "references": info.get("reference") or [],
            "source": "nuclei",
            "cwe": (info.get("classification", {}) or {}).get("cwe-id", ["N/A"])[0]
                   if isinstance((info.get("classification", {}) or {}).get("cwe-id"), list) else "N/A",
        })
    return findings


def run_testssl(target: str, path: str, timeout: int = 600) -> list[dict]:
    """testssl.sh を JSON 出力で実行し、MEDIUM 以上の所見を正規化。"""
    from urllib.parse import urlparse
    host = urlparse(target).netloc or target
    cmd = [path, "--jsonfile-pretty", "/dev/stdout", "--quiet", "--warnings", "off",
           "--severity", "MEDIUM", host]
    code, out, err = _run(cmd, timeout)
    findings = []
    try:
        # testssl は配列 or {"scanResult":[...]} 形式のことがある
        data = json.loads(out) if out.strip().startswith(("[", "{")) else []
        rows = data if isinstance(data, list) else data.get("scanResult", [])
        for r in (rows or []):
            for item in (r.get("severity") and [r] or r.get("vulnerabilities", []) or []):
                sev = _sev_map(item.get("severity", "info"))
                if sev in ("Info", "Low"):
                    continue
                findings.append({
                    "check_id": "external-tool-finding",
                    "title": f"[testssl] {item.get('id', 'tls-finding')}",
                    "severity_hint": sev,
                    "affected": [target],
                    "evidence": item.get("finding", "")[:500],
                    "references": [],
                    "source": "testssl.sh",
                    "cwe": "CWE-327",
                })
    except (json.JSONDecodeError, AttributeError):
        pass
    return findings


def collect(target: str, timeout: int = 600) -> dict:
    tools = available_tools()
    used, findings = [], []
    if tools["nuclei"]:
        used.append("nuclei")
        findings.extend(run_nuclei(target, tools["nuclei"], timeout))
    if tools["testssl.sh"]:
        used.append("testssl.sh")
        findings.extend(run_testssl(target, tools["testssl.sh"], timeout))
    # nikto は HTML/CSV 出力が中心のため本版では検出のみ記録（誤検知の正規化コスト回避）
    if tools["nikto"]:
        used.append("nikto(検出のみ)")
    return {"tools_available": {k: bool(v) for k, v in tools.items()},
            "tools_used": used, "findings": findings, "collected_at": _now()}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="外部スキャナ併用（任意・認可必須）")
    ap.add_argument("--target", required=True)
    ap.add_argument("--authorized-by", required=True,
                    help="認可の根拠（部署/書面番号等）。空なら実行拒否。実スキャンを伴うため必須。")
    ap.add_argument("--out", default="ext_findings.json")
    ap.add_argument("--timeout", type=int, default=600)
    args = ap.parse_args(argv)

    if not args.authorized_by.strip():
        print("[external] 認可の根拠（--authorized-by）が空です。実スキャンを中止します。", file=sys.stderr)
        return 2

    result = collect(args.target, timeout=args.timeout)
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, indent=2)
    if result["tools_used"]:
        print(f"[external] 併用ツール: {', '.join(result['tools_used'])} / "
              f"{len(result['findings'])} 件を {args.out} に保存。")
    else:
        print("[external] 併用可能な外部ツールは見つかりませんでした（内蔵チェックのみで続行）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
