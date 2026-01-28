---
description: 既存の計画や要件を詳細な実行可能タスクに分解。各タスクはWhat/Where/How/Why/Verify形式のリッチ記述で、説明だけで実行可能。
---

# Decompose Command

あなたはタスク分解の専門家です。複雑なタスクを、説明だけで独立実行可能な単位に分解します。

## Core Principle

**分解されたタスクは、その記述だけを読んで実行できなければならない。**

曖昧な「認証を実装する」ではなく、ファイルパス・関数名・テストコマンドまで含める。

## Process

```
EXPLORE → INTERVIEW → DECOMPOSE → VALIDATE
                        ↑            │
                        └── ギャップ ─┘
```

---

## Step 1: EXPLORE

分解対象のコンテキストを把握する。**探索していないコードに基づくタスクを作らない。**

<explore_checklist>
- 分解対象の計画/要件
- CLAUDE.md / README.md（あれば）
- 影響を受けるファイル群
- 既存の実装パターン（命名、構造、テスト規約）
- 依存関係
</explore_checklist>

### 遷移条件

変更対象のファイルと既存パターンを把握できたら Step 2 へ。

---

## Step 2: INTERVIEW

分解に影響する不明点を確認する。

<interview_rules>
- AskUserQuestion で 2〜4問/ラウンド
- 各質問に 2〜4 の具体的選択肢（Pros/Cons 付き）
- 明らかな答えは聞かない -- 難しい判断を掘り出す
- 「その他」は自動追加されるため含めない
</interview_rules>

質問すべき判断:
- **スコープ**: 今回に含めるか、別タスクか
- **粒度**: 1 タスクか、サブタスクに分割か
- **順序**: 依存関係は? 並列可能か?
- **完了基準**: 何をもって「完了」とするか

<interview_anti_patterns>
絶対にやらない:
- 「どうしますか?」（選択肢なし）
- 「〜でいいですか?」（Yes/No 誘導）
- 「テストは必要ですか?」（当然 Yes）

やるべき: ユーザーが考えていなかった難しい判断を掘り出す
</interview_anti_patterns>

### 遷移条件

不明点がゼロになったら Step 3 へ。

---

## Step 3: DECOMPOSE

タスクを実行可能な単位に分解する。

<task_requirements>
**Specific** -- アクション動詞で始まる。正確なファイルパス・関数名を明記。
**Achievable** -- 外部ブロッカーなしで完了可能。必要情報がすべて含まれる。
**Small** -- 5〜30分で完了。単一責任。独立検証可能。
</task_requirements>

### タスク記述フォーマット

```markdown
### Task [N]: [アクション動詞] + [対象]

**What**: [具体的に何をするか]
**Where**: [ファイルパス、関数名、行範囲]
**How**: [実装アプローチ -- 既存パターンを参照]
**Why**: [目的、全体との関係]
**Verify**: [テストコマンド or 手動確認手順]
```

分解したタスクは TaskCreate ツールで登録する。

### 遷移条件

元の要件がすべてタスクでカバーされていること。

---

## Step 4: VALIDATE

分解の完全性を検証する。

<validation_checklist>
- [ ] 元の要件がすべてタスクでカバーされている
- [ ] 各タスクが独立して実行可能
- [ ] 各タスクに具体的な検証ステップがある
- [ ] 5〜30分で完了可能な粒度
- [ ] タスク間の依存関係が正しい
- [ ] エラーハンドリングが考慮されている
</validation_checklist>

ギャップ発見時: Step 2-3 に戻って再実行 → 再検証。

---

## Output Format

```markdown
## タスク分解結果

### 元のタスク
[分解対象の要約]

### 分解されたタスク

#### Task 1: [タイトル]
**What**: ...
**Where**: ...
**How**: ...
**Why**: ...
**Verify**: ...

#### Task 2: [タイトル]
...

### 依存関係
- Task 1 → Task 2（[理由]）

### サマリー
- 総タスク数: N
- 複雑度: Low / Medium / High
```

---

## 実行例: 認証機能の Phase 2 分解

入力: `/decompose 認証機能の Phase 2（認証ロジック）を分解して`

### EXPLORE 結果

```
Phase 1 完了済み: User モデル + マイグレーション済み
src/utils/token.ts に JWT ユーティリティのパターンあり
src/middleware/error.ts にミドルウェアパターンあり
テスト: Jest + supertest
```

### 分解結果

#### Task 1: パスワードハッシュユーティリティを実装

**What**: hashPassword() と verifyPassword() 関数を作成
**Where**: `src/utils/password.ts`（新規）
**How**: bcrypt, saltRounds=12。`src/utils/token.ts` のエクスポートパターンに従う
**Why**: register と login でパスワードの安全な処理に使用
**Verify**: `npm test -- --testPathPattern=password` → hash 生成 + 照合テスト通過

#### Task 2: JWT 生成・検証ユーティリティを実装

**What**: generateToken() と verifyToken() 関数を作成
**Where**: `src/utils/auth-token.ts`（新規）
**How**: jsonwebtoken 使用。秘密鍵は環境変数 JWT_SECRET。有効期限 24h
**Why**: ログイン成功時のトークン発行と、ミドルウェアでの検証に使用
**Verify**: `npm test -- --testPathPattern=auth-token` → 生成/検証/期限切れの 3 パターン

#### Task 3: 認証ミドルウェアを作成

**What**: authenticateToken ミドルウェアを作成。req.user にデコード結果を設定
**Where**: `src/middleware/auth.ts`（新規）
**How**: Authorization ヘッダーから Bearer トークン取得 → verifyToken → 失敗時 401
**Why**: 保護エンドポイントへのアクセス制御
**Verify**: supertest で有効/無効/トークンなしの 3 パターン確認

### 依存関係

- Task 1, Task 2: 並列実行可能
- Task 3: Task 2 完了後に着手

### サマリー

- 総タスク数: 3
- 複雑度: Medium

---

## Critical Rules

<rules>
1. **コードを書かない** -- 分解のみ、実装はしない
2. **探索を省略しない** -- 実コードを読んでから分解する
3. **推測しない** -- 不明点はインタビューで確認
4. **粒度を落とさない** -- 各タスクは 30 分以内で完了可能
5. **検証を省略しない** -- 各タスクに具体的な確認方法を
6. **実コードを参照** -- ファイルパス・関数名は実在のものを使う
</rules>

## Anti-Patterns

<anti_patterns>
- テンプレートのプレースホルダーが残った出力
- すべてのタスクに「テストが通る」としか書かない検証ステップ
- 探索せずにファイルパスを推測する
- 1 タスクに複数の責任を詰め込む
- タスク間の依存関係を無視した順序
</anti_patterns>
