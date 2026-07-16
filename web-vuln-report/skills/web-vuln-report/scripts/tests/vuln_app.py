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
from urllib.parse import urlparse, parse_qs, quote

# CSRF 保護 login フィクスチャ用のトークン（秘密ではない・テスト用の固定値）。
# XSRF-TOKEN Cookie は URL エンコード形で発行し、クライアントはデコードして X-XSRF-TOKEN に載せる。
_XSRF_RAW = "vwr-xsrf-tok3n=="            # デコード後（X-XSRF-TOKEN ヘッダの期待値・'=' で decode を検査）
_XSRF_COOKIE = quote(_XSRF_RAW, safe="")  # Set-Cookie で送る URL エンコード形
_CSRF_META = "vwr-meta-tok3n"             # meta csrf-token / hidden _token の期待値

INDEX_HTML = """<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>Vuln Test App</title>
<meta name="csrf-token" content="tok123">
<script src="/static/jquery-1.8.3.min.js"></script>
<script src="/static/app.js"></script>
<script>const Ziggy = {"url":"http:\\/\\/localhost","port":null,"defaults":{},"routes":{"login":{"uri":"login","methods":["GET"]},"admin.users.index":{"uri":"admin\\/users","methods":["GET"]},"data.export":{"uri":"data\\/export","methods":["GET"]},"storage.download":{"uri":"storage\\/download\\/{file}","methods":["GET"]}}};
const api = "/api/generate-report";</script></head>
<body><h1>テストアプリ</h1>
<a href="/search?q=hello">検索</a>
<a href="/go?url=/next">遷移</a>
<a href="/files/">ファイル</a>
<form action="/search" method="GET"><input name="q" type="text"></form>
</body></html>"""

# CSRF 保護された login ページ。meta csrf-token と hidden _token を含み、GET で XSRF-TOKEN
# Cookie を発行する。トークン無しの素 POST は 419、トークン付き POST は処理される（下記 do_POST）。
LOGIN_HTML = (
    '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">'
    f'<meta name="csrf-token" content="{_CSRF_META}">'
    '<title>ログイン</title></head><body><h1>ログイン</h1>'
    '<form action="/login" method="POST">'
    f'<input type="hidden" name="_token" value="{_CSRF_META}">'
    '<input name="email" type="text"><input name="password" type="password">'
    '<button type="submit">ログイン</button></form></body></html>'
)


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
            # 意図的に Secure/HttpOnly/SameSite を欠落。Laravel 指紋用に XSRF-TOKEN /
            # laravel_session も併せて発行する（フレームワーク指紋テスト用）。
            self.send_header("Set-Cookie", "SESSIONID=abc123; Path=/")
            self.send_header("Set-Cookie", "XSRF-TOKEN=eyJ0b2tlbiI6IngifQ; Path=/")
            self.send_header("Set-Cookie", "laravel_session=abc; Path=/")
        # セキュリティヘッダは意図的に付与しない
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/":
            self._send(200, INDEX_HTML, cookies=True)
        elif path == "/login":
            self._send_login(200, LOGIN_HTML)
        elif path == "/login-hardened":
            # トークンも XSRF Cookie も出さない login（トークン取得不能をシミュレート）。
            self._send(200, "<html><body>Hardened login</body></html>")
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
        elif path == "/static/app.js":
            # 真の秘密様（sk_live）＋公開クライアント鍵（pk_live/AIza=誤検知しない）＋ sourceMappingURL。
            # リテラル秘密トークンを避け連結生成する（secret-scanning 誤検知の回避。実行時値は同一）。
            sk = "sk_" + "live_" + "0123456789abcdefABCDEFGHIJ"
            pk = "pk_" + "live_" + "0123456789abcdefABCDEFGHIJ"
            gk = "AIza" + "SyA1234567890abcdefghijklmnopqrstuv"
            body = (f'/* app */ var s="{sk}";var pub="{pk}";var g="{gk}";\n'
                    '//# sourceMappingURL=app.js.map')
            self._send(200, body, ctype="application/javascript")
        elif path == "/static/app.js.map":
            self._send(200, '{"version":3,"file":"app.js","sources":["a.ts"],'
                            '"names":[],"mappings":"AAAA","sourcesContent":["const x=1"]}',
                       ctype="application/json")
        elif path.startswith("/static/"):
            self._send(200, "/* jquery 1.8.3 */", ctype="application/javascript")
        else:
            self._send(404, "<html><body>404</body></html>")

    def _send_login(self, code, body):
        """login ページ応答。XSRF-TOKEN（JS 読取可）と laravel_session（HttpOnly）を発行する。"""
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Server", "TestServer/1.2.3")
        self.send_header("Set-Cookie", f"XSRF-TOKEN={_XSRF_COOKIE}; Path=/")
        self.send_header("Set-Cookie", "laravel_session=login-sess; Path=/; HttpOnly")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/login":
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length).decode("utf-8", "replace") if length else ""
            fields = parse_qs(body)
            header_token = self.headers.get("X-XSRF-TOKEN", "")
            form_token = fields.get("_token", [""])[0]
            # Cookie の有無ではなく、ヘッダ/フォームのトークンを検証する（実 Laravel に整合し、
            # csrf-enforcement のトークン無し POST を古い XSRF Cookie 経由で誤受理しない）。
            token_ok = (header_token == _XSRF_RAW) or (form_token == _CSRF_META)
            if not token_ok:
                # トークン無し/不一致 → CSRF 前段遮断（419）。レート制限層には到達しない。
                self._send(419, "<html><body>CSRF token mismatch</body></html>")
                return
            # トークン一致 → レート制限層に到達。偽の資格情報なので 401（処理はされた）。
            # レート制限は意図的に未実装（no-rate-limit を検出させる）。
            self._send(401, "<html><body>認証失敗</body></html>")
            return
        if parsed.path == "/login-hardened":
            # トークンの有無に関わらず常に 419（レート制限層へ到達できない＝判定保留を検証）。
            self._send(419, "<html><body>CSRF wall</body></html>")
            return
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
