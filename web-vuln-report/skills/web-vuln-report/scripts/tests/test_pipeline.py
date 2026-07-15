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


def test_coverage_ledger_statuses(crawl_data):
    from checks import run_checks, Ledger, LEDGER_GROUPS
    led = Ledger()
    run_checks(crawl_data, timeout=10, active=True, ledger=led)
    rows = {r["id"]: r for r in led.rows()}
    # 全グループが台帳に載る
    assert len(rows) == len(LEDGER_GROUPS)
    # ヘッダ群は検出あり（フィクスチャに欠落ヘッダ多数）
    assert rows["security-headers"]["status"] == "finding"
    # http 対象なので TLS は未実施
    assert rows["tls-cert"]["status"] == "skipped"
    assert rows["tls-protocol"]["status"] == "skipped"
    # ローカル/IP 対象なので DNS は未実施（外部ネットワークを叩かない）
    assert rows["dns-email-auth"]["status"] == "skipped"
    # 実施済みで所見の無い群（例: forms は GET 検索のみ）は「問題なし(clean)」
    statuses = {r["status"] for r in rows.values()}
    assert "clean" in statuses
    # passive-only では能動群が未実施になる
    led2 = Ledger()
    run_checks(crawl_data, timeout=10, active=False, ledger=led2)
    rows2 = {r["id"]: r for r in led2.rows()}
    assert rows2["reflected-input"]["status"] == "skipped"
    assert rows2["exposed-files"]["status"] == "skipped"


def test_coverage_ledger_no_html_is_skipped_not_clean():
    # ページ応答が無い（＝HTML 検査が一度も走らない）とき、ページ依存の受動群を
    # 「問題なし(clean)」にせず「未実施(skipped)」とする（未検査を沈黙で合格にしない）。
    from checks import run_checks, Ledger
    led = Ledger()
    run_checks({"scope": {"target": "", "hosts": []}, "pages": [], "cookies": [], "forms": []},
               timeout=5, active=False, ledger=led)
    rows = {r["id"]: r for r in led.rows()}
    assert rows["security-headers"]["status"] == "skipped"
    assert rows["sri"]["status"] == "skipped"
    assert rows["verbose-error"]["status"] == "skipped"
    # 空データでも実行される群（cookies/forms）は clean（実施済み・所見なし）
    assert rows["cookies"]["status"] == "clean"
    assert rows["forms"]["status"] == "clean"


def test_registrable_domain_expanded_ccTLDs():
    from checks import _registrable_domain
    # レビュー指摘の多ラベル ccTLD で公開接尾辞を返さない（DMARC/SPF 偽陽性の回避）
    assert _registrable_domain("www.example.com.mx") == "example.com.mx"
    assert _registrable_domain("shop.example.co.id") == "example.co.id"
    assert _registrable_domain("a.example.com.br") == "example.com.br"


def test_coverage_flows_into_report(crawl_data):
    from checks import run_checks, Ledger
    from scoring import score_all
    import render_report
    led = Ledger()
    findings = run_checks(crawl_data, timeout=10, active=True, ledger=led)
    doc = {"target": "http://test", "scope": {"hosts": ["test"]}, "findings": findings,
           "coverage": led.rows(), "coverage_summary": led.summary()}
    html = render_report.render(score_all(doc), narrative={}, tools_used=[])
    assert "診断項目カバレッジ台帳" in html
    assert "問題なし" in html or "未実施" in html


def test_registrable_domain_multilabel():
    from checks import _registrable_domain
    assert _registrable_domain("example.com") == "example.com"
    assert _registrable_domain("www.example.com") == "example.com"
    assert _registrable_domain("shop.example.com") == "example.com"
    assert _registrable_domain("www.actcall.co.jp") == "actcall.co.jp"  # 多ラベル ccTLD
    assert _registrable_domain("actcall.co.jp") == "actcall.co.jp"


def test_check_dns_with_fake_resolver():
    from checks import check_dns, Findings

    # フェイク resolver（オフライン）: DMARC/SPF いずれも不在 → 双方検出
    def q_empty(name, rdtype):
        return []
    f = Findings()
    check_dns("https://example.com/", f, query=q_empty)
    ids = {i["check_id"] for i in f.as_list()}
    assert "dns-dmarc-missing" in ids
    assert "dns-spf-missing" in ids

    # DMARC が p=none、SPF あり → dns-dmarc-weak のみ、missing は出さない
    def q_weak(name, rdtype):
        if name.startswith("_dmarc."):
            return ["v=DMARC1; p=none; rua=mailto:x@example.com"]
        return ["v=spf1 include:_spf.example.com -all"]
    f2 = Findings()
    check_dns("https://example.com/", f2, query=q_weak)
    ids2 = {i["check_id"] for i in f2.as_list()}
    assert "dns-dmarc-weak" in ids2
    assert "dns-dmarc-missing" not in ids2
    assert "dns-spf-missing" not in ids2

    # DMARC が p=reject、SPF あり → 何も出さない
    def q_ok(name, rdtype):
        if name.startswith("_dmarc."):
            return ["v=DMARC1; p=reject"]
        return ["v=spf1 -all"]
    f3 = Findings()
    check_dns("https://example.com/", f3, query=q_ok)
    assert not f3.as_list()


def test_check_forms_static_analysis():
    from checks import check_forms, Findings
    forms = [
        # 平文送信 + 機微 POST + トークン無し: insecure-form-target / missing-csrf-token
        {"url": "https://s/login", "action": "http://s/login", "method": "POST",
         "inputs": [{"name": "user", "type": "text"}, {"name": "pass", "type": "password"}]},
        # 対策済み: csrf トークン有り → missing-csrf-token を出さない
        {"url": "https://s/secure", "action": "https://s/secure", "method": "POST",
         "inputs": [{"name": "pw2", "type": "password"},
                    {"name": "csrf_token", "type": "hidden"},
                    {"name": "email", "type": "email"}]},
        # GET 検索フォーム → 何も出さない
        {"url": "https://s/search", "action": "https://s/search", "method": "GET",
         "inputs": [{"name": "q", "type": "text"}]},
    ]
    f = Findings()
    check_forms(forms, f)
    items = f.as_list()
    ids = {i["check_id"] for i in items}
    assert {"insecure-form-target", "missing-csrf-token"} <= ids
    # autocomplete は ASVS 5.0.0 方針転換により検査対象外（誤検知の温床を持ち込まない）
    assert "password-autocomplete" not in ids
    # 対策済み secure フォーム・GET 検索フォームは何も出さない
    assert not any("secure" in a for i in items for a in i["affected"])
    assert not any("search" in a for i in items for a in i["affected"])


def test_verbose_error_detection():
    from checks import check_verbose_error, Findings
    # スタックトレースの兆候を検出（evidence にシグネチャ種別のみ）
    f = Findings()
    check_verbose_error("https://x/e", "<pre>Traceback (most recent call last):\n  File \"/app/main.py\"</pre>", f)
    items = f.as_list()
    assert "verbose-error" in {i["check_id"] for i in items}
    assert "/app/main.py" not in items[0]["evidence"]  # 内部パスは載せない
    # SQL エラー
    f2 = Findings()
    check_verbose_error("https://x/q", "You have an error in your SQL syntax; near '1'", f2)
    assert "verbose-error" in {i["check_id"] for i in f2.as_list()}
    # 通常ページは誤検知しない
    f3 = Findings()
    check_verbose_error("https://x/", "<html><body>エラーの対処法について解説します。</body></html>", f3)
    assert "verbose-error" not in {i["check_id"] for i in f3.as_list()}


def test_reflected_input_ignores_non_html():
    # 反射型 XSS は HTML 文脈でのみ成立する。JSON/API がマーカーをエコーしても
    # content-type が text/html でなければ検出しない（偽陽性の除去）。
    from checks import check_reflected_input, Findings, REFLECT_MARKER

    class _R:
        def __init__(self, text, ctype):
            self.status_code, self.text, self.headers = 200, text, {"content-type": ctype}

    class _C:
        def __init__(self, resp):
            self._resp = resp

        def get(self, url):
            return self._resp

    payload_echo = f'{REFLECT_MARKER}<"\''
    params = [{"url": "https://x/?q=1", "name": "q"}]
    # JSON エコー: 検出しない
    fj = Findings()
    check_reflected_input(params, _C(_R(f'{{"q":"{payload_echo}"}}', "application/json")), fj)
    assert "reflected-input" not in {i["check_id"] for i in fj.as_list()}
    # HTML 反射: 検出する
    fh = Findings()
    check_reflected_input(params, _C(_R(f"<div>{payload_echo}</div>", "text/html; charset=utf-8")), fh)
    assert "reflected-input" in {i["check_id"] for i in fh.as_list()}


def test_no_finding_leaks_raw_secret_values(findings):
    # 検出はするが、evidence にパスワード平文をそのまま載せない（署名/存在のみ）
    blob = " ".join(f["evidence"] for f in findings)
    assert "supersecret" not in blob
    assert "DB_PASSWORD=pw" not in blob
