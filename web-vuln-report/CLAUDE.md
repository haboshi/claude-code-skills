# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

web-vuln-report は Claude Code スキル（プラグイン）で、URL を起点に Web サイト/システム/
アプリを非破壊で脆弱性診断し、CVSS 4.0（CVSS-B）・OWASP Top 10:2025・CWE を付し、WSTG/ASVS 5.0.0 を参照した日本語のビジネス
脆弱性診断報告書（HTML→A4 PDF）を生成する。Genspark 用 `.skill` バンドル生成にも対応。

**適用範囲は認可済み・防御目的の診断に限定**。単一組織スコープ・非破壊デフォルト。無認可
対象・破壊的テスト・検出回避・一斉スキャンは実装も運用も行わない。

## アーキテクチャ

```
skills/web-vuln-report/
├── SKILL.md                        # スキル定義（Claude が読むワークフロー契約）
├── scripts/
│   ├── assess.py                   # 統括: Phase 0 認可ゲート → 巡回 → 検査 → 採点 → HTML → PDF
│   ├── crawl.py                    # 同一オリジンクローラ（robots/rate-limit/上限を強制）
│   ├── checks.py                   # 非破壊チェックエンジン（GET/HEAD/OPTIONS のみ）
│   ├── catalog.py                  # チェック定義の単一の正（OWASP/CWE/基準CVSS/修正指針）
│   ├── external_tools.py           # nuclei/testssl.sh 併用（任意・graceful degrade）
│   ├── scoring.py                  # cvss ライブラリで採点・集約・重大度分類
│   ├── render_report.py            # scored.json → 自己完結 HTML（Jinja2）
│   ├── report_to_pdf.py            # HTML → A4 PDF（weasyprint）
│   ├── package_genspark_skill.py   # .skill バンドル生成（パス相対化）
│   └── tests/                      # ローカル脆弱フィクスチャによる結合テスト
├── templates/  report.html.j2 / report.css   # 報告書テンプレート（印刷CSSは自己完結）
├── references/ check-catalog.md / cvss-guide.md / report-standard.md / standards-mapping.md
└── examples/   report.html / report.pdf / *.json  # フィクスチャに対するサンプル
```

## 重要な設計判断

- **catalog.py が単一の正**: チェックの OWASP/CWE/基準 CVSS ベクタ/修正指針はここに集約。
  checks.py（所見生成）と scoring.py（採点）、references/check-catalog.md はこれに整合させる。
- **安全境界はコードで強制**: crawl は same-origin/robots/rate-limit/件数上限を、checks は
  送信メソッドを GET/HEAD/OPTIONS に限定。プロンプト文言だけに頼らない。
- **認可ゲートは必須**: assess.py / crawl.py は `--authorized-by` が空なら実行拒否（exit 2）。
- **Genspark ランタイム非依存**: SKILL.md は「指示＋テンプレートだけでエージェントが手動で
  診断・報告書生成を遂行できる」ように書いてある。Python スクリプトは加速器であり、
  weasyprint 等が無い環境では HTML を最終成果物にする（PDF はベストエフォート）。
- **PDF の印刷 CSS は自己完結**: pdf-creator-jp の @page/表/画像制御を report.css に複製
  （バンドル可搬性のためプラグイン依存にしない）。
- **CVSS 4.0（CVSS-B）**: 算出は cvss ライブラリ（CVSS4）に委譲。ただし catalog に**事前計算スコアを
  同梱**するためランタイムはライブラリ不要（外部ツール所見のみ算出。不在なら黙って Medium にせず
  「未算出」明示）。3.1 とスコア非互換。標準対応（OWASP Top 10:2025/WSTG v4.2/ASVS 5.0.0）は
  catalog と references/standards-mapping.md が正。
- **報告書 HTML は autoescape=True**: 対象由来データを確実にエスケープ（格納型 XSS 防止）。信頼できる
  自前 CSS・narrative のみ `|safe`。
- **カバレッジ台帳（v0.3）**: `checks.Ledger` が各診断項目を finding/clean/error/skipped で記録し、
  報告書に「診断項目カバレッジ台帳」として面出しする。旧実装は検出事項のみ列挙し、合格・エラー・
  未実施がすべて同じ沈黙だった欠陥を是正（`check_cert_expiry` は接続失敗を例外送出→台帳で error 化）。
  台帳は `run_checks(..., ledger=Ledger())` で受け取り、findings_doc→scored→render へ透過する。
- **受動 DNS / forms（v0.3）**: `check_dns`（DMARC/SPF・dnspython は soft-import、不在時 skipped）、
  `check_forms`（平文送信/CSRF の静的検査・送信は行わない）。`_registrable_domain` は PSL を持たず
  代表的多ラベル ccTLD のみ内蔵の簡易推定。**password autocomplete は不採用**（ASVS 5.0.0 が
  無効化を要求しない方針転換のため）。
- **CVSS 較正の誠実性（v0.3）**: `info-disclosure-banner` は VC:L→VC:N（Info）に是正（バージョン
  文字列は機密データでない）。偵察系の較正は機械的一律変更でなく個別レビューで判断する。
- **単一アプリ深掘り（v0.4）**: `crawl` が各ページの `script_srcs` と inline ルート blob
  （Ziggy/Inertia/Next マーカー）を**構造化フィールドで捕捉**（本文は保持しない）。`checks` は
  解析専任で、`route-disclosure`（機微ルートを1所見に集約・disclosure 止まり 6.3）、
  `stack-fingerprint`（情報 0.0）、`eol-runtime`（内蔵オフライン EOL 表・「脆弱」断定回避）、
  `js-secret-exposure`（上限付き外部 JS 取得＝same-origin+CDN allowlist・高特異度パターン・
  **公開鍵 pk_live/AIza は誤検知せず生値非掲載** 8.7）、`unauth-sensitive-route`、
  `sourcemap-exposure`（version:3 実体確認で HTML フォールバック除去）、`dnssec-missing`、
  ヘッダ補完（`missing-coop`/`xss-protection-legacy`）を追加。`check_outdated_libraries` は
  汎用版数抽出＋危殆版下限表に是正（`jquery/2.` 見逃しバグ修正）。
- **能動認証は opt-in・隔離設計（v0.4 Phase 3）**: `no-rate-limit`/`csrf-not-enforced` は既定 OFF。
  `--active-auth`＋`--authorized-active`（書面認可）＋`--login-url`＋in-scope の**二重ゲート**を
  満たしたときのみ、`_SafeClient` とは別クラスの `_ActiveAuthClient`（**login への POST 限定**・
  他メソッド/他 URL 拒否・client 側ハードキャップ）で実行する。**`_SafeClient` の GET 強制境界は
  緩めない・迂回しない**。レート制限は実在アカウント不使用・試行 min(要求,8) クランプ・419/403
  前段拒否は判定保留（偽陽性回避）。TLS 暗号スイート列挙は偽陰性回避のため内蔵せず testssl.sh へ委譲。
- **CSRF トークン取得つき能動レート制限 + 判定保留区分（v0.4.1）**: CSRF 実効の web フォーム
  （Laravel 等）では素 POST が 419 で前段遮断されレート制限層に到達できないため、`check_login_rate_limit`
  は POST の前に `_acquire_login_csrf` で **login ページを GET（読み取り専用）してセッション/CSRF
  トークンを取得**する（`XSRF-TOKEN` Cookie を URL デコードして `X-XSRF-TOKEN`、`meta csrf-token`/
  hidden `_token` を `_token` フィールドへ）。`sc`（GET）と `aac`（POST）は同一 httpx.Client の Cookie
  ジャーを共有。**GET 取得は blast radius を広げない**（login ページ 1 回＋必要時のみ sanctum csrf-cookie）・
  取得失敗は素 POST へ安全にフォールバック・`_ActiveAuthClient` の POST 限定は不変。到達し 429 無し→
  `finding`、throttle 検知→`clean`、未到達→**`inconclusive`（判定保留）**を返し、run_checks が
  login-rate-limit 群を **明示 record**（generic finalize が clean に丸めるのを防ぐ）。`LEDGER_STATUS_JA`
  に `inconclusive: 判定保留` を追加、`scoring` は inconclusive を clean に算入せず grade_context に
  「一部項目は判定保留（要手動確認）」を注記（グレードを不当に高くしない）。テンプレは `cov-inconclusive`
  中間色で描画。cookie-no-httponly は CSRF トークン系 Cookie（`XSRF-TOKEN` 等）を**誤検知除外**
  （設計上 JS 読取が正当。Secure/SameSite は継続検査）。
- **新規チェックは全て台帳に登録**: `LEDGER_GROUPS`＋`_GROUP_CHECK_IDS`＋`_CHECK_TO_GROUP` を網羅し、
  未マップの check_id（沈黙で不可視化）をゼロに保つ。catalog の `cvss`/`cvss_score` は cvss ライブラリ
  実算出と完全一致（`test_catalog_scores_match_cvss4_library` が全 42 件を検算）。
- **CVE 網羅を誇張しない**: 内蔵チェックは構成/衛生面の指摘。CVE 級は外部ツール併用時のみ、
  報告書の制約事項に明記。
- **所見は集約**: scoring.merge_findings が同一 check_id+title を1件に束ね該当箇所を列挙
  （ページ単位の重複計上を防ぐ）。

## テスト

```bash
cd skills/web-vuln-report
uv run --with httpx --with beautifulsoup4 --with cvss --with jinja2 --with dnspython --with pytest \
  python -m pytest scripts/tests/ -v
```

`scripts/tests/vuln_app.py` は意図的に脆弱なローカルフィクスチャ（外部公開禁止）。
外部通信なしで巡回・検出・採点・レンダリングを検証する。

## Marketplace / Versioning

`haboshi/claude-code-skills` でマーケットプレイス配信される。バージョン更新時は以下の2
ファイルを**必ず同時に**更新すること（片方だけだと不整合）:

- `marketplace.json`（ルート）
- `.claude-plugin/marketplace.json`

プラグインエントリに `"skills"` フィールドを付けない（スキーマエラーになる）。
