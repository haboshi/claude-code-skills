#!/usr/bin/env python3
"""
vuln_app.py - テスト用の意図的に脆弱なローカル HTTP サーバ

診断エンジンの検出ロジックを検証するためのフィクスチャ。**ローカル/認可済み
環境専用**であり、外部公開してはならない。以下の欠陥を意図的に含む:
  - セキュリティヘッダ欠落（HSTS/XCTO/CSP/X-Frame-Options/Referrer-Policy）
  - Secure/HttpOnly/SameSite の無い Cookie
  - 機微ファイルの公開（/.git/HEAD, /.env）
  - ディレクトリリスティング風の応答（/files/）
  - 反射型入力（/search?q= を無害化せず反射）
  - オープンリダイレクト（/go?url=）
  - 古い JS ライブラリ参照（jquery-1.8.3）

Copyright (c) 2026 haboshi / MIT License.
"""
from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

INDEX_HTML = """<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>Vuln Test App</title>
<script src="/static/jquery-1.8.3.min.js"></script></head>
<body><h1>テストアプリ</h1>
<a href="/search?q=hello">検索</a>
<a href="/go?url=/next">遷移</a>
<a href="/files/">ファイル</a>
<form action="/search" method="GET"><input name="q" type="text"></form>
</body></html>"""


class VulnHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 静音化
        pass

    def _send(self, code=200, body="", ctype="text/html; charset=utf-8", cookies=False):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Server", "TestServer/1.2.3")  # バージョン露出
        if cookies:
            # 意図的に Secure/HttpOnly/SameSite を欠落
            self.send_header("Set-Cookie", "SESSIONID=abc123; Path=/")
        # セキュリティヘッダは意図的に付与しない
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/":
            self._send(200, INDEX_HTML, cookies=True)
        elif path == "/search":
            q = qs.get("q", [""])[0]
            # 無害化せず反射（反射型 XSS の兆候）
            self._send(200, f"<html><body>検索結果: {q}</body></html>")
        elif path == "/go":
            target = qs.get("url", ["/"])[0]
            self.send_response(302)
            self.send_header("Location", target)  # 検証なしリダイレクト
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif path == "/files/":
            self._send(200, "<html><head><title>Directory listing for /files/</title></head>"
                            "<body><h1>Index of /files/</h1><ul><li>a.txt</li></ul></body></html>")
        elif path == "/.git/HEAD":
            self._send(200, "ref: refs/heads/main\n", ctype="text/plain")
        elif path == "/.env":
            self._send(200, "SECRET_KEY=supersecret\nDB_PASSWORD=pw\n", ctype="text/plain")
        elif path.startswith("/static/"):
            self._send(200, "/* jquery 1.8.3 */", ctype="application/javascript")
        else:
            self._send(404, "<html><body>404</body></html>")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Allow", "GET, POST, OPTIONS, TRACE, PUT")  # 危険メソッド露出
        self.send_header("Content-Length", "0")
        self.end_headers()


def start_server(host="127.0.0.1", port=0):
    """サーバを起動し (server, base_url) を返す。port=0 で空きポート自動割当。"""
    server = ThreadingHTTPServer((host, port), VulnHandler)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://{host}:{actual_port}"


if __name__ == "__main__":
    srv, url = start_server(port=8899)
    print(f"Vuln test app: {url}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()
