#!/usr/bin/env python3
"""
md_to_pdf.py の回帰テスト（pytest）。

本体 (md_to_pdf.py) は一切変更せず、公開関数 markdown_to_pdf() を
モジュールとして import して振る舞いを検証する。

実行方法（想定）:
    uv run --with weasyprint --with markdown --with pytest --with pypdf \
        pytest pdf-creator-jp/scripts/test_md_to_pdf.py -q

weasyprint はネイティブ依存（pango / cairo / gdk-pixbuf 等）を要求するため、
それらが無い環境ではモジュール import 時に OSError / ImportError が発生する。
その場合は全テストを pytest.skip して環境依存の失敗を回避する。
"""

import importlib.util
import struct
import zlib
from pathlib import Path

import pytest

SCRIPT_DIR = Path(__file__).resolve().parent
MODULE_PATH = SCRIPT_DIR / "md_to_pdf.py"


def _make_png(path: Path) -> None:
    """外部依存なしで有効な 1x1 白 PNG を生成する（Pillow に読ませても壊れない）。"""

    def chunk(typ: bytes, data: bytes) -> bytes:
        body = typ + data
        crc = zlib.crc32(body) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + body + struct.pack(">I", crc)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit RGB
    raw = b"\x00\xff\xff\xff"  # filter byte + 白ピクセル(RGB)
    idat = zlib.compress(raw)
    png = signature + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.write_bytes(png)


def _sample_markdown(image_uri: str) -> str:
    """見出し・表・チェックボックス・画像参照・改ページを含む日本語フィクスチャ。"""
    return f"""# 日本語ドキュメント変換テスト

これは pdf-creator-jp の回帰テスト用サンプルです。本文には日本語（ひらがな・
カタカナ・漢字）を含みます。

## 第1章 見出しと段落

段落テキスト。長い英単語 supercalifragilisticexpialidocious や
URL https://example.com/very/long/path/that/should/wrap も含みます。

### 小見出し

- 箇条書き項目その1
- 箇条書き項目その2

## 第2章 表

| 項目 | 説明 | 値 |
|------|------|-----|
| 温度 | 室温 | 25℃ |
| 湿度 | 相対湿度 | 60% |
| 気圧 | 標準大気圧 | 1013hPa |

## 第3章 チェックボックス

- [x] 完了したタスク
- [ ] 未完了のタスク
- [ ] もう一つの未完了タスク

## 第4章 画像

![サンプル画像のキャプション]({image_uri})

<div style="page-break-before: always;"></div>

## 第5章 改ページ後のセクション

改ページ後の本文テキスト。ここは新しいページに配置されることを意図している。

```python
def hello():
    print("こんにちは")
```
"""


def _load_module():
    """md_to_pdf.py をモジュールとして読み込む。ネイティブ依存欠如時は skip。"""
    spec = importlib.util.spec_from_file_location("md_to_pdf", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except (ImportError, OSError) as exc:
        pytest.skip(f"weasyprint のネイティブ依存が無いためスキップ: {exc}")
    return module


@pytest.fixture(scope="module")
def md2pdf():
    return _load_module()


def _write_fixture(tmp_path: Path) -> Path:
    png_path = tmp_path / "sample.png"
    _make_png(png_path)
    image_uri = png_path.as_uri()  # file:// 絶対 URI（base_url 無しでも解決可能）
    md_path = tmp_path / "sample.md"
    md_path.write_text(_sample_markdown(image_uri), encoding="utf-8")
    return md_path


def _assert_valid_pdf(pdf_path: Path):
    """生成 PDF の基本検証: 存在・サイズ・ヘッダ・（可能なら）ページ数。"""
    # (a) PDF ファイルが生成される
    assert pdf_path.exists(), f"PDF が生成されていない: {pdf_path}"

    data = pdf_path.read_bytes()

    # (b) ファイルサイズ > 1KB
    assert len(data) > 1024, f"PDF サイズが小さすぎる: {len(data)} bytes"

    # (c) PDF ヘッダ（%PDF-）が正しい
    assert data[:5] == b"%PDF-", f"PDF ヘッダが不正: {data[:8]!r}"

    # (d) pypdf が使えるならページ数 >= 1
    try:
        import pypdf
    except ImportError:
        return
    reader = pypdf.PdfReader(str(pdf_path))
    assert len(reader.pages) >= 1, "ページ数が 0"


def test_basic_conversion(md2pdf, tmp_path):
    """全要素を含むフィクスチャをデフォルトスタイルで変換し基本検証を通す。"""
    md_path = _write_fixture(tmp_path)
    pdf_path = tmp_path / "sample.pdf"

    result = md2pdf.markdown_to_pdf(str(md_path), str(pdf_path))

    assert Path(result) == pdf_path
    _assert_valid_pdf(pdf_path)


@pytest.mark.parametrize("style", ["business", "technical", "minimal"])
def test_all_style_presets(md2pdf, tmp_path, style):
    """CSS プリセット3種それぞれで変換が成功することを確認する。"""
    md_path = _write_fixture(tmp_path)
    pdf_path = tmp_path / f"sample_{style}.pdf"

    result = md2pdf.markdown_to_pdf(str(md_path), str(pdf_path), style=style)

    assert Path(result) == pdf_path
    _assert_valid_pdf(pdf_path)


def test_no_page_numbers_option(md2pdf, tmp_path):
    """--no-page-numbers 相当（page_numbers=False）でも変換が成功する。"""
    md_path = _write_fixture(tmp_path)
    pdf_path = tmp_path / "sample_nopage.pdf"

    result = md2pdf.markdown_to_pdf(str(md_path), str(pdf_path), page_numbers=False)

    assert Path(result) == pdf_path
    _assert_valid_pdf(pdf_path)
