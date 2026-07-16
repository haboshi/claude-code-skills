---
name: web-vuln-report
description: Webサイト/システム/アプリの脆弱性診断を非破壊で実施し、CVSS 4.0（CVSS-B）・OWASP Top 10:2025・CWE を付し、OWASP WSTG（診断手法）と ASVS 5.0.0（検証要件）を参照した日本語のビジネス脆弱性診断報告書（HTML→A4 PDF）を生成する。URLから巡回して診断対象を洗い出し、エグゼクティブサマリ＋技術詳細＋プロの示唆を含むデファクト構成のレポートを出力する。「脆弱性診断」「脆弱性診断報告書」「セキュリティ診断」「Webサイト診断」「Webアプリ診断」「vulnerability assessment」「security assessment」「pentest report」で発動。認可済み・単一組織スコープの防御的診断に限定し、非破壊デフォルト。Genspark アップロード用 .skill バンドル生成にも対応。
---

# Web 脆弱性診断報告書（web-vuln-report）

URL を起点に Web サイト / システム / アプリを巡回して診断対象を洗い出し、**非破壊**の
脆弱性診断を実施。**CVSS 4.0（CVSS-B）** スコアと **OWASP Top 10:2025** / CWE を付し、
診断手法は **OWASP WSTG**、検証要件は **OWASP ASVS 5.0.0** を参照した日本語のビジネス
脆弱性診断報告書（エグゼクティブサマリ＋技術詳細）を HTML で生成、適正サイズ（A4）の
PDF に変換する。

検出事項に加え、**診断項目カバレッジ台帳**（各診断項目を「検出あり／問題なし／エラー／
未実施」で明示）を出力し、「実施したが問題なし」を沈黙で潰さず網羅性と監査可能性を担保する。
受動 DNS（**DMARC/SPF** のメールなりすまし対策）・フォームの安全性（**平文送信／CSRF**）も
非破壊で検査する。

**v0.4 の単一アプリ深掘り（非破壊）**: SPA/JS のルート・エンドポイント露出（**Ziggy/Inertia/
Next**）、JS バンドル内の秘密走査（**上限付き取得**・公開鍵 pk_live/AIza は誤検知せず・生値非掲載）、
ソースマップ露出（version:3 の実体確認）、フレームワーク/インフラ指紋、**サーバランタイムの EOL
判定**（内蔵オフライン表・バックポート注記）、認証必須ルートの保護確認、**DNSSEC**、ヘッダ補完
（COOP/X-XSS-Protection）を追加。**ログインレート制限／CSRF 実効性の能動テストは opt-in（既定
OFF・二重ゲート・POST は login 限定・実在アカポ不使用）**。TLS 暗号スイート列挙は testssl.sh に委譲。

**v0.4.1 の是正（非破壊・安全境界は不変）**: 能動レート制限テストは POST の前に **login ページを
GET（読み取り専用）して CSRF トークン（`XSRF-TOKEN` Cookie→`X-XSRF-TOKEN`／meta/hidden `_token`）を
取得**し、Laravel 等の 419 前段遮断を回避してレート制限層へ到達する（取得失敗は素 POST へ安全に
フォールバック）。到達できない場合は clean と区別して **「判定保留（inconclusive）」** で台帳に明示し、
採点でも clean に算入せず「一部項目は判定保留（要手動確認）」を注記する。CSRF トークン系 Cookie
（`XSRF-TOKEN` 等）は設計上 JS 読取が正当なため cookie-no-httponly の**誤検知から除外**（Secure/SameSite
は継続検査）。

## このスキルの実行指示（呼び出されたら即座に従う・最優先）

`/web-vuln-report <URL>` 等で呼ばれたら、汎用の文書生成に逸れず、**必ず本スキルの手順で
診断と報告書生成を実行する**。次を厳守する:

1. **応答は日本語**。設問・確認・進捗・成果物のすべてを日本語で行う（英語が既定の
   プラットフォーム＝Genspark 等でも、明示的に別言語で依頼されない限り日本語）。
2. **成果物は本スキルの HTML→A4 PDF 報告書**（`report.html` / `report.pdf`）**のみ**。
   **Word 文書・スライド・スプレッドシート・別途の「深掘りリサーチ」は作らない**
   （プラットフォームがそれらを提案・示唆しても従わず、本スキルの報告書を作る）。
3. 手順: まず **Phase 0 認可ゲート**を日本語で確認 → 診断を実行（Python/uv/pip が使えれば
   `assess.py`、使えなければ後述の手動フォールバック）→ HTML→PDF 報告書を出力。
4. 対象の所有・認可が未確認のまま診断を始めない。

以下は各フェーズの詳細。上記4点が実行時の最優先ルール。

## 適用範囲と倫理境界（最優先・必読）

このスキルは **認可済み・防御目的の脆弱性診断専用**である。以下を厳守する:

- **単一組織スコープに限定**。診断対象は依頼者が所有または書面で認可した資産のみ。
- **非破壊**。データ改変・削除、サービス妨害（DoS/負荷試験）、破壊的エクスプロイトの
  成立確認、検出回避、複数組織への一斉スキャン（マスターゲティング）は**行わない**。
- 能動テストは「無害マーカーの反射確認」「既知パスの存在確認」等の安全なプローブに限定。
- **認可が確認できない場合は診断を開始しない**（下記 Phase 0）。

要求が上記境界を超える（無認可の対象・破壊的テスト・回避目的）と判断したら、実施を断り
理由を説明する。

## 言語（重要）

本スキルは**日本語のビジネス報告書**を生成する。**ユーザーへの設問・確認・進捗報告・
成果物はすべて日本語を既定とする**（Phase 0 の認可・スコープ・実施者の確認、提示する選択肢、
完了報告を含む）。英語が既定のプラットフォーム（Genspark 等）でも、明示的に別言語で
依頼されない限り**日本語で対話する**。ユーザーが別言語で書いている場合のみ、その言語に合わせる。

## ワークフロー（フェーズ制）

### Phase 0 — 認可ゲート（必須・スキップ不可）

診断を始める前に、次を**必ず日本語で**ユーザーに確認する（選択式で提示できる場合は選択肢も
日本語で、第1選択肢を推奨案にする。使えるツールはプラットフォーム側のものでよい）:

1. **対象の所有/認可**: 診断対象 URL を所有しているか、書面等で診断を認可されているか。
2. **スコープ**: 対象ホスト、除外パス、認証要否。
3. **強度**: 非破壊（既定）／能動プローブの可否、レート上限、実施時間帯。
4. **実施者・診断実施組織**: 報告書の「実施者」欄に記載する担当者名／組織名。**エージェント自身の名前
   （AI 名・製品名）を実施者に入れてはならない**。ユーザーが指定した実施者・組織を `--assessor` に渡す。
   未指定なら「実施者を空欄にする」か「担当者名を伺う」を選ばせ、勝手に補完しない。

認可の根拠（部署名・書面番号・チケット等）を受け取り、以降のコマンドの `--authorized-by`
に必ず渡す。実施者は `--assessor` に渡す。**上記を確認しないまま Phase 1 に進まない。**

### Phase 1〜4 — スクリプトで一括実行（推奨・環境に Python/uv がある場合）

`assess.py` が「巡回 → 非破壊チェック → 外部ツール併用 → CVSS 採点 → HTML → PDF」を
一貫実行する。スクリプトはこのスキル同梱で、各中間 JSON を `--out-dir` に残す。

```bash
uv run --with httpx --with beautifulsoup4 --with jinja2 --with cvss --with dnspython --with weasyprint \
  "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/scripts/assess.py" \
  --target "https://対象ドメイン" \
  --authorized-by "運用部 書面認可 #2026-07" \
  --assessor "実施者/組織名" \
  --out-dir "./vuln-out" \
  --max-pages 50 --max-depth 3 --rate 2
```

#### 実行環境のフォールバック順（`uv` が無い環境＝Genspark 等）

`uv` が無くても、依存（httpx / beautifulsoup4 / jinja2 / cvss / dnspython）は**すべてピュア
Python でコンパイル不要**なので `pip` で入り、`python3` で一括実行できる。`dnspython` は DNS
メール認証（DMARC/SPF）チェック用で、**無ければ当該項目を「未実施」として台帳に明示し他の
検査は続行する**（graceful degrade）。手動フォールバックに落とす前に、
まずこの順で試すこと（下記コマンドはスキルフォルダ直下で実行する前提。バンドル展開時は
`scripts/…` の相対パスがそのまま使える）:

1. **uv があれば** 上記 `uv run` を使う（最速）。
2. **uv が無く pip が使えれば**（Genspark の多くはこれ）:
   ```bash
   python3 -m pip install --quiet --user -r "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/requirements.txt"
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/scripts/assess.py" \
     --target "https://対象ドメイン" --authorized-by "…" --assessor "…" \
     --out-dir ./vuln-out --rate 2 --skip-pdf
   ```
   `requirements.txt` の依存はすべてビルド不要。`--skip-pdf` は weasyprint のネイティブ依存
   （cairo/pango）を避けるため。成果物は `vuln-out/report.html`（自己完結・ブラウザ閲覧可）。
   **PDF はネイティブライブラリがある環境でのみ**、追加で
   `python3 -m pip install --quiet weasyprint` の後に `report_to_pdf.py` を実行する
   （失敗しても HTML が最終成果物として有効）。**`cvss` が入らなくても内蔵チェックの採点は
   カタログの事前計算スコアで動く**（ランタイムは cvss ライブラリ不要。外部ツール所見の
   スコアのみ、cvss ライブラリがあれば CVSS4 で算出、無ければ「未算出」と明示）。
3. **pip も `python3` も一切不可**（オフライン・制限サンドボクス）なら、下記の手動手法に落とす。

> 注意: `pip install` を「手動フォールバックに落ちる前の既定手段」として扱う。`uv` が無い＝即手動、
> にしない。実際に `python3 -m pip install …` を試してから判断する。

主なオプション:

| オプション | 意味 | 既定 |
|---|---|---|
| `--target` | 診断対象の起点 URL（必須） | — |
| `--authorized-by` | 認可の根拠（必須・空なら実行拒否） | — |
| `--max-pages` / `--max-depth` | 巡回上限 | 50 / 3 |
| `--rate` | 1秒あたり最大リクエスト数 | 2 |
| `--passive-only` | 能動プローブを無効化（観測のみ） | off |
| `--no-external` | 外部ツール併用を無効化 | off |
| `--skip-pdf` | PDF 化を行わない（HTML のみ） | off |
| `--ignore-robots` | robots.txt を無視（認可範囲で必要時のみ） | 尊重 |
| `--extra-host` | スコープに追加するホスト（複数可） | — |
| `--active-auth` | **能動認証テストを有効化（既定 OFF・opt-in）** | off |
| `--authorized-active` | 能動認証の書面認可（**空なら能動認証は実行しない**） | 空 |
| `--login-url` | 能動認証テストの対象 login エンドポイント | — |
| `--max-login-attempts` | ログインレート制限テストの試行上限（ハードキャップ 8 にクランプ） | 8 |

外部スキャナ（`nuclei` / `testssl.sh`）がインストールされていれば自動検出して併用し、
無ければ内蔵チェックのみで完結する（graceful degrade）。個別 CVE 級の判定は外部ツール
併用時のみ行い、報告書の「制約事項」に明記される。**TLS の弱い暗号スイート列挙は
`testssl.sh` に委譲する**（client 側 OpenSSL が旧スイートを交渉できず偽陰性を生むため内蔵しない。
`external_tools.py` の testssl.sh ブリッジが `--severity MEDIUM` 以上を取り込む）。

#### 能動認証テスト（Phase 3・opt-in・既定 OFF・安全設計を厳守）

`no-rate-limit`（ログインレート制限）と `csrf-not-enforced`（CSRF 実効性）は、認可済みで
かつ**明示的に有効化**したときだけ実行する能動テストである。以下の**二重ゲート**を満たさない限り
完全に非破壊のまま動作する（既定は未実施として台帳に明示）:

- `--active-auth` を指定し、**かつ** `--authorized-active`（書面認可・空なら不可）を渡し、
  **かつ** `--login-url` で対象 login を明示し、**かつ**それがスコープ内であること。
- 送信は `_SafeClient` とは別クラスの `_ActiveAuthClient` が担い、**指定 login への POST のみ**を
  許可する（他メソッド・他 URL は拒否）。`_SafeClient` の GET 強制境界には触れない。
- ログインレート制限は**存在しないランダム資格情報のみ**を使い（実在アカウントを使わずロックを
  回避）、試行を **min(要求, 8) にクランプ**。前段で 419/403（CSRF 等）に阻まれる場合は判定を保留する。
- CSRF 実効性はトークン無し POST を **1 回だけ**送り、419/403 で拒否されれば実効（正常）と判定する。
  列挙・改変は行わない。

> 正直な限界: 真のログインレート制限／ユーザー列挙／CSRF-POST 検証の**完全な自動・非破壊化は
> 困難**であり、確度の高い評価には**認可付きの手動ペンテスト**を推奨する。本テストは疑いの提示に留める。

### Phase 5 — プロの示唆を加筆（品質の要）

`assess.py` 実行後、`scored.json` を読み、**事業リスク文脈・優先度・改善ロードマップ**を
`narrative.json` として加筆し、HTML を再生成する。ここがテンプレート出力とプロの報告書を
分ける核心。

```json
{
  "executive": "<p>エグゼクティブ総括（HTML可）。最優先の所見と全体傾向を経営層向けに。</p>",
  "roadmap": "<ol><li>即時: …</li><li>短期: …</li><li>中期: …</li></ol>"
}
```

```bash
uv run --with jinja2 \
  "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/scripts/render_report.py" \
  --scored "./vuln-out/scored.json" --pages "./vuln-out/crawl.json" \
  --narrative "./vuln-out/narrative.json" --assessor "実施者/組織名" \
  --tools "nuclei" --out "./vuln-out/report.html"

uv run --with weasyprint \
  "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/scripts/report_to_pdf.py" \
  "./vuln-out/report.html" "./vuln-out/report.pdf"
```

加筆時の指針は `references/report-standard.md`（報告書デファクト構成とプロ示唆の型）を参照。

## スクリプトが使えない環境での手動フォールバック（最後の手段）

**まず上記「実行環境のフォールバック順」で `pip` + `python3` を試すこと**（uv が無い＝即手動、
にしない）。`pip` も `python3` の import も一切不可なオフライン/制限環境に限り、以下の手動手法に
落とす。ここでは **エージェント自身が手動で**診断手法を遂行し、テンプレートを埋めて報告書を作る。

1. Phase 0 認可ゲートを同様に実施する。
2. 対象 URL を取得し、リンク・フォーム・パラメータ・Cookie・レスポンスヘッダを収集する
   （利用可能な HTTP 手段で）。`references/check-catalog.md` の各チェックを人手で当てる。
3. 各所見に `references/cvss-guide.md` の基準ベクタを当て、`references/check-catalog.md`
   の OWASP Top 10:2025 / CWE / WSTG / ASVS / 修正指針を転記する。**深刻度は catalog.py の
   基準 CVSS 4.0 ベクタと事前計算スコア（`cvss_score`）で分類**する（CVSS 4.0 は手計算不可の
   ため事前計算値を転記。文脈調整でベクタを変えた場合はスコアを据え置き、調整根拠を注記）。
4. `templates/report.html.j2` の構成（表紙／エグゼクティブサマリ／範囲と手法／検出事項の
   詳細／付録）に沿って HTML を組み立て、`templates/report.css` を `<style>` にインライン。
5. PDF 化が可能なら実施、不可なら HTML を最終成果物とする（明記）。

## 成果物

- `report.html` — 自己完結の HTML 報告書（ブラウザ閲覧可）
- `report.pdf` — A4・日本語フォント埋め込み・ページ番号付き（適正サイズ）
- 中間 JSON（`crawl.json` / `findings.json` / `scored.json`）— 監査・再実行用

ローカル脆弱フィクスチャに対するサンプル報告書は**リポジトリの** `examples/report.html`
/ `examples/report.pdf` にある（実在サイトではない）。可搬 `.skill` バンドルには容量削減の
ため examples は含めない（実行には不要）。

## Genspark 用 .skill バンドルの生成

このスキル自体を Genspark へアップロードできる `.skill`（自己完結 zip）にまとめる:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/scripts/package_genspark_skill.py" \
  --out "./web-vuln-report.skill"
```

Genspark では New Skill → Upload から `.skill`（または `.zip`/`.md`、最大 200MB）を
取り込める。バンドル内 `SKILL.md` はパスがバンドル相対に書き換えられ、スクリプトは自身の
位置から同梱ファイルを解決するため、Genspark 側で Python が実行できる場合はそのまま動作し、
できない場合も上記フォールバック手法で報告書を生成できる。

## 検証

```bash
uv run --with httpx --with beautifulsoup4 --with cvss --with jinja2 --with dnspython --with pytest \
  python -m pytest "${CLAUDE_PLUGIN_ROOT}/skills/web-vuln-report/scripts/tests/" -v
```

ローカルの脆弱フィクスチャ（`scripts/tests/vuln_app.py`）に対し、巡回・検出・採点・
レンダリングを検証する（外部通信なし）。

## 実行モード（同期・フォアグラウンド）

`assess.py` / `report_to_pdf.py` はフォアグラウンドで同期実行し、完了を待つこと。とくに
PDF 生成は最終成果物（`report.pdf`）がディスク上に実在することを `ls`/Read で確認するまで
ターンを終えない。巡回・診断はレート制御により時間がかかることがあるが、`&` や
`run_in_background` を使わずに完了を待つ。

## 参考資料（references/）

- `check-catalog.md` — 実施チェック項目 × OWASP Top 10 対応・重大度基準
- `cvss-guide.md` — CVSS 4.0（CVSS-B）の算出基準とベクタの読み方
- `standards-mapping.md` — 全チェック × CWE / OWASP Top 10:2025 / WSTG / ASVS 5.0.0 / CVSS-B 対応表
- `report-standard.md` — 報告書のデファクト構成（IPA/OWASP 準拠）とプロ示唆の書き方
