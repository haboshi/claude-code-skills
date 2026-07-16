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
from pathlib import Path
from urllib.parse import urlparse, urlencode, urlunparse, parse_qsl, urljoin

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


class ActiveAuthViolation(RuntimeError):
    """能動認証テストの境界（login URL への POST 以外）に反する送信を検出したときに送出。"""


# 能動認証テストの client 側 blast-radius バックストップ（関数側の試行上限とは別の二重防御）
_CLIENT_POST_CAP = 10
# ログインレート制限テストの試行ハードキャップ（関数側で min(要求, これ) にクランプ）
_LOGIN_HARD_CAP = 8
# login-rate-limit の台帳区分ごとの備考（finding/clean/inconclusive を明示 record するときに使う）
_LOGIN_RL_STATUS_NOTE = {
    "finding": "",
    "clean": "レート制限層に到達しスロットリングを確認（防御あり）",
    "inconclusive": "CSRF/前段拒否等でレート制限層に到達できず判定保留（要手動確認）",
}


class _ActiveAuthClient:
    """Phase 3 能動認証テスト専用の **POST 限定・login URL 限定** クライアント（既定 OFF）。

    許可するのは指定された単一 login エンドポイントへの POST のみ。他メソッド・他 URL は
    ActiveAuthViolation を送出して送信自体を拒否する（blast radius 最小化）。非破壊境界の
    `_SafeClient` とは完全に別クラスで、そのコード強制 GET 境界には一切手を触れない。"""

    def __init__(self, client: httpx.Client, login_url: str, delay: float = 0.0,
                 hard_cap: int = _CLIENT_POST_CAP):
        self._c = client
        self._login_url = login_url
        self._delay = delay
        self.hard_cap = hard_cap
        self._posts = 0

    def post(self, url, **kwargs):
        if url != self._login_url:
            raise ActiveAuthViolation(
                "能動認証: 許可された login URL 以外への送信は拒否されました")
        if self._posts >= self.hard_cap:
            raise ActiveAuthViolation(
                f"能動認証: client ハードキャップ {self.hard_cap} 回に到達したため送信を停止")
        self._posts += 1
        if self._delay:
            time.sleep(self._delay)
        return self._c.post(url, **kwargs)

    def request(self, method, url, **kwargs):
        if method.upper() != "POST":
            raise ActiveAuthViolation(f"能動認証: メソッド {method} は許可されません（POST のみ）")
        return self.post(url, **kwargs)


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
    # v0.4 ヘッダ補完: COOP 欠如 / 非推奨 X-XSS-Protection の有効値
    if "cross-origin-opener-policy" not in headers:
        f.add("missing-coop", url, "Cross-Origin-Opener-Policy が未設定", confidence="Low")
    xxp = headers.get("x-xss-protection", "").strip()
    if xxp and not xxp.startswith("0"):
        f.add("xss-protection-legacy", url,
              f"非推奨の X-XSS-Protection が有効値で設定（{xxp[:40]}）。近代ブラウザでは無効化(0)を推奨",
              confidence="Low")
    server = headers.get("server", "")
    powered = headers.get("x-powered-by", "")
    banner = "; ".join(x for x in (server, powered) if x)
    # 版数様トークン（`2.4.68` や `/1` 等）を含む場合のみバージョン露出とする。
    # 単なる製品名（"AmazonS3" の "S3" など）の数字で誤発火しないようにする。
    if banner and re.search(r"\d+\.\d+|/\d", banner):
        f.add("info-disclosure-banner", url, f"バージョン露出: {banner}", confidence="Medium")


# ===== v0.5 A4: CSP 深掘り解析（受動・default-src フォールバック考慮・明確なバイパスのみ） =====
# script-src/object-src で「広すぎる」とみなす source（任意ホスト/スキームからの読込を許す）
_CSP_WIDE_SOURCES = ("*", "https:", "http:", "data:")
# default-src にフォールバックする fetch ディレクティブ（base-uri/form-action/frame-ancestors はしない）
_CSP_FETCH_FALLBACK = {"script-src", "object-src", "style-src", "img-src", "connect-src",
                       "worker-src", "child-src", "frame-src", "font-src", "media-src"}


def _parse_csp(csp: str) -> dict[str, list[str]]:
    """CSP を {ディレクティブ名(小文字): [source, ...]} に分解する。"""
    out: dict[str, list[str]] = {}
    for part in (csp or "").split(";"):
        toks = part.split()
        if not toks:
            continue
        out[toks[0].lower()] = [t for t in toks[1:]]
    return out


def _csp_effective(directives: dict[str, list[str]], name: str) -> list[str] | None:
    """指定ディレクティブの実効 source を返す。未設定の fetch ディレクティブは default-src へ
    フォールバックする。フォールバック対象外（base-uri 等）や default-src も無い場合は None。"""
    if name in directives:
        return directives[name]
    if name in _CSP_FETCH_FALLBACK:
        return directives.get("default-src")
    return None


def _analyze_csp(csp: str) -> list[str]:
    """CSP の明確なバイパス条件のみを列挙する（過検知回避）。default-src フォールバックを考慮し、
    `default-src 'none'` 等で実効的に無害な指定は指摘しない。"""
    d = _parse_csp(csp)
    issues: list[str] = []
    script = _csp_effective(d, "script-src")
    script_low = [s.lower() for s in script] if script is not None else None
    scripts_blocked = script_low == ["'none'"]

    if script is None:
        issues.append("script-src も default-src も未設定＝スクリプト source が無制限")
    elif not scripts_blocked:
        has_nonce_hash = any(s.startswith(("'nonce-", "'sha")) for s in script_low)
        if "'unsafe-inline'" in script_low and not has_nonce_hash:
            issues.append("script-src に 'unsafe-inline'（nonce/hash 無し）＝インラインスクリプト注入を許す")
        wide = sorted({s for s in script_low if s in _CSP_WIDE_SOURCES})
        if wide:
            issues.append(f"script-src に広すぎる source（{', '.join(wide)}）＝任意ホスト/データ URI からの読込を許す")

    obj = _csp_effective(d, "object-src")
    if obj is None:
        issues.append("object-src も default-src も未設定＝<object>/<embed> の source が無制限")
    else:
        obj_wide = sorted({s.lower() for s in obj if s.lower() in _CSP_WIDE_SOURCES})
        if obj_wide:
            issues.append(f"object-src に広すぎる source（{', '.join(obj_wide)}）＝プラグイン/オブジェクト注入の余地")

    # base-uri/form-action は default-src にフォールバックしない。スクリプトが全面ブロック
    # （script/default が 'none'）なら実効無害なので指摘しない（FP回避）。
    if not scripts_blocked:
        if "base-uri" not in d:
            issues.append("base-uri 未設定＝<base> 注入で相対スクリプト URL の解決先を乗っ取れる")
        if "form-action" not in d:
            issues.append("form-action 未設定＝フォームの送信先を CSP で制限できない")
    return issues


def check_csp(url: str, csp: str, f: Findings) -> None:
    """CSP をディレクティブ解析し、明確なバイパス条件のみを **1所見に集約** する（受動・非破壊）。

    CSP 未設定は missing-csp が担当するため本関数では扱わない（未設定なら何もしない）。
    `default-src` フォールバックを正しく評価し、object-src 未設定でも `default-src 'none'` なら
    安全と判定する。unsafe-inline（nonce/hash 無し）があるときのみ確度 High（明確なバイパス）。"""
    if not csp or not csp.strip():
        return
    issues = _analyze_csp(csp)
    if not issues:
        return
    strong = any("unsafe-inline" in it for it in issues)
    f.add("csp-bypassable", url,
          "CSP にバイパス可能な条件: " + " / ".join(issues),
          confidence="High" if strong else "Medium")


# CSRF トークン系 Cookie 名（小文字比較）。SPA が JS で読み X-XSRF-TOKEN/_token に載せる
# 前提で **意図的に JS 読取可**（HttpOnly 不可）であり、cookie-no-httponly の誤検知対象。
# 例: Laravel の XSRF-TOKEN、Django の csrftoken。Secure/SameSite の検査は継続する。
_CSRF_READABLE_COOKIE_NAMES = {
    "xsrf-token", "csrf-token", "x-csrf-token", "_csrf", "csrf", "csrf_token", "csrftoken",
}


def check_cookies(cookies: list[dict], f: Findings) -> None:
    for c in cookies:
        is_https = c["url"].startswith("https")
        # CSRF トークン Cookie は設計上 JS 読取可（HttpOnly 不要）。誤検知回避のため
        # cookie-no-httponly の対象から除外する（Secure/SameSite は引き続き検査する）。
        is_csrf_readable = str(c["name"]).strip().lower() in _CSRF_READABLE_COOKIE_NAMES
        if is_https and not c["secure"]:
            f.add("cookie-insecure", c["url"], f"Cookie '{c['name']}' に Secure 属性が無い")
        if not c["httponly"] and not is_csrf_readable:
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


# G2: TLS 証明書の検証失敗（ホスト名不一致/期限切れ/自己署名/チェーン不備）を分類する純関数。
def _classify_cert_error(msg: str) -> str:
    low = (msg or "").lower()
    if any(k in low for k in ("hostname mismatch", "doesn't match", "no match",
                              "ip address mismatch", "not valid for")):
        return "ホスト名不一致（証明書の SAN/subject が対象ホストと一致しない）"
    if "not yet valid" in low:
        return "証明書の有効期間前（notBefore が未来）"
    if "expired" in low:
        return "証明書の期限切れ"
    if "self-signed" in low or "self signed" in low:
        return "自己署名証明書（信頼された CA でない）"
    if any(k in low for k in ("unable to get local issuer", "unable to get issuer", "chain")):
        return "中間証明書/チェーン不備（発行者をたどれない）"
    return "証明書検証失敗（信頼チェーンが成立しない）"


def _verify_cert(host: str, port: int, timeout: float = 10.0) -> bool:
    """証明書検証つきで TLS ハンドシェイクする。検証失敗は ssl.SSLCertVerificationError を送出。"""
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host):
            return True


def check_cert_validity(target: str, f: Findings, verify=None) -> None:
    """TLS 証明書の**検証失敗**（ホスト名不一致・期限切れ・自己署名・チェーン不備）を finding 化する。

    検証成功なら何もしない（期限接近は check_cert_expiry が担当）。検証失敗のみ tls-cert-invalid を
    emit し、接続不能等の非検証エラーは送出して呼び出し側（台帳）が error として扱う。
    verify は (host, port)->bool の呼び出し可能（テストで fake を注入）。"""
    parsed = urlparse(target)
    if parsed.scheme != "https":
        return
    host = parsed.hostname
    port = parsed.port or 443
    v = verify or _verify_cert
    try:
        v(host, port)
    except ssl.SSLCertVerificationError as e:
        reason = _classify_cert_error(getattr(e, "verify_message", "") or str(e))
        f.add("tls-cert-invalid", target, f"TLS 証明書の検証に失敗: {reason}", confidence="High")


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


# v0.4 是正: 汎用の lib 名+版数抽出 ＋ 内蔵の危殆版下限表。
# 旧実装は jquery-1./jquery/1./jquery-2./angular.js/1. のみをハードコードし、`jquery/2.`
# （スラッシュ表記 2.x）を見逃し、bootstrap/react/vue の評価ロジックが死蔵していた。
_LIB_VER_RE = re.compile(
    r"(jquery|bootstrap|vue|react|angular(?:\.js)?|lodash|moment|axios)"
    r"[.\-/]?v?(\d+)\.(\d+)(?:\.(\d+))?", re.I)
# lib -> (既知の問題を含む版の上限。この版未満を危殆版候補として Medium 確度で指摘)
_LIB_VULN_FLOORS = {
    "jquery": (3, 5, 0),      # <3.5.0: CVE-2020-11022/11023（XSS）
    "bootstrap": (4, 3, 1),   # <4.3.1（3.x は <3.4.1）: XSS
    "angular": (2, 0, 0),     # AngularJS 1.x は EOL（2.x 以降のモダン Angular は対象外）
    "vue": (3, 0, 0),         # Vue 2.x は 2023-12 EOL
    "lodash": (4, 17, 21),    # <4.17.21: プロトタイプ汚染
    "moment": (2, 29, 4),     # <2.29.4: ReDoS（moment 自体もメンテ終了）
    "axios": (1, 6, 0),       # 旧 0.x: SSRF/CSRF 系の既知問題
    "react": (16, 0, 0),      # <16 は非常に古い（EOL 目安）
}


def check_outdated_libraries(pages: list[dict], f: Findings) -> None:
    """crawl の technologies（js: <src>）と script_srcs から lib 名+版数を汎用抽出し、
    内蔵の危殆版下限表と比較する（受動・非破壊）。CVE 断定は外部 DB 併用時のみ。"""
    seen: set[tuple] = set()
    for page in pages:
        haystacks = [t for t in page.get("technologies", []) if t.lower().startswith("js:")]
        haystacks.extend(page.get("script_srcs", []))
        for hay in haystacks:
            for m in _LIB_VER_RE.finditer(hay):
                lib = m.group(1).lower().replace(".js", "")
                ver = (int(m.group(2)), int(m.group(3)), int(m.group(4) or 0))
                floor = _LIB_VULN_FLOORS.get(lib)
                if not floor or ver >= floor:
                    continue  # floor 不明・下限以上は誤検知回避のため所見化しない
                key = (page.get("url", ""), lib, ver)
                if key in seen:
                    continue
                seen.add(key)
                vs = ".".join(str(n) for n in ver)
                fl = ".".join(str(n) for n in floor)
                f.add("outdated-library", page.get("url", ""),
                      f"危殆版の可能性: {lib} {vs}（既知の問題を含む版下限 {fl} 未満）",
                      confidence="Medium")


# ===== v0.5 A2: 内蔵オフライン署名DB（retire.js 形式）による CVE 相関（非egress） =====
# 検出した lib+版数を references/js-vuln-signatures.json と突合し、危殆版一致で具体 CVE を提示する。
# 長い名前を先に置く（jquery-ui は jquery の前・angularjs/angular.js は angular の前）。
_JS_CVE_LIB_RE = re.compile(
    r"(jquery-ui|jquery\.ui|jqueryui|jquery|bootstrap|angularjs|angular\.js|angular|"
    r"lodash|moment|axios|handlebars|dompurify)"
    r"[.\-/]?v?(\d+)\.(\d+)(?:\.(\d+))?", re.I)
# DB の severity → per-finding CVSS 4.0 ベクタ・事前計算スコア（cvss ライブラリで検算済み）。
# catalog の js-known-cve 既定（medium 5.1）を DB severity に応じ原子的に上書きする。
_JS_CVE_SEVERITY_VECTORS = {
    "low":      ("CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N", 2.1),
    "medium":   ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N", 5.1),
    "high":     ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:H/VI:L/VA:N/SC:N/SI:N/SA:N", 7.0),
    "critical": ("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:N", 9.9),
}
_JS_CVE_SEV_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
_JS_SIG_PATH = Path(__file__).resolve().parent.parent / "references" / "js-vuln-signatures.json"
_JS_SIG_CACHE: dict | None = None


def _load_js_signatures() -> dict:
    """内蔵オフライン署名DB を読み込む（キャッシュ）。不在・破損時は空 DB（＝所見ゼロ）で継続。"""
    global _JS_SIG_CACHE
    if _JS_SIG_CACHE is None:
        try:
            _JS_SIG_CACHE = json.loads(_JS_SIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            _JS_SIG_CACHE = {"signatures": {}, "snapshot_date": ""}
    return _JS_SIG_CACHE


def _parse_ver(s: str) -> tuple:
    parts = ((s or "").split(".") + ["0", "0", "0"])[:3]
    return tuple(int(re.sub(r"\D", "", p) or 0) for p in parts)


def _normalize_js_lib(raw: str, ver: tuple) -> str | None:
    """抽出した lib 名を署名DB のキーへ正規化する。modern Angular(2+) は DB 対象外＝None。"""
    n = raw.lower()
    if n in ("jquery-ui", "jquery.ui", "jqueryui"):
        return "jquery-ui"
    if n in ("angular", "angular.js", "angularjs"):
        return "angularjs" if ver[0] == 1 else None
    return n


def check_js_known_cve(pages: list[dict], f: Findings, db: dict | None = None) -> None:
    """検出済み JS ライブラリ（script_srcs / technologies の js:）を内蔵署名DB と突合し、
    危殆版一致で具体 CVE と重大度を提示する（純解析・非破壊・非egress）。

    同一 (lib, 版数) は 1 所見に集約し、一致署名の全 CVE を列挙・最も重い severity を採用する。
    確度は明示版数の一致ゆえ High。severity に応じ per-finding でベクタ/スコア/タイトルを上書きする。"""
    sigs = db if db is not None else _load_js_signatures()
    signatures = sigs.get("signatures", {})
    snap = sigs.get("snapshot_date", "")
    if not signatures:
        return
    seen: set[tuple] = set()
    for page in pages:
        hay = [t for t in page.get("technologies", []) if t.lower().startswith("js:")]
        hay.extend(page.get("script_srcs", []))
        for s in hay:
            for m in _JS_CVE_LIB_RE.finditer(s):
                ver = (int(m.group(2)), int(m.group(3)), int(m.group(4) or 0))
                lib = _normalize_js_lib(m.group(1), ver)
                if not lib or lib not in signatures:
                    continue
                matched = [sig for sig in signatures[lib] if ver < _parse_ver(sig.get("below", "0"))]
                if not matched:
                    continue
                key = (page.get("url", ""), lib, ver)
                if key in seen:
                    continue
                seen.add(key)
                cves: list[str] = []
                for sig in matched:
                    for c in sig.get("cve", []):
                        if c not in cves:
                            cves.append(c)
                worst = max((sig.get("severity", "medium") for sig in matched),
                            key=lambda x: _JS_CVE_SEV_RANK.get(x, 2))
                vec, score = _JS_CVE_SEVERITY_VECTORS.get(worst, _JS_CVE_SEVERITY_VECTORS["medium"])
                notes = []
                for sig in matched:
                    nt = sig.get("note", "")
                    if nt and nt not in notes:
                        notes.append(nt)
                vs = ".".join(str(n) for n in ver)
                snap_note = f"{snap} 時点の署名DBに基づく（要定期更新）。" if snap else "署名DBに基づく（要定期更新）。"
                f.add("js-known-cve", page.get("url", ""),
                      f"既知の脆弱性を含む {lib} {vs}: {', '.join(cves)}"
                      f"（重大度 {worst}／{'; '.join(notes)}）。{snap_note}",
                      confidence="High",
                      extra={"title": f"既知のCVEを含むJSライブラリ: {lib} {vs}",
                             "cvss_vector": vec, "cvss_score": score})


# ===== v0.4 フレームワーク/インフラ指紋（情報カテゴリ） =====
_FW_LABEL = {"laravel-csrf-meta": "Laravel", "vue": "Vue", "react": "React",
             "angular": "Angular", "next": "Next.js", "nuxt": "Nuxt", "wordpress": "WordPress"}
_COOKIE_FW = [
    (re.compile(r"^(laravel_session|xsrf-token)$", re.I), "Laravel"),
    (re.compile(r"^(wordpress_|wp-settings)", re.I), "WordPress"),
    (re.compile(r"^csrftoken$", re.I), "Django"),
    (re.compile(r"^_[a-z0-9_]+_session$", re.I), "Rails"),
]


def check_framework_fingerprint(pages: list[dict], cookies: list[dict], f: Findings) -> None:
    """ヘッダ・Cookie・DOM/スクリプトパスの複数シグナルからスタックを推定する（情報カテゴリ・
    受動）。単体では脆弱性でなく Info(0.0) の1所見に集約。EOL/CVE 判定の入力に用いる。"""
    fw_signals: dict[str, set[str]] = {}
    infra: set[str] = set()

    def add(fw: str, sig: str) -> None:
        fw_signals.setdefault(fw, set()).add(sig)

    for c in cookies or []:
        name = c.get("name") or ""
        for rx, fw in _COOKIE_FW:
            if rx.match(name):
                add(fw, "cookie")
    for page in pages:
        for m in page.get("client_fw", []):
            add(_FW_LABEL.get(m, m), "dom")
        for tech in page.get("technologies", []):
            low = tech.lower()
            if "awselb" in low:
                infra.add("AWS ELB")
            if low.startswith("cf-ray"):
                infra.add("Cloudflare")
            if low.startswith("x-vercel-id"):
                infra.add("Vercel")
            if low.startswith("via:"):
                infra.add("プロキシ/CDN (Via)")
            if low.startswith("x-amz-cf-id"):
                infra.add("Amazon CloudFront")
            if "x-runtime" in low:
                add("Rails", "header")

    if not fw_signals and not infra:
        return
    parts = []
    if fw_signals:
        parts.append("FW: " + ", ".join(sorted(fw_signals)))
    if infra:
        parts.append("インフラ: " + ", ".join(sorted(infra)))
    multi = any(len(s) >= 2 for s in fw_signals.values())
    f.add("stack-fingerprint", pages[0]["url"] if pages else "",
          "検出スタック — " + " / ".join(parts),
          confidence="High" if multi else "Medium")


# ===== v0.4 EOL ランタイム判定（内蔵オフライン表・バックポート注記） =====
# (製品名, banner 抽出正規表現, 危殆判定 predicate(version tuple)->bool, 注記)
_EOL_RULES = [
    ("PHP", re.compile(r"PHP/(\d+)\.(\d+)", re.I), lambda n: n <= (8, 0),
     "PHP 8.0 は 2023-11、7.4 は 2022-11 に upstream EOL"),
    ("Apache httpd", re.compile(r"Apache/(\d+)\.(\d+)", re.I), lambda n: n <= (2, 2),
     "Apache httpd 2.2 系は 2018-01 に EOL"),
    ("OpenSSL", re.compile(r"OpenSSL/(\d+)\.(\d+)\.(\d+)", re.I), lambda n: n[0] <= 1,
     "OpenSSL 1.x 系は 2023-09（1.1.1 終了）までに全て upstream EOL"),
    ("nginx", re.compile(r"nginx/(\d+)\.(\d+)", re.I), lambda n: n < (1, 18),
     "nginx 1.18 未満は旧く、サポート状況の確認を要する"),
]


def check_eol_runtime(pages: list[dict], f: Findings) -> None:
    """banner の版数 × 内蔵オフライン EOL 表で upstream EOL を推定する（受動）。
    バックポート保守の可能性ゆえ「脆弱」とは断定せず確度 Medium とする。"""
    banners: set[str] = set()
    for page in pages:
        b = page.get("server", "") or ""
        for t in page.get("technologies", []):
            if t.lower().startswith(("server:", "x-powered-by:")):
                b += " " + t.split(":", 1)[1]
        if b.strip():
            banners.add(b.strip())
    seen: set[tuple] = set()
    src = pages[0]["url"] if pages else ""
    for banner in banners:
        for product, rx, pred, note in _EOL_RULES:
            for m in rx.finditer(banner):
                nums = tuple(int(x) for x in m.groups())
                if not pred(nums):
                    continue
                ver = ".".join(str(n) for n in nums)
                key = (product, ver)
                if key in seen:
                    continue
                seen.add(key)
                f.add("eol-runtime", src,
                      f"{product} {ver}: {note}。upstream EOL 疑い（ディストロのバックポート"
                      f"保守を要確認・単体では脆弱と断定しない）。",
                      confidence="Medium")


# v0.4 ルート/EP 露出: 機微語を含むルートのみを対象化し、期待ルートは除外する。
_SENSITIVE_ROUTE_RE = re.compile(
    r"(admin|user[-_]?management|users|download|generate|storage|export|delete|backup|"
    r"invoice|payment|contract|impersonate)", re.I)
# 認証系の期待ルートは露出しても衛生的に自然なため除外（件数インフレ防止）
_EXPECTED_ROUTE_RE = re.compile(
    r"(?:^|[./])(login|logout|home|password|reset|forgot|verification|verify|register|welcome)"
    r"(?:$|[./])", re.I)


def check_route_disclosure(pages: list[dict], f: Findings) -> None:
    """crawl が捕捉したルート blob（Ziggy/Inertia/Next/JS 内 api）から、機微なルート/EP 名を
    抽出する（受動・非破壊）。**1 所見に集約**し件数インフレとグレード算術崩壊を避ける。

    ルート名はクライアントに配布済みの公開情報のため evidence への掲載は秘密漏洩でない。"""
    sensitive: list[str] = []
    seen: set[str] = set()
    source_url = ""
    for page in pages:
        rm = page.get("route_markers") or {}
        candidates: list[tuple[str, str]] = []
        for r in rm.get("ziggy", []):
            candidates.append((r.get("name", ""), r.get("uri", "")))
        for p in rm.get("api_paths", []):
            candidates.append(("", p))
        for name, uri in candidates:
            hay = f"{name} {uri}"
            if _EXPECTED_ROUTE_RE.search(hay):
                continue
            if not _SENSITIVE_ROUTE_RE.search(hay):
                continue
            key = (name or uri).strip()
            if key and key not in seen:
                seen.add(key)
                sensitive.append(name or uri)
                if not source_url:
                    source_url = page.get("url", "")
    if sensitive:
        total = len(sensitive)
        sample = ", ".join(sensitive[:8])
        more = "" if total <= 8 else f" ほか{total - 8}件"
        f.add("route-disclosure", source_url or (pages[0]["url"] if pages else ""),
              f"未認証ページ由来の JS から機微なルート/EP 名を {total} 件抽出（例: {sample}{more}）。"
              f"ルート名の開示であり到達・悪用可能とは限らない。",
              confidence="High")


# ===== v0.4 外部 JS の上限付き取得（DoS/スコープ逸脱の回避） =====
# 秘密は同一オリジンの first-party バンドルに載るのが通例。取得先は same-origin か
# CDN allowlist に限定し、件数・サイズを上限で縛る。
_CDN_ALLOWLIST = {
    "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "ajax.googleapis.com",
    "code.jquery.com", "stackpath.bootstrapcdn.com", "maxcdn.bootstrapcdn.com",
}
_MAX_JS_FILES = 12
_MAX_JS_BYTES = 2_000_000


def _collect_script_srcs(pages: list[dict]) -> list[str]:
    out, seen = [], set()
    for page in pages:
        for s in page.get("script_srcs", []):
            if s not in seen:
                seen.add(s)
                out.append(s)
    return out


def _bounded_fetch_scripts(urls: list[str], client, allowed_hosts: set[str],
                           limit: int = _MAX_JS_FILES, max_bytes: int = _MAX_JS_BYTES
                           ) -> list[tuple[str, str]]:
    """same-origin または CDN allowlist の JS を件数・サイズ上限つきで取得する（GET のみ）。"""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for u in urls:
        if len(out) >= limit:
            break
        host = (urlparse(u).hostname or "").lower()
        if host not in allowed_hosts and host not in _CDN_ALLOWLIST:
            continue
        if u in seen:
            continue
        seen.add(u)
        try:
            r = client.get(u)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        if "html" in r.headers.get("content-type", "").lower():
            continue  # HTML フォールバック（SPA catch-all）は JS でないため除外
        body = r.text
        out.append((u, body[:max_bytes] if len(body) > max_bytes else body))
    return out


# 高特異度の秘密パターン（gitleaks 既定 ruleset 準拠）。公開クライアント鍵（pk_live/AIza/
# Firebase）は正当な公開情報のため**検出対象に含めない**（誤検知しない）。
_SECRET_PATTERNS = [
    ("AWS アクセスキー", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Stripe シークレットキー", re.compile(r"sk_live_[0-9a-zA-Z]{24,}")),
    ("GitHub Personal Access Token", re.compile(r"ghp_[0-9A-Za-z]{36}")),
    ("Slack トークン", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}")),
    ("秘密鍵 (PEM)", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("GCP サービスアカウント秘密鍵", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
]
# 既知の example/公開接頭辞（真陽性から除外）
_SECRET_EXAMPLE_ALLOW = {"AKIAIOSFODNN7EXAMPLE"}
_PUBLIC_KEY_PREFIXES = ("pk_live_", "pk_test_", "AIza", "G-", "UA-", "GTM-", "ga_")
# keyword 付随の高エントロピー・トークン（specific に載らない秘密の補助・確度 Medium）
_GENERIC_SECRET_RE = re.compile(
    r"""(?i)(?:secret|token|api[_-]?key|password|passwd|access[_-]?key)["']?\s*[:=]\s*"""
    r"""["']([A-Za-z0-9/+_\-]{24,})["']""")


def _shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    from math import log2
    counts: dict[str, int] = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * log2(c / n) for c in counts.values())


def check_js_secrets(script_bodies: list[tuple[str, str]], f: Findings) -> None:
    """取得済み JS 本文（[(url, body)]）を走査して秘密の露出を検出する（純解析・非破壊）。

    evidence には**種別と場所のみ**を載せ、生値は一切載せない（dangerous-data-handling 整合）。
    公開クライアント鍵（pk_live/AIza/Firebase）は検出対象外＝誤検知しない。"""
    seen: set[tuple] = set()
    for url, body in script_bodies:
        body = body or ""
        for label, rx in _SECRET_PATTERNS:
            for m in rx.finditer(body):
                if m.group(0) in _SECRET_EXAMPLE_ALLOW:
                    continue
                key = (label, url)
                if key in seen:
                    continue
                seen.add(key)
                f.add("js-secret-exposure", url,
                      f"種別: {label} の疑い / 出所: 外部 JS（生値は非掲載）", confidence="High")
        for m in _GENERIC_SECRET_RE.finditer(body):
            val = m.group(1)
            if val in _SECRET_EXAMPLE_ALLOW or any(val.startswith(p) for p in _PUBLIC_KEY_PREFIXES):
                continue
            if _shannon_entropy(val) < 4.2:
                continue
            key = ("generic", url)
            if key in seen:
                continue
            seen.add(key)
            f.add("js-secret-exposure", url,
                  "種別: 高エントロピーの秘密様トークン（keyword 付随）/ 出所: 外部 JS（生値は非掲載）",
                  confidence="Medium")


# ===== v0.4 認証必須ルートの保護確認（未認証 GET → 302/401/403=保護 / 200=露出疑い） =====
_AUTH_SENSITIVE_PATHS = [
    "/admin", "/administrator", "/user-management", "/users", "/export", "/data-export",
    "/upload", "/settings", "/config", "/dashboard", "/api/admin", "/actuator",
    "/swagger", "/graphql",
]


def _collect_robots_sitemap_paths(root: str, client) -> list[str]:
    """robots.txt Disallow / sitemap.xml の <loc> から機微語を含むパスを収集（GET のみ）。"""
    out: list[str] = []
    try:
        r = client.get(root + "/robots.txt")
        if r.status_code == 200 and "html" not in r.headers.get("content-type", "").lower():
            for line in r.text.splitlines():
                low = line.strip()
                if low.lower().startswith("disallow:"):
                    p = low.split(":", 1)[1].strip().split("*")[0]
                    if p.startswith("/") and _SENSITIVE_ROUTE_RE.search(p):
                        out.append(p.rstrip("/") or p)
    except Exception:
        pass
    try:
        r = client.get(root + "/sitemap.xml")
        if r.status_code == 200:
            for m in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text):
                pp = urlparse(m).path
                if pp.startswith("/") and _SENSITIVE_ROUTE_RE.search(pp):
                    out.append(pp)
    except Exception:
        pass
    return out


def check_auth_routes(target: str, pages: list[dict], client, f: Findings,
                      extra_paths: list[str] | None = None) -> None:
    base = urlparse(target)
    root = urlunparse((base.scheme, base.netloc, "", "", "", ""))
    baseline_len = -1
    try:
        b = client.get(root + "/vwr-nonexistent-auth-7c3f")
        if b.status_code == 200:
            baseline_len = len(b.text)
    except Exception:
        pass
    paths = list(dict.fromkeys(_AUTH_SENSITIVE_PATHS + list(extra_paths or [])))
    for path in paths:
        if not path.startswith("/"):
            continue
        try:
            r = client.get(root + path)
        except Exception:
            continue
        if r.status_code in (301, 302, 401, 403):
            continue  # 保護されている（リダイレクト/認証要求）＝正常
        if r.status_code != 200:
            continue
        # soft-404 / SPA フォールバック（index と本文長が酷似）は露出でなくフォールバックと判定
        if baseline_len >= 0 and abs(len(r.text) - baseline_len) < 64:
            continue
        f.add("unauth-sensitive-route", root + path,
              f"機微パス {path} が未認証 GET で 200 を返す（保護リダイレクト/401/403 なし）。"
              f"公開が意図的な可能性もあり認可設計の確認を要する。", confidence="Medium")


# ===== v0.4 ソースマップ露出（実体確認で HTML フォールバック誤検知を除去） =====
_SOURCEMAP_RE = re.compile(r"(?://[#@]\s*sourceMappingURL=)(\S+)")


def check_source_map(script_bodies: list[tuple[str, str]], client, f: Findings,
                     allowed_hosts: set[str] | None = None) -> None:
    """JS 末尾の `//# sourceMappingURL=` を辿るか `.map` を推測して取得し、**実体確認**する。

    200 かつ本文が `{"version":3` の JSON で `"mappings"` を含む場合のみ露出と判定し、
    SPA の HTML フォールバック（200 でも中身は index.html）を誤検知しない。"""
    allowed_hosts = allowed_hosts or set()
    seen: set[str] = set()
    for url, body in script_bodies:
        m = _SOURCEMAP_RE.search(body or "")
        if m:
            ref = m.group(1).strip()
            if ref.startswith("data:"):
                continue  # inline data URI は露出でない
            map_url = urljoin(url, ref)
        else:
            map_url = url + ".map"  # 慣習的推測
        # SSRF 防止: sourceMappingURL は対象由来の任意ホスト（内部 IP・クラウドメタデータ等）を
        # 指しうるため、_bounded_fetch_scripts と同じく same-origin または CDN allowlist の
        # ホストにのみ取得を限定する（allowed_hosts 未指定なら fail-closed で取得しない）。
        map_host = (urlparse(map_url).hostname or "").lower()
        if map_host not in allowed_hosts and map_host not in _CDN_ALLOWLIST:
            continue
        if map_url in seen:
            continue
        seen.add(map_url)
        try:
            r = client.get(map_url)
        except Exception:
            continue
        if r.status_code != 200 or "html" in r.headers.get("content-type", "").lower():
            continue
        text = (r.text or "").lstrip()
        compact = text.replace(" ", "")
        if not (text.startswith("{") and '"version":3' in compact and '"mappings"' in text):
            continue  # 実体確認（HTML フォールバック等を除去）
        has_sources = '"sourcesContent"' in text
        note = "（sourcesContent 有り＝原ソース露出に格上げ）" if has_sources else ""
        f.add("sourcemap-exposure", map_url,
              f"ソースマップが取得可能（version:3 の実体確認済み）{note}",
              confidence="High" if has_sources else "Medium")


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


def check_dnssec(target: str, f: Findings, query=None) -> None:
    """DNSSEC（DNSKEY/DS）の有無を受動照会する（DNS クエリのみ・非破壊）。

    query は (name, rdtype)->list[str] の呼び出し可能（テストでフェイク注入）。
    DNSKEY/DS が双方空なら未署名と判定する。"""
    q = query or _default_dns_query
    domain = _registrable_domain(urlparse(target).hostname or "")
    if not domain:
        return
    dnskey = q(domain, "DNSKEY")
    ds = q(domain, "DS")
    if not dnskey and not ds:
        f.add("dnssec-missing", domain,
              f"{domain} に DNSSEC（DNSKEY/DS）が確認できない（DNS 応答の完全性が検証されない）",
              confidence="Medium")


# ===== v0.5 A1: サブドメインテイクオーバー（dangling CNAME）検出（受動・単一組織スコープ） =====
# {サービス名 → CNAME パターン → 未所有フィンガープリント}。subjack/can-i-take-over-xyz の
# 公開署名に基づく内蔵テーブル（ライブ照会はしない）。CNAME 一致と応答本文の未所有 fingerprint
# の**両方**が一致したときのみ takeover 疑いを emit する（FP回避）。
_TAKEOVER_SERVICES = [
    ("GitHub Pages", re.compile(r"\.github\.io$", re.I),
     ["There isn't a GitHub Pages site here",
      "For root URLs (like http://example.com/) you must provide an index.html file"]),
    ("Amazon S3", re.compile(r"(\.s3[.\-][\w\-]*\.amazonaws\.com|\.s3\.amazonaws\.com|s3-website)", re.I),
     ["NoSuchBucket", "The specified bucket does not exist"]),
    ("Heroku", re.compile(r"(\.herokuapp\.com|\.herokudns\.com|\.herokussl\.com)$", re.I),
     ["No such app", "herokucdn.com/error-pages/no-such-app.html"]),
    ("Microsoft Azure", re.compile(
        r"(\.azurewebsites\.net|\.cloudapp\.net|\.cloudapp\.azure\.com|\.trafficmanager\.net|"
        r"\.blob\.core\.windows\.net|\.azureedge\.net)$", re.I),
     ["404 Web Site not found", "The specified blob does not exist", "Error 404 - Web app not found"]),
    ("Fastly", re.compile(r"\.fastly\.net$", re.I),
     ["Fastly error: unknown domain"]),
    ("Shopify", re.compile(r"\.myshopify\.com$", re.I),
     ["Sorry, this shop is currently unavailable", "Only one step left!"]),
    ("Netlify", re.compile(r"(\.netlify\.app|\.netlify\.com)$", re.I),
     ["Not Found - Request ID"]),
    ("Surge.sh", re.compile(r"\.surge\.sh$", re.I),
     ["project not found"]),
    ("Zendesk", re.compile(r"\.zendesk\.com$", re.I),
     ["Help Center Closed"]),
    ("Unbounce", re.compile(r"\.unbounce\.com$", re.I),
     ["The requested URL was not found on this server", "Trying to access your account?"]),
    ("Cargo", re.compile(r"(\.cargocollective\.com|cargo\.site)$", re.I),
     ["<b>404 Not Found</b>", "If you're moving your domain away from Cargo"]),
    ("WordPress.com", re.compile(r"\.wordpress\.com$", re.I),
     ["Do you want to register"]),
]
_MAX_TAKEOVER_HOSTS = 40  # 単一組織でも観測ホスト数を上限で縛る（暴発防止）


def _collect_observed_hosts(target: str, pages: list[dict],
                            forms: list[dict] | None = None) -> list[str]:
    """対象＋巡回で観測したホストのうち、**対象と同一の登録ドメイン**のものだけを返す。

    crawl は同一オリジンのリンクしかページ化しないため、実際の母集団は対象ホスト＋
    script_srcs / form action のホスト（同一登録ドメイン）に限られる。単一組織スコープを
    厳守し、他組織ホスト・CDN・ワードリスト列挙は一切対象にしない。"""
    base_dom = _registrable_domain(urlparse(target).hostname or "")
    if not base_dom:
        return []
    hosts: list[str] = []
    seen: set[str] = set()

    def _add(u: str) -> None:
        h = (urlparse(u).hostname or "").lower()
        if h and h not in seen and _registrable_domain(h) == base_dom:
            seen.add(h)
            hosts.append(h)

    _add(target)
    for page in pages:
        _add(page.get("url", ""))
        for s in page.get("script_srcs", []):
            _add(s)
    for form in (forms or []):
        _add(form.get("action", ""))
    return hosts[:_MAX_TAKEOVER_HOSTS]


def _resolve_cname_chain(host: str, query, max_hops: int = 5) -> list[str]:
    """host の CNAME 鎖をたどる（各段の CNAME ターゲットを小文字・末尾ドット除去で返す）。

    query は (name, rdtype)->list[str] の呼び出し可能（テストでフェイク注入）。"""
    chain: list[str] = []
    current = host
    for _ in range(max_hops):
        try:
            targets = query(current, "CNAME")
        except Exception:
            break
        if not targets:
            break
        nxt = (targets[0] or "").rstrip(".").lower()
        if not nxt or nxt in chain:
            break
        chain.append(nxt)
        current = nxt
    return chain


def _fetch_host_body(host: str, client) -> str | None:
    """host のトップページ本文を GET で取得する（https→http→取得不能なら None）。非破壊。"""
    for scheme in ("https", "http"):
        try:
            r = client.get(f"{scheme}://{host}/")
        except Exception:
            continue
        try:
            return (r.text or "")[:8192]
        except Exception:
            return ""
    return None


def check_subdomain_takeover(target: str, pages: list[dict], forms: list[dict] | None,
                             client, f: Findings, query=None) -> None:
    """対象＋観測済み同一組織ホストの CNAME 鎖を解決し、既知テイクオーバー可能サービスを指し、
    かつ応答が未所有フィンガープリントに一致するホストを takeover 疑いとして emit する（受動）。

    CNAME 一致と未所有フィンガープリントの**両方**が一致したときのみ提示（FP回避）。
    query は (name, rdtype)->list[str]（テストでフェイク注入）。DNS 照会と GET のみ＝非破壊。"""
    q = query or _default_dns_query
    seen: set[str] = set()
    for host in _collect_observed_hosts(target, pages, forms):
        if host in seen:
            continue
        seen.add(host)
        chain = _resolve_cname_chain(host, q)
        if not chain:
            continue
        service = cname_hit = None
        fingerprints: list[str] = []
        for cname in chain:
            for name, pat, fps in _TAKEOVER_SERVICES:
                if pat.search(cname):
                    service, cname_hit, fingerprints = name, cname, fps
                    break
            if service:
                break
        if not service:
            continue  # 既知テイクオーバー可能サービスを指していない
        body = _fetch_host_body(host, client)
        if body is None:
            continue
        if any(fp in body for fp in fingerprints):
            f.add("subdomain-takeover", host,
                  f"CNAME が {service}（{cname_hit}）を指し、応答が未所有フィンガープリントに一致"
                  f"（CNAME＋未所有応答の両方一致）。サブドメインテイクオーバーの疑い。",
                  confidence="High")


# ===== v0.4 Phase 3 能動認証テスト（既定 OFF・opt-in・login URL 限定 POST） =====
import uuid as _uuid  # 局所 import（受動パスに影響させない）


def _fake_credentials() -> dict:
    """存在しないランダム資格情報を生成する（実在アカウントを一切使わない＝ロック回避）。"""
    tag = _uuid.uuid4().hex[:12]
    return {"email": f"vwr-nonexistent-{tag}@example.invalid",
            "password": f"vwr-{_uuid.uuid4().hex[:16]}",
            "username": f"vwr-nonexistent-{tag}"}


# Laravel/一般 web フォームの anti-CSRF トークン抽出（HTML の meta / hidden から取得）。
# 属性順に依存しないよう name→content と content→name の双方向を許容する。
_CSRF_META_RE = re.compile(
    r'<meta[^>]+name=["\']csrf-token["\'][^>]*content=["\']([^"\']+)["\']', re.I)
_CSRF_META_RE_REV = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*name=["\']csrf-token["\']', re.I)
_HIDDEN_TOKEN_RE = re.compile(
    r'<input[^>]+name=["\']_token["\'][^>]*value=["\']([^"\']+)["\']', re.I)
_HIDDEN_TOKEN_RE_REV = re.compile(
    r'<input[^>]+value=["\']([^"\']+)["\'][^>]*name=["\']_token["\']', re.I)


def _extract_html_csrf_token(html: str) -> str | None:
    """login HTML から anti-CSRF トークン（meta csrf-token / hidden _token）を抽出する。"""
    if not html:
        return None
    for rx in (_CSRF_META_RE, _CSRF_META_RE_REV, _HIDDEN_TOKEN_RE, _HIDDEN_TOKEN_RE_REV):
        m = rx.search(html)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return None


def _acquire_login_csrf(get_client, cookie_jar, login_url: str,
                        origin: str = "") -> tuple[dict, dict]:
    """login のセッション/CSRF トークンを **GET（読み取り専用・非破壊）で取得**する。

    CSRF 実効の web フォーム（Laravel 等）では、トークン無しの素 POST は 419 で前段遮断され
    レート制限層に到達できない。これを避けるため、POST の前に login ページを 1 回 GET して
    セッションを確立し、トークンを取り出す。GET は SAFE_METHODS 内であり `_SafeClient` 経由で
    行える（`_SafeClient` の GET 強制境界には一切触れない）。Cookie は POST 側と同一の
    httpx.Client のジャーで共有されるため、維持したまま POST される。

    返り値 (headers, fields):
      - `XSRF-TOKEN` Cookie があれば URL デコードして `X-XSRF-TOKEN` ヘッダに載せる（Laravel 慣行）
      - login HTML の `<meta name="csrf-token">` か hidden `_token` があれば `_token` フィールドに載せる
    取得に失敗しても安全にフォールバック（空 dict を返し、呼び出し側は従来の素 POST を送る）。"""
    from urllib.parse import unquote
    headers: dict[str, str] = {}
    fields: dict[str, str] = {}

    def _read_cookie(name: str):
        try:
            return cookie_jar.get(name)
        except Exception:
            return None

    html = ""
    try:
        r = get_client.get(login_url)
        if "text/html" in (r.headers.get("content-type", "") or "").lower():
            html = r.text or ""
    except Exception:
        html = ""

    tok = _extract_html_csrf_token(html)
    if tok:
        fields["_token"] = tok

    xsrf = _read_cookie("XSRF-TOKEN")
    if not xsrf and origin:
        # login-url が API でページ側でセッション Cookie を発行しない場合の一手として、
        # Laravel Sanctum の CSRF cookie エンドポイントを 1 回だけ GET する（非破壊）。
        try:
            get_client.get(origin.rstrip("/") + "/sanctum/csrf-cookie")
        except Exception:
            pass
        xsrf = _read_cookie("XSRF-TOKEN")
    if xsrf:
        headers["X-XSRF-TOKEN"] = unquote(xsrf)

    return headers, fields


def check_login_rate_limit(client: "_ActiveAuthClient", login_url: str, f: Findings,
                           max_attempts: int = _LOGIN_HARD_CAP,
                           headers: dict | None = None,
                           extra_fields: dict | None = None) -> str:
    """存在しないランダム資格情報で login へ上限付き POST し、429/スロットリングの有無を観測する。

    実在アカウントは一切使わない（アカウントロック回避）。試行回数は min(要求, ハードキャップ)。
    `headers`/`extra_fields` に CSRF トークン（X-XSRF-TOKEN / _token）を渡すと、419 前段遮断を
    回避してレート制限層へ到達できる（`_acquire_login_csrf` が取得）。

    返り値は台帳区分:
      - "finding": レート制限層に到達し 3 回以上処理させたが 429/スロットリング未観測（no-rate-limit）
      - "clean": スロットリングを観測（レート制限が実在）
      - "inconclusive": 全て 419/403 で前段遮断される等でレート制限層に到達できず判定不能"""
    attempts = max(1, min(max_attempts, _LOGIN_HARD_CAP))
    processed = 0
    throttled = False
    for _ in range(attempts):
        data = dict(_fake_credentials())
        if extra_fields:
            data.update(extra_fields)
        try:
            r = client.post(login_url, data=data, headers=headers or None)
        except ActiveAuthViolation:
            break
        except Exception:
            break
        h = {k.lower(): v for k, v in r.headers.items()}
        if r.status_code == 429 or "retry-after" in h or "ratelimit-limit" in h \
                or "x-ratelimit-limit" in h:
            throttled = True
            break
        if r.status_code in (419, 403):
            continue  # 前段拒否（CSRF 等）＝レート制限に未到達。判定に数えない
        if r.status_code in (200, 301, 302, 401, 422):
            processed += 1
    if throttled:
        return "clean"  # レート制限層に到達しスロットリングを確認＝防御あり
    if processed >= 3:
        f.add("no-rate-limit", login_url,
              f"ログインへの未認証 POST を {processed} 回処理させたが 429/スロットリング応答が"
              f"観測されなかった（実在アカウント不使用）。反自動化防御の確認を要する。",
              confidence="Medium")
        return "finding"
    # レート制限層に到達できず（前段遮断・応答不足）判定不能。clean と区別して保留する。
    return "inconclusive"


def check_csrf_enforcement(client: "_ActiveAuthClient", login_url: str, f: Findings) -> None:
    """anti-CSRF トークン無しの POST を **1 回だけ** 送り、419/403 で拒否されるかを観測する。

    拒否（419/403）なら CSRF が実効。受理（200/302/401/422）なら csrf-not-enforced。
    データ改変・列挙は行わない（機微につき列挙は実装しない）。"""
    try:
        r = client.post(login_url, data=_fake_credentials())
    except Exception:
        return
    if r.status_code in (419, 403):
        return  # トークン無し POST が拒否された＝CSRF 実効（正常）
    if r.status_code in (200, 301, 302, 401, 422):
        f.add("csrf-not-enforced", login_url,
              f"anti-CSRF トークン無しの POST が {r.status_code} で受理された（419/403 で拒否されない）。"
              f"CSRF 保護の実効性を要確認（列挙・改変は未実施）。", confidence="Medium")


# ===== v0.5 A3: ユーザー列挙（opt-in 能動・既存ゲート内・非存在アカウントのみ） =====
# アカウント存在に依存する（＝列挙可能な）応答語。汎用の "not found"（404 相当）は誤検知の
# 温床なので採らず、アカウント存在を明示する語のみを用いる（advisor 指摘）。
_ENUM_ACCOUNT_SPECIFIC = (
    "no account", "no such user", "unknown user", "user does not exist",
    "account does not exist", "email is not registered", "email not registered",
    "not a registered", "no user with", "email address is not associated",
    "user not found",  # login 文脈の "user not found" は存在依存（"page not found" は generic 側で吸収）
)
_ENUM_ACCOUNT_SPECIFIC_JA = (
    "アカウントが見つかりません", "ユーザーが存在しません", "登録されていません",
    "登録がありません", "そのメールアドレスは登録されて", "アカウントは存在しません",
    "登録されたアカウントがありません", "該当するアカウントがありません",
)
# 存在を露呈しない汎用応答（安全側）。これが含まれるなら列挙とみなさない（generic override）。
_ENUM_GENERIC = (
    "invalid credentials", "incorrect password", "if an account", "if a matching account",
    "if that email", "we have sent", "we've sent", "a reset link", "page not found",
)
_ENUM_GENERIC_JA = (
    "認証情報", "ログイン情報が正しく", "パスワードが正しく", "認証に失敗", "認証失敗",
    "登録があれば", "メールを送信しました", "リセット用のメール", "メールをお送りしました",
    "該当する場合", "ページが見つかりません",
)
_ENUM_STATUS_NOTE = {
    "finding": "",
    "clean": "認証ロジックに到達し、存在を露呈しない汎用応答を確認",
    "inconclusive": "CSRF/前段遮断等で認証ロジックに未到達＝判定保留（要手動確認）",
}


def _enum_classify(body: str) -> str:
    """応答本文をアカウント存在露呈の観点で分類する: 'specific'（存在依存）/'generic'（安全）/'unknown'。

    汎用応答（generic）が含まれるなら存在依存語があっても安全側に倒す（generic override＝FP回避）。"""
    b = body or ""
    low = b.lower()
    if any(p in low for p in _ENUM_GENERIC) or any(p in b for p in _ENUM_GENERIC_JA):
        return "generic"
    if any(p in low for p in _ENUM_ACCOUNT_SPECIFIC) or any(p in b for p in _ENUM_ACCOUNT_SPECIFIC_JA):
        return "specific"
    return "unknown"


def check_user_enumeration(login_client: "_ActiveAuthClient", login_url: str, f: Findings,
                           reset_client: "_ActiveAuthClient | None" = None,
                           reset_url: str | None = None,
                           headers: dict | None = None, extra_fields: dict | None = None,
                           reset_headers: dict | None = None,
                           reset_fields: dict | None = None) -> str:
    """存在しないランダムアカウントで login/reset に POST し、応答がアカウント有無を露呈するか観測する。

    実在アカウントは一切使わない（ロック回避・改変なし）。login は 2 つの異なる非存在アカウントを
    送り、到達した応答が一貫して存在依存（specific）のときのみ列挙疑いとする（安定性確認）。reset は
    非存在 email を 1 回送り、存在依存か汎用かを判定する。機微につき evidence にはメッセージ差の
    要旨のみを載せ、生の内部情報は載せない。確度は控えめ（Low）。

    返り値の台帳区分: 'finding'（列挙疑い）/'clean'（汎用応答で安全）/'inconclusive'（前段遮断で未到達）。"""
    signals: list[str] = []
    login_verdicts: list[str] = []
    for _ in range(2):
        data = dict(_fake_credentials())
        if extra_fields:
            data.update(extra_fields)
        try:
            r = login_client.post(login_url, data=data, headers=headers or None)
        except Exception:
            break
        if r.status_code in (419, 403):
            continue  # CSRF/前段遮断＝認証ロジックに未到達
        login_verdicts.append(_enum_classify((r.text or "")[:4000]))
    login_reached = bool(login_verdicts)
    if login_verdicts and all(v == "specific" for v in login_verdicts):
        signals.append("login")

    reset_reached = False
    if reset_client and reset_url:
        data = {"email": _fake_credentials()["email"]}
        if reset_fields:
            data.update(reset_fields)
        try:
            r = reset_client.post(reset_url, data=data, headers=reset_headers or None)
            if r.status_code not in (419, 403):
                reset_reached = True
                if _enum_classify((r.text or "")[:4000]) == "specific":
                    signals.append("reset")
        except Exception:
            pass

    if signals:
        where = login_url if "login" in signals else (reset_url or login_url)
        f.add("user-enumeration", where,
              "非存在アカウントに対し、アカウント有無に依存する応答を観測（"
              + "/".join(signals) + "）。存在の可否を第三者が推定しうる（生の応答内容は非掲載）。",
              confidence="Low")
        return "finding"
    if login_reached or reset_reached:
        return "clean"       # 認証ロジックに到達し、存在を露呈しない汎用応答を確認
    return "inconclusive"    # 前段遮断（419/403）等で認証ロジックに未到達＝判定保留


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
    ("csp-analysis", "CSP バイパス可能性の詳細分析", "A06", "passive"),
    ("cookies", "Cookie 属性（Secure/HttpOnly/SameSite）", "A01/A02", "passive"),
    ("sri", "外部リソースの SRI（改竄検知）", "A08", "passive"),
    ("outdated-libs", "古いクライアントライブラリの痕跡", "A03", "passive"),
    ("js-known-cve", "既知CVEを含むJSライブラリ（署名DB照合）", "A03", "passive"),
    ("route-disclosure", "SPA/JS ルート・EP の未認証露出", "A01", "passive"),
    ("stack-fingerprint", "フレームワーク/インフラ指紋（情報）", "A01", "passive"),
    ("eol-runtime", "サーバランタイムの EOL 判定", "A03", "passive"),
    ("forms", "フォームの安全性（平文送信 / CSRF）", "A01/A04", "passive"),
    ("verbose-error", "詳細エラー / スタックトレース露出", "A10", "passive"),
    ("tls-protocol", "TLS 旧プロトコル受入（1.0/1.1）", "A04", "network"),
    ("tls-cert", "TLS 証明書の有効期限", "A04", "network"),
    ("tls-cert-validity", "TLS 証明書の検証（ホスト名/期限/チェーン）", "A04", "network"),
    ("dns-email-auth", "DNS メール認証（DMARC / SPF）", "A02", "network"),
    ("dnssec", "DNSSEC（DNSKEY / DS）", "A02", "network"),
    ("subdomain-takeover", "サブドメインテイクオーバー（CNAME dangling）", "A02", "network"),
    ("https-redirect", "HTTP→HTTPS リダイレクト強制", "A04", "active"),
    ("exposed-files", "機微ファイル / パスの公開", "A01", "active"),
    ("directory-listing", "ディレクトリリスティング", "A01", "active"),
    ("cors", "CORS 設定", "A02", "active"),
    ("http-methods", "危険な HTTP メソッド", "A02", "active"),
    ("js-secrets", "JS バンドル内の秘密露出", "A02", "active"),
    ("auth-routes", "認証必須ルートの保護確認", "A01", "active"),
    ("source-map", "ソースマップ露出", "A02", "active"),
    ("open-redirect", "オープンリダイレクト", "A01", "active"),
    ("reflected-input", "反射型 XSS の兆候", "A05", "active"),
    ("mixed-content", "混在コンテンツ", "A06", "active"),
    ("login-rate-limit", "ログインレート制限（能動・opt-in）", "A06", "active-auth"),
    ("csrf-enforcement", "CSRF トークン実効性（能動・opt-in）", "A01", "active-auth"),
    ("user-enumeration", "ユーザー列挙（能動・opt-in）", "A06", "active-auth"),
]

# 各グループが生成しうる check_id（台帳の finding/clean 判定に使用）
_GROUP_CHECK_IDS = {
    "security-headers": {"missing-hsts", "missing-xcto", "missing-csp", "weak-csp",
                         "missing-frame-options", "missing-referrer-policy",
                         "missing-permissions-policy", "info-disclosure-banner",
                         "missing-coop", "xss-protection-legacy"},
    "csp-analysis": {"csp-bypassable"},
    "cookies": {"cookie-insecure", "cookie-no-httponly", "cookie-no-samesite",
                "cookie-samesite-none-insecure"},
    "sri": {"missing-sri"},
    "outdated-libs": {"outdated-library"},
    "js-known-cve": {"js-known-cve"},
    "route-disclosure": {"route-disclosure"},
    "stack-fingerprint": {"stack-fingerprint"},
    "eol-runtime": {"eol-runtime"},
    "forms": {"insecure-form-target", "missing-csrf-token"},
    "verbose-error": {"verbose-error"},
    "tls-protocol": {"tls-weak-protocol"},
    "tls-cert": {"tls-cert-expiring"},
    "tls-cert-validity": {"tls-cert-invalid"},
    "dns-email-auth": {"dns-dmarc-missing", "dns-dmarc-weak", "dns-spf-missing"},
    "dnssec": {"dnssec-missing"},
    "subdomain-takeover": {"subdomain-takeover"},
    "https-redirect": {"no-https-redirect"},
    "exposed-files": {"exposed-sensitive-file"},
    "directory-listing": {"directory-listing"},
    "cors": {"cors-misconfig"},
    "http-methods": {"risky-http-method"},
    "js-secrets": {"js-secret-exposure"},
    "auth-routes": {"unauth-sensitive-route"},
    "source-map": {"sourcemap-exposure"},
    "open-redirect": {"open-redirect"},
    "reflected-input": {"reflected-input"},
    "mixed-content": {"mixed-content"},
    "login-rate-limit": {"no-rate-limit"},
    "csrf-enforcement": {"csrf-not-enforced"},
    "user-enumeration": {"user-enumeration"},
}
_CHECK_TO_GROUP = {cid: gid for gid, cids in _GROUP_CHECK_IDS.items() for cid in cids}

LEDGER_STATUS_JA = {"finding": "検出あり", "clean": "問題なし", "error": "エラー",
                    "skipped": "未実施", "inconclusive": "判定保留"}


class Ledger:
    """診断項目ごとの実施状況（検出/問題なし/エラー/未実施）を保持する。"""

    def __init__(self):
        self._rows: dict[str, dict] = {}
        # 診断の信頼性メタ（主要ページがロードできたか等）。採点ゲートに用いる（G1）。
        self.assessment: dict = {}

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
               ledger: "Ledger | None" = None, active_auth: bool = False,
               active_auth_url: str | None = None, active_auth_authorized: str = "",
               max_login_attempts: int = _LOGIN_HARD_CAP,
               active_auth_reset_url: str | None = None) -> list[dict]:
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

    # ===== G1: 診断の信頼性判定（主要ページ未ロード時の false clean / グレード膨張を防ぐ） =====
    # ページが「HTTP 応答を得た（status あり・error なし）」ものだけを実データとみなす。
    def _page_ok(p) -> bool:
        return isinstance(p, dict) and not p.get("error") and p.get("status") is not None

    pages_total = len([p for p in pages if isinstance(p, dict)])
    pages_responded = len([p for p in pages if _page_ok(p)])
    tnorm = (target or "").rstrip("/")
    target_loaded = bool(target) and any(
        (p.get("url", "").rstrip("/") == tnorm) and _page_ok(p) for p in pages)
    # 実データ有無: 1 ページでも HTTP 応答があれば cookies/技術情報等を実際に観測できている。
    # 応答ゼロ（全ページ error 等）は「観測できていない」＝データ不足とし、後段で clean を出さない。
    data_reliable = pages_responded > 0
    ledger.assessment = {
        "pages_total": pages_total, "pages_responded": pages_responded,
        "target_loaded": target_loaded, "data_reliable": data_reliable,
    }

    ran: set[str] = set()         # 実際に実行できたグループ（未実行を clean にしないための実績記録）
    rate_limit_seen = False       # 受動でスロットリングヘッダを観測したか（弱陽性・非破壊）
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
            _rl = _headers_lower(r)
            if any(k in _rl for k in ("ratelimit-limit", "x-ratelimit-limit", "retry-after")):
                rate_limit_seen = True
            _safe("security-headers", lambda: check_security_headers(page, _headers_lower(r), f))
            _safe("csp-analysis",
                  lambda: check_csp(page["url"], _headers_lower(r).get("content-security-policy", ""), f))
            if "text/html" in r.headers.get("content-type", ""):
                _safe("sri", lambda: check_sri(page["url"], r.text, f))
                _safe("verbose-error", lambda: check_verbose_error(page["url"], r.text, f))

        # G1: これらはページ応答から得た実データ（cookies/technologies/route_markers/forms）に
        # 依存する。1 ページも応答が無ければ「観測できていない」＝データ不足で skipped とし、
        # 空入力を「問題なし(clean)」と偽らない（主要ページ未ロード時のグレード膨張を防ぐ）。
        _data_dependent = ("cookies", "outdated-libs", "js-known-cve", "route-disclosure",
                           "stack-fingerprint", "eol-runtime", "forms")
        if data_reliable:
            _safe("cookies", lambda: check_cookies(crawl.get("cookies", []), f))
            _safe("outdated-libs", lambda: check_outdated_libraries(pages, f))
            _safe("js-known-cve", lambda: check_js_known_cve(pages, f))
            _safe("route-disclosure", lambda: check_route_disclosure(pages, f))
            _safe("stack-fingerprint",
                  lambda: check_framework_fingerprint(pages, crawl.get("cookies", []), f))
            _safe("eol-runtime", lambda: check_eol_runtime(pages, f))
            _safe("forms", lambda: check_forms(crawl.get("forms", []), f))
        else:
            for gid in _data_dependent:
                ledger.record(gid, "skipped", note="主要ページ未応答のためデータ不足（未観測）")

        # TLS（HTTPS 対象のみ・接続/証明書取得の失敗は error として表面化）
        tp = urlparse(target) if target else None
        if tp and tp.scheme == "https":
            host, port = tp.hostname, (tp.port or 443)
            _safe("tls-protocol", lambda: _probe_old_tls(host, port, f, target))
            _safe("tls-cert", lambda: check_cert_expiry(target, f))
            _safe("tls-cert-validity", lambda: check_cert_validity(target, f))
        elif target:
            ledger.record("tls-protocol", "skipped", note="HTTPS 対象外")
            ledger.record("tls-cert", "skipped", note="HTTPS 対象外")
            ledger.record("tls-cert-validity", "skipped", note="HTTPS 対象外")

        # DNS メール認証（DMARC/SPF）
        dns_host = (tp.hostname if tp else "") or ""
        if target and dns_available() and _dns_target_ok(dns_host):
            _safe("dns-email-auth", lambda: check_dns(target, f))
            _safe("dnssec", lambda: check_dnssec(target, f))
        elif target:
            note = "dnspython 未導入" if not dns_available() else "IP/ローカル対象のため対象外"
            ledger.record("dns-email-auth", "skipped", note=note)
            ledger.record("dnssec", "skipped", note=note)

        # ===== v0.5 A1: サブドメインテイクオーバー（CNAME dangling・受動・単一組織スコープ） =====
        # DNS 照会＋GET のみ。対象＋観測済み同一組織ホストに限定（列挙・他組織はしない）。
        if target and dns_available() and _dns_target_ok(dns_host) and data_reliable:
            _safe("subdomain-takeover",
                  lambda: check_subdomain_takeover(target, pages, crawl.get("forms", []), sc, f))
        elif target:
            st_note = ("dnspython 未導入" if not dns_available()
                       else "IP/ローカル対象のため対象外" if not _dns_target_ok(dns_host)
                       else "主要ページ未応答のためデータ不足")
            ledger.record("subdomain-takeover", "skipped", note=st_note)

        # ===== アクティブ（非破壊の能動プローブ） =====
        # G1: 対象が全く応答していない（data_reliable=False）ときは、各能動 check の内部
        # try/except が接続エラーを飲み込んで「実行できた＝clean」になる偽陽性を避けるため、
        # 能動プローブ自体をゲートして skipped にする。
        if active and target and in_scope(target) and data_reliable:
            params = [p for p in crawl.get("params", []) if in_scope(p["url"])]
            # 外部 JS の上限付き取得（same-origin + CDN allowlist）。js-secrets / source-map で共用。
            try:
                script_bodies = _bounded_fetch_scripts(_collect_script_srcs(pages), sc, allowed)
            except Exception:
                script_bodies = []
            active_jobs = [
                ("exposed-files", lambda: check_exposed_files(target, sc, f)),
                ("directory-listing", lambda: check_directory_listing(pages, sc, f)),
                ("cors", lambda: check_cors(target, sc, f)),
                ("http-methods", lambda: check_http_methods(target, sc, f)),
                ("https-redirect", lambda: check_https_redirect(target, sc, f)),
                ("open-redirect", lambda: check_open_redirect(params, sc, f)),
                ("reflected-input", lambda: check_reflected_input(params, sc, f)),
                ("mixed-content", lambda: check_mixed_content(pages, sc, f)),
                ("js-secrets", lambda: check_js_secrets(script_bodies, f)),
                ("auth-routes", lambda: check_auth_routes(
                    target, pages, sc, f,
                    _collect_robots_sitemap_paths(
                        urlunparse((urlparse(target).scheme, urlparse(target).netloc,
                                    "", "", "", "")), sc))),
                ("source-map", lambda: check_source_map(script_bodies, sc, f, allowed)),
            ]
            for gid, job in active_jobs:
                _safe(gid, job)
        else:
            if not active:
                reason = "能動プローブ無効（--passive-only）"
            elif not (target and in_scope(target)):
                reason = "対象がスコープ外"
            else:
                reason = "主要ページ未応答のため能動プローブ不可（データ不足）"
            for gid in ("https-redirect", "exposed-files", "directory-listing", "cors",
                        "http-methods", "open-redirect", "reflected-input", "mixed-content",
                        "js-secrets", "auth-routes", "source-map"):
                if not ledger.has(gid):
                    ledger.record(gid, "skipped", note=reason)

        # ===== Phase 3 能動認証テスト（既定 OFF・opt-in・明示認可＋login URL 必須） =====
        # _SafeClient には触れず、POST 限定・login URL 限定の _ActiveAuthClient を隔離使用する。
        aa_ok = bool(active_auth and active_auth_url and active_auth_authorized.strip()
                     and in_scope(active_auth_url))
        if aa_ok:
            aac = _ActiveAuthClient(raw, active_auth_url, delay)
            # csrf-enforcement は **トークン無し** の POST を送って 419/403 拒否を確認する検査なので
            # 意図的にトークンを付けない（付けると常に受理され偽陰性になる）。
            _safe("csrf-enforcement", lambda: check_csrf_enforcement(aac, active_auth_url, f))

            # login-rate-limit は逆に、CSRF 実効フォームで 419 前段遮断を回避するため、POST の前に
            # login ページを GET してセッション/CSRF トークンを取得し、トークン付きで POST する。
            # sc（GET 限定）と aac（POST 限定）は同一 httpx.Client(raw) を包むため Cookie を共有する。
            def _run_login_rate_limit() -> None:
                ap = urlparse(active_auth_url)
                origin = urlunparse((ap.scheme, ap.netloc, "", "", "", ""))
                try:
                    hdrs, fields = _acquire_login_csrf(sc, raw.cookies, active_auth_url, origin)
                except Exception:
                    hdrs, fields = {}, {}
                status = check_login_rate_limit(aac, active_auth_url, f, max_login_attempts,
                                                headers=hdrs, extra_fields=fields)
                # 台帳を明示 record（generic finalize が inconclusive を clean に丸めるのを防ぐ）。
                ledger.record("login-rate-limit", status,
                              findings=1 if status == "finding" else 0,
                              note=_LOGIN_RL_STATUS_NOTE.get(status, ""))
            _safe("login-rate-limit", _run_login_rate_limit)

            # v0.5 A3: ユーザー列挙。csrf/rate-limit と cap を食い合わないよう **独立した**
            # _ActiveAuthClient を使う（各テストの blast radius を個別に縛る）。reset は
            # --reset-url が in-scope のときだけ別 client で検査する（既定 OFF）。
            def _run_user_enumeration() -> None:
                ap = urlparse(active_auth_url)
                origin = urlunparse((ap.scheme, ap.netloc, "", "", "", ""))
                enum_login = _ActiveAuthClient(raw, active_auth_url, delay)
                try:
                    hdrs, fields = _acquire_login_csrf(sc, raw.cookies, active_auth_url, origin)
                except Exception:
                    hdrs, fields = {}, {}
                reset_client = None
                r_hdrs, r_fields = {}, {}
                if active_auth_reset_url and in_scope(active_auth_reset_url):
                    reset_client = _ActiveAuthClient(raw, active_auth_reset_url, delay)
                    try:
                        r_hdrs, r_fields = _acquire_login_csrf(
                            sc, raw.cookies, active_auth_reset_url, origin)
                    except Exception:
                        r_hdrs, r_fields = {}, {}
                status = check_user_enumeration(
                    enum_login, active_auth_url, f,
                    reset_client=reset_client, reset_url=active_auth_reset_url,
                    headers=hdrs, extra_fields=fields,
                    reset_headers=r_hdrs, reset_fields=r_fields)
                # 明示 record（inconclusive を clean に丸めない・login-rate-limit と同様）。
                ledger.record("user-enumeration", status,
                              findings=1 if status == "finding" else 0,
                              note=_ENUM_STATUS_NOTE.get(status, ""))
            _safe("user-enumeration", _run_user_enumeration)
        else:
            if not active_auth:
                aa_reason = "能動認証テスト無効（既定 OFF・--active-auth 未指定）"
            elif not active_auth_authorized.strip():
                aa_reason = "能動認証の書面認可（--authorized-active）が空"
            elif not active_auth_url:
                aa_reason = "login URL（--login-url）未指定"
            else:
                aa_reason = "login URL がスコープ外"
            for gid in ("login-rate-limit", "csrf-enforcement", "user-enumeration"):
                if not ledger.has(gid):
                    note = aa_reason
                    if gid == "login-rate-limit" and rate_limit_seen:
                        note += " / 受動でスロットリングヘッダを観測（弱陽性）"
                    ledger.record(gid, "skipped", note=note)

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
    ap.add_argument("--active-auth", action="store_true",
                    help="Phase 3 能動認証テストを有効化（既定 OFF・破壊なし・login への POST 限定）")
    ap.add_argument("--authorized-active", default="",
                    help="能動認証テストの書面認可（空なら能動認証は実行しない）")
    ap.add_argument("--login-url", default=None, help="能動認証テストの対象 login エンドポイント")
    ap.add_argument("--reset-url", default=None,
                    help="ユーザー列挙テストの対象パスワード再発行エンドポイント（任意・既定 OFF）")
    ap.add_argument("--max-login-attempts", type=int, default=8,
                    help="ログインレート制限テストの試行上限（ハードキャップ 8 にクランプ）")
    args = ap.parse_args(argv)

    with open(args.crawl, encoding="utf-8") as fp:
        crawl = json.load(fp)

    ledger = Ledger()
    findings = run_checks(crawl, timeout=args.timeout, active=not args.passive_only, ledger=ledger,
                          active_auth=args.active_auth, active_auth_url=args.login_url,
                          active_auth_authorized=args.authorized_active,
                          max_login_attempts=args.max_login_attempts,
                          active_auth_reset_url=args.reset_url)
    out = {
        "target": crawl.get("scope", {}).get("target", ""),
        "generated_at": _now_iso(),
        "scope": crawl.get("scope", {}),
        "findings": findings,
        "coverage": ledger.rows(),
        "coverage_summary": ledger.summary(),
        "assessment": ledger.assessment,  # G1: 採点ゲート用の信頼性メタ
    }
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=2)
    print(f"[checks] {len(findings)} 件の所見を {args.out} に保存しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
