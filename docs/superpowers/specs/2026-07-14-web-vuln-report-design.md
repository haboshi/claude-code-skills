# web-vuln-report 設計ドキュメント

- 作成日: 2026-07-14
- ステータス: 承認済み（実装着手）
- 種別: 新規プラグイン（Claude Code スキル + Genspark `.skill` バンドル）

## 目的

URL を起点に Web サイト / Web システム / Web アプリを巡回して診断対象を洗い出し、
非破壊の脆弱性診断を実施。CVSS スコアと OWASP Top 10 / CWE マッピングを付し、
日本語のビジネス脆弱性診断報告書（エグゼクティブサマリ + 技術詳細）を HTML で生成、
適正サイズ（A4）の PDF に変換する。加えて Genspark へアップロードできる `.skill`
バンドルを生成する。

## 確定した方針（ユーザー承認）

- 実行方式: **ハイブリッド** — Claude 主導の自己完結チェックをコアに、`nuclei` /
  `testssl.sh` / `nikto` があれば自動検出して併用し、無くても動く graceful degrade。
- 攻撃性の上限: **非破壊 + 安全な能動プローブ**。データ改変・DoS・破壊的攻撃・検出回避・
  マスターゲティングは非対応。認可確認とスコープ限定を必須化。
- 報告書: **日本語 / エグゼクティブ + 技術詳細**。OWASP Top 10 (2021) / IPA 準拠。

## アーキテクチャ

Claude がオーケストレータ。`SKILL.md` がワークフロー契約、`scripts/` が機械処理、
`references/` が報告書標準・チェックカタログ。診断はフェーズ制で中間 JSON を残す。

```
web-vuln-report/
├── .claude-plugin/plugin.json
├── CLAUDE.md / README.md
└── skills/web-vuln-report/
    ├── SKILL.md
    ├── scripts/  assess.py(統括) crawl.py checks.py external_tools.py
    │             scoring.py render_report.py report_to_pdf.py
    │             package_genspark_skill.py tests/
    ├── templates/ report.html.j2  report.css(印刷用A4・pdf-creator-jp流用)
    └── references/ check-catalog.md  cvss-guide.md  report-standard.md
```

## フェーズ

- Phase 0 認可ゲート（必須・コードで強制）: 対象所有/認可の確認、スコープ確定、
  レート上限・能動プローブ同意。`--authorized-by` 未指定なら実行拒否。
- Phase 1 巡回: 同一オリジンをクロール（robots 尊重・深さ/件数上限・レート制御・
  スキャナを名乗る UA）。URL/フォーム/パラメータ/技術スタック/Cookie を抽出 → `crawl.json`
- Phase 2 診断: 非破壊チェック群 + 任意外部ツール併用 → `findings.json`
- Phase 3 採点: `cvss` ライブラリで CVSS 3.1 算出、重大度分類、OWASP/CWE
  マッピング、総合リスクスコア → `scored.json`
- Phase 4 レポート: HTML（自己完結・ブラウザ閲覧可）→ PDF（A4・日本語・ページ番号）
- Phase 5 プロ示唆: Claude が優先度・改善ロードマップ・事業影響を加筆

## 重要な設計判断（advisor レビュー反映）

1. **Genspark ランタイム非依存の二重動作**: Genspark サンドボクスが `uv`/Python/
   weasyprint ネイティブ依存/Go バイナリ（nuclei）を実行できる保証はない。よって
   SKILL.md は「指示 + テンプレートだけでエージェントが手動で診断・報告書生成を
   遂行できる」ように書く。Python スクリプトは加速器であり graceful degrade する。
   → バンドルは Genspark がコードを実行できても・できなくても機能する。
2. **PDF は自己完結**: pdf-creator-jp の印刷 CSS（@page A4 / img max-height:14cm /
   thead 繰り返し / overflow-wrap:anywhere / orphans・widows）を `report.css` に
   コピー流用（プラグイン依存にしない）。PDF はローカル主体・Genspark はベストエフォート。
3. **CVSS は `cvss` PyPI ライブラリ**を使う（ベクタ計算を手実装しない）。
4. **CVE 網羅を誇張しない**: コアは設定/衛生チェック（ヘッダ・TLS・Cookie・CSP・CORS・
   公開ファイル・クリックジャッキング・オープンリダイレクト・リフレクト型プローブ）が確実。
   CVE 級の既知脆弱ライブラリ照合は nuclei 併用時のみとし、報告書の Scope/手法に明記。
5. **ガードレールはコードで強制**: crawl（same-origin/robots/rate-limit/上限）、
   checks（非破壊アサーション）。プロンプトの文言だけに頼らない。
6. **サンプルはローカル/認可済み対象のみ**: pytest フィクスチャの脆弱サーバに対して
   1 本だけ実サンプル報告書 + PDF を生成。自分の Phase 0 ゲートを自分で守る。
   コミット物に絶対パス（/Users/...）を残さない。

## データモデル（中間JSON）

- `crawl.json`: scope, pages[], forms[], params[], cookies[]
- `findings.json`: findings[]（id, check_id, title, owasp, cwe, confidence, affected[],
  evidence, description, impact, remediation, references[], source, cvss_vector）
- `scored.json`: findings（+cvss_score/severity）+ summary（by_severity, risk_score,
  risk_rating, owasp_coverage）

## 安全・責任あるツール設計

- 単一組織スコープ限定。認可ゲート未通過なら停止。
- 非破壊デフォルト。能動プローブは無害マーカーの反射確認等に限定。
- レート制御・タイムアウト・UA 明示。
- 検出した認証情報・トークンはマスクし transcript/レポートに平文で残さない。

## テスト

pytest: ローカルに欠陥のある HTTP フィクスチャ（ヘッダ欠落・Cookie 属性欠落・
公開ファイル・ディレクトリリスティング等）を立て、checks/scoring の検出と
render→pdf のスモークを検証。

## 配布

- `marketplace.json`（ルート）と `.claude-plugin/marketplace.json` の両方に登録
  （`skills` フィールドは付けない）。
- `package_genspark_skill.py` がスキルフォルダを自己完結化して zip → `web-vuln-report.skill`。
  バンドル内 SKILL.md は `${CLAUDE_PLUGIN_ROOT}/...` を相対パスに書き換え。
