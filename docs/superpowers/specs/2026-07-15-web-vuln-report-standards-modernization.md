# web-vuln-report 標準モダナイズ設計（v0.2）

- 作成日: 2026-07-15
- ステータス: 計画（着手前・承認待ち）
- 目的: OWASP Top 10:2021→2025、CVSS 3.1→4.0 へ更新し、WSTG（診断手法）と ASVS 5.0.0
  （検証要件）への参照を追加して「準拠」の中身を明確化する。
- 根拠: Fable5 統括 + Opus×2 / Sonnet×3 の分散ディープリサーチ（一次情報裏取り済み）。

## 研究サマリ（確認済み事実・出典）

### CVSS 4.0（FIRST 公式）
- メトリクス刷新: Exploitability = AV / AC / **AT（新・攻撃要件）** / PR / **UI=None/Passive/Active**、
  Impact = **VC/VI/VA（脆弱システム）** + **SC/SI/SA（後続システム）**。**Scope(S) 廃止**。
- ベクタ順: `CVSS:4.0/AV/AC/AT/PR/UI/VC/VI/VA/SC/SI/SA`。
- スコア算出: 270 macrovector ＋ルックアップ表＋補間。**算術式なし**＝手計算/内蔵 3.1 式は流用不可。
- 定性しきい値: **3.1 と完全同一**（None/Low/Medium/High/Critical）。
- 呼称: Base のみは **CVSS-B**。報告書はこのラベルを明示（E 未指定＝最悪ケース前提）。
- 3.1 と 4.0 のスコアは**非一致・換算不可**（4.0 は単一の低〜中影響を高めに出す傾向）。
- 出典: https://www.first.org/cvss/v4.0/specification-document

### CVSS 4.0 実装（cvss PyPI）
- `cvss` ライブラリは **`CVSS4` クラスで v4 対応**（v3.0=2024-01 以降、現行 v3.6）。
  API は `.scores()[0]`/`.base_score` の別が報告間で食い違い → **実装時に実測で確定**。
- v4 は 270 エントリ表＋266 行アルゴリズム。BSD-2-Clause（`cvss4.py`/`constants4.py`）。
  stdlib 自前化は表＋アルゴリズムの vendoring ＋公式テストベクタ全件検証が要る（重い）。
- 出典: https://pypi.org/project/cvss/ , https://github.com/RedHatProductSecurity/cvss

### OWASP Top 10:2025（owasp.org 公式・CWE 照合済み）
- 10 カテゴリ（英名 verbatim / 参考訳）:
  A01 Broken Access Control / A02 Security Misconfiguration /
  **A03 Software Supply Chain Failures（新）** / A04 Cryptographic Failures / A05 Injection /
  A06 Insecure Design / A07 Authentication Failures / A08 Software OR Data Integrity Failures /
  A09 Security Logging and Alerting Failures / **A10 Mishandling of Exceptional Conditions（新）**。
- 変更: 新設2（A03 サプライチェーン=旧 A06 の拡張、A10 例外処理）、統合1（SSRF→A01）、
  順位/改名（Misconfig A05→A02、Crypto A02→A04、Injection A03→A05、Insecure Design A04→A06）。
- **重要**: 旧「A05 設定ミス」集中のチェック群が 2025 では CWE 単位で A01/A02/A04/A06/A10 に**分散**。
  真に A02 に残るのは xcto/cookie-secure/httponly/samesite-none/cors の5件のみ。
- リリース状態: 「現行公開版（most current released version）」だが "final" の明示スタンプなし
  → 報告書は「現行公開版」と記す（"最終版" と断定しない）。
- 出典: https://owasp.org/Top10/2025/ 各カテゴリの List of Mapped CWEs

### OWASP WSTG（owasp.org / GitHub 公式）
- 安定版 **v4.2**（v5.0 は未リリース草案）。ID 形式 `WSTG-<CAT>-<NN>`。
- 検証済みマッピング（抜粋）: TLS→CRYP-01 / Cookie→SESS-02 / CORS→CLNT-07 /
  クリックジャッキング→CLNT-09 / 機微ファイル→CONF-04 / 反射型XSS→INPV-01 /
  バナー露出→INFO-02 / エラー露出→ERRH-01 / 危険メソッド→CONF-06 / HSTS・HTTP→HTTPS→CONF-07 /
  オープンリダイレクト→CLNT-04。
- **v4.2 に専用 ID が無い**: セキュリティヘッダ全般・CSP・SRI・混在コンテンツ
  （v5.0 草案に CONF-12=CSP / CONF-14=その他ヘッダ が新設予定だが未リリース）。
  → これらは「WSTG v4.2 非対応（独自根拠 / v5.0 草案）」と正直に明示。
- WSTG は業務ロジック(BUSL)・認可(ATHZ)を**自動化不可**と明言 → 本スキルの非破壊自動診断の
  範囲外説明の根拠に使える。

### OWASP ASVS 5.0.0（owasp.org / GitHub 公式）
- 安定版 **5.0.0**（2025-05-30、約350要件・17章 V1–V17、旧4.0から全面再編）。
- レベル L1/L2/L3。参照形式 `v5.0.0-<章>.<節>.<要件>` ＋対象レベル明記。
- 対応例: HSTS=`3.4.1`(L1) / CSP=`3.4.3`(L2) / SRI=`3.6.1`(L3)。
- **ASVS 対応なし**: Permissions-Policy / 混在コンテンツ / TLS 証明書期限（正直に「該当なし」）。
- **ASVS 5.0 は CWE 公式マッピングを廃止** → 本スキルの CWE は独自付与と注記。
- 「自動診断=L1」は不正確（各チェックは L1〜L3 に散る）。
- ※ 全22チェックの完全な要件対応表は実装段階で調査エージェントから取り直す（要点は取得済み）。

## バージョンアップ計画（v0.1.x → v0.2.0）

### 変更対象ファイル
1. **`scripts/catalog.py`（単一の正）** — 全エントリを更新:
   - `cvss`: CVSS 4.0 ベクタへ**再モデリング**（列置換でなく VC/VI/VA・SC/SI/SA・AT・UI 再判定）。
     書換後は必ず `cvss` ライブラリで実スコア再算出し、推測値を残さない。
   - `owasp`: 2025 ラベルへ（CWE 照合表に忠実）。
   - `wstg`（新規）: 検証済み WSTG-ID、無ければ「該当なし（独自根拠）」。
   - `asvs`（新規）: `v5.0.0-x.y.z (Ln)`、無ければ「該当なし」。
   - `cwe`: 維持（ASVS 5.0 は CWE マッピング廃止＝独自付与と注記）。
2. **`scripts/scoring.py`** — CVSS 4.0 採点:
   - `CVSS4` を使用（API は実測確定）。severity しきい値は不変。
   - 内蔵 3.1 式（`_base_score_builtin`）は 4.0 に無効 → オフライン採点は下記「未決定」参照。
   - グレード（security_score/grade）は severity ベースのため大枠不変。
3. **`templates/report.html.j2` / `report.css`** — 表記更新:
   - CVSS ラベル → 「CVSS 4.0 基本値（CVSS-B）」。
   - 診断範囲/手法に**準拠標準セクション**（WSTG v4.2・Top 10:2025・CVSS 4.0(CVSS-B)・ASVS 5.0.0）。
   - 所見カードに WSTG-ID / ASVS 要件のチップ（ある項目のみ）。
4. **`references/`** — cvss-guide（4.0 へ全面改訂）/ check-catalog（2025・WSTG・ASVS 追記）/
   report-standard（準拠標準セクション・正直なスコープ）。必要なら standards-mapping.md 新設。
5. **`SKILL.md`** — 手法記述を標準準拠へ更新。CVSS 4.0 は cvss ライブラリ前提（pip）である旨。
6. **`scripts/tests/`** — CVSS4 採点テスト、カタログ整合テスト（全エントリに 2025 ラベル・
   wstg/asvs フィールドの存在/明示 null）、代表ベクタの公式値照合。
7. **`plugin.json` + `marketplace.json`×2** — 0.2.0、description に 2025/4.0/WSTG/ASVS 反映。
8. **サンプル + `.skill` バンドル再生成**。

### 誠実性の担保（過去の轍を踏まない）
- Top 10:2025 は「現行公開版」と表記（"final" 断定しない）。
- WSTG v4.2 に ID が無い項目（CSP/ヘッダ全般/SRI/混在）は「独自根拠 / v5.0 草案」と明示。
- ASVS 該当なし項目（Permissions-Policy/混在/証明書期限）は「該当なし」と明示。
- CVSS は「CVSS-B」明示、E 未指定＝最悪ケース、3.1 と非互換を注記。
- tls-cert-expiring / risky-http-method の 2025 カテゴリは未確認 → 暫定と明示。
- CWE は ASVS 5.0 非公式（スキル独自付与）と注記。

## レビュー反映（Fable5 レビュー 2026-07-15・判定=要修正→以下を確定）

### P0（着手前に計画へ反映済み）
- **移行対象は catalog 26 エントリだけではない**。3.1 ベクタ混入経路が他に2箇所:
  `assess.py` の `REPRESENTATIVE_VECTORS`（外部ツール所見用・3.1 ベクタ4本）と
  `catalog.py get_check()` のデフォルトエントリ。全数走査の母数 = **catalog 26 + get_check デフォルト
  + assess.py REPRESENTATIVE_VECTORS**。
- **新フィールド伝搬**: `wstg`/`asvs` を所見に届けるには `checks.py Findings.add()` と
  `assess.py _normalize_external()` の dict 組立を変更（テンプレートだけでは届かない）。
- **scoring.py のサイレント劣化を廃す**: 現行はベクタ計算例外時に黙って `cvss_score=5.0/Medium`。
  4.0 でライブラリ不在だと**全所見が Medium 5.0 化**する最悪の失敗モード → **禁止**。不在時は
  下記の事前計算スコアを用いるか明示エラー。黙って 5.0 にしない。
- **手動フォールバックの原理的破綻**（4.0 は手計算不可）→ **catalog 各エントリに `cvss_score`
  （ビルド時に cvss ライブラリで算出した基準 4.0 値）を事前計算同梱**。Python 不可環境でも
  「ベクタ＋事前計算スコア」を転記でき、文脈調整時は「スコア据え置き＋調整根拠注記」。
  SKILL.md 手動手順の「CVSS 3.1 で分類」を書き換える。
- **再モデリング変換規約を先に明文化**（standards-mapping.md）:
  - **AC:H（MITM 前提）→ AC:L + AT:P**（現 catalog は 12 エントリが AC:H）。
  - **UI:R → Passive/Active は spec 例示表と照合**。特に **reflected-input は UI:A**（最大の誤判定点）、
    MITM 系ヘッダ欠落は **UI:P**。
  - **S:C → SC/SI/SA は非自動**。reflected-input は **SC:L/SI:L 中心**（被害＝後続ブラウザ）、
    cors は **VC 中心**、csp/frame/sri は多層防御欠如ゆえ **Low/Info 相当の再検討**、
    open-redirect は **SC/SI 側**。
  - 変換後は**必ず cvss ライブラリで実スコア再算出**し、3.1 からの severity バンド変動を人間レビュー。
- **一次照合を要する 2025/CVSS 判断**（実装時に FIRST spec / owasp.org を再取得して確定）:
  - **reflected-input は A05:2025 Injection に留まる**（CWE-79・動かさない）。
  - **cors-misconfig は A01 か A02 か**（CWE-942 の owasp マッピングで確定）。
  - AT:P の MITM 該当・UI:A の reflected XSS。
  - external-tool-finding / get_check デフォルト / tls-cert-expiring / risky-http-method は
    「汎用/暫定」カテゴリとして明示。

### P1（反映）
- **バージョン破壊性**: 3.1→4.0 でスコア数値が非互換 → CHANGELOG に「破壊的: 既存 scored.json と
  スコア非互換」を明記。`risk_score` の `max_cvss*9` 係数は 3.1 分布前提のため再検討（grade は severity
  ベースで大枠不変）。marketplace.json ×2 同時更新。
- **テスト不変条件**: (a) 全 catalog/get_check/REPRESENTATIVE_VECTORS の `cvss` が `CVSS:4.0/` で始まる
  （3.1 混入ゼロを正規表現検査）、(b) 代表3-5ベクタを FIRST 公式値とハードコード照合（`.base_score`
  vs `.scores()[0]` の API 差をここで実測確定）、(c) 全エントリに owasp(2025)/wstg/asvs キーが存在し
  確定値か明示「該当なし」（None 禁止）、(d) ライブラリ不在時の scoring 挙動テスト。
- **サンプル/バンドル再生成後の grep 検査**: report.html とバンドル内 SKILL.md に 3.1 ベクタ・「2021」・
  旧 A05 ラベル・「CVSS 3.1」が残っていないこと。
- **WSTG v5.0 草案 ID（CONF-12/14 等）は報告書本文に出さない**（references メモのみ）。

### 実装順序（依存）
catalog.py（+基準スコア事前計算）→ scoring.py（4.0 採点・不在時挙動）→
checks.py/assess.py（フィールド伝搬・ベクタ変換）→ tests → templates → references →
SKILL.md/CLAUDE.md → サンプル再生成 → plugin.json/marketplace×2 → .skill 再生成。

### 確定した方針（レビュー推奨）
- **オフライン採点 = 案(a): cvss ライブラリ必須 ＋ catalog に基準 4.0 スコア事前計算同梱**。
  (b) 表 vendoring は保守過剰、(c) 3.1 併記は手法混同で却下。既存の pip フォールバック思想と整合。
- **実装範囲 = フルモダナイズ**（CVSS 4.0 ＋ Top 10:2025 ＋ WSTG v4.2 ＋ ASVS 5.0.0）を v0.2.0 で。

### なお実装時に取り直すもの
- ASVS 全26エントリの完全な要件対応表（要点は取得済み・調査エージェントから再取得）。
- reflected-input/cors の 2025 カテゴリ、AT/UI の判定は FIRST spec・owasp.org を一次再照合して確定。
