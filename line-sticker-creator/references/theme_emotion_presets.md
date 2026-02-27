# テーマ別 感情プリセット

スタンプの使用シーン（テーマ）に応じた感情・表情プリセット。
汎用テーマは `emotion_expression_templates.md` を参照。

## テーマ一覧

| テーマ | 概要 | 参照先 |
|:---|:---|:---|
| 汎用（日常会話） | 挨拶・感情・リアクション | `emotion_expression_templates.md` |
| ビジネス | 職場向け表現 | 本ファイル |
| 友達・カジュアル | くだけた日常表現 | 本ファイル |
| 恋人・家族 | 親密な表現 | 本ファイル |

---

## トーン（方向性）

テーマ選択後に、テーマ内のトーンを選択する。トーンはプリセットの**テキスト口調**と**プロンプトの雰囲気修飾**に影響する。
感情の種類（プリセットテーブル）は共通で、トーンに応じて味付けを変える。

ユーザーは選択肢から選ぶか、「Other」で自分の言葉で方向性を記述できる。

### 汎用（日常会話）のトーン

| トーン | 説明 | テキスト口調 | プロンプト修飾 |
|:---|:---|:---|:---|
| ほんわか・癒し系 | ゆるくて柔らかい。見ると和む | ひらがな多め、語尾に「〜」。例: 「ありがと〜」「おつかれ〜」 | soft round style, gentle pastel colors, relaxed atmosphere |
| 元気・ポップ | 明るくて活発。カラフルでにぎやか | 「！」多め、短くパンチのある言葉。例: 「おはよ！」「やったー！」 | vibrant colorful style, dynamic pose, energetic, bold outlines |
| クール・シンプル | ミニマルで洗練。落ち着いたトーン | 漢字＋句点。例: 「了解。」「感謝。」 | minimalist clean style, muted tones, calm composed expression |

### ビジネスのトーン

| トーン | 説明 | テキスト口調 | プロンプト修飾 |
|:---|:---|:---|:---|
| きっちり敬語 | 上司・取引先向け。丁寧で礼儀正しい | 「です・ます」調。例: 「承知しました」「お疲れ様です」 | formal business attire, polite bow, professional office setting |
| ゆるビジネス | チーム内Slack・社内チャット向け | 丁寧だけどくだけた表現。例: 「りょ！」「おつです〜」 | smart casual style, relaxed office vibe, friendly coworker energy |
| リモートワーク | 在宅勤務の日常。ステータス共有重視 | 状態報告ベース。例: 「カメラOFF勢」「ミュートし忘れた」 | home office setting, laptop, headset, cozy room background |

### 友達・カジュアルのトーン

| トーン | 説明 | テキスト口調 | プロンプト修飾 |
|:---|:---|:---|:---|
| ハイテンション | ノリ重視。勢いとテンション全振り | 全角カタカナ・ｗ多用。例: 「ウケるｗｗ」「ﾏｼﾞか」 | exaggerated expression, over-the-top reaction, speed lines, impact effects |
| まったり・脱力 | ゆるくてだるい。癒しと共感 | ひらがな＋「...」多め。例: 「ねむ...」「もうむり...」 | slouching, melting, lazy pose, low energy, droopy eyes |
| 推し活・オタク | 推し語り・イベント・感情の振れ幅大 | オタク構文。例: 「尊い...」「優勝」「しんどい（良い意味）」 | sparkling eyes, nosebleed, worship pose, light stick, intense emotion |

### 恋人・家族のトーン

| トーン | 説明 | テキスト口調 | プロンプト修飾 |
|:---|:---|:---|:---|
| あまあま | ラブラブ全開。ハートと甘い雰囲気 | 「♡」多用、甘え口調。例: 「すき♡」「ちゅ♡」 | hearts everywhere, blushing, pink aura, lovey-dovey atmosphere |
| ほっこり日常 | 長年の安心感。生活に寄り添う温かさ | 自然体の言葉。例: 「ごはんできたよ」「おかえり」 | warm home setting, cozy atmosphere, everyday life moments |
| 親子・ファミリー | 子育てや家族行事。世代を超えて使える | 優しい言葉。例: 「がんばったね」「だいすき」「いってらっしゃい」 | family interaction, parent-child, gentle nurturing expression |

### トーンの適用方法

1. **プリセットテーブルの感情種類は変えない**（8個/16個の構成は共通）
2. **テキスト口調**: トーンの「テキスト口調」欄に従い、プリセットの「テキスト例」を調整する
3. **プロンプト修飾**: トーンの「プロンプト修飾」をキャラクター基本プロンプトのスタイル指定に追加する
4. **ユーザーがOtherで独自トーンを記述した場合**: その記述から口調とプロンプト修飾を推定して適用する

---

## ビジネス

### 8個セット（基本）

| # | 感情 | テキスト例 | プロンプトヒント |
|:---|:---|:---|:---|
| 1 | 了解 | 了解です | thumbs up, professional smile, nodding |
| 2 | お疲れ様 | お疲れ様です | waving goodbye, tired but satisfied smile |
| 3 | 確認中 | 確認します | looking at document, magnifying glass, focused |
| 4 | 承知 | 承知しました | saluting, confident expression |
| 5 | お先に | お先に失礼します | bowing politely, briefcase |
| 6 | がんばります | がんばります！ | fist pump, determined eyes, fire aura |
| 7 | ありがとう | ありがとうございます | bowing deeply, grateful expression |
| 8 | すみません | 申し訳ありません | apologetic bow, sweat drop |

### 16個セット（基本 + 拡張）

8個セットに加えて:

| # | 感情 | テキスト例 | プロンプトヒント |
|:---|:---|:---|:---|
| 9 | 会議中 | 会議中... | sitting at desk, laptop, headset |
| 10 | ランチ | ランチ行きます | chopsticks, bento box, happy |
| 11 | 納期 | 納期いつ？ | calendar, pointing, questioning look |
| 12 | 報告 | ご報告です | clipboard, presenting, professional |
| 13 | 検討中 | 検討します | arms crossed, thinking, question mark |
| 14 | 祝達成 | 目標達成！ | confetti, trophy, celebrating |
| 15 | お願い | お願いします | hands clasped together, pleading eyes |
| 16 | 休憩中 | 休憩中 | coffee cup, relaxed, stretching |

### 24個以上

16個プリセットを使用し、残りは `emotion_expression_templates.md` の汎用テンプレート（#17以降）から補完する。

---

## 友達・カジュアル

### 8個セット（基本）

| # | 感情 | テキスト例 | プロンプトヒント |
|:---|:---|:---|:---|
| 1 | ウェーイ | ウェーイ！ | arms up, party mode, super excited |
| 2 | 草 | 草 | rolling on floor laughing, tears of joy |
| 3 | マジか | マジか... | jaw dropped, shocked, disbelief |
| 4 | それな | それな！ | pointing finger, strong agreement, nodding |
| 5 | おつ | おつ～ | casual wave, relaxed smile |
| 6 | 無理 | 無理ｗ | melting, giving up, dead eyes |
| 7 | いいね | いいね！ | thumbs up, winking, sparkle |
| 8 | 眠い | ねむ... | drowsy eyes, ZZZ, yawning |

### 16個セット（基本 + 拡張）

8個セットに加えて:

| # | 感情 | テキスト例 | プロンプトヒント |
|:---|:---|:---|:---|
| 9 | やばい | やばい！ | panicking, hands on cheeks, screaming |
| 10 | 腹減った | 腹減った | stomach growling, drooling, hungry eyes |
| 11 | 遅刻 | 遅刻！ | running frantically, clock, speed lines |
| 12 | 推し | 推し！ | heart eyes, fan mode, waving light stick |
| 13 | 帰りたい | 帰りたい... | looking out window, soul leaving body |
| 14 | 飲み行こ | 飲み行こ！ | beer mug, cheering, inviting gesture |
| 15 | 暇 | 暇... | lying flat, bored expression, cobwebs |
| 16 | さすが | さすが！ | clapping, impressed, admiring eyes |

### 24個以上

16個プリセットを使用し、残りは `emotion_expression_templates.md` の汎用テンプレート（#17以降）から補完する。

---

## 恋人・家族

### 8個セット（基本）

| # | 感情 | テキスト例 | プロンプトヒント |
|:---|:---|:---|:---|
| 1 | 大好き | 大好き！ | hugging heart, love aura, sparkling eyes |
| 2 | ハグ | ぎゅー | arms open wide, warm embrace pose |
| 3 | おやすみ | おやすみ | sleepy eyes, moon, pillow, peaceful |
| 4 | おはよう | おはよう！ | stretching, morning sun, cheerful |
| 5 | 会いたい | 会いたいな... | lonely expression, reaching out, heart |
| 6 | ごめんね | ごめんね | puppy eyes, sorry pose, small tears |
| 7 | ありがとう | ありがとう♡ | blushing, hands on chest, grateful |
| 8 | いってきます | いってきます！ | waving at door, cheerful, backpack |

### 16個セット（基本 + 拡張）

8個セットに加えて:

| # | 感情 | テキスト例 | プロンプトヒント |
|:---|:---|:---|:---|
| 9 | おかえり | おかえり！ | welcoming at door, happy, open arms |
| 10 | 甘えたい | 甘えたい～ | clingy pose, puppy eyes, cuddling |
| 11 | ちゅ | ちゅっ | blowing kiss, winking, heart flying |
| 12 | 一緒にいたい | ずっと一緒 | holding hands silhouette, warm glow |
| 13 | ご飯できたよ | ご飯できたよ | apron, serving food, proud smile |
| 14 | 待ってる | 待ってるね | sitting, watching clock, patient smile |
| 15 | 嬉しい | 嬉しい！ | jumping with joy, flowers, sparkles |
| 16 | 笑って | えへへ | shy laugh, hand covering mouth, blushing |

### 24個以上

16個プリセットを使用し、残りは `emotion_expression_templates.md` の汎用テンプレート（#17以降）から補完する。

---

## テーマ選択時のワークフロー

1. **テーマ選択**（Step 6）: 大分類を選ぶ
2. **トーン選択**（Step 6b）: テーマ内の方向性を選ぶか、自分の言葉で記述する
3. **汎用** → `emotion_expression_templates.md` をベースに、トーンの口調・プロンプト修飾を適用
4. **ビジネス / 友達 / 恋人・家族** → 本ファイルの該当テーマプリセットをベースに、トーンの口調・プロンプト修飾を適用
5. セット枚数がプリセット数を超える場合 → `emotion_expression_templates.md` から不足分を補完
6. ユーザーがカスタマイズを希望する場合 → プリセットをベースに調整
