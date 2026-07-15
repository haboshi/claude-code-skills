# CVSS 4.0（CVSS-B）採点ガイド

> 本スキルは **CVSS v4.0 の基本値（CVSS-B）** で深刻度を評価する。CVSS 3.1 とはスコアが
> **非互換**（同一事象でも数値が異なり、4.0 は低〜中影響を高めに出す傾向）。
> 出典: FIRST 公式 https://www.first.org/cvss/v4.0/specification-document

## 1. Base メトリクスと取りうる値

CVSS 4.0 の Base は 11 指標すべてが必須。3.1 の Scope(S) は廃止され、影響が「脆弱システム」と
「後続システム」に二分された。

**Exploitability（悪用可能性）**

| 指標 | 意味 | 値 |
|---|---|---|
| AV | 攻撃元区分 | N(Network) / A(Adjacent) / L(Local) / P(Physical) |
| AC | 攻撃条件の複雑さ | L(Low) / H(High) |
| **AT** | **攻撃要件（新規）** | N(None) / P(Present) ※中間者位置・競合状態など「攻撃者の制御外の前提」 |
| PR | 必要権限 | N(None) / L(Low) / H(High) |
| **UI** | **利用者関与（刷新）** | N(None) / P(Passive) / A(Active) ※3.1 の None/Required から3値へ |

**Impact（影響）**

| 系統 | 指標 | 値 |
|---|---|---|
| Vulnerable System（脆弱システム） | **VC / VI / VA** | H(High) / L(Low) / N(None) |
| Subsequent System（後続システム） | **SC / SI / SA** | H(High) / L(Low) / N(None) |

## 2. ベクタ文字列

必須プレフィックス `CVSS:4.0`、Base 固定順序:
`AV → AC → AT → PR → UI → VC → VI → VA → SC → SI → SA`

例: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N`（＝8.7 / High）

## 3. スコア算出（手計算不可・ライブラリ必須）

CVSS 4.0 は 3.1 のような**算術式を持たない**。約1500万ベクタを **270 個の macrovector（等価
クラス EQ1〜EQ6 の直積）** に分類し、**ルックアップ表**から最悪 severity ベクタの値を引き、
他ベクタは severity 距離に基づく**補間**で算出する。したがって:

- 採点は `cvss` PyPI ライブラリ（`CVSS4`）に委譲する。`CVSS4(vector).base_score` で基本値を得る。
- **本スキルは各チェックの基準ベクタの基本値を `catalog.py` に事前計算して同梱**するため、
  ランタイムでは通常ライブラリ不要（外部ツール所見のみ、ライブラリがあれば算出）。
- ライブラリも事前計算値も無い環境では、**黙って中間値にせず「未算出」と明示**する
  （誤ったスコアより未算出のほうが安全）。手動診断では catalog の基準ベクタと事前計算スコアを
  転記する（4.0 は手計算できないため）。

## 4. 定性重大度しきい値（3.1 と同一）

| 基本値 | 重大度 |
|---|---|
| 9.0–10.0 | Critical / 緊急 |
| 7.0–8.9 | High / 重要 |
| 4.0–6.9 | Medium / 警告 |
| 0.1–3.9 | Low / 注意 |
| 0.0 | None / 情報 |

`scoring.py` の `severity_from_score()` はこの区分。3.1 から不変。

## 5. Threat / Environmental / Supplemental と CVSS-B

- **Threat**: Exploit Maturity(E) = X / A(Attacked) / P(PoC) / U(Unreported)。E:X はスコア上
  最悪ケース（Attacked）扱い。
- **Environmental**: CR/IR/AR、Modified Base（MAV…MSA）。
- **Supplemental**（スコア非影響）: Safety / Automatable / Recovery / Value Density など。
- **命名法**: Base のみ = **CVSS-B**、+Threat = CVSS-BT、全部 = CVSS-BTE。数値を表示する箇所では
  この呼称を明示する。本スキルは **CVSS-B**（Base のみ・E 未指定＝最悪ケース前提）を用いる。
  自動・非破壊診断は脅威情勢や環境を反映しないため、Base に留めるのが妥当。

## 6. 3.1 ベクタからの再モデリング規約（catalog 移行時）

3.1 → 4.0 は「列の読み替え」ではなく**再モデリング**。判断を誤りやすい点:

- **AC:H（中間者=MITM 前提）→ AC:L + AT:P**。3.1 が AC:H で表していた「経路への介在が必要」は
  4.0 では AT:P（攻撃要件）に移す。AC は防御突破の労力のみを表す。
- **UI:R → Passive / Active**。FIRST の例示に従う: **reflected / self XSS は UI:A**（被害者が
  細工リンクを踏む）、中間者依存のヘッダ欠落は **UI:P**（被害者は通常閲覧するだけ）。
- **S:C → SC/SI/SA へ自動対応しない**。影響先を個別に判断: **reflected XSS の被害は後続ブラウザ
  ＝SC/SI**（脆弱システムの VC/VI に置かない）、**オープンリダイレクトも後続 SC/SI**、
  **CORS のデータ窃取は脆弱システムの VC**。CSP/SRI/フレーム対策などの多層防御欠如は単体で影響が
  確定しないため Low 相当に留める。
- 変換後は**必ず `cvss` ライブラリで実スコアを再算出**し、事前計算値として catalog に同梱する。

## 7. 手動環境向け・ベクタ→スコアの対応（catalog 実測値）

`cvss` ライブラリが無い環境では **catalog.py の各エントリの `cvss` ベクタと `cvss_score`
（事前計算基本値）をそのまま転記**する。文脈調整でベクタを変えた場合は、スコアを据え置いた
うえで「調整根拠」を注記する（4.0 は手計算不可）。全チェックのベクタ・スコアの一覧は
`references/standards-mapping.md` を参照。
