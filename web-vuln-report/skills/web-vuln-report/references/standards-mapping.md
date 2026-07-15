# 標準対応表（standards-mapping）

本表は全 31 チェック（`check_id`）を、**CWE・OWASP Top 10:2025・OWASP WSTG v4.2・
OWASP ASVS 5.0.0・CVSS 4.0 基本値（CVSS-B）**の各標準に一枚で対応づけたものである。
値はすべて `scripts/catalog.py`（チェック定義の単一の正）から機械生成しており、勝手な
改変をしない。CVSS-B スコアは各ベクタを `cvss` ライブラリ（`CVSS4`）で算出した基準値
（`catalog.py` の `cvss_score` に事前計算同梱）で、対象の文脈に応じた調整前の目安である。

- 深刻度しきい値は `scripts/scoring.py` の `severity_from_score()` に一致
  （Critical ≥9.0 / High ≥7.0 / Medium ≥4.0 / Low >0.0 / Info 0.0）。CVSS 3.1 と同一境界。
- WSTG v4.2 に専用テスト ID の無い項目は「該当なし（独自根拠）」と明示する。
- ASVS 5.0.0 に対応要件の無い項目は「該当なし」と明示する。
- ベクタは `CVSS:4.0/` の接頭辞を省いて表記（メトリクス順は
  `AV/AC/AT/PR/UI/VC/VI/VA/SC/SI/SA`、Scope は 4.0 で廃止）。

## 全チェック対応表（OWASP カテゴリ順 → CVSS-B 降順）

| check_id | タイトル | CWE | OWASP Top 10:2025 | WSTG v4.2 | ASVS 5.0.0 | CVSS-B ベクタ | CVSS-B |
|---|---|---|---|---|---|---|---|
| `exposed-sensitive-file` | 機微ファイル/ディレクトリの公開 | CWE-538 | A01:2025-アクセス制御の不備 | WSTG-CONF-04 | v5.0.0-13.4.1 (L1) | `AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N` | 8.7（High） |
| `directory-listing` | ディレクトリリスティングが有効 | CWE-548 | A01:2025-アクセス制御の不備 | WSTG-CONF-04 | v5.0.0-13.4.3 (L2) | `AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 6.9（Medium） |
| `info-disclosure-banner` | サーバ/フレームワークのバージョン露出 | CWE-200 | A01:2025-アクセス制御の不備 | WSTG-INFO-02 | v5.0.0-13.4.6 (L3) | `AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N` | 0.0（Info） |
| `open-redirect` | オープンリダイレクトの可能性 | CWE-601 | A01:2025-アクセス制御の不備 | WSTG-CLNT-04 | v5.0.0-3.7.2 (L2) | `AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N` | 5.1（Medium） |
| `missing-referrer-policy` | Referrer-Policy 未設定 | CWE-200 | A01:2025-アクセス制御の不備 | 該当なし（独自根拠） | v5.0.0-3.4.5 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `cookie-no-samesite` | Cookie に SameSite 属性が無い | CWE-1275 | A01:2025-アクセス制御の不備 | WSTG-SESS-02 | v5.0.0-3.3.2 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `missing-csrf-token` | 機微な POST フォームに anti-CSRF トークンが見当たらない | CWE-352 | A01:2025-アクセス制御の不備 | WSTG-SESS-05 | v5.0.0-3.5.1 (L1) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `cors-misconfig` | CORS の設定ミス（任意オリジン反射 + credentials 許可） | CWE-942 | A02:2025-セキュリティの設定ミス | WSTG-CLNT-07 | v5.0.0-3.4.2 (L1) | `AV:N/AC:L/AT:N/PR:N/UI:A/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N` | 6.9（Medium） |
| `risky-http-method` | 危険な HTTP メソッドが有効（TRACE/PUT/DELETE 等） | CWE-650 | A02:2025-セキュリティの設定ミス（暫定・2025 CWE リスト未確認） | WSTG-CONF-06 | v5.0.0-13.4.4 (L2) | `AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 6.9（Medium） |
| `cookie-insecure` | Cookie に Secure 属性が無い（HTTPS 配信下） | CWE-614 | A02:2025-セキュリティの設定ミス | WSTG-SESS-02 | v5.0.0-3.3.1 (L1) | `AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 6.3（Medium） |
| `dns-dmarc-missing` | DMARC レコード未設定（メールなりすまし対策の欠如） | CWE-693 | A02:2025-セキュリティの設定ミス | 該当なし（独自根拠） | 該当なし | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `dns-dmarc-weak` | DMARC ポリシーが p=none（監視のみ・拒否しない） | CWE-693 | A02:2025-セキュリティの設定ミス | 該当なし（独自根拠） | 該当なし | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `dns-spf-missing` | SPF レコード未設定（送信元 IP 認可の欠如） | CWE-693 | A02:2025-セキュリティの設定ミス | 該当なし（独自根拠） | 該当なし | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `missing-xcto` | X-Content-Type-Options: nosniff 未設定 | CWE-16 | A02:2025-セキュリティの設定ミス | 該当なし（独自根拠） | v5.0.0-3.4.4 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `cookie-no-httponly` | Cookie に HttpOnly 属性が無い | CWE-1004 | A02:2025-セキュリティの設定ミス | WSTG-SESS-02 | v5.0.0-3.3.4 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:N/SA:N` | 2.1（Low） |
| `cookie-samesite-none-insecure` | Cookie が SameSite=None かつ Secure 属性を欠く | CWE-614 | A02:2025-セキュリティの設定ミス | WSTG-SESS-02 | v5.0.0-3.3.1 (L1) / 3.3.2 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `external-tool-finding` | 外部ツール検出（nuclei/nikto/testssl） | CWE-1035 | A03:2025-ソフトウェアサプライチェーンの障害（受け皿・暫定） | 該当なし（独自根拠） | 該当なし | `AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 6.9（Medium） |
| `outdated-library` | 古い可能性のあるクライアントライブラリの使用 | CWE-1104 | A03:2025-ソフトウェアサプライチェーンの障害 | 該当なし（独自根拠） | v5.0.0-15.2.1 (L1) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `tls-weak-protocol` | 旧式 TLS/SSL プロトコルが有効 | CWE-327 | A04:2025-暗号化の失敗 | WSTG-CRYP-01 | v5.0.0-12.1.1 (L1) / 12.1.2 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N` | 6.0（Medium） |
| `missing-hsts` | HTTP Strict-Transport-Security (HSTS) ヘッダ未設定 | CWE-319 | A04:2025-暗号化の失敗 | WSTG-CONF-07 | v5.0.0-3.4.1 (L1) | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `tls-cert-expiring` | TLS 証明書の有効期限が近い/失効 | CWE-298 | A04:2025-暗号化の失敗（暫定・2025 CWE リスト未確認） | WSTG-CRYP-01 | 該当なし | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `no-https-redirect` | HTTP アクセスが HTTPS へリダイレクトされない | CWE-319 | A04:2025-暗号化の失敗 | WSTG-CONF-07 | v5.0.0-12.2.1 (L1) | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `insecure-form-target` | フォームの送信先が平文 HTTP（暗号化されない経路への送信） | CWE-319 | A04:2025-暗号化の失敗 | WSTG-CRYP-03 | v5.0.0-12.2.1 (L1) | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `reflected-input` | 入力値の無害化されない反射（XSS の兆候） | CWE-79 | A05:2025-インジェクション | WSTG-INPV-01 | v5.0.0-1.2.1 (L1) | `AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N` | 5.1（Medium） |
| `mixed-content` | 混在コンテンツ（HTTPS ページ内の HTTP リソース） | CWE-311 | A06:2025-安全でない設計 | 該当なし（独自根拠） | 該当なし | `AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.3（Low） |
| `missing-csp` | Content-Security-Policy (CSP) 未設定 | CWE-693 | A06:2025-安全でない設計 | 該当なし（独自根拠） | v5.0.0-3.4.3 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `weak-csp` | Content-Security-Policy が脆弱（unsafe-inline / unsafe-eval / ワイルドカード） | CWE-693 | A06:2025-安全でない設計 | 該当なし（独自根拠） | v5.0.0-3.4.3 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `missing-frame-options` | クリックジャッキング対策（X-Frame-Options / frame-ancestors）未設定 | CWE-1021 | A06:2025-安全でない設計 | WSTG-CLNT-09 | v5.0.0-3.4.6 (L2) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `missing-permissions-policy` | Permissions-Policy（旧 Feature-Policy）未設定 | CWE-693 | A06:2025-安全でない設計 | 該当なし（独自根拠） | 該当なし | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 2.1（Low） |
| `missing-sri` | 外部リソースに Subresource Integrity（SRI）が無い | CWE-353 | A08:2025-ソフトウェアまたはデータ完全性の障害 | 該当なし（独自根拠） | v5.0.0-3.6.1 (L3) | `AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N` | 2.1（Low） |
| `verbose-error` | 詳細なエラーメッセージの露出 | CWE-209 | A10:2025-例外的条件の不適切な処理 | WSTG-ERRH-01 | v5.0.0-16.5.1 (L2) | `AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` | 6.9（Medium） |

計 31 チェック（OWASP 内訳: A01=7 / A02=9 / A03=2 / A04=5 / A05=1 / A06=5 / A08=1 / A10=1）。

## 補足: 旧 A05:2021（設定ミス）集中の解消

CVSS 3.1 / Top 10:2021 版では、内蔵チェックの主力（ヘッダ・Cookie 系）が
**A05:2021-セキュリティの設定ミス**に集中していた。Top 10:2025 では対象 CWE 単位で
再マッピングされ、旧 A05 のチェック群は **A01（アクセス制御の不備）/ A02（設定ミス）/
A04（暗号化の失敗）/ A06（安全でない設計）/ A10（例外的条件の不適切な処理）** に分散した。
2025 で真に A02（設定ミス）に残るのは `missing-xcto` / `cookie-insecure` /
`cookie-no-httponly` / `cookie-samesite-none-insecure` / `cors-misconfig` /
`risky-http-method` 系である。

## 各標準の版・出典・誠実性の注記

| 標準 | 採用版 | 出典 |
|---|---|---|
| CVSS | 4.0（基本値のみ = CVSS-B） | https://www.first.org/cvss/v4.0/specification-document |
| OWASP Top 10 | 2025（現行公開版） | https://owasp.org/Top10/2025/ |
| OWASP WSTG | v4.2（安定版） | https://owasp.org/www-project-web-security-testing-guide/ |
| OWASP ASVS | 5.0.0（2025-05-30） | https://owasp.org/www-project-application-security-verification-standard/ |

- **OWASP Top 10:2025 は「現行公開版」**として扱い、"最終版（final）" とは断定しない。
- **WSTG は安定版 v4.2 を採用**。CSP・一部セキュリティヘッダ・SRI・混在コンテンツは
  v4.2 に専用テスト ID が無く「該当なし（独自根拠）」とした。v5.0 は未リリース草案のため、
  草案の暫定 ID（CONF-12 / CONF-14 等）は本表・報告書本文に**記載しない**。
- **CWE は本スキル独自付与**。ASVS 5.0.0 は CWE 公式マッピングを廃止しており、CWE は
  ASVS の裏付けを持たない参考分類である。
- **ASVS 参照は技術検証の一部**にすぎず、本スキルの自動・非破壊診断は **ASVS 認証や
  OWASP トラストマークを意味しない**。ASVS の業務ロジック・認可（ATHZ）等、自動化不可の
  検証項目は本スキルの範囲外である。
- **`tls-cert-expiring` / `risky-http-method` / `external-tool-finding`** の 2025 カテゴリは
  一次 CWE リストでの確定に至っておらず「暫定／受け皿」と明示した。
- CVSS-B は脅威情勢（E）未指定＝最悪ケース前提の基準値であり、対象の実態に応じて
  `references/cvss-guide.md` の手順で文脈調整する前提である。CVSS 3.1 とはスコアが
  非互換で相互換算できない。
- **v0.3 の較正**: `info-disclosure-banner`（バージョン露出）は VC:L→**VC:N（Info, 0.0）**
  に是正した。バージョン文字列そのものは機密データではなく、露出は偵察の効率化に寄与する
  参考情報にとどまるため。CVSS 4.0 が VC:L の低影響ネットワーク issue を 6.9 と高めに出す
  傾向を、機密性影響の実態に合わせて補正した誠実性優先の判断である。
- **v0.3 の追加**: `dns-dmarc-missing` / `dns-dmarc-weak` / `dns-spf-missing`（受動 DNS・
  メール認証）、`insecure-form-target`（フォーム平文送信）、`missing-csrf-token`（機微 POST の
  anti-CSRF トークン欠如）を追加。DMARC/SPF は WSTG・ASVS がアプリ層標準のため「該当なし
  （独自根拠）」。なお **password の autocomplete 無効化は不採用**（ASVS 5.0.0 は無効化を
  要求せず、むしろ v5.0.0-6.2.7 でパスワードマネージャ許可を要求する方針転換があったため）。
