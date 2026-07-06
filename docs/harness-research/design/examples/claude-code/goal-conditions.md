# `/goal` 条件文テンプレ集（系統A / 短期ロードマップ）

`/goal` は prompt-based Stop hook のセッション限定ラッパーで、各ターン終了時に小型高速モデル（既定 Haiku 系）が完了を判定する。以下の3点は確認済み仕様なので、条件文はこの制約に翻訳して書く:

- 評価器は **tool-less**（ファイルやコマンドを独立に読めず、**transcript に現れた証拠だけ**で yes/no を返す）。だから完了条件は worker が会話に痕跡を残せる形にする。
- 条件本文は **最大 4,000 文字**。**trust dialog を受諾した workspace でのみ**動作し、`disableAllHooks` / `allowManagedHooksOnly` 下では使えない。

各テンプレは rubric 3点法（**end_state**〔測定可能な単一終状態〕/ **proof**〔transcript 上でどう証明するか〕/ **constraints**〔守る制約・触れない範囲〕）と、保険条項（`or stop after N turns` 相当の turn cap）で構成する。turn/budget/no-progress の cap は `/goal` の保険条項だけに頼らず、必要なら別レイヤー（自前ループ・agent Stop hook）にも置く。

---

## (a) テスト収束型（06章 auth 例）

failing test を全て green にし、それを transcript 上のテスト出力で証明する。

```bash
/goal src/auth 配下の failing test を全て修正する。
完了条件（各ターン後に fresh evaluator が transcript の証拠のみで判定）:
- end_state: src/auth 配下の failing test がゼロ
- proof: 直近ターンの transcript に `npm test -- test/auth` の出力があり、0 failed であること
- constraints: src/auth と test/auth 以外に差分を出さない / 既存の公開 API シグネチャを変更しない / 新規依存を追加しない
保険: 20 ターンで停止。
```

**良い条件 vs 悪い条件（同じ意図の対比）**

```text
# 悪い: proof が transcript に落ちず、tool-less 評価器には検証不能
end_state: 認証まわりのテストがいい感じに通るようにする
proof:     実際にちゃんと動くこと
→ 「いい感じ」は単一の可観測状態でなく、「実際に動く」は評価器が見られない根拠（evaluator blindness）。

# 良い: 単一の終状態 + 会話に載る証拠 + 触れない範囲
end_state: `npm test -- test/auth` が exit 0
proof:     直近 transcript にそのコマンド出力（0 failed）が存在
constraints: test/auth 以外のテストを書き換えない
```

---

## (b) backlog 消化型（キューが空になる）

作業キューが空である状態を終状態にし、その空を transcript 上のキュー出力で証明する。

```bash
/goal .tasks/queue.txt に列挙された未処理タスクを上から順に片付ける。
完了条件（各ターン後に fresh evaluator が transcript の証拠のみで判定）:
- end_state: .tasks/queue.txt の未処理行がゼロ（キューが空）
- proof: 直近ターンの transcript に `cat .tasks/queue.txt` の出力があり、未処理行が無いこと（各タスク完了時にそのタスクのテスト/検証ログも会話に残す）
- constraints: 1ターンにつき1タスクのみ着手し完了を証明してから次へ / キュー定義ファイル自体の仕様は変更しない
保険: 15 ターンで停止（残タスクがあれば未達として報告）。
```

**良い条件 vs 悪い条件**

```text
# 悪い: 「空」の証明が会話に出ず、自己申告になる
proof: 全部やり終えたと判断できること

# 良い: キューの実体を毎回 transcript に出す
proof: 直近 transcript の `cat .tasks/queue.txt` 出力が未処理行ゼロ
```

---

## (c) ドキュメント整合型（変更と docs の同期）

コード変更に対応する docs 更新が済み、両者が同一コミット断面に載っていることを終状態にする。

```bash
/goal 今回のコード変更に対応するドキュメントを docs/ 配下で同期する。
完了条件（各ターン後に fresh evaluator が transcript の証拠のみで判定）:
- end_state: 変更したコードの公開挙動が docs/ に反映され、`git status --porcelain` が clean
- proof: 直近ターンの transcript に (1) 変更したソースと docs の両方を含む `git diff --stat` の出力、(2) `git status --porcelain` が空、の両方があること
- constraints: 実装の挙動を変えない（docs とコメントのみ追従）/ docs/ 以外の生成物を新規追加しない
保険: 10 ターンで停止。
```

**良い条件 vs 悪い条件**

```text
# 悪い: 「整合」が主観で、証明手段が無い
end_state: ドキュメントがコードと矛盾しない状態

# 良い: diff と git status という決定論的証拠に翻訳
end_state: 対象コードと docs の両方が `git diff --stat` に現れ、`git status --porcelain` が空
proof:     直近 transcript にその2出力が存在
```

---

## 共通の書き方チェックリスト

- **end_state は単一の可観測状態**に固定する（「いい感じに」「必要なら止まる」を避ける = 曖昧 done 回避）。
- **proof は tool-less 評価器が読める形**に翻訳する（会話に載るコマンド出力へ。「実際に動くこと」等の評価器が見られない根拠を書かない = evaluator blindness 回避）。
- **constraints に触れない範囲・予算・安全境界**を明記する。
- **単一スコアだけを最適化させない**（metric monoculture 回避）。決定論ゲート＋critic＋Done 判定の多軸で合否を取り、`/goal` はその meso 層の一つと捉える。
- **保険（turn cap）を必ず付ける**。収束しないときの第2停止条件がないと空回りが止まらない。
