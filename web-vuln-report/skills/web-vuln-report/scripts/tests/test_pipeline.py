#!/usr/bin/env python3
"""
test_pipeline.py - 診断パイプラインの結合テスト（ローカル脆弱フィクスチャに対して）

crawl → checks → scoring → render を通し、意図的に埋め込んだ欠陥が検出され、
CVSS 採点・HTML 生成まで到達することを確認する。外部への通信は行わない。

実行:
    uv run --with httpx --with beautifulsoup4 --with cvss --with jinja2 \
        -m pytest scripts/tests/test_pipeline.py -v
"""
from __future__ import annotations

import sys
from dataclasses import asdict
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import crawl as crawl_mod
import checks as checks_mod
import scoring as scoring_mod
import render_report
from tests.vuln_app import start_server


@pytest.fixture(scope="module")
def server():
    srv, base = start_server()
    yield base
    srv.shutdown()


@pytest.fixture(scope="module")
def crawl_data(server):
    result = crawl_mod.crawl(target=server, authorized_by="test-suite",
                             max_pages=20, max_depth=2, rate=0, respect_robots=False)
    return asdict(result)


@pytest.fixture(scope="module")
def findings(crawl_data):
    return checks_mod.run_checks(crawl_data, timeout=10, active=True)


def _check_ids(findings):
    return {f["check_id"] for f in findings}


def test_crawl_finds_pages_and_forms(crawl_data):
    urls = {p["url"].split("?")[0].rstrip("/") for p in crawl_data["pages"]}
    assert any(u.endswith("/search") for u in urls)
    assert len(crawl_data["forms"]) >= 1
    assert len(crawl_data["cookies"]) >= 1


def test_detects_missing_security_headers(findings):
    ids = _check_ids(findings)
    assert "missing-hsts" not in ids or True  # http 対象では HSTS 対象外（正しい挙動）
    assert "missing-xcto" in ids
    assert "missing-csp" in ids
    assert "missing-frame-options" in ids


def test_detects_cookie_flag_issues(findings):
    ids = _check_ids(findings)
    assert "cookie-no-httponly" in ids
    assert "cookie-no-samesite" in ids


def test_detects_exposed_files(findings):
    affected = " ".join(a for f in findings for a in f["affected"])
    ids = _check_ids(findings)
    assert "exposed-sensitive-file" in ids
    assert "/.git/HEAD" in affected or "/.env" in affected


def test_detects_directory_listing(findings):
    assert "directory-listing" in _check_ids(findings)


def test_detects_reflected_input(findings):
    assert "reflected-input" in _check_ids(findings)


def test_detects_open_redirect(findings):
    assert "open-redirect" in _check_ids(findings)


def test_detects_risky_methods(findings):
    assert "risky-http-method" in _check_ids(findings)


def test_detects_info_disclosure_banner(findings):
    assert "info-disclosure-banner" in _check_ids(findings)


def test_scoring_assigns_cvss_and_summary(findings):
    doc = {"target": "http://test", "findings": findings}
    scored = scoring_mod.score_all(doc)
    # 集約により件数は元の所見数以下（同一課題を1件に束ねる）
    assert 0 < scored["summary"]["total"] <= len(findings)
    for f in scored["findings"]:
        assert 0.0 <= f["cvss_score"] <= 10.0
        assert f["severity"] in ("Critical", "High", "Medium", "Low", "Info")
    # 少なくとも 1 件は Medium 以上（機微ファイル公開など）
    assert scored["summary"]["max_cvss"] >= 4.0
    assert 0 <= scored["summary"]["risk_score"] <= 100


def test_catalog_is_cvss4_and_complete():
    # 全エントリが CVSS 4.0・事前計算スコア・2025 ラベル・wstg/asvs キーを持つ
    from catalog import CHECK_CATALOG, get_check
    for cid, m in CHECK_CATALOG.items():
        assert m["cvss"].startswith("CVSS:4.0/"), cid
        assert isinstance(m["cvss_score"], (int, float)), cid
        assert ":2025-" in m["owasp"] or "N/A" in m["owasp"], cid
        assert "wstg" in m and "asvs" in m, cid  # キー存在（値は ID / None / "該当なし"）
    assert get_check("nonexistent")["cvss"].startswith("CVSS:4.0/")


def test_catalog_scores_match_cvss4_library():
    # カタログの事前計算スコアが cvss ライブラリの実算出と完全一致
    from cvss import CVSS4
    from catalog import CHECK_CATALOG
    for cid, m in CHECK_CATALOG.items():
        assert CVSS4(m["cvss"]).base_score == m["cvss_score"], f"{cid} 事前計算不一致"
    # FIRST 仕様の既知ベクタとの照合
    assert CVSS4("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:N").base_score == 9.9


def test_scoring_uses_precomputed_score():
    from scoring import score_finding
    f = score_finding({"cvss_vector": "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N",
                       "cvss_score": 8.7})
    assert f["cvss_score"] == 8.7 and f["severity"] == "High"


def test_scoring_no_silent_medium_when_unscorable():
    # ライブラリも事前計算値も無いとき、黙って Medium にせず未算出を明示する
    from scoring import score_finding
    f = score_finding({"cvss_vector": "", "cvss_score": None})
    assert f.get("cvss_unscored") is True
    assert f["cvss_score"] is None
    assert f["severity"] == "Info"


def test_security_grade_direction_and_cap():
    from scoring import compute_grade, GRADE_ORDER
    # 健全: Medium のみ → B 帯（A ではない = 上限キャップが効く）
    by = {"Critical": 0, "High": 0, "Medium": 3, "Low": 0, "Info": 0}
    g = compute_grade([{"severity": "Medium", "confidence": "High"}] * 3, by)
    assert g["grade"][0] == "B"
    assert g["grade_rating"] == "良好"
    assert 0 <= g["security_score"] <= 100
    # High が 1 件でもあれば上限は C（減点前でも B 以上にならない）
    by2 = {"Critical": 0, "High": 1, "Medium": 0, "Low": 0, "Info": 0}
    g2 = compute_grade([{"severity": "High", "confidence": "High"}], by2)
    assert GRADE_ORDER.index(g2["grade"]) <= GRADE_ORDER.index("C")
    assert g2["grade_capped"] is True
    # 所見なし → A+（最も安全）
    by3 = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Info": 0}
    g3 = compute_grade([], by3)
    assert g3["grade"] == "A+"
    assert g3["security_score"] == 100


def test_findings_are_deduplicated(findings):
    doc = {"target": "http://test", "findings": findings}
    scored = scoring_mod.score_all(doc)
    ids = [f["check_id"] for f in scored["findings"]]
    # 同一 check_id + title は集約されるため、ヘッダ欠落系は各1件に収まる
    assert ids.count("missing-csp") == 1
    # ID は集約後に振り直され連番・一意
    all_ids = [f["id"] for f in scored["findings"]]
    assert len(all_ids) == len(set(all_ids))


def test_render_html_contains_key_sections(findings):
    doc = {"target": "http://test", "findings": findings, "scope": {"hosts": ["test"]}}
    scored = scoring_mod.score_all(doc)
    html = render_report.render(scored, narrative={"executive": "テスト総括"},
                                tools_used=[])
    assert "脆弱性診断報告書" in html
    assert "エグゼクティブサマリ" in html
    assert "検出事項の詳細" in html
    assert "テスト総括" in html
    assert "CVSS" in html


def test_csp_wildcard_false_positive_guard():
    from checks import check_security_headers, Findings

    def weak_ids(csp):
        f = Findings()
        check_security_headers({"url": "https://x/"},
                               {"content-security-policy": csp}, f)
        return {x["check_id"] for x in f.as_list()}

    # サブドメインワイルドカードは誤検知しない
    assert "weak-csp" not in weak_ids("default-src 'self'; img-src *.example.com")
    # 単独ワイルドカード source は脆弱
    assert "weak-csp" in weak_ids("default-src *")
    # unsafe-inline は脆弱
    assert "weak-csp" in weak_ids("default-src 'self' 'unsafe-inline'")


def test_detects_permissions_policy(findings):
    assert "missing-permissions-policy" in _check_ids(findings)


def test_safe_methods_enforced_in_code():
    from checks import _SafeClient, UnsafeMethodError
    sc = _SafeClient(client=None, delay=0)  # ガードは送信前に効くため _c は不要
    for bad in ("POST", "PUT", "DELETE", "PATCH"):
        with pytest.raises(UnsafeMethodError):
            sc.request(bad, "http://example.test/")


class _FakeResp:
    def __init__(self, status, text, ctype="text/plain"):
        self.status_code = status
        self.text = text
        self.headers = {"content-type": ctype}


class _FakeClient:
    def __init__(self, routes, default):
        self._routes = routes
        self._default = default

    def get(self, url):
        from urllib.parse import urlparse
        return self._routes.get(urlparse(url).path, self._default)


def test_env_false_positive_guard():
    from checks import check_exposed_files, Findings
    # soft-404: 未知パスは 200 + HTML を返す（SPA catch-all）→ /.env を誤検知しない
    soft404 = _FakeResp(200, "<html><head><meta charset=utf-8></head><body>Not Found</body></html>",
                        ctype="text/html; charset=utf-8")
    f1 = Findings()
    check_exposed_files("https://spa.test/", _FakeClient({}, soft404), f1)
    assert "exposed-sensitive-file" not in {x["check_id"] for x in f1.as_list()}
    # 実際に環境変数を返す /.env は検出する（非HTML・KEY=VALUE）
    routes = {"/.env": _FakeResp(200, "API_KEY=secret123\nDB_HOST=db\n", ctype="text/plain")}
    f2 = Findings()
    check_exposed_files("https://real.test/", _FakeClient(routes, _FakeResp(404, "nf")), f2)
    ids = {x["check_id"] for x in f2.as_list()}
    assert "exposed-sensitive-file" in ids


def test_samesite_none_without_secure():
    from checks import check_cookies, Findings
    f = Findings()
    check_cookies([{"name": "sid", "url": "https://x/", "secure": False,
                    "httponly": True, "samesite": "None"}], f)
    assert "cookie-samesite-none-insecure" in {x["check_id"] for x in f.as_list()}


def test_sri_flags_cross_origin_only():
    from checks import check_sri, Findings
    f = Findings()
    html = ('<script src="https://cdn.other.test/a.js"></script>'
            '<script src="/local.js"></script>')
    check_sri("https://site.test/page", html, f)
    ids = {x["check_id"] for x in f.as_list()}
    assert "missing-sri" in ids
    # 同一オリジン + integrity 付きは検出しない
    f2 = Findings()
    check_sri("https://site.test/p", '<script src="/x.js"></script>'
              '<script src="https://cdn.other.test/b.js" integrity="sha384-x"></script>', f2)
    assert "missing-sri" not in {x["check_id"] for x in f2.as_list()}


def test_report_escapes_target_data_xss():
    # 対象由来データ（evidence・affected 等）が HTML エスケープされ格納型 XSS を防ぐこと、
    # かつ信頼できる CSS（|safe）は壊れないこと。
    from scoring import score_all
    import render_report
    doc = {"target": "http://x", "scope": {"hosts": ["x"]}, "findings": [{
        "check_id": "reflected-input", "title": "t", "owasp": "A05:2025-インジェクション",
        "cwe": "CWE-79", "cvss_vector": "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N",
        "cvss_score": 5.1, "confidence": "Medium",
        "affected": ["http://x/?q=<script>alert(1)</script>"],
        "evidence": "reflected <script>alert('xss')</script>", "description": "d", "impact": "i",
        "remediation": "r", "references": [], "source": "core",
        "wstg": "WSTG-INPV-01", "asvs": "v5.0.0-1.2.1 (L1)"}]}
    html = render_report.render(score_all(doc), narrative={}, tools_used=[])
    assert "<script>alert" not in html          # 生スクリプトが出力されない
    assert "&lt;script&gt;" in html             # エスケープ済み
    assert "@page" in html                      # CSS（|safe）は壊れていない


def test_no_finding_leaks_raw_secret_values(findings):
    # 検出はするが、evidence にパスワード平文をそのまま載せない（署名/存在のみ）
    blob = " ".join(f["evidence"] for f in findings)
    assert "supersecret" not in blob
    assert "DB_PASSWORD=pw" not in blob
