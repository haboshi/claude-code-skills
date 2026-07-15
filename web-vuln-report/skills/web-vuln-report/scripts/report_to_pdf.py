#!/usr/bin/env python3
"""
report_to_pdf.py - HTML 報告書を適正サイズ（A4）の PDF に変換（Phase 4b）

render_report.py が出力した自己完結 HTML を weasyprint で PDF 化する。CSS は
HTML に @page 設定込みでインライン済みのため、ここでは追加スタイルを与えずに
そのまま印刷する。macOS Homebrew のネイティブライブラリパスを import 前に設定。

注記（Genspark 等のランタイム差異）: weasyprint は cairo/pango 等のネイティブ
ライブラリを必要とする。これらが無い環境（一部のサンドボクス）では PDF 化は
失敗しうる。その場合でも HTML 報告書は成果物として有効であり、本スクリプトは
明確なエラーメッセージを返して HTML を残す（ローカル主体・PDF はベストエフォート）。

Copyright (c) 2026 haboshi / MIT License.

Usage:
    uv run --with weasyprint report_to_pdf.py report.html report.pdf
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# weasyprint import 前に環境変数を設定（macOS Homebrew 対応）— 順序が重要
if sys.platform == "darwin":
    homebrew_lib = "/opt/homebrew/lib"
    if os.path.exists(homebrew_lib):
        current = os.environ.get("DYLD_LIBRARY_PATH", "")
        if homebrew_lib not in current:
            os.environ["DYLD_LIBRARY_PATH"] = f"{homebrew_lib}:{current}"


def html_to_pdf(html_path: str, pdf_path: str) -> None:
    try:
        from weasyprint import HTML
    except Exception as e:  # ネイティブ依存の不足を含む
        raise RuntimeError(
            f"weasyprint を読み込めません（ネイティブ依存の可能性）: {e}\n"
            f"HTML 報告書 {html_path} は有効です。PDF 化はネイティブライブラリ "
            f"(cairo/pango/gdk-pixbuf) が揃う環境で実行してください。"
        ) from e

    src = Path(html_path).resolve()
    HTML(filename=str(src), base_url=str(src.parent)).write_pdf(pdf_path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="HTML 報告書 → A4 PDF")
    ap.add_argument("html", help="入力 HTML")
    ap.add_argument("pdf", nargs="?", help="出力 PDF（省略時は同名 .pdf）")
    args = ap.parse_args(argv)

    html_path = args.html
    pdf_path = args.pdf or str(Path(html_path).with_suffix(".pdf"))
    try:
        html_to_pdf(html_path, pdf_path)
    except RuntimeError as e:
        print(f"[pdf] {e}", file=sys.stderr)
        return 3
    print(f"[pdf] PDF を {pdf_path} に出力しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
