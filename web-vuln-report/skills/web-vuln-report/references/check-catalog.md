# 実施チェック項目カタログ（check-catalog）

本カタログは `scripts/catalog.py`（チェック定義の単一の正）と対応する。**標準対応の
authoritative な値（OWASP Top 10:2025 / CWE / WSTG v4.2 / ASVS 5.0.0 / CVSS 4.0 ベクタ・
スコア）は `catalog.py` と `references/standards-mapping.md` を正とする**。本書は各チェックの
**観測ポイント（何を見て判定するか）と 2025 分類**をまとめる。検出ロジックは
`scripts/checks.py`、外部ツール受け皿は `scripts/external_tools.py`。

**すべて非破壊チェックである。** 送信メソッドは GET / HEAD / OPTIONS に限定し
（`scripts/checks.py` の `_SafeClient` が `SAFE_METHODS` をコードで強制）、能動プローブは
「無害マーカーの反射確認」「既知パスの存在確認」に留める。データ改変・削除・DoS・破壊的
エクスプロイト成立確認は一切行わない。

## 2025 分類の分散（重要）

OWASP Top 10:2025 のデータ駆動 CWE マッピングでは、旧「A05 設定ミス」集中だったチェック群が
CWE 単位で **A01 / A02 / A04 / A06 / A10 に分散**する。真に A02（設定ミス）に残るのは
xcto / cookie-secure / cookie-httponly / cors / samesite-none の系統のみ。深刻度は
**CVSS 4.0 基本値（CVSS-B、3.1 と非互換）**、severity 区分は 3.1 と同一。

---

## A01:2025 — アクセス制御の不備

#### missing-referrer-policy — Referrer-Policy 未設定
- CWE: CWE-200 / WSTG: 該当なし（独自根拠） / ASVS: v5.0.0-3.4.5 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: リファラ制御が無く、URL に含まれる機微情報が外部サイトへ送出される余地がある。
- 対策: `Referrer-Policy: strict-origin-when-cross-origin` 等を設定する。

#### cookie-no-samesite — Cookie に SameSite 属性が無い
- CWE: CWE-1275 / WSTG: WSTG-SESS-02 / ASVS: v5.0.0-3.3.2 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: SameSite が未指定で、CSRF に対する既定防御が弱い。
- 対策: `SameSite=Lax`（または要件に応じ `Strict`）を設定する。

#### exposed-sensitive-file — 機微ファイル/ディレクトリの公開
- CWE: CWE-538 / WSTG: WSTG-CONF-04 / ASVS: v5.0.0-13.4.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N`（8.7）
- 観測: `.git`/`.env`/バックアップ等の機微ファイルが公開領域から取得可能。
- 対策: 当該ファイル/ディレクトリを公開領域から除去し、Web サーバで拒否する。

#### directory-listing — ディレクトリリスティングが有効
- CWE: CWE-548 / WSTG: WSTG-CONF-04 / ASVS: v5.0.0-13.4.3 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（6.9）
- 観測: 自動インデックス表示が有効で、意図しないファイル一覧が閲覧できる。
- 対策: Web サーバの自動インデックスを無効化する（`Options -Indexes` 等）。

#### open-redirect — オープンリダイレクトの可能性
- CWE: CWE-601 / WSTG: WSTG-CLNT-04 / ASVS: v5.0.0-3.7.2 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N`（5.1）
- 観測: リダイレクト先パラメータが検証されず、任意 URL へ誘導できる兆候がある。
- 対策: リダイレクト先を相対パスまたは許可リストに限定する。

#### info-disclosure-banner — サーバ/フレームワークのバージョン露出
- CWE: CWE-200 / WSTG: WSTG-INFO-02 / ASVS: v5.0.0-13.4.6 (L3)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N`（0.0・Info）
- 観測: Server/X-Powered-By 等でソフトウェアとバージョンが露出。直接の機密性侵害は無いが偵察を容易にする参考情報（v0.3 で VC:L→VC:N に較正。バージョン文字列は機密データでないため）。
- 対策: バージョン情報の露出を抑制する（トークン非表示・バナー抑制）。

#### missing-csrf-token — 機微な POST フォームに anti-CSRF トークンが見当たらない
- CWE: CWE-352 / WSTG: WSTG-SESS-05 / ASVS: v5.0.0-3.5.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: 機微な POST フォーム（password/email 等を含む）に anti-CSRF トークン様の hidden が無い。SameSite/ヘッダ方式の防御は静的解析で検知できないため手動確認を推奨（確度 Low）。フォームは静的検査のみで送信は行わない。
- 対策: 同期トークン（anti-CSRF トークン）を導入し、`SameSite` Cookie を併用する。

---

## A02:2025 — セキュリティの設定ミス

#### missing-xcto — X-Content-Type-Options: nosniff 未設定
- CWE: CWE-16 / WSTG: 該当なし（独自根拠） / ASVS: v5.0.0-3.4.4 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: MIME スニッフィング抑止ヘッダが無く、ブラウザがコンテンツ型を誤推定して スクリプトとして解釈する余地がある。
- 対策: 全応答に `X-Content-Type-Options: nosniff` を付与する。

#### cookie-insecure — Cookie に Secure 属性が無い（HTTPS 配信下）
- CWE: CWE-614 / WSTG: WSTG-SESS-02 / ASVS: v5.0.0-3.3.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（6.3）
- 観測: Secure 属性が無く、平文経路で Cookie が送出される可能性がある。
- 対策: 認証系 Cookie に `Secure` 属性を付与する。

#### cookie-no-httponly — Cookie に HttpOnly 属性が無い
- CWE: CWE-1004 / WSTG: WSTG-SESS-02 / ASVS: v5.0.0-3.3.4 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:N/SA:N`（2.1）
- 観測: HttpOnly が無く、XSS 発生時に JavaScript から Cookie を読み取られる。
- 対策: 認証系 Cookie に `HttpOnly` 属性を付与する。

#### cors-misconfig — CORS の設定ミス（任意オリジン反射 + credentials 許可）
- CWE: CWE-942 / WSTG: WSTG-CLNT-07 / ASVS: v5.0.0-3.4.2 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N`（6.9）
- 観測: Origin をそのまま反射しつつ credentials を許可しており、任意サイトから 認証済みレスポンスを読み取れる。
- 対策: 許可オリジンをホワイトリスト化し、Origin 反射をやめる。credentials 許可時はワイルドカード/反射を禁止する。

#### risky-http-method — 危険な HTTP メソッドが有効（TRACE/PUT/DELETE 等）
- CWE: CWE-650 / WSTG: WSTG-CONF-06 / ASVS: v5.0.0-13.4.4 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（6.9）
- 観測: OPTIONS 応答で TRACE/PUT/DELETE 等が許可されている。
- 対策: 不要な HTTP メソッドを無効化し、必要なものだけ許可する。

#### cookie-samesite-none-insecure — Cookie が SameSite=None かつ Secure 属性を欠く
- CWE: CWE-614 / WSTG: WSTG-SESS-02 / ASVS: v5.0.0-3.3.1 (L1) / 3.3.2 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: SameSite=None は Secure 属性が必須。欠くとモダンブラウザに拒否され、平文経路での送出や CSRF 防御の無効化につながる。
- 対策: `SameSite=None` を用いる場合は必ず `Secure` を併記する。

#### dns-dmarc-missing — DMARC レコード未設定（メールなりすまし対策の欠如）
- CWE: CWE-693 / WSTG: 該当なし（独自根拠） / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: `_dmarc.<domain>` に DMARC レコード（v=DMARC1）が無く、正規ドメインを騙るなりすましメールを受信側が判別しにくい。DNS の TXT 参照のみの受動チェック（非破壊）。
- 対策: DMARC レコードを公開し、SPF/DKIM と整合させ p=quarantine→reject へ段階強化する。

#### dns-dmarc-weak — DMARC ポリシーが p=none（監視のみ・拒否しない）
- CWE: CWE-693 / WSTG: 該当なし（独自根拠） / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: DMARC は存在するが p=none で、なりすましメールを検疫・拒否せず監視のみ。
- 対策: レポートで正規送信元を洗い出し、p=quarantine を経て p=reject へ強化する。

#### dns-spf-missing — SPF レコード未設定（送信元 IP 認可の欠如）
- CWE: CWE-693 / WSTG: 該当なし（独自根拠） / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: ドメイン apex に SPF レコード（v=spf1）が無く、送信を許可された IP の宣言が欠けている。DNS TXT 参照のみの受動チェック。
- 対策: SPF レコードを公開し、正規送信元のみ許可して末尾を -all（または ~all）とする。

---

## A03:2025 — ソフトウェアサプライチェーンの障害

#### outdated-library — 古い可能性のあるクライアントライブラリの使用
- CWE: CWE-1104 / WSTG: 該当なし（独自根拠） / ASVS: v5.0.0-15.2.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: 既知の古いバージョン痕跡を持つ JS ライブラリを検出。CVE 断定には外部 DB （nuclei 等）併用が必要。
- 対策: 依存ライブラリを最新の安定版へ更新し、SCA を継続導入する。

#### external-tool-finding — 外部ツール検出（nuclei/nikto/testssl）
- CWE: CWE-1035 / WSTG: 該当なし（独自根拠） / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（6.9）
- 観測: 外部スキャナが検出した所見。詳細は evidence を参照。
- 対策: 各ツールの推奨に従い是正する。

---

## A04:2025 — 暗号化の失敗

#### missing-hsts — HTTP Strict-Transport-Security (HSTS) ヘッダ未設定
- CWE: CWE-319 / WSTG: WSTG-CONF-07 / ASVS: v5.0.0-3.4.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: HSTS ヘッダが無いため、初回アクセスや平文リダイレクト時に中間者による ダウングレード攻撃（SSL Strip）の余地が残る。
- 対策: HTTPS 応答に `Strict-Transport-Security: max-age=31536000; includeSubDomains` を付与する。プリロード登録も検討する。

#### tls-weak-protocol — 旧式 TLS/SSL プロトコルが有効
- CWE: CWE-327 / WSTG: WSTG-CRYP-01 / ASVS: v5.0.0-12.1.1 (L1) / 12.1.2 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N`（6.0）
- 観測: TLS 1.0/1.1 等の非推奨プロトコルが有効で、既知の弱点を突かれる余地がある。
- 対策: TLS 1.2 以上のみを許可し、TLS 1.0/1.1 と SSLv3 を無効化する。

#### tls-cert-expiring — TLS 証明書の有効期限が近い/失効
- CWE: CWE-298 / WSTG: WSTG-CRYP-01 / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: 証明書が失効間近または失効しており、警告表示や信頼失墜を招く。
- 対策: 証明書を更新し、自動更新（ACME 等）と失効監視を導入する。

#### no-https-redirect — HTTP アクセスが HTTPS へリダイレクトされない
- CWE: CWE-319 / WSTG: WSTG-CONF-07 / ASVS: v5.0.0-12.2.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: 平文 HTTP でのアクセスが HTTPS へ確実に誘導されず、初回接続や直打ちで平文通信が成立しうる。
- 対策: 全 HTTP アクセスを HTTPS へ 301 リダイレクトし、HSTS を併用する。

#### insecure-form-target — フォームの送信先が平文 HTTP（暗号化されない経路への送信）
- CWE: CWE-319 / WSTG: WSTG-CRYP-03 / ASVS: v5.0.0-12.2.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: HTML フォームの action が http:// を指し、入力（認証情報を含みうる）が暗号化されない経路で送信される。crawl 済みフォーム定義の静的検査のみ（送信は行わない）。
- 対策: フォームの送信先を https:// に統一し、平文 HTTP への送信を排除する。

---

## A05:2025 — インジェクション

#### reflected-input — 入力値の無害化されない反射（XSS の兆候）
- CWE: CWE-79 / WSTG: WSTG-INPV-01 / ASVS: v5.0.0-1.2.1 (L1)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N`（5.1）
- 観測: 無害な検査マーカーが HTML エスケープされずに応答へ反射している。反射型 XSS の疑い。
- 対策: 出力コンテキストに応じたエスケープ/サニタイズを施し、CSP を併用する。

---

## A06:2025 — 安全でない設計

#### missing-csp — Content-Security-Policy (CSP) 未設定
- CWE: CWE-693 / WSTG: 該当なし（独自根拠） / ASVS: v5.0.0-3.4.3 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: CSP が無く、XSS 等のスクリプト注入に対する多層防御が欠如している。
- 対策: 適切な `Content-Security-Policy` を段階的に導入する（まず `default-src 'self'` を Report-Only で検証）。

#### weak-csp — Content-Security-Policy が脆弱（unsafe-inline / unsafe-eval / ワイルドカード）
- CWE: CWE-693 / WSTG: 該当なし（独自根拠） / ASVS: v5.0.0-3.4.3 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: CSP に `unsafe-inline`/`unsafe-eval`/`*` が含まれ、防御を実質的に無効化している。
- 対策: `unsafe-inline`/`unsafe-eval` を排除し、nonce/hash ベースに移行する。ソースは必要最小限のオリジンに限定する。

#### missing-frame-options — クリックジャッキング対策（X-Frame-Options / frame-ancestors）未設定
- CWE: CWE-1021 / WSTG: WSTG-CLNT-09 / ASVS: v5.0.0-3.4.6 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: フレーム埋め込み制限が無く、UI を重ねてユーザー操作を騙し取るクリックジャッキングが可能。
- 対策: `X-Frame-Options: DENY`（または `SAMEORIGIN`）と CSP `frame-ancestors 'self'` を設定する。

#### mixed-content — 混在コンテンツ（HTTPS ページ内の HTTP リソース）
- CWE: CWE-311 / WSTG: 該当なし（独自根拠） / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N`（2.3）
- 観測: HTTPS ページが HTTP のリソースを読み込んでおり、経路上での改竄余地がある。
- 対策: 全リソースを HTTPS 化し、`upgrade-insecure-requests` を設定する。

#### missing-permissions-policy — Permissions-Policy（旧 Feature-Policy）未設定
- CWE: CWE-693 / WSTG: 該当なし（独自根拠） / ASVS: 該当なし
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（2.1）
- 観測: ブラウザ機能（カメラ・位置情報・全画面等）の利用制限ポリシーが未設定で、埋め込みコンテンツや XSS 時に機能を濫用される余地がある。
- 対策: `Permissions-Policy` で不要なブラウザ機能を明示的に無効化する。

---

## A08:2025 — ソフトウェアまたはデータ完全性の障害

#### missing-sri — 外部リソースに Subresource Integrity（SRI）が無い
- CWE: CWE-353 / WSTG: 該当なし（独自根拠） / ASVS: v5.0.0-3.6.1 (L3)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:N/VA:N/SC:L/SI:L/SA:N`（2.1）
- 観測: クロスオリジンの script/stylesheet に integrity 属性が無く、配信元の改竄や供給元汚染が検知されないまま実行される。
- 対策: 外部 script/link に `integrity`（と `crossorigin`）属性を付与する。

---

## A10:2025 — 例外的条件の不適切な処理

#### verbose-error — 詳細なエラーメッセージの露出
- CWE: CWE-209 / WSTG: WSTG-ERRH-01 / ASVS: v5.0.0-16.5.1 (L2)
- CVSS-B: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`（6.9）
- 観測: スタックトレースや内部パスを含むエラーが表示され、内部構造が漏れている。
- 対策: 本番環境ではデバッグ表示を無効化し、汎用エラーページを返す。

---

## 注意 — CVE 級判定・標準参照の境界

- 内蔵チェックは**構成・衛生面の指摘**に留まる。**CVE 級（既知脆弱ライブラリの個別脆弱性）
  判定は外部脆弱性 DB を持つツール（nuclei 等）併用時のみ**行い、`external-tool-finding`
  として取り込む。報告書の「制約事項・免責」に明記する。
- **WSTG v4.2 に専用 ID の無い項目**（CSP・一部ヘッダ・SRI・混在コンテンツ）は「該当なし
  （独自根拠）」とし、未リリースの v5.0 草案 ID は報告書本文に出さない。
- **ASVS 該当なし**（Permissions-Policy・混在コンテンツ・証明書期限）は明示する。CWE は本
  スキル独自付与（ASVS 5.0 は CWE 公式マッピングを廃止）。自動診断は ASVS 認証を意味しない。
