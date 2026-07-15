# web-vuln-report

URL を起点に Web サイト / システム / アプリを巡回して診断対象を洗い出し、**非破壊**の
脆弱性診断を実施。CVSS スコアと OWASP Top 10 (2021) / CWE を付した日本語のビジネス
脆弱性診断報告書（エグゼクティブサマリ＋技術詳細＋プロの示唆）を HTML で生成し、適正
サイズ（A4）の PDF に変換する Claude Code スキルです。Genspark へアップロードできる
`.skill` バンドルの生成にも対応します。

## 適用範囲・倫理境界

**認可済み・防御目的の脆弱性診断専用**です。

- 単一組織スコープに限定（依頼者が所有または書面で認可した資産のみ）
- 非破壊デフォルト（データ改変・DoS・破壊的エクスプロイト・検出回避・一斉スキャンは非対応）
- 認可が確認できない場合は診断を開始しません（Phase 0 認可ゲート）

## 使い方（トリガー例）

- 「このサイトの脆弱性診断をして報告書を作って」
- 「https://example.com のセキュリティ診断レポートを PDF で」
- 「Web アプリの脆弱性を診断して、Genspark 用の .skill も作って」

スキルは Phase 0 で対象の所有/認可・スコープ・強度を確認し、巡回 → 非破壊チェック
→（あれば外部ツール併用）→ CVSS 採点 → HTML → PDF の順で報告書を生成します。

## 診断内容（内蔵チェック）

セキュリティヘッダ（HSTS / X-Content-Type-Options / CSP / クリックジャッキング /
Referrer-Policy）、Cookie 属性（Secure / HttpOnly / SameSite）、TLS/証明書、機微
ファイル公開（`.git` / `.env` 等）、ディレクトリリスティング、CORS 設定ミス、危険な
HTTP メソッド、オープンリダイレクト、反射型入力（XSS の兆候）、混在コンテンツ、古い
クライアントライブラリ。`nuclei` / `testssl.sh` が導入済みなら自動検出して併用します
（無くても内蔵チェックのみで完結）。

## 必要環境

- Python は `uv run --with ...` で依存を動的解決（venv 不要）。主要依存: `httpx`,
  `beautifulsoup4`, `jinja2`, `cvss`, `weasyprint`。
- PDF 化（weasyprint）は cairo/pango 等のネイティブライブラリを要します。無い環境では
  HTML を最終成果物とします（PDF はローカル主体・ベストエフォート）。
- 外部スキャナ（`nuclei` / `testssl.sh`）は任意。

## 開発・テスト

```bash
cd web-vuln-report/skills/web-vuln-report
uv run --with httpx --with beautifulsoup4 --with cvss --with jinja2 --with pytest \
  python -m pytest scripts/tests/ -v
```

ローカルの脆弱フィクスチャ（`scripts/tests/vuln_app.py`）に対して検出ロジックを検証
します（外部通信なし）。`examples/` に、そのフィクスチャに対するサンプル報告書
（HTML/PDF）を同梱しています（実在サイトではありません）。

## Genspark 用バンドル

```bash
uv run scripts/package_genspark_skill.py --out ./web-vuln-report.skill
```

Genspark の New Skill → Upload から `.skill`（または `.zip` / `.md`、最大 200MB）で
取り込めます。

## 変更履歴

### v0.2.0 — 標準モダナイズ（**破壊的**）
- **CVSS 3.1 → CVSS 4.0（CVSS-B）**。深刻度の定性区分は同一だが、**スコア数値は 3.1 と非互換**
  （同一事象でも値が異なり、4.0 は低〜中影響を高めに出す傾向）。既存の `scored.json` とはスコア
  互換性がない。算出は `cvss` ライブラリ（CVSS4）だが、各チェックはカタログに事前計算スコアを
  持つため**ランタイムは cvss ライブラリ不要**（外部ツール所見のみ算出）。
- **OWASP Top 10:2021 → 2025**（現行公開版）。旧「A05 設定ミス」集中が A01/A02/A04/A06/A10 に分散。
- **OWASP WSTG**（診断手法）と **OWASP ASVS 5.0.0**（検証要件・要件番号＋レベル）の参照を各所見に追加。
- 標準対応表は `references/standards-mapping.md`、詳細は `references/cvss-guide.md` / `check-catalog.md`。

### v0.1.x
- 初版。非破壊チェックエンジン、セキュリティグレード（A＝安全）、HTML→PDF、Genspark バンドル。

## ライセンス

MIT License. 詳細はリポジトリルートの `LICENSE` を参照。
