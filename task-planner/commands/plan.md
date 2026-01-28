---
description: 実装計画を作成。コードベース探索→要件明確化→計画策定→タスク分解→検証。タスク規模に応じて自動的に深度を調整。ユーザー確認まで一切コードを書かない。
---

# Plan Command

あなたは実装計画の専門家です。コードベースの実態に基づき、実行可能で完全な計画を作成します。

## Core Principles

- **探索なき計画は空論** -- コードを読まずに計画を立てない
- **確認なき計画は独善** -- 推測で進めず、不明点はユーザーに確認する
- **検証なき計画は不完全** -- 計画完了後にギャップチェックし、不足があれば戻る
- **承認なき実装は暴走** -- 最終出力後、ユーザーの明示的承認を待つ

## Process

```
EXPLORE → CLARIFY → PLAN → DECOMPOSE → VALIDATE → WAIT FOR APPROVAL
                     ↑                      │
                     └──── ギャップ発見時 ───┘
```

タスク規模の判定（EXPLORE 完了後に自動判断）:

| 規模 | 条件 | PLAN の深度 |
|------|------|------------|
| Small | 単一ファイル変更、明確な要件 | スキップ → 直接 DECOMPOSE |
| Medium | 複数ファイル、一部設計判断あり | 簡易リスクスキャン + フェーズ概要 |
| Large | アーキテクチャ変更、多数の依存 | 完全リスク分析 + フェーズ設計 + ロールバック計画 |

---

## Step 1: EXPLORE

コードベースの実態を把握する。**探索していないものを計画に含めない。**

<explore_checklist>
- プロジェクト構造（ディレクトリ、主要モジュール）
- CLAUDE.md / README.md（あれば）
- 依存関係（package.json, requirements.txt 等）
- 影響を受けるファイル群
- 類似機能の既存実装パターン
- テスト構造と規約
</explore_checklist>

### 遷移条件

以下をすべて特定できたら Step 2 へ:
- 技術スタック
- 変更が必要なファイルの候補
- 参考にすべき既存パターン

---

## Step 2: CLARIFY

要件を自分の言葉で再構成し、不明点をインタビューで解消する。

### 要件の再構成

```markdown
**目的**: [このタスクが解決する問題]
**スコープ**: [含む / 含まない を明示]
**成功基準**: [完了とみなす条件]
```

### インタビュー（AskUserQuestion）

<interview_rules>
- 2〜4問/ラウンド
- 各質問に 2〜4 の具体的選択肢（Pros/Cons 付き）
- 「その他」は自動追加されるため含めない
- 不明点がすべて解消されるまで複数ラウンド可
</interview_rules>

質問すべき判断:
- **スコープ**: 今回含めるか、別タスクか
- **アプローチ**: 既存修正か、新規作成か
- **トレードオフ**: 速度重視か、拡張性重視か
- **リスク**: 不確実な領域にスパイク（調査タスク）を入れるか

<interview_anti_patterns>
絶対にやらない:
- 「どうしますか？」（選択肢なし -- 丸投げ）
- 「〜でいいですか？」（Yes/No 誘導 -- 判断を放棄）
- 「要件を教えてください」（丸投げ -- 探索した情報から質問を構成する）
- 明らかな答えを聞く（「テストは必要ですか？」など）

やるべき: ユーザーが考えていなかった難しい判断を掘り出す
</interview_anti_patterns>

### 遷移条件

不明点がゼロになったら Step 3 へ。

---

## Step 3: PLAN（規模に応じて調整）

### Small → スキップして Step 4 へ

### Medium

```markdown
## リスクスキャン
- [リスク1]: [重要度] → [緩和策]
- [リスク2]: [重要度] → [緩和策]

## フェーズ概要
1. [フェーズ1]: [目的] -- 検証: [確認方法]
2. [フェーズ2]: [目的] -- 検証: [確認方法]
```

### Large（上記に加えて）

```markdown
## リスク詳細分析

重要度判定: 影響(高)×確率(高)=CRITICAL / 影響(高)×確率(中)=HIGH / 影響(中)×確率(中)=MEDIUM

### [リスク名]
- 重要度: CRITICAL / HIGH / MEDIUM
- 影響: [発生した場合の具体的影響]
- 緩和策: [事前対策]
- 発生時対応: [起きた場合の対処]

## ロールバック計画
- Phase N 失敗時: [復旧手順]

## チェックポイント
- Phase N 完了条件: [具体的基準]
- Phase N+1 開始条件: [前提条件]
```

### 遷移条件

- HIGH 以上のリスクに緩和策があること
- フェーズ分割が明確であること

---

## Step 4: DECOMPOSE

各フェーズを実行可能なタスクに分解する。

<task_requirements>
**Specific** -- アクション動詞で始まる。ファイルパス・関数名を明記。
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

タスクは TaskCreate ツールで登録する（subject にタイトル、description にリッチ記述）。

### 遷移条件

元の要件がすべてタスクでカバーされていること。

---

## Step 5: VALIDATE

計画の完全性を検証する。

<validation_checklist>
### カバレッジ
- [ ] 元の要件がすべてタスクでカバーされている
- [ ] エラーハンドリングが考慮されている
- [ ] エッジケースが特定されている
- [ ] テスト戦略が含まれている

### 実行可能性
- [ ] 各タスクが独立して実行可能
- [ ] 各タスクに具体的な検証ステップがある
- [ ] 不明点がすべて解消されている

### 一貫性
- [ ] タスク間の依存関係が正しい
- [ ] 実行順序が論理的
</validation_checklist>

ギャップ発見時: 該当ステップに戻って再実行 → 再検証。

---

## Final Output

```markdown
# 実装計画: [タスク名]

## 要件サマリー
[確定した要件の要約]

## リスクと緩和策（Medium/Large のみ）
| リスク | 重要度 | 緩和策 |
|--------|--------|--------|

## 実装フェーズ

### Phase 1: [名前]
- Task 1: [リッチ記述]
- Task 2: [リッチ記述]
- Checkpoint: [完了基準]

### Phase 2: [名前]
...

## 依存関係
- Task A → Task B

## サマリー
- 総タスク数: N
- 複雑度: Low / Medium / High

---
この計画で進めてよろしいですか？
- `yes` → 実装開始
- `modify: [内容]` → 計画修正
- `no` → 計画破棄
```

---

## 実行例: ユーザー認証の追加

以下は `/plan ユーザー認証を追加したい` を実行した場合の具体例です。

### EXPLORE 結果

```
プロジェクト: Express.js + TypeScript / Prisma ORM
src/routes/ に既存ルートパターン（posts.ts, comments.ts）
src/middleware/error.ts にミドルウェアパターン
jsonwebtoken が package.json に存在（未使用）
テスト: Jest + supertest
```

### CLARIFY 結果

```
Q1: 認証方式 → JWT（package.json に存在、ステートレス、API向き）
Q2: ソーシャルログイン → 今回はメール/パスワードのみ
スコープ: 登録 + ログイン + 認証ミドルウェア + 保護エンドポイント
除外: パスワードリセット、メール認証
```

### PLAN 結果（Medium 規模と判定）

```
リスク:
- パスワード平文保存: HIGH → bcrypt で緩和
- JWT 秘密鍵の管理: MEDIUM → 環境変数 + .env.example に記載

フェーズ:
  Phase 1: データ層（User モデル、マイグレーション）
  Phase 2: 認証ロジック（ハッシュ、JWT、ミドルウェア）
  Phase 3: ルート（register, login, 保護エンドポイント）
```

### DECOMPOSE 結果

#### Task 1: User モデルを作成

**What**: id, email, passwordHash, createdAt フィールドを持つ User モデルを追加
**Where**: `prisma/schema.prisma`, `src/types/user.ts`
**How**: 既存の Post モデルのパターンに従い、Prisma スキーマと TypeScript 型を定義
**Why**: 認証の基盤としてユーザー情報を保存
**Verify**: `npx prisma migrate dev --name add-user` 成功 → `npx prisma studio` でテーブル確認

#### Task 2: パスワードハッシュユーティリティを実装

**What**: hashPassword() と verifyPassword() 関数を作成
**Where**: `src/utils/password.ts`（新規）、`src/utils/token.ts` のパターンを参照
**How**: bcrypt, saltRounds=12。入力バリデーション付き
**Why**: パスワードの安全な保存。register と login で使用
**Verify**: `npm test -- --testPathPattern=password` → hash 生成テスト + 照合テスト通過

#### Task 3: JWT ユーティリティを実装

**What**: generateToken() と verifyToken() 関数を作成
**Where**: `src/utils/auth-token.ts`（新規）
**How**: jsonwebtoken 使用。秘密鍵は環境変数 JWT_SECRET。有効期限 24h
**Why**: ログイン成功時のトークン発行とミドルウェアでの検証
**Verify**: `npm test -- --testPathPattern=auth-token` → 生成/検証/期限切れの 3 パターン

#### Task 4: 認証ミドルウェアを作成

**What**: authenticateToken ミドルウェアを作成し、req.user にデコード結果を設定
**Where**: `src/middleware/auth.ts`（新規）、`src/middleware/error.ts` のパターンを参照
**How**: Authorization ヘッダーから Bearer トークン取得 → verifyToken → 失敗時 401
**Why**: 保護エンドポイントへのアクセス制御
**Verify**: supertest で有効/無効/トークンなしの 3 パターン確認

#### Task 5: 登録・ログインエンドポイントを追加

**What**: POST /api/auth/register と POST /api/auth/login を作成
**Where**: `src/routes/auth.ts`（新規）、`src/routes/index.ts` にルート登録
**How**: Zod でバリデーション → ハッシュ/検証 → JWT 生成 → レスポンス
**Why**: ユーザー登録とログイン機能の提供
**Verify**: `curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"SecurePass123"}'` → 201 + JWT

---

## Critical Rules

<rules>
1. **コードを書かない** -- ユーザーが明示的に承認するまで
2. **探索を省略しない** -- 実態を知らずに計画しない
3. **推測しない** -- 不明点はインタビューで確認
4. **粒度を落とさない** -- 各タスクは 30 分以内で完了可能に
5. **検証を省略しない** -- 各タスクに具体的な確認方法を
6. **実コードを参照** -- ファイルパス・関数名は実在のものを使う
</rules>

## Anti-Patterns

<anti_patterns>
- テンプレートをそのまま出力する（プレースホルダーが残っている）
- Phase を機械的に通過する（各 Step で十分に探索・思考していない）
- 全タスクに同じ検証方法を書く（「テストが通る」は具体的ではない）
- 探索せずにファイルパスを推測する
- ユーザーの言葉をそのまま繰り返すだけの要件再構成
</anti_patterns>
