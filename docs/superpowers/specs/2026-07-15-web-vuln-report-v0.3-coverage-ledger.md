# web-vuln-report v0.3 — カバレッジ台帳・受動DNS・較正（設計メモ）

- 日付: 2026-07-15
- 対象: `web-vuln-report` プラグイン（0.2.0 → 0.3.0）
- 背景: 実 actcall.jp 診断を競合（Genspark Super Agent）出力と突き合わせ、Fable5 に実コード
  裏取りレビューを依頼した結果を反映。目的は「信頼して意思決定できる報告書」への質的強化で、
  件数・ページ数で競合に張り合わない方針。

## 動機（レビューで判明した事実）

- 「当方は TLS/HSTS を見ていない」は**事実誤認**だった。`_probe_old_tls`/`check_cert_expiry`/
  HSTS/HTTPS リダイレクトは実装済み。ただし `check_tls` が証明書取得の例外を握り潰しており、
  **「合格」「エラー」「未実行」がすべて同じ沈黙**になっていた。競合報告の「4件だけ＝狭い」は
  一部が幻（実施済みだが不可視）だった可能性が高い。
- 偵察系の CVSS が一律高め。特に `info-disclosure-banner`（バージョン露出）が Medium 6.9 は
  過大。CVSS 4.0 が VC:L の低影響ネットワーク issue を高く出す既知傾向による。
- `verbose-error` はカタログ定義だけで未実装（孤児）、crawl の `forms[]` は死蔵、
  `check_reflected_input` は content-type ガードが無く JSON エコーを誤検知しうる。
- 受動で取れて意思決定を変える DNS メール認証（DMARC/SPF）が未対応。

## 採用した変更（v0.3）

1. **カバレッジ台帳（最重要）**: `checks.Ledger` を追加。全診断項目を
   `finding / clean / error / skipped` で記録し、報告書に「診断項目カバレッジ台帳」として
   面出しする。`run_checks(..., ledger=Ledger())` で受け取り、`findings_doc → scored → render`
   へ透過。`check_cert_expiry` を `check_tls` から分離し、接続失敗を例外送出→台帳 error として
   表面化（握り潰し是正）。
2. **偽陽性除去**: `check_reflected_input` に `text/html` ガード（反射型 XSS は HTML 文脈のみ成立）。
3. **受動 DNS**: `check_dns`（DMARC 欠落 / p=none / SPF 欠落）。`dnspython` は soft-import で
   不在時 skipped。`resolver` 注入でオフラインテスト可能。`_registrable_domain` は PSL 非依存の
   簡易推定（代表的多ラベル ccTLD のみ内蔵）。IP/ローカル対象は対象外。
4. **フォーム静的検査**: `check_forms`（平文送信 `insecure-form-target` / CSRF `missing-csrf-token`）。
   送信は一切行わない静的解析のみ。
5. **CVSS 較正**: `info-disclosure-banner` を VC:L→**VC:N（Info, 0.0）**。偵察系5項目は機械的
   一律変更でなく個別レビューし、`directory-listing`/`verbose-error`/`risky-http-method`/
   `cors-misconfig` は VC:L/VI:L が妥当につき据え置き。

## 明示的に不採用にしたもの（誠実性）

- **password autocomplete の無効化チェック**: 一次情報調査で ASVS 5.0.0 が方針を反転させて
  いることを確認（無効化を要求せず、v5.0.0-6.2.7 でパスワードマネージャ許可を要求）。
  現行標準に反する指摘のため不採用。
- **CAA レコード欠落**: ほぼ全サイトで欠落＝ノイズになるため DMARC/SPF に絞った。
- **OSV.dev ライブ CVE 照会**: 顧客の技術スタックが組織境界外に漏れる egress 罠。将来ローカル
  retire.js DB（オフライン）で実装する方針とし本 PR では見送り。

## 標準対応（一次情報で裏取り）

- 新規 forms 項目: `insecure-form-target` = WSTG-CRYP-03 / ASVS v5.0.0-12.2.1 (L1)、
  `missing-csrf-token` = WSTG-SESS-05 / ASVS v5.0.0-3.5.1 (L1)。
- DNS 項目（DMARC/SPF）: WSTG・ASVS はアプリ層標準のため「該当なし（独自根拠）」。CWE-693。
- 全 31 チェックの事前計算スコアは `cvss` ライブラリの実算出と完全一致（テストで担保）。

## 非破壊境界（不変）

送信は GET/HEAD/OPTIONS のみ（`_SafeClient` がコードで強制）。DNS は TXT 参照の読み取りのみ、
forms は静的解析のみ、追加コードは能動的な破壊操作・スコープ外アクセスを導入しない。

## 検証

`scripts/tests/test_pipeline.py` に台帳（clean/finding/skipped 区別）・reflected-input ガード・
DNS（fake resolver）・forms・registrable-domain・banner 較正のテストを追加（計 32 件 green）。
examples/ は v0.3（台帳入り）・匿名化で再生成。
