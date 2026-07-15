#!/usr/bin/env python3
"""
crawl.py - 同一オリジンクローラ（脆弱性診断の Phase 1）

Copyright (c) 2026 haboshi
Licensed under the MIT License.

認可済み・単一組織スコープの防御的診断専用。以下を必ずコードで強制する:
  - same-origin（スコープ内ホストのみ）
  - robots.txt 尊重（--ignore-robots で明示解除可能だが既定は尊重）
  - レート制御（--rate req/s）・件数/深さ上限・タイムアウト
  - スキャナを名乗る User-Agent（透明性）

出力: crawl.json（scope, pages[], forms[], params[], cookies[]）

Usage:
    uv run --with httpx --with beautifulsoup4 crawl.py \
        --target https://example.com --authorized-by "運用部/書面認可#123" \
        --out crawl.json --max-pages 50 --max-depth 3 --rate 2
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.robotparser
from collections import deque
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse, urldefrag

try:
    import httpx
    from bs4 import BeautifulSoup
except ImportError as e:  # pragma: no cover - 実行時の依存不足を明示
    print(f"[crawl] 依存パッケージが不足しています: {e}\n"
          f"  uv run --with httpx --with beautifulsoup4 crawl.py ... で実行してください。",
          file=sys.stderr)
    raise

USER_AGENT = "web-vuln-report/0.1 (authorized security assessment; +non-destructive)"

# 技術フィンガープリント（ヘッダ/HTML の弱いシグナル。CVE 断定には使わない）
_TECH_HEADER_HINTS = {
    "server": "Server",
    "x-powered-by": "X-Powered-By",
    "x-generator": "X-Generator",
    "x-aspnet-version": "X-AspNet-Version",
}


@dataclass
class CrawlResult:
    scope: dict
    pages: list = field(default_factory=list)
    forms: list = field(default_factory=list)
    params: list = field(default_factory=list)
    cookies: list = field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _same_scope(url: str, allowed_hosts: set[str]) -> bool:
    host = urlparse(url).hostname or ""
    return host.lower() in allowed_hosts


def _fingerprint(headers: httpx.Headers, html: str | None) -> list[str]:
    techs = []
    for key, label in _TECH_HEADER_HINTS.items():
        if key in headers:
            techs.append(f"{label}: {headers[key]}")
    if html:
        soup = BeautifulSoup(html, "html.parser")
        gen = soup.find("meta", attrs={"name": "generator"})
        if gen and gen.get("content"):
            techs.append(f"generator: {gen['content']}")
        # JS ライブラリのパスからの弱いバージョン推定
        for script in soup.find_all("script", src=True):
            src = script["src"]
            for lib in ("jquery", "bootstrap", "angular", "react", "vue"):
                if lib in src.lower():
                    techs.append(f"js: {src}")
                    break
    # 重複除去（順序維持）
    seen, out = set(), []
    for t in techs:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _extract_links(base_url: str, soup: BeautifulSoup) -> list[str]:
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute, _ = urldefrag(urljoin(base_url, href))
        links.append(absolute)
    return links


def _extract_forms(base_url: str, soup: BeautifulSoup) -> list[dict]:
    forms = []
    for form in soup.find_all("form"):
        action = urljoin(base_url, form.get("action", "").strip() or base_url)
        method = (form.get("method") or "GET").upper()
        inputs = []
        for tag in form.find_all(("input", "textarea", "select")):
            name = tag.get("name")
            if not name:
                continue
            inputs.append({"name": name, "type": tag.get("type", tag.name)})
        forms.append({"url": base_url, "action": action, "method": method, "inputs": inputs})
    return forms


def _extract_params(url: str) -> list[dict]:
    parsed = urlparse(url)
    if not parsed.query:
        return []
    out = []
    for pair in parsed.query.split("&"):
        name = pair.split("=", 1)[0]
        if name:
            out.append({"url": url, "name": name, "in": "query"})
    return out


def _collect_cookies(url: str, resp: httpx.Response) -> list[dict]:
    out = []
    # Set-Cookie を生ヘッダから解析（属性を保持するため）
    for raw in resp.headers.get_list("set-cookie"):
        parts = [p.strip() for p in raw.split(";")]
        name = parts[0].split("=", 1)[0] if parts else ""
        attrs = {p.split("=", 1)[0].lower(): (p.split("=", 1)[1] if "=" in p else True)
                 for p in parts[1:]}
        out.append({
            "name": name,
            "url": url,
            "secure": "secure" in attrs,
            "httponly": "httponly" in attrs,
            "samesite": attrs.get("samesite"),
        })
    return out


def _load_robots(base: str, respect: bool) -> urllib.robotparser.RobotFileParser | None:
    if not respect:
        return None
    rp = urllib.robotparser.RobotFileParser()
    robots_url = urljoin(base, "/robots.txt")
    try:
        with httpx.Client(timeout=10, headers={"User-Agent": USER_AGENT}) as c:
            r = c.get(robots_url)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp.parse([])  # robots が無ければ全許可
    except Exception:
        rp.parse([])
    return rp


def crawl(target: str, authorized_by: str, max_pages: int = 50, max_depth: int = 3,
          rate: float = 2.0, timeout: float = 15.0, respect_robots: bool = True,
          extra_hosts: list[str] | None = None) -> CrawlResult:
    parsed = urlparse(target)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("target は http(s) URL である必要があります")

    allowed_hosts = {parsed.hostname.lower()}
    for h in (extra_hosts or []):
        allowed_hosts.add(h.lower())

    rp = _load_robots(target, respect_robots)
    result = CrawlResult(scope={
        "target": target,
        "hosts": sorted(allowed_hosts),
        "authorized_by": authorized_by,
        "respect_robots": respect_robots,
        "rate_per_sec": rate,
        "max_pages": max_pages,
        "max_depth": max_depth,
        "started_at": _now_iso(),
        "user_agent": USER_AGENT,
    })

    seen: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(target, 0)])
    delay = 1.0 / rate if rate > 0 else 0

    with httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT},
                      follow_redirects=False) as client:
        while queue and len(result.pages) < max_pages:
            url, depth = queue.popleft()
            if url in seen or depth > max_depth:
                continue
            seen.add(url)
            if not _same_scope(url, allowed_hosts):
                continue
            if rp is not None and not rp.can_fetch(USER_AGENT, url):
                continue
            try:
                resp = client.get(url)
            except Exception as exc:
                result.pages.append({"url": url, "error": str(exc)})
                continue

            ctype = resp.headers.get("content-type", "")
            is_html = "text/html" in ctype
            html = resp.text if is_html else None
            page = {
                "url": url,
                "status": resp.status_code,
                "content_type": ctype,
                "server": resp.headers.get("server", ""),
                "technologies": _fingerprint(resp.headers, html),
            }
            result.cookies.extend(_collect_cookies(url, resp))
            result.params.extend(_extract_params(url))

            if is_html and resp.status_code < 400:
                soup = BeautifulSoup(html, "html.parser")
                title = soup.title.string.strip() if soup.title and soup.title.string else ""
                page["title"] = title
                result.forms.extend(_extract_forms(url, soup))
                for link in _extract_links(url, soup):
                    if link not in seen and _same_scope(link, allowed_hosts):
                        queue.append((link, depth + 1))
            result.pages.append(page)

            if delay:
                time.sleep(delay)

    result.scope["finished_at"] = _now_iso()
    result.scope["pages_crawled"] = len(result.pages)
    # cookies / params の重複除去
    result.cookies = _dedupe(result.cookies, key=lambda c: (c["name"], c["url"]))
    result.params = _dedupe(result.params, key=lambda p: (p["name"], p["url"]))
    return result


def _dedupe(items: list[dict], key) -> list[dict]:
    seen, out = set(), []
    for it in items:
        k = key(it)
        if k not in seen:
            seen.add(k)
            out.append(it)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="同一オリジンクローラ（認可済み診断専用）")
    ap.add_argument("--target", required=True, help="起点 URL（http/https）")
    ap.add_argument("--authorized-by", required=True,
                    help="認可の根拠（担当部署/書面番号等）。未指定は実行拒否。")
    ap.add_argument("--out", default="crawl.json")
    ap.add_argument("--max-pages", type=int, default=50)
    ap.add_argument("--max-depth", type=int, default=3)
    ap.add_argument("--rate", type=float, default=2.0, help="1秒あたりの最大リクエスト数")
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument("--ignore-robots", action="store_true",
                    help="robots.txt を無視（認可範囲で必要な場合のみ）")
    ap.add_argument("--extra-host", action="append", default=[],
                    help="スコープに含める追加ホスト（複数指定可）")
    args = ap.parse_args(argv)

    if not args.authorized_by.strip():
        print("[crawl] 認可の根拠（--authorized-by）が空です。実行を中止します。", file=sys.stderr)
        return 2

    result = crawl(
        target=args.target,
        authorized_by=args.authorized_by,
        max_pages=args.max_pages,
        max_depth=args.max_depth,
        rate=args.rate,
        timeout=args.timeout,
        respect_robots=not args.ignore_robots,
        extra_hosts=args.extra_host,
    )
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(asdict(result), f, ensure_ascii=False, indent=2)
    print(f"[crawl] {len(result.pages)} ページ / {len(result.forms)} フォーム / "
          f"{len(result.cookies)} Cookie を {args.out} に保存しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
