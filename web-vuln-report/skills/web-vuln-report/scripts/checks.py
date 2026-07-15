#!/usr/bin/env python3
"""
checks.py - 非破壊チェックエンジン（Phase 2）

crawl.json を入力に、以下の非破壊チェックを実施して findings.json を生成する。
安全境界（コードで強制）:
  - 送信メソッドは GET / HEAD / OPTIONS のみ（データ改変・破壊的操作を行わない）
  - 能動プローブは無害マーカーの反射確認・既知パスの存在確認に限定
  - スコープ内ホストのみ（crawl.json の scope.hosts）
  - レート制御・タイムアウトを適用

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run --with httpx checks.py --crawl crawl.json --out findings.json
"""
from __future__ import annotations

import argparse
import json
import re
import socket
import ssl
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse, urlencode, urlunparse, parse_qsl

try:
    import httpx
except ImportError as e:  # pragma: no cover
    print(f"[checks] 依存不足: {e}\n  uv run --with httpx checks.py ... で実行してください。",
          file=sys.stderr)
    raise

from catalog import get_check

USER_AGENT = "web-vuln-report/0.1 (authorized security assessment; +non-destructive)"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

# 能動プローブ: 存在確認する機微パス。値は (署名, 非HTMLを期待するか)。
# 非HTML期待の項目は text/html を返す応答（SPA の soft-404 等）を機微ファイルと誤判定しない。
SENSITIVE_PATHS = {
    "/.git/HEAD": ("ref: ", True),
    "/.env": ("__ENV__", True),          # 特別扱い: KEY=VALUE 行の正規表現で判定（下記 _looks_like_env）
    "/.DS_Store": ("\x00\x00\x00", True),
    "/backup.zip": ("PK", True),
    "/wp-config.php.bak": ("<?php", True),
    "/phpinfo.php": ("phpinfo()", False),          # HTML だが署名が十分特異
    "/server-status": ("Apache Server Status", False),
    "/.svn/entries": ("", True),
}

_ENV_LINE_RE = re.compile(r"(?m)^[A-Za-z_][A-Za-z0-9_]*\s*=\S")


def _looks_like_env(body: str) -> bool:
    """`.env` 誤検知抑止: KEY=VALUE 形式の行が実在するかで判定する。"""
    return bool(_ENV_LINE_RE.search(body))

# 反射型 XSS 検査用の無害マーカー（スクリプトは実行しない。エスケープ有無のみ判定）
REFLECT_MARKER = "vwrPROBE9137"
REFLECT_PAYLOAD = f"{REFLECT_MARKER}<\"'"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Findings:
    def __init__(self):
        self._items: list[dict] = []
        self._seq = 0

    def add(self, check_id: str, affected: str, evidence: str,
            confidence: str = "High", source: str = "core", extra: dict | None = None):
        meta = get_check(check_id)
        self._seq += 1
        item = {
            "id": f"VWR-{self._seq:03d}",
            "check_id": check_id,
            "title": meta["title"],
            "owasp": meta["owasp"],
            "cwe": meta["cwe"],
            "wstg": meta.get("wstg"),
            "asvs": meta.get("asvs"),
            "cvss_vector": meta["cvss"],
            "cvss_score": meta.get("cvss_score"),
            "confidence": confidence,
            "affected": [affected] if isinstance(affected, str) else list(affected),
            "evidence": evidence,
            "description": meta["description"],
            "impact": meta["impact"],
            "remediation": meta["remediation"],
            "references": meta["references"],
            "source": source,
        }
        if extra:
            item.update(extra)
        self._items.append(item)

    def as_list(self) -> list[dict]:
        return self._items


def _client(timeout: float) -> httpx.Client:
    return httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT},
                        follow_redirects=False, verify=True)


class UnsafeMethodError(RuntimeError):
    """非破壊境界（SAFE_METHODS 以外）に反する送信を検出したときに送出。"""


class _SafeClient:
    """レート制御に加え、送信メソッドを SAFE_METHODS に**コードで強制**する薄いラッパ。

    全チェックはこのラッパ経由でのみ通信し、GET/HEAD/OPTIONS 以外（POST/PUT/DELETE 等）は
    UnsafeMethodError を送出して送信自体を拒否する。非破壊性を慣習でなく機構で保証する。"""

    def __init__(self, client: httpx.Client, delay: float = 0.0):
        self._c = client
        self._delay = delay

    def _guard(self, method: str) -> None:
        if method.upper() not in SAFE_METHODS:
            raise UnsafeMethodError(f"非破壊境界: メソッド {method} は許可されていません")

    def get(self, *args, **kwargs):
        if self._delay:
            time.sleep(self._delay)
        return self._c.get(*args, **kwargs)

    def head(self, *args, **kwargs):
        if self._delay:
            time.sleep(self._delay)
        return self._c.head(*args, **kwargs)

    def request(self, method, *args, **kwargs):
        self._guard(method)
        if self._delay:
            time.sleep(self._delay)
        return self._c.request(method, *args, **kwargs)


def _headers_lower(resp: httpx.Response) -> dict[str, str]:
    return {k.lower(): v for k, v in resp.headers.items()}


def check_security_headers(page: dict, headers: dict[str, str], f: Findings) -> None:
    url = page["url"]
    if "strict-transport-security" not in headers and url.startswith("https"):
        f.add("missing-hsts", url, "応答に Strict-Transport-Security ヘッダが存在しない")
    if headers.get("x-content-type-options", "").lower() != "nosniff":
        f.add("missing-xcto", url, "X-Content-Type-Options: nosniff が未設定")
    csp = headers.get("content-security-policy", "")
    if not csp:
        f.add("missing-csp", url, "Content-Security-Policy ヘッダが存在しない")
    else:
        low = csp.lower()
        weak = [t for t in ("unsafe-inline", "unsafe-eval") if t in low]
        # 単独のワイルドカード source（*）のみ脆弱扱い。*.example.com 等の
        # サブドメインワイルドカードは誤検知回避のため対象外とする。
        tokens = re.split(r"[;\s]+", csp.strip())
        if "*" in tokens:
            weak.append("ワイルドカード source (*)")
        if weak:
            f.add("weak-csp", url, f"CSP に脆弱な指定: {', '.join(weak)}")
    xfo = headers.get("x-frame-options", "")
    if not xfo and "frame-ancestors" not in csp:
        f.add("missing-frame-options", url,
              "X-Frame-Options も CSP frame-ancestors も未設定")
    if "referrer-policy" not in headers:
        f.add("missing-referrer-policy", url, "Referrer-Policy が未設定", confidence="Medium")
    if "permissions-policy" not in headers and "feature-policy" not in headers:
        f.add("missing-permissions-policy", url,
              "Permissions-Policy（旧 Feature-Policy）が未設定", confidence="Low")
    server = headers.get("server", "")
    powered = headers.get("x-powered-by", "")
    banner = "; ".join(x for x in (server, powered) if x)
    if banner and any(ch.isdigit() for ch in banner):
        f.add("info-disclosure-banner", url, f"バージョン露出: {banner}", confidence="Medium")


def check_cookies(cookies: list[dict], f: Findings) -> None:
    for c in cookies:
        is_https = c["url"].startswith("https")
        if is_https and not c["secure"]:
            f.add("cookie-insecure", c["url"], f"Cookie '{c['name']}' に Secure 属性が無い")
        if not c["httponly"]:
            f.add("cookie-no-httponly", c["url"],
                  f"Cookie '{c['name']}' に HttpOnly 属性が無い", confidence="Medium")
        if not c["samesite"]:
            f.add("cookie-no-samesite", c["url"],
                  f"Cookie '{c['name']}' に SameSite 属性が無い", confidence="Medium")
        elif str(c["samesite"]).lower() == "none" and not c["secure"]:
            # SameSite=None は Secure 必須。欠くとブラウザに拒否され、CSRF 防御も無効。
            f.add("cookie-samesite-none-insecure", c["url"],
                  f"Cookie '{c['name']}' が SameSite=None かつ Secure 属性を欠く")


def check_cert_expiry(target: str, f: Findings) -> None:
    """TLS 証明書の有効期限を検証する（残 30 日未満で所見）。

    接続・証明書取得の失敗は例外を送出し、呼び出し側（カバレッジ台帳）が
    「エラー（検査できなかった）」として表面化する。旧実装は例外を握り潰し、
    合格・エラー・未実行がすべて同じ沈黙になっていた欠陥を是正している。"""
    parsed = urlparse(target)
    if parsed.scheme != "https":
        return
    host = parsed.hostname
    port = parsed.port or 443
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            cert = ssock.getpeercert()
    not_after = cert.get("notAfter")
    if not_after:
        exp = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days = (exp - datetime.now(timezone.utc)).days
        if days < 30:
            f.add("tls-cert-expiring", target,
                  f"証明書の残存日数 {days} 日（notAfter={not_after}）",
                  confidence="High")


def _probe_old_tls(host: str, port: int, f: Findings, target: str) -> None:
    """TLS 1.0/1.1 のハンドシェイク受入を検査（非破壊）。

    ここでは「サーバが旧プロトコルのハンドシェイクを受理するか」だけを判定する。
    証明書の正当性は本検査の対象外（データ送受信は行わない）ため、意図的に
    check_hostname/verify を無効化している。証明書の有効期限は check_cert_expiry 側の
    正規検証コンテキストで別途確認する。この無効化は本関数のプロトコル受入判定に限定する。
    """
    if not hasattr(ssl, "TLSVersion"):
        return
    for label, ver in (("TLS 1.0", ssl.TLSVersion.TLSv1), ("TLS 1.1", ssl.TLSVersion.TLSv1_1)):
        try:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False   # プロトコル受入のみ検査（証明書検証は check_tls が担当）
            ctx.verify_mode = ssl.CERT_NONE
            ctx.minimum_version = ver
            ctx.maximum_version = ver
            with socket.create_connection((host, port), timeout=8) as sock:
                with ctx.wrap_socket(sock, server_hostname=host):
                    f.add("tls-weak-protocol", target,
                          f"{label} のハンドシェイクが受理された", confidence="High")
        except Exception:
            continue


def _rebuild(url: str, query: dict) -> str:
    p = urlparse(url)
    return urlunparse(p._replace(query=urlencode(query, doseq=True)))


def check_exposed_files(target: str, client, f: Findings) -> None:
    base = urlparse(target)
    root = urlunparse((base.scheme, base.netloc, "", "", "", ""))

    # soft-404 ベースライン: 実在しないランダムパスの応答を取得し、SPA/カスタム 404 の
    # 「200 + HTML」を機微ファイルと誤検知しないための基準にする。
    baseline_soft404 = False
    baseline_len = -1
    try:
        b = client.get(root + "/vwr-nonexistent-3f9a1c7e")
        if b.status_code == 200:
            baseline_soft404 = True
            baseline_len = len(b.text)
    except Exception:
        pass

    for path, (signature, expect_non_html) in SENSITIVE_PATHS.items():
        try:
            r = client.get(root + path)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        ctype = r.headers.get("content-type", "").lower()
        # 非HTMLを期待する機微ファイルが HTML を返す＝soft-404/catch-all の可能性 → 除外
        if expect_non_html and "text/html" in ctype:
            continue
        # soft-404 ベースラインと本文長が酷似する応答は実体無しとみなし除外
        if baseline_soft404 and baseline_len >= 0 and abs(len(r.text) - baseline_len) < 32:
            continue
        body = r.text[:1024]
        if path == "/.env":
            matched = _looks_like_env(body)
            ev = "KEY=VALUE 形式の環境変数を含む"
        elif signature:
            matched = signature in body
            ev = f"署名一致: {signature!r}"
        else:
            matched = True
            ev = "非HTMLの機微パスが 200 で取得可能"
        if matched:
            f.add("exposed-sensitive-file", root + path,
                  f"HTTP 200 で取得可能（{ev}）")


def check_directory_listing(pages: list[dict], client: httpx.Client, f: Findings) -> None:
    checked = set()
    for page in pages:
        url = page.get("url", "")
        p = urlparse(url)
        # ディレクトリ様のパス（末尾 / または拡張子なし）
        dir_url = urlunparse(p._replace(path=p.path.rsplit("/", 1)[0] + "/", query="", fragment=""))
        if dir_url in checked:
            continue
        checked.add(dir_url)
        try:
            r = client.get(dir_url)
        except Exception:
            continue
        if r.status_code == 200 and ("Index of /" in r.text or "<title>Directory listing" in r.text):
            f.add("directory-listing", dir_url, "自動インデックス表示の兆候（'Index of /'）")


def check_cors(target: str, client: httpx.Client, f: Findings) -> None:
    evil = "https://evil.example.com"
    try:
        r = client.get(target, headers={"Origin": evil})
    except Exception:
        return
    h = _headers_lower(r)
    acao = h.get("access-control-allow-origin", "")
    acac = h.get("access-control-allow-credentials", "").lower()
    if acao == evil and acac == "true":
        f.add("cors-misconfig", target,
              f"Origin を反射（ACAO={acao}）しつつ credentials 許可")
    elif acao == "*" and acac == "true":
        f.add("cors-misconfig", target, "ACAO=* かつ credentials 許可", confidence="Medium")


def check_http_methods(target: str, client: httpx.Client, f: Findings) -> None:
    try:
        r = client.request("OPTIONS", target)
    except Exception:
        return
    allow = _headers_lower(r).get("allow", "")
    risky = [m for m in ("TRACE", "PUT", "DELETE", "CONNECT") if m in allow.upper()]
    if risky:
        f.add("risky-http-method", target, f"Allow ヘッダに危険メソッド: {', '.join(risky)}")


def check_open_redirect(params: list[dict], client: httpx.Client, f: Findings) -> None:
    redirect_names = {"url", "next", "redirect", "return", "returnurl", "dest",
                      "destination", "go", "target", "r", "u", "continue"}
    marker = "https://vwr-redirect-probe.example.org/"
    seen = set()
    for param in params:
        if param["name"].lower() not in redirect_names:
            continue
        url = param["url"]
        q = dict(parse_qsl(urlparse(url).query))
        q[param["name"]] = marker
        probe = _rebuild(url, q)
        if probe in seen:
            continue
        seen.add(probe)
        try:
            r = client.get(probe)
        except Exception:
            continue
        location = _headers_lower(r).get("location", "")
        if r.status_code in (301, 302, 303, 307, 308) and location.startswith(marker):
            f.add("open-redirect", probe,
                  f"パラメータ '{param['name']}' がリダイレクト先に反映（Location={location}）",
                  confidence="Medium")


def check_reflected_input(params: list[dict], client: httpx.Client, f: Findings) -> None:
    seen = set()
    for param in params:
        url = param["url"]
        q = dict(parse_qsl(urlparse(url).query))
        q[param["name"]] = REFLECT_PAYLOAD
        probe = _rebuild(url, q)
        key = (url, param["name"])
        if key in seen:
            continue
        seen.add(key)
        try:
            r = client.get(probe)
        except Exception:
            continue
        # 反射型 XSS は HTML 文脈でのみ成立する。JSON/プレーンテキスト等の応答が
        # 値をエコーしても XSS ではないため、content-type が text/html の場合のみ判定する
        # （API のエコーを反射型 XSS と誤検知する偽陽性を除去）。
        if "text/html" not in r.headers.get("content-type", "").lower():
            continue
        body = r.text
        # マーカーがエスケープされずそのまま（< " ' を含む形で）反射しているか
        if f"{REFLECT_MARKER}<\"'" in body or f"{REFLECT_MARKER}<" in body:
            f.add("reflected-input", probe,
                  f"パラメータ '{param['name']}' の値が無害化されず反射（マーカー検出）",
                  confidence="Medium")


def check_mixed_content(pages: list[dict], client: httpx.Client, f: Findings) -> None:
    for page in pages:
        url = page.get("url", "")
        if not url.startswith("https") or "text/html" not in page.get("content_type", ""):
            continue
        try:
            r = client.get(url)
        except Exception:
            continue
        # 単純な検出: HTTPS ページ内の http:// の src/href（弱いシグナル）
        if 'src="http://' in r.text or "src='http://" in r.text:
            f.add("mixed-content", url, "HTTPS ページ内に http:// リソース参照を検出",
                  confidence="Medium")


def check_outdated_libraries(pages: list[dict], f: Findings) -> None:
    for page in pages:
        for tech in page.get("technologies", []):
            low = tech.lower()
            if low.startswith("js:") and any(v in low for v in ("jquery-1.", "jquery/1.",
                                                                 "jquery-2.", "angular.js/1.")):
                f.add("outdated-library", page["url"],
                      f"古い可能性のあるライブラリ参照: {tech}", confidence="Low")


def check_sri(url: str, html: str, f: Findings) -> None:
    """外部（クロスオリジン）の script/stylesheet に integrity（SRI）が無いかを検出。"""
    page_host = (urlparse(url).hostname or "").lower()
    for tag in re.findall(r"<(?:script|link)\b[^>]*>", html or "", re.I):
        low = tag.lower()
        if "src=" in low:
            m = re.search(r'src=["\']([^"\']+)["\']', tag, re.I)
        elif "stylesheet" in low and "href=" in low:
            m = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
        else:
            continue
        if not m:
            continue
        res_host = (urlparse(m.group(1)).hostname or "").lower()
        if not res_host or res_host == page_host:
            continue  # 相対・同一オリジンは SRI 対象外
        if "integrity=" not in low:
            f.add("missing-sri", url,
                  f"外部リソースに integrity（SRI）が無い: {m.group(1)}", confidence="Low")
            return  # 1 ページ 1 件に留める（過剰列挙を避ける）


# 詳細エラー/スタックトレースの高特異度シグネチャ（通常コンテンツにはまず現れない）。
# 誤検知を避けるため一般語（"error" 等）は使わず、フレームワーク/DB 固有の文言に限定する。
_VERBOSE_STRONG = (
    "Traceback (most recent call last):",              # Python
    "Werkzeug Debugger",                                # Flask デバッグ
    "Whoops, looks like something went wrong",          # Laravel
    "Server Error in '/' Application",                  # ASP.NET
    "You have an error in your SQL syntax",             # MySQL
    "SQLSTATE[",                                        # PDO/SQL
    "Microsoft OLE DB Provider for SQL Server",         # MSSQL
    "Warning: mysql_",                                  # PHP + MySQL
)
_VERBOSE_ORA = re.compile(r"ORA-\d{5}")                 # Oracle
_VERBOSE_PHP = re.compile(r"(?:Fatal error|Warning|Notice)\s*:.{0,200}?on line \d+", re.I | re.S)


def check_verbose_error(url: str, html: str, f: Findings) -> None:
    """応答本文にスタックトレース/DB エラー等の詳細エラー露出の兆候があるかを検出（非破壊・パッシブ）。

    evidence にはシグネチャ種別のみを載せ、内部パス等の生データは載せない。"""
    if not html:
        return
    hit = next((s for s in _VERBOSE_STRONG if s in html), None)
    if not hit and _VERBOSE_ORA.search(html):
        hit = "ORA-番号 (Oracle エラー)"
    if not hit and _VERBOSE_PHP.search(html):
        hit = "PHP エラー（... on line N）"
    if hit:
        f.add("verbose-error", url, f"詳細エラー/スタックトレースの兆候を検出: {hit}")


# フォーム静的検査のヒント語
_CSRF_TOKEN_HINTS = ("csrf", "xsrf", "_token", "authenticity_token",
                     "verificationtoken", "requestverificationtoken", "nonce")
_SENSITIVE_FIELD_HINTS = ("password", "passwd", "email", "login", "user",
                          "account", "card", "cvv", "ssn")


def check_forms(forms: list[dict], f: Findings) -> None:
    """crawl が収集したフォーム定義を静的に検査する（非破壊・送信は一切行わない）。

    検査対象: (a) 平文 HTTP への送信、(b) 機微な POST フォームの anti-CSRF トークン様 hidden 欠如。
    注: password 欄の autocomplete 無効化は ASVS 5.0.0 では要求されない（むしろ
    パスワードマネージャ許可を要求する方針転換があった）ため、検査対象から除外している。"""
    seen_http, seen_csrf = set(), set()
    for form in forms:
        action = (form.get("action") or "").strip()
        page_url = form.get("url", "")
        method = (form.get("method") or "GET").upper()
        inputs = form.get("inputs", [])
        names = [(i.get("name") or "").lower() for i in inputs]
        has_password = any((i.get("type") or "").lower() == "password" for i in inputs)

        # (a) 平文送信: action が http://（機微データが暗号化されない経路で送出される）
        if action.lower().startswith("http://") and action not in seen_http:
            seen_http.add(action)
            note = "（password 欄を含む）" if has_password else ""
            f.add("insecure-form-target", action,
                  f"フォーム送信先が平文 HTTP{note}（method={method}）")

        # (b) 機微な POST フォームに anti-CSRF トークン様 hidden が見当たらない
        if method == "POST" and any(h in n for n in names for h in _SENSITIVE_FIELD_HINTS):
            has_token = any(h in n for n in names for h in _CSRF_TOKEN_HINTS)
            key = action or page_url
            if not has_token and key not in seen_csrf:
                seen_csrf.add(key)
                f.add("missing-csrf-token", key,
                      "機微な POST フォームに anti-CSRF トークン様の hidden フィールドが無い",
                      confidence="Low")


# 組織ドメイン推定の簡易版（PSL を持たないため、代表的な多ラベル公開接尾辞のみ内蔵）。
# 深いサブドメインや稀な多段 ccTLD では推定を外しうるため、所見側で手動確認を促す。
_MULTI_LABEL_SUFFIXES = {
    "co.jp", "ne.jp", "or.jp", "go.jp", "ac.jp", "ad.jp", "ed.jp", "gr.jp", "lg.jp",
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk",
    "com.au", "net.au", "org.au", "gov.au", "edu.au", "co.nz", "org.nz", "govt.nz",
    "co.kr", "or.kr", "ne.kr", "go.kr", "co.in", "co.za", "org.za",
    "com.br", "com.cn", "com.hk", "com.sg", "com.tw", "com.my", "com.ph", "com.vn",
    "com.mx", "com.ar", "com.co", "com.tr", "com.ua", "com.pe", "com.ng", "com.pk",
    "co.id", "co.th", "co.il", "co.ke", "co.jp", "com.eg", "com.sa", "com.pl",
}


def _registrable_domain(host: str) -> str:
    labels = (host or "").strip(".").split(".")
    if len(labels) <= 2:
        return ".".join(labels)
    if ".".join(labels[-2:]) in _MULTI_LABEL_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def dns_available() -> bool:
    try:
        import dns.resolver  # noqa: F401
        return True
    except Exception:
        return False


def _default_dns_query(name: str, rdtype: str) -> list[str]:
    """DNS レコード文字列のリストを返す。レコード不在は []、ネットワーク等の障害は例外送出。"""
    import dns.resolver
    try:
        ans = dns.resolver.resolve(name, rdtype, lifetime=8.0)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    out = []
    for r in ans:
        strings = getattr(r, "strings", None)
        if strings is not None:  # TXT: 分割文字列を結合
            out.append(b"".join(strings).decode("utf-8", "replace"))
        else:
            out.append(str(r))
    return out


def check_dns(target: str, f: Findings, query=None) -> None:
    """DMARC/SPF を受動的に照会する（DNS クエリのみ・非破壊）。

    query は (name, rdtype)->list[str] の呼び出し可能（テスト時にフェイクを注入）。
    ネットワーク障害時は例外を送出し、呼び出し側（カバレッジ台帳）が error として扱う。"""
    q = query or _default_dns_query
    domain = _registrable_domain(urlparse(target).hostname or "")
    if not domain:
        return
    # DMARC（_dmarc.<domain> の TXT）
    dmarc = [t for t in q(f"_dmarc.{domain}", "TXT") if t.lower().startswith("v=dmarc1")]
    if not dmarc:
        f.add("dns-dmarc-missing", domain,
              f"_dmarc.{domain} に DMARC レコード（v=DMARC1）が存在しない", confidence="Medium")
    else:
        m = re.search(r"p\s*=\s*(none|quarantine|reject)", dmarc[0], re.I)
        if m and m.group(1).lower() == "none":
            f.add("dns-dmarc-weak", domain,
                  "DMARC ポリシーが p=none（監視のみでなりすましメールを拒否しない）",
                  confidence="Medium")
    # SPF（ドメイン apex の TXT）
    spf = [t for t in q(domain, "TXT") if t.lower().startswith("v=spf1")]
    if not spf:
        f.add("dns-spf-missing", domain,
              f"{domain} に SPF レコード（v=spf1）が存在しない", confidence="Medium")


def check_https_redirect(target: str, client, f: Findings) -> None:
    """HTTPS 対象について、HTTP アクセスが HTTPS へ確実にリダイレクトされるかを検証。"""
    p = urlparse(target)
    if p.scheme != "https":
        return
    http_url = urlunparse(("http", p.netloc, p.path or "/", "", "", ""))
    try:
        r = client.get(http_url)
    except Exception:
        return
    loc = _headers_lower(r).get("location", "")
    if r.status_code == 200:
        f.add("no-https-redirect", http_url,
              "HTTP アクセスが 200 を返し、HTTPS へリダイレクトされない")
    elif r.status_code in (301, 302, 303, 307, 308) and not loc.lower().startswith("https://"):
        f.add("no-https-redirect", http_url,
              f"HTTP アクセスのリダイレクト先が HTTPS でない（Location={loc}）")


# ===== カバレッジ台帳（診断項目の実施状況を可視化） =====
# (group_id, 表示名, 分類, 種別)。「実施したが問題なし（clean）」「エラー」「未実施」を
# 沈黙で潰さず report に面出しするための土台。旧実装は検出事項のみ列挙していた。
LEDGER_GROUPS = [
    ("security-headers", "セキュリティヘッダ（HSTS/CSP/XFO 等）", "A02/A04/A06", "passive"),
    ("cookies", "Cookie 属性（Secure/HttpOnly/SameSite）", "A01/A02", "passive"),
    ("sri", "外部リソースの SRI（改竄検知）", "A08", "passive"),
    ("outdated-libs", "古いクライアントライブラリの痕跡", "A03", "passive"),
    ("forms", "フォームの安全性（平文送信 / CSRF）", "A01/A04", "passive"),
    ("verbose-error", "詳細エラー / スタックトレース露出", "A10", "passive"),
    ("tls-protocol", "TLS 旧プロトコル受入（1.0/1.1）", "A04", "network"),
    ("tls-cert", "TLS 証明書の有効期限", "A04", "network"),
    ("dns-email-auth", "DNS メール認証（DMARC / SPF）", "A02", "network"),
    ("https-redirect", "HTTP→HTTPS リダイレクト強制", "A04", "active"),
    ("exposed-files", "機微ファイル / パスの公開", "A01", "active"),
    ("directory-listing", "ディレクトリリスティング", "A01", "active"),
    ("cors", "CORS 設定", "A02", "active"),
    ("http-methods", "危険な HTTP メソッド", "A02", "active"),
    ("open-redirect", "オープンリダイレクト", "A01", "active"),
    ("reflected-input", "反射型 XSS の兆候", "A05", "active"),
    ("mixed-content", "混在コンテンツ", "A06", "active"),
]

# 各グループが生成しうる check_id（台帳の finding/clean 判定に使用）
_GROUP_CHECK_IDS = {
    "security-headers": {"missing-hsts", "missing-xcto", "missing-csp", "weak-csp",
                         "missing-frame-options", "missing-referrer-policy",
                         "missing-permissions-policy", "info-disclosure-banner"},
    "cookies": {"cookie-insecure", "cookie-no-httponly", "cookie-no-samesite",
                "cookie-samesite-none-insecure"},
    "sri": {"missing-sri"},
    "outdated-libs": {"outdated-library"},
    "forms": {"insecure-form-target", "missing-csrf-token"},
    "verbose-error": {"verbose-error"},
    "tls-protocol": {"tls-weak-protocol"},
    "tls-cert": {"tls-cert-expiring"},
    "dns-email-auth": {"dns-dmarc-missing", "dns-dmarc-weak", "dns-spf-missing"},
    "https-redirect": {"no-https-redirect"},
    "exposed-files": {"exposed-sensitive-file"},
    "directory-listing": {"directory-listing"},
    "cors": {"cors-misconfig"},
    "http-methods": {"risky-http-method"},
    "open-redirect": {"open-redirect"},
    "reflected-input": {"reflected-input"},
    "mixed-content": {"mixed-content"},
}
_CHECK_TO_GROUP = {cid: gid for gid, cids in _GROUP_CHECK_IDS.items() for cid in cids}

LEDGER_STATUS_JA = {"finding": "検出あり", "clean": "問題なし", "error": "エラー", "skipped": "未実施"}


class Ledger:
    """診断項目ごとの実施状況（検出/問題なし/エラー/未実施）を保持する。"""

    def __init__(self):
        self._rows: dict[str, dict] = {}

    def record(self, group_id: str, status: str, findings: int = 0, note: str = "") -> None:
        self._rows[group_id] = {"status": status, "findings": findings, "note": note}

    def has(self, group_id: str) -> bool:
        return group_id in self._rows

    def rows(self) -> list[dict]:
        out = []
        for gid, label, cat, kind in LEDGER_GROUPS:
            r = self._rows.get(gid, {"status": "skipped", "findings": 0, "note": "未実行"})
            out.append({
                "id": gid, "label": label, "category": cat, "kind": kind,
                "status": r["status"], "status_ja": LEDGER_STATUS_JA.get(r["status"], r["status"]),
                "findings": r["findings"], "note": r["note"],
            })
        return out

    def summary(self) -> dict:
        by: dict[str, int] = {}
        for r in self.rows():
            by[r["status"]] = by.get(r["status"], 0) + 1
        return {"total": len(LEDGER_GROUPS), "by_status": by}


def _dns_target_ok(host: str) -> bool:
    """DNS メール認証チェックの対象になりうるか（IP・ローカル・非 FQDN は対象外）。"""
    if not host or "." not in host or ":" in host:
        return False
    if host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local"):
        return False
    # IPv4 ドット表記
    if host.count(".") == 3 and host.replace(".", "").isdigit():
        return False
    return True


def run_checks(crawl: dict, timeout: float = 15.0, active: bool = True,
               ledger: "Ledger | None" = None) -> list[dict]:
    f = Findings()
    if ledger is None:
        ledger = Ledger()
    scope = crawl.get("scope", {})
    target = scope.get("target", "")
    allowed = set(h.lower() for h in scope.get("hosts", []))
    pages = crawl.get("pages", [])
    rate = scope.get("rate_per_sec", 2.0)
    delay = 1.0 / rate if rate > 0 else 0

    def in_scope(u: str) -> bool:
        return (urlparse(u).hostname or "").lower() in allowed

    ran: set[str] = set()         # 実際に実行できたグループ（未実行を clean にしないための実績記録）
    errored: dict[str, str] = {}  # 例外を送出したグループ。値は例外種別のみ（生の例外文字列に
                                  # 含まれうるリクエスト URL・クエリを台帳へ載せない＝情報開示防止）

    def _safe(gid: str, fn) -> None:
        """チェックを実行し、成功なら ran に、例外なら errored に記録して他項目を巻き込まない。"""
        try:
            fn()
            ran.add(gid)
        except Exception as e:
            errored[gid] = type(e).__name__

    with _client(timeout) as raw:
        # 全通信を _SafeClient 経由に統一し、非破壊メソッドをコードで強制＋レート制御する
        sc = _SafeClient(raw, delay)

        # ===== パッシブ（巡回済みデータから判定・各チェックは個別に error 隔離） =====
        for page in pages:
            if page.get("error") or "status" not in page:
                continue
            try:
                r = sc.get(page["url"])
            except Exception:
                continue
            _safe("security-headers", lambda: check_security_headers(page, _headers_lower(r), f))
            if "text/html" in r.headers.get("content-type", ""):
                _safe("sri", lambda: check_sri(page["url"], r.text, f))
                _safe("verbose-error", lambda: check_verbose_error(page["url"], r.text, f))

        _safe("cookies", lambda: check_cookies(crawl.get("cookies", []), f))
        _safe("outdated-libs", lambda: check_outdated_libraries(pages, f))
        _safe("forms", lambda: check_forms(crawl.get("forms", []), f))

        # TLS（HTTPS 対象のみ・接続/証明書取得の失敗は error として表面化）
        tp = urlparse(target) if target else None
        if tp and tp.scheme == "https":
            host, port = tp.hostname, (tp.port or 443)
            _safe("tls-protocol", lambda: _probe_old_tls(host, port, f, target))
            _safe("tls-cert", lambda: check_cert_expiry(target, f))
        elif target:
            ledger.record("tls-protocol", "skipped", note="HTTPS 対象外")
            ledger.record("tls-cert", "skipped", note="HTTPS 対象外")

        # DNS メール認証（DMARC/SPF）
        dns_host = (tp.hostname if tp else "") or ""
        if target and dns_available() and _dns_target_ok(dns_host):
            _safe("dns-email-auth", lambda: check_dns(target, f))
        elif target:
            note = "dnspython 未導入" if not dns_available() else "IP/ローカル対象のため対象外"
            ledger.record("dns-email-auth", "skipped", note=note)

        # ===== アクティブ（非破壊の能動プローブ） =====
        if active and target and in_scope(target):
            params = [p for p in crawl.get("params", []) if in_scope(p["url"])]
            active_jobs = [
                ("exposed-files", lambda: check_exposed_files(target, sc, f)),
                ("directory-listing", lambda: check_directory_listing(pages, sc, f)),
                ("cors", lambda: check_cors(target, sc, f)),
                ("http-methods", lambda: check_http_methods(target, sc, f)),
                ("https-redirect", lambda: check_https_redirect(target, sc, f)),
                ("open-redirect", lambda: check_open_redirect(params, sc, f)),
                ("reflected-input", lambda: check_reflected_input(params, sc, f)),
                ("mixed-content", lambda: check_mixed_content(pages, sc, f)),
            ]
            for gid, job in active_jobs:
                _safe(gid, job)
        else:
            reason = "能動プローブ無効（--passive-only）" if not active else "対象がスコープ外"
            for gid in ("https-redirect", "exposed-files", "directory-listing", "cors",
                        "http-methods", "open-redirect", "reflected-input", "mixed-content"):
                if not ledger.has(gid):
                    ledger.record(gid, "skipped", note=reason)

    # ===== 台帳の確定（finding > error > clean > skipped） =====
    # finding を error より優先し、所見のある群は本文と整合させる（error は注記で併記）。
    # 実行実績（ran）の無い群は clean でなく skipped とし、未検査を沈黙で合格にしない。
    found_counts: dict[str, int] = {}
    for it in f.as_list():
        gid = _CHECK_TO_GROUP.get(it["check_id"])
        if gid:
            found_counts[gid] = found_counts.get(gid, 0) + 1
    for gid, _label, _cat, _kind in LEDGER_GROUPS:
        if ledger.has(gid):
            continue
        n = found_counts.get(gid, 0)
        if n > 0:
            note = f"一部エラー（{errored[gid]}）" if gid in errored else ""
            ledger.record(gid, "finding", findings=n, note=note)
        elif gid in errored:
            ledger.record(gid, "error", note=errored[gid])
        elif gid in ran:
            ledger.record(gid, "clean")
        else:
            ledger.record(gid, "skipped", note="対象応答なし／未実施")

    return f.as_list()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="非破壊チェックエンジン")
    ap.add_argument("--crawl", required=True, help="crawl.json のパス")
    ap.add_argument("--out", default="findings.json")
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument("--passive-only", action="store_true", help="能動プローブを行わない")
    args = ap.parse_args(argv)

    with open(args.crawl, encoding="utf-8") as fp:
        crawl = json.load(fp)

    ledger = Ledger()
    findings = run_checks(crawl, timeout=args.timeout, active=not args.passive_only, ledger=ledger)
    out = {
        "target": crawl.get("scope", {}).get("target", ""),
        "generated_at": _now_iso(),
        "scope": crawl.get("scope", {}),
        "findings": findings,
        "coverage": ledger.rows(),
        "coverage_summary": ledger.summary(),
    }
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=2)
    print(f"[checks] {len(findings)} 件の所見を {args.out} に保存しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
