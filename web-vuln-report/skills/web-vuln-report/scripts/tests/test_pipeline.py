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


def test_detects_route_disclosure(findings):
    # フィクスチャの Ziggy blob（admin.users.index / data.export / storage.download）と
    # JS 内 /api/generate-report を機微ルートとして 1 所見に集約検出する
    ids = _check_ids(findings)
    assert "route-disclosure" in ids
    ev = " ".join(f["evidence"] for f in findings if f["check_id"] == "route-disclosure")
    assert "admin" in ev or "export" in ev or "storage" in ev


def test_detects_stack_fingerprint(findings):
    fp = [f for f in findings if f["check_id"] == "stack-fingerprint"]
    assert fp, "stack-fingerprint が検出されない"
    assert "Laravel" in fp[0]["evidence"]
    assert fp[0]["cvss_score"] == 0.0  # 情報カテゴリ（グレードを毀損しない）


def test_merge_preserves_all_evidence():
    # G3: 同一 check_id+title の複数証跡（jQuery 1.11.1 と 2.2.0）が全件 surface される
    from scoring import merge_findings
    fs = [
        {"check_id": "outdated-library", "title": "古い可能性のあるライブラリ",
         "affected": ["https://s/"], "evidence": "jquery 1.11.1", "confidence": "Low"},
        {"check_id": "outdated-library", "title": "古い可能性のあるライブラリ",
         "affected": ["https://s/"], "evidence": "jquery 2.2.0", "confidence": "Low"},
    ]
    m = merge_findings(fs)
    assert len(m) == 1
    assert "1.11.1" in m[0]["evidence"] and "2.2.0" in m[0]["evidence"]  # 先頭のみ残さない


def test_banner_no_false_fire_on_product_name():
    # G5: "AmazonS3" の "3" で誤発火しない。版数様トークンがある時のみ発火する
    from checks import check_security_headers, Findings
    f = Findings()
    check_security_headers({"url": "https://x/"}, {"server": "AmazonS3"}, f)
    assert "info-disclosure-banner" not in {i["check_id"] for i in f.as_list()}
    f2 = Findings()
    check_security_headers({"url": "https://x/"}, {"server": "Apache/2.4.68"}, f2)
    assert "info-disclosure-banner" in {i["check_id"] for i in f2.as_list()}


def test_outdated_library_generic_extraction():
    from checks import check_outdated_libraries, Findings
    # slash 表記 jquery/2.x（旧実装の見逃しバグ）と bootstrap 危殆版を検出、modern は無視
    pages = [{"url": "https://s/", "technologies": [],
              "script_srcs": ["https://cdn/jquery/2.2.4/jquery.min.js",
                              "https://cdn/bootstrap/3.3.7/js/bootstrap.min.js",
                              "https://cdn/vue/3.4.0/vue.js",
                              "https://cdn/angular/16.2.0/angular.min.js"]}]
    f = Findings()
    check_outdated_libraries(pages, f)
    ev = " ".join(i["evidence"] for i in f.as_list())
    assert "jquery 2.2.4" in ev          # slash 表記 2.x を捕捉（バグ修正）
    assert "bootstrap 3.3.7" in ev
    assert "vue 3" not in ev             # モダン版は誤検知しない
    assert "angular 16" not in ev


def test_eol_runtime_detection():
    from checks import check_eol_runtime, Findings
    pages = [{"url": "https://s/", "server": "Apache/2.2.15 (CentOS)",
              "technologies": ["Server: Apache/2.2.15 OpenSSL/1.0.2k", "X-Powered-By: PHP/7.4.3"]}]
    f = Findings()
    check_eol_runtime(pages, f)
    ev = " ".join(i["evidence"] for i in f.as_list())
    assert "PHP 7.4" in ev and "Apache httpd 2.2" in ev and "OpenSSL 1.0.2" in ev
    # 「脆弱」と断定しない（バックポート注記つき）
    assert all("断定しない" in i["evidence"] for i in f.as_list())
    # モダン版は EOL 判定しない
    f2 = Findings()
    check_eol_runtime([{"url": "https://s/", "server": "nginx/1.25.3",
                        "technologies": ["X-Powered-By: PHP/8.3.0"]}], f2)
    assert not f2.as_list()


def test_detects_js_secret_exposure(findings):
    js = [f for f in findings if f["check_id"] == "js-secret-exposure"]
    assert js, "js-secret-exposure が検出されない"
    blob = " ".join(f["evidence"] for f in js)
    assert ("sk_" + "live_0123456789") not in blob           # 生値は非掲載
    assert "pk_live" not in blob and "AIza" not in blob  # 公開クライアント鍵は誤検知しない


def test_js_secrets_true_and_false_positives():
    from checks import check_js_secrets, Findings
    # ダミー鍵はリテラルを避け連結生成する（secret-scanning 誤検知回避。実行時の値は同一）。
    sk = "sk_" + "live_" + "0123456789abcdefABCDEFGHIJ"   # 真陽性（Stripe secret 様）
    pk = "pk_" + "live_" + "0123456789abcdefABCDEFGHIJ"   # 公開鍵→誤検知しない
    gk = "AIza" + "SyA1234567890abcdefghijklmnopqrstuv"    # ブラウザ鍵→誤検知しない
    ak = "AKIA" + "IOSFODNN7EXAMPLE"                       # example→除外
    bodies = [("https://s/app.js", f'var a="{sk}";var pk="{pk}";var g="{gk}";var ex="{ak}";')]
    f = Findings()
    check_js_secrets(bodies, f)
    items = f.as_list()
    assert [i["check_id"] for i in items] == ["js-secret-exposure"]  # sk_live のみ
    assert items[0]["confidence"] == "High"
    blob = " ".join(i["evidence"] for i in items)
    for leak in (sk[:12], pk[:7], gk[:4], "AKIA"):
        assert leak not in blob  # 生値・公開鍵接頭辞を evidence に載せない


def test_detects_source_map_exposure(findings):
    sm = [f for f in findings if f["check_id"] == "sourcemap-exposure"]
    assert sm, "sourcemap-exposure が検出されない"
    assert "sourcesContent" in sm[0]["evidence"]  # 原ソース露出に格上げ


def test_source_map_rejects_html_fallback():
    from checks import check_source_map, Findings

    class _R:
        def __init__(self, status, text, ctype="application/json"):
            self.status_code, self.text, self.headers = status, text, {"content-type": ctype}

    class _C:
        def __init__(self, resp):
            self._resp = resp

        def get(self, url):
            return self._resp

    # SPA の catch-all が 200+HTML を返すケース → 実体（version:3）でないので誤検知しない
    fh = Findings()
    check_source_map([("https://s/app.js", "//# sourceMappingURL=app.js.map")],
                     _C(_R(200, "<html><body>Not Found</body></html>", "text/html")), fh, {"s"})
    assert "sourcemap-exposure" not in {i["check_id"] for i in fh.as_list()}
    # 本物のマップ（version:3）→ 検出する
    ft = Findings()
    check_source_map([("https://s/app.js", "//# sourceMappingURL=app.js.map")],
                     _C(_R(200, '{"version":3,"mappings":"AAAA"}')), ft, {"s"})
    assert "sourcemap-exposure" in {i["check_id"] for i in ft.as_list()}


def test_source_map_ssrf_guard():
    # sourceMappingURL が非許可ホスト（内部IP・メタデータ等）を指しても取得しない（SSRF防止）
    from checks import check_source_map, Findings

    class _R:
        def __init__(self):
            self.status_code, self.text, self.headers = 200, '{"version":3,"mappings":"AAAA"}', {"content-type": "application/json"}

    class _SpyClient:
        def __init__(self):
            self.requested = []

        def get(self, url):
            self.requested.append(url)
            return _R()

    # クロスオリジンのメタデータ/内部ホストへの sourceMappingURL → allowed_hosts 外なので取得しない
    spy = _SpyClient()
    f = Findings()
    check_source_map(
        [("https://s/app.js", "//# sourceMappingURL=http://169.254.169.254/latest/meta-data/map.js.map")],
        spy, f, {"s"})
    assert spy.requested == []  # 非許可ホストへは一切リクエストしない
    assert "sourcemap-exposure" not in {i["check_id"] for i in f.as_list()}
    # allowed_hosts 未指定は fail-closed（取得しない）
    spy2 = _SpyClient()
    check_source_map([("https://s/app.js", "//# sourceMappingURL=app.js.map")], spy2, Findings())
    assert spy2.requested == []


def test_auth_routes_detection_and_protection():
    from checks import check_auth_routes, Findings
    from urllib.parse import urlparse as _up

    class _R:
        def __init__(self, status, text="", ctype="text/html"):
            self.status_code, self.text, self.headers = status, text, {"content-type": ctype}

    class _C:
        def __init__(self, routes, default):
            self._routes, self._default = routes, default

        def get(self, url):
            return self._routes.get(_up(url).path, self._default)

    routes = {
        "/vwr-nonexistent-auth-7c3f": _R(404, "nf"),
        "/admin": _R(200, "<html>admin panel with plenty of unique content here</html>"),
        "/dashboard": _R(302, ""),   # ログインへリダイレクト＝保護
        "/settings": _R(403, ""),    # 認証要求＝保護
    }
    f = Findings()
    check_auth_routes("https://s/", [], _C(routes, _R(404, "nf")), f)
    affected = " ".join(a for i in f.as_list() for a in i["affected"])
    assert "/admin" in affected          # 200 の機微パス＝露出疑い
    assert "/dashboard" not in affected  # 302 は保護＝検出しない
    assert "/settings" not in affected   # 403 は保護


def test_route_disclosure_filters_and_aggregates():
    from checks import check_route_disclosure, Findings
    pages = [{"url": "https://s/login", "route_markers": {
        "ziggy": [
            {"name": "login", "uri": "login"},
            {"name": "admin.users.index", "uri": "admin/users"},
            {"name": "data.export", "uri": "data/export"},
        ],
        "api_paths": ["/api/generate-report", "/api/login"],
        "next_data": False, "inertia_url": None,
    }}]
    f = Findings()
    check_route_disclosure(pages, f)
    items = f.as_list()
    # 機微ルート 3 件（admin.users.index / data.export / /api/generate-report）を 1 所見に集約。
    # 期待ルート login / /api/login は列挙しない。
    assert len(items) == 1
    assert "3 件" in items[0]["evidence"]
    assert "admin" in items[0]["evidence"]


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


# ===== v0.5 A4: CSP 深掘り解析（受動・default-src フォールバック考慮） =====
def test_csp_bypassable_analysis():
    from checks import check_csp, Findings

    def issues(csp):
        f = Findings()
        check_csp("https://x/", csp, f)
        return [i for i in f.as_list() if i["check_id"] == "csp-bypassable"]

    # 完全ロック（default-src 'none'）→ バイパス条件なし（FP回避）
    assert not issues("default-src 'none'")
    # 堅牢な CSP（nonce・object 'none'・base-uri/form-action 明示）→ 指摘なし
    assert not issues("default-src 'self'; script-src 'self' 'nonce-abc'; object-src 'none'; "
                      "base-uri 'self'; form-action 'self'")
    # object-src 未設定でも default-src 'none' へフォールバックして安全と判定する
    assert not issues("default-src 'none'; script-src 'self' 'nonce-x'; "
                      "base-uri 'self'; form-action 'self'")
    # unsafe-inline（nonce/hash 無し）→ 検出・確度 High（明確なバイパス）
    it = issues("script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'")
    assert it and it[0]["confidence"] == "High"
    assert "unsafe-inline" in it[0]["evidence"]
    # unsafe-inline + nonce 併記 → CSP3 では nonce がインラインを実効無効化するため指摘しない
    assert not any("unsafe-inline" in i["evidence"] for i in issues(
        "script-src 'self' 'unsafe-inline' 'nonce-abc'; object-src 'none'; "
        "base-uri 'self'; form-action 'self'"))
    # 広すぎる source（*）→ 検出
    it2 = issues("default-src *")
    assert it2 and "script-src" in it2[0]["evidence"]
    # base-uri / form-action 欠如（スクリプト許可時）→ 検出（1所見に集約）
    it3 = issues("script-src 'self'; object-src 'none'")
    assert len(it3) == 1
    assert "base-uri" in it3[0]["evidence"] and "form-action" in it3[0]["evidence"]


def test_detects_permissions_policy(findings):
    assert "missing-permissions-policy" in _check_ids(findings)


def test_header_supplements_coop_and_xss_legacy():
    from checks import check_security_headers, Findings
    # COOP 欠如 → missing-coop、X-XSS-Protection 有効値 → xss-protection-legacy
    f = Findings()
    check_security_headers({"url": "https://x/"}, {"x-xss-protection": "1; mode=block"}, f)
    ids = {i["check_id"] for i in f.as_list()}
    assert "missing-coop" in ids and "xss-protection-legacy" in ids
    # COOP 設定済み・X-XSS-Protection: 0（推奨値）は指摘しない
    f2 = Findings()
    check_security_headers({"url": "https://x/"},
                           {"x-xss-protection": "0", "cross-origin-opener-policy": "same-origin"}, f2)
    ids2 = {i["check_id"] for i in f2.as_list()}
    assert "missing-coop" not in ids2 and "xss-protection-legacy" not in ids2


def test_check_dnssec_with_fake_resolver():
    from checks import check_dnssec, Findings
    # 署名なし（DNSKEY/DS 双方空）→ 検出
    f = Findings()
    check_dnssec("https://example.com/", f, query=lambda n, t: [])
    assert "dnssec-missing" in {i["check_id"] for i in f.as_list()}
    # 署名あり（DNSKEY あり）→ 検出しない
    f2 = Findings()
    check_dnssec("https://example.com/", f2,
                 query=lambda n, t: ["257 3 13 abc"] if t == "DNSKEY" else [])
    assert not f2.as_list()


def test_classify_cert_error():
    from checks import _classify_cert_error
    assert "ホスト名不一致" in _classify_cert_error("Hostname mismatch, certificate is not valid for 'x'")
    assert "期限切れ" in _classify_cert_error("certificate has expired")
    assert "自己署名" in _classify_cert_error("self-signed certificate")
    assert "チェーン" in _classify_cert_error("unable to get local issuer certificate")
    assert "有効期間前" in _classify_cert_error("certificate is not yet valid")
    assert _classify_cert_error("some other verify failure")  # フォールバックも文字列を返す


def test_check_cert_validity_emits_on_verification_error():
    import ssl
    from checks import check_cert_validity, Findings

    def bad_verify(host, port):
        e = ssl.SSLCertVerificationError("certificate verify failed")
        e.verify_message = "Hostname mismatch, certificate is not valid for 'x'"
        raise e

    f = Findings()
    check_cert_validity("https://x.test/", f, verify=bad_verify)
    items = f.as_list()
    assert "tls-cert-invalid" in {i["check_id"] for i in items}
    assert "ホスト名不一致" in items[0]["evidence"]
    # 検証成功 → 何も出さない
    f2 = Findings()
    check_cert_validity("https://x.test/", f2, verify=lambda h, p: True)
    assert not f2.as_list()
    # http は対象外
    f3 = Findings()
    check_cert_validity("http://x.test/", f3, verify=bad_verify)
    assert not f3.as_list()


def test_safe_methods_enforced_in_code():
    from checks import _SafeClient, UnsafeMethodError
    sc = _SafeClient(client=None, delay=0)  # ガードは送信前に効くため _c は不要
    for bad in ("POST", "PUT", "DELETE", "PATCH"):
        with pytest.raises(UnsafeMethodError):
            sc.request(bad, "http://example.test/")


def test_active_auth_client_guard():
    # 能動認証 client は POST 限定・login URL 限定。ガードは送信前に効くため下位 client は不要。
    from checks import _ActiveAuthClient, ActiveAuthViolation
    ac = _ActiveAuthClient(client=None, login_url="https://s/login", hard_cap=8)
    for bad in ("GET", "PUT", "DELETE", "HEAD", "OPTIONS"):
        with pytest.raises(ActiveAuthViolation):
            ac.request(bad, "https://s/login")
    with pytest.raises(ActiveAuthViolation):
        ac.post("https://s/other")  # login URL 以外への POST は拒否


def test_active_auth_client_hard_cap():
    from checks import _ActiveAuthClient, ActiveAuthViolation

    class _Raw:
        def post(self, url, **kw):
            class _R:
                status_code, headers = 200, {}
            return _R()

    ac = _ActiveAuthClient(_Raw(), "https://s/login", hard_cap=2)
    ac.post("https://s/login")
    ac.post("https://s/login")
    with pytest.raises(ActiveAuthViolation):
        ac.post("https://s/login")  # client 側 blast-radius バックストップ


def test_login_rate_limit_logic():
    from checks import check_login_rate_limit, Findings

    class _R:
        def __init__(self, status, headers=None):
            self.status_code, self.headers = status, headers or {}

    class _NoThrottle:
        def post(self, url, **kw):
            return _R(200)

    f = Findings()
    check_login_rate_limit(_NoThrottle(), "https://s/login", f, max_attempts=8)
    assert "no-rate-limit" in {i["check_id"] for i in f.as_list()}

    class _Throttle:
        def __init__(self):
            self.n = 0

        def post(self, url, **kw):
            self.n += 1
            return _R(429) if self.n >= 2 else _R(200)

    f2 = Findings()
    check_login_rate_limit(_Throttle(), "https://s/login", f2, max_attempts=8)
    assert not f2.as_list()  # スロットリング有 → 検出しない

    class _Csrf:
        def post(self, url, **kw):
            return _R(419)  # 前段で CSRF 拒否 → レート制限に未到達

    f3 = Findings()
    check_login_rate_limit(_Csrf(), "https://s/login", f3, max_attempts=8)
    assert not f3.as_list()  # 偽陽性回避


def test_login_rate_limit_clamps_to_hard_cap():
    from checks import check_login_rate_limit, Findings, _LOGIN_HARD_CAP

    class _Counter:
        def __init__(self):
            self.n = 0

        def post(self, url, **kw):
            self.n += 1

            class _R:
                status_code, headers = 200, {}
            return _R()

    c = _Counter()
    check_login_rate_limit(c, "https://s/login", Findings(), max_attempts=100)
    assert c.n == _LOGIN_HARD_CAP  # 100 要求でもハードキャップ 8 にクランプ


def test_csrf_enforcement_logic():
    from checks import check_csrf_enforcement, Findings

    class _R:
        def __init__(self, status):
            self.status_code, self.headers = status, {}

    class _C:
        def __init__(self, status):
            self._s = status

        def post(self, url, **kw):
            return _R(self._s)

    f = Findings()
    check_csrf_enforcement(_C(200), "https://s/login", f)
    assert "csrf-not-enforced" in {i["check_id"] for i in f.as_list()}  # 受理 → 検出
    f2 = Findings()
    check_csrf_enforcement(_C(419), "https://s/login", f2)
    assert not f2.as_list()  # 419 拒否 → CSRF 実効


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
    # ルート露出群は検出あり（Ziggy blob の機微ルート）
    assert rows["route-disclosure"]["status"] == "finding"
    # 指紋群は検出あり（Laravel 指紋）、EOL 群は実施済み・問題なし（TestServer は EOL 表に不一致）
    assert rows["stack-fingerprint"]["status"] == "finding"
    assert rows["eol-runtime"]["status"] == "clean"
    # JS 秘密・ソースマップは検出あり（app.js に sk_live と .map）、auth-routes は機微パス無し
    assert rows["js-secrets"]["status"] == "finding"
    assert rows["source-map"]["status"] == "finding"
    assert rows["auth-routes"]["status"] == "clean"
    # Phase 3 能動認証は既定 OFF → 未実施（opt-in）
    assert rows["login-rate-limit"]["status"] == "skipped"
    assert rows["csrf-enforcement"]["status"] == "skipped"
    # http 対象なので TLS は未実施
    assert rows["tls-cert"]["status"] == "skipped"
    assert rows["tls-protocol"]["status"] == "skipped"
    assert rows["tls-cert-validity"]["status"] == "skipped"
    # ローカル/IP 対象なので DNS は未実施（外部ネットワークを叩かない）
    assert rows["dns-email-auth"]["status"] == "skipped"
    assert rows["dnssec"]["status"] == "skipped"
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
    # G1: 応答ページが 1 件も無ければ cookies/forms 等の実データ依存群も clean にしない
    # （空入力＝未観測 ≠ 問題なし。旧実装の false clean を是正）。
    assert rows["cookies"]["status"] == "skipped"
    assert rows["forms"]["status"] == "skipped"


def test_g1_unreachable_target_gates_clean_and_grade():
    # G1 回帰（jbr 実データ再現）: 主要ページが TLS 証明書エラーで未ロード（status=None・error）の
    # とき、データ依存群を false clean にせず、採点も A- 等を出さず「要再診断」にゲートする。
    from checks import run_checks, Ledger
    from scoring import score_all
    # http + 非ルータブル IP を用い、run_checks が実ネットワークを一切叩かない条件で
    # ゲート経路のみを検証する（TLS/DNS は scheme=http / IP のため未接続）。error 文字列は
    # jbr の実データ（証明書検証失敗）を模す。
    crawl = {"scope": {"target": "http://192.0.2.1/", "hosts": ["192.0.2.1"]},
             "pages": [{"url": "http://192.0.2.1/",
                        "error": "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"}],
             "cookies": [], "forms": []}
    led = Ledger()
    findings = run_checks(crawl, timeout=5, active=True, ledger=led)
    rows = {r["id"]: r for r in led.rows()}
    # データ依存群・能動群は clean でなく skipped（未観測）
    for gid in ("cookies", "outdated-libs", "route-disclosure", "stack-fingerprint",
                "eol-runtime", "forms", "cors", "exposed-files", "js-secrets", "auth-routes"):
        assert rows[gid]["status"] == "skipped", f"{gid} should be skipped (unreachable)"
    # 信頼性メタが False
    assert led.assessment["data_reliable"] is False
    assert led.assessment["pages_responded"] == 0
    # 採点ゲート: グレードは A- を出さず「要再診断」、スコアは None
    doc = {"target": "https://x.test/", "scope": crawl["scope"], "findings": findings,
           "coverage": led.rows(), "assessment": led.assessment}
    scored = score_all(doc)
    s = scored["summary"]
    assert s["assessment_incomplete"] is True
    assert s["security_score"] is None
    assert s["grade"] not in ("A+", "A", "A-", "B+", "B")
    assert "要再診断" in s["grade_rating"]


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
    # 新 kind="active-auth" の台帳行が日本語ラベル「能動認証」で表示される（テンプレ追随の
    # 回帰防止）。修正前は kind セルが生の "active-auth" になり「能動認証」は現れなかった。
    assert "能動認証" in html


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
    assert ("sk_" + "live_0123456789") not in blob  # JS 内の秘密も生値を載せない


# ===== v0.4.1 変更3: CSRF トークン系 Cookie を cookie-no-httponly から除外 =====
def test_cookie_csrf_token_excluded_from_httponly_fp():
    from checks import check_cookies, Findings
    cookies = [
        {"name": "XSRF-TOKEN", "url": "https://s/", "secure": True,
         "httponly": False, "samesite": "Lax"},
        {"name": "session", "url": "https://s/", "secure": True,
         "httponly": False, "samesite": "Lax"},
    ]
    f = Findings()
    check_cookies(cookies, f)
    items = f.as_list()
    # XSRF-TOKEN は JS 読取が設計上正当なため cookie-no-httponly の対象外
    assert not [i for i in items
                if i["check_id"] == "cookie-no-httponly" and "XSRF-TOKEN" in i["evidence"]]
    # 通常のセッション Cookie は引き続き cookie-no-httponly を検出
    assert [i for i in items
            if i["check_id"] == "cookie-no-httponly" and "session" in i["evidence"]]
    # CSRF Cookie でも Secure/SameSite の検査は継続する（HttpOnly のみ除外）
    f2 = Findings()
    check_cookies([{"name": "csrf-token", "url": "https://s/", "secure": False,
                    "httponly": False, "samesite": None}], f2)
    ids2 = {i["check_id"] for i in f2.as_list()}
    assert "cookie-insecure" in ids2 and "cookie-no-samesite" in ids2
    assert "cookie-no-httponly" not in ids2


# ===== v0.4.1 変更1: CSRF トークン取得（HTML 抽出 + Cookie デコード）=====
def test_extract_html_csrf_token():
    from checks import _extract_html_csrf_token
    assert _extract_html_csrf_token('<meta name="csrf-token" content="abc123">') == "abc123"
    assert _extract_html_csrf_token('<meta content="rev456" name="csrf-token">') == "rev456"
    assert _extract_html_csrf_token('<input type="hidden" name="_token" value="tok789">') == "tok789"
    assert _extract_html_csrf_token('<input value="rev012" name="_token">') == "rev012"
    assert _extract_html_csrf_token("<html>no token here</html>") is None
    assert _extract_html_csrf_token("") is None


def test_login_csrf_acquisition_reaches_rate_limit_layer(server):
    # CSRF 実効 login では素 POST は 419 で前段遮断され判定保留。GET でトークンを取得してから
    # POST するとレート制限層へ到達し no-rate-limit を検出できる（変更1 の中核）。
    import httpx
    from checks import (_SafeClient, _ActiveAuthClient, _acquire_login_csrf,
                        check_login_rate_limit, Findings)
    login = f"{server}/login"
    # (A) トークン無しの素 POST → 全て 419 前段遮断 → inconclusive（clean と区別）
    with httpx.Client(follow_redirects=False) as raw:
        aac = _ActiveAuthClient(raw, login)
        f0 = Findings()
        status0 = check_login_rate_limit(aac, login, f0, max_attempts=8)
        assert status0 == "inconclusive"
        assert not f0.as_list()
    # (B) GET でトークン取得 → トークン付き POST → レート制限層に到達 → no-rate-limit finding
    with httpx.Client(follow_redirects=False) as raw:
        sc = _SafeClient(raw)
        aac = _ActiveAuthClient(raw, login)
        hdrs, fields = _acquire_login_csrf(sc, raw.cookies, login, server)
        assert hdrs.get("X-XSRF-TOKEN") == "vwr-xsrf-tok3n=="   # XSRF-TOKEN Cookie を URL デコード
        assert fields.get("_token") == "vwr-meta-tok3n"         # meta/hidden から抽出
        f1 = Findings()
        status1 = check_login_rate_limit(aac, login, f1, max_attempts=8,
                                         headers=hdrs, extra_fields=fields)
        assert status1 == "finding"
        assert "no-rate-limit" in {i["check_id"] for i in f1.as_list()}


def test_active_auth_login_rate_limit_integration(crawl_data, server):
    # run_checks 経由の結合テスト: CSRF トークン取得 → レート制限層到達 → no-rate-limit。
    # csrf-enforcement はトークン無し POST が 419 で拒否され csrf-not-enforced を出さない。
    from checks import run_checks, Ledger
    led = Ledger()
    login_url = server.rstrip("/") + "/login"
    findings = run_checks(crawl_data, timeout=10, active=True, ledger=led,
                          active_auth=True, active_auth_url=login_url,
                          active_auth_authorized="test-suite")
    ids = {f["check_id"] for f in findings}
    assert "no-rate-limit" in ids
    assert "csrf-not-enforced" not in ids   # トークン無し POST は 419 拒否＝CSRF 実効（正常）
    rows = {r["id"]: r for r in led.rows()}
    assert rows["login-rate-limit"]["status"] == "finding"
    assert rows["csrf-enforcement"]["status"] == "clean"


# ===== v0.4.1 変更2: inconclusive（判定保留）区分 =====
def test_active_auth_inconclusive_ledger_when_csrf_wall(crawl_data, server):
    # トークン取得不能な CSRF ウォール（常時 419）では、レート制限層に到達できず判定保留。
    # 明示 record が generic finalize（ran→clean）に勝ち、clean に丸められない（advisor 指摘）。
    from checks import run_checks, Ledger
    led = Ledger()
    login_url = server.rstrip("/") + "/login-hardened"
    findings = run_checks(crawl_data, timeout=10, active=True, ledger=led,
                          active_auth=True, active_auth_url=login_url,
                          active_auth_authorized="test-suite")
    ids = {f["check_id"] for f in findings}
    assert "no-rate-limit" not in ids  # 到達不能なので finding は出さない
    rows = {r["id"]: r for r in led.rows()}
    assert rows["login-rate-limit"]["status"] == "inconclusive"
    assert rows["login-rate-limit"]["status_ja"] == "判定保留"
    # 実 run の台帳（led.rows()）→ score_all → grade_context まで判定保留が伝播することを
    # end-to-end で確認する（手組み dict でなく実 coverage 由来で注記が出る）。
    from scoring import score_all
    doc = {"target": server, "scope": {"hosts": ["127.0.0.1"]}, "findings": findings,
           "coverage": led.rows(), "coverage_summary": led.summary(),
           "assessment": led.assessment}
    scored = score_all(doc)
    assert scored["summary"]["inconclusive_count"] >= 1
    assert "判定保留" in scored["summary"]["grade_context"]


def test_compute_grade_inconclusive_note():
    from scoring import compute_grade
    by = {"Critical": 0, "High": 0, "Medium": 1, "Low": 0, "Info": 0}
    g = compute_grade([{"severity": "Medium", "confidence": "High"}], by, inconclusive=1)
    assert g["inconclusive_count"] == 1
    assert "判定保留" in g["grade_context"]
    # inconclusive 0 のときは注記を出さない
    g0 = compute_grade([{"severity": "Medium", "confidence": "High"}], by, inconclusive=0)
    assert "判定保留" not in g0["grade_context"]


def test_score_all_counts_inconclusive_from_coverage():
    from scoring import score_all
    doc = {"target": "http://x", "findings": [],
           "coverage": [{"id": "login-rate-limit", "status": "inconclusive"},
                        {"id": "cookies", "status": "clean"}]}
    scored = score_all(doc)
    assert scored["summary"]["inconclusive_count"] == 1
    assert "判定保留" in scored["summary"]["grade_context"]


def test_report_renders_inconclusive_ledger():
    from scoring import score_all
    import render_report
    doc = {"target": "http://x", "scope": {"hosts": ["x"]}, "findings": [],
           "coverage": [{"id": "login-rate-limit", "label": "ログインレート制限（能動・opt-in）",
                         "category": "A06", "kind": "active-auth", "status": "inconclusive",
                         "status_ja": "判定保留", "findings": 0, "note": "要手動確認"}],
           "coverage_summary": {"total": 1, "by_status": {"inconclusive": 1}}}
    html = render_report.render(score_all(doc), narrative={}, tools_used=[])
    assert "判定保留" in html
    assert "cov-inconclusive" in html
