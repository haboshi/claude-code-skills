# 感情・表情テンプレート

LINEスタンプセットのキャラクター一貫性を保ちつつ、バリエーション豊かな表情を生成するためのテンプレート。

## 8個セット（必須の基本感情）

| # | 感情 | 表現 | プロンプトヒント |
|:---|:---|:---|:---|
| 1 | 喜び | 満面の笑顔、目がキラキラ | smiling brightly, sparkling eyes |
| 2 | 悲しみ | 涙目、しょんぼり | teary eyes, drooping |
| 3 | 怒り | 眉をつり上げ、プンプン | angry eyebrows, steam from head |
| 4 | 驚き | 目を大きく見開く、口ぽかん | wide eyes, open mouth, shocked |
| 5 | 挨拶 | 手を振る、にっこり | waving hand, friendly smile |
| 6 | 感謝 | お辞儀、ハートマーク | bowing, heart marks |
| 7 | OK/了解 | サムズアップ、ウインク | thumbs up, winking |
| 8 | 疲れ | ぐったり、汗マーク | exhausted, sweat drops |

## 16個セット（基本 + 日常）

8個セットに加えて:

| # | 感情 | 表現 | プロンプトヒント |
|:---|:---|:---|:---|
| 9 | 照れ | 頬を赤らめる | blushing cheeks |
| 10 | 眠い | 目が半開き、ZZZ | half-closed eyes, sleeping ZZZ |
| 11 | 食べる | もぐもぐ、美味しそう | eating, delicious expression |
| 12 | 応援 | メガホン、ガッツポーズ | cheering, megaphone, fist pump |
| 13 | 焦り | 汗だく、慌てる | panicking, sweating profusely |
| 14 | ラブ | ハート目、うっとり | heart eyes, lovestruck |
| 15 | ドヤ顔 | 得意げ、キリッ | smug face, confident pose |
| 16 | 謝罪 | 土下座、ごめんなさい | deep bow, apologizing |

## 24個セット（基本 + 日常 + コミュニケーション）

16個セットに加えて:

| # | 感情 | 表現 | プロンプトヒント |
|:---|:---|:---|:---|
| 17 | 待って | 手のひらを前に、ストップ | palm forward, stop gesture |
| 18 | 考え中 | 腕組み、はてなマーク | arms crossed, question mark |
| 19 | 祝い | クラッカー、紙吹雪 | party popper, confetti |
| 20 | 寒い | 震える、マフラー | shivering, scarf wrapped |
| 21 | 暑い | 扇子、太陽マーク | fanning self, sun mark |
| 22 | 走る | ダッシュ、スピード線 | running, speed lines |
| 23 | 音楽 | ヘッドフォン、音符 | headphones, music notes |
| 24 | バイバイ | 手を振る、背を向ける | waving goodbye, turning away |

## 32個セット

24個セットに加えて:

| # | 感情 | 表現 |
|:---|:---|:---|
| 25 | 秘密 | 口に指、シーッ |
| 26 | 電話 | 受話器ポーズ |
| 27 | 写真 | カメラポーズ、ピース |
| 28 | 雨 | 傘をさす、雨粒 |
| 29 | 星 | キラキラ、夢見心地 |
| 30 | 筋トレ | ダンベル、マッチョポーズ |
| 31 | お金 | 財布、金欠または豪遊 |
| 32 | 寝る | 布団、おやすみ |

## 40個セット

32個セットに加えて:

| # | 感情 | 表現 |
|:---|:---|:---|
| 33 | なるほど | 電球マーク、ひらめき |
| 34 | 乾杯 | グラス、ビールジョッキ |
| 35 | プレゼント | ギフトボックス |
| 36 | 掃除 | ほうき、ピカピカ |
| 37 | パソコン | キーボード、集中 |
| 38 | 散歩 | のんびり歩く |
| 39 | ハイタッチ | 両手を上げる |
| 40 | スペシャル | キャラの決めポーズ |

## キャラクター一貫性のためのプロンプト構成

画像生成プロンプトは以下の構造で統一する:

```
[キャラクター基本描写], [今回の感情・ポーズ], [スタイル指定],
LINE sticker style, simple clean design, transparent background,
white outline around character, no text
```

### 一貫性を保つためのルール

1. **キャラクター基本描写**を全スタンプで固定する（体型、色、服装、特徴）
2. **スタイル指定**を統一する（chibi, kawaii, flat design 等）
3. **背景**は常に透過（transparent background）
4. **白縁取り**を推奨（白背景チャットでの視認性向上）
5. 参照画像がある場合は全スタンプで同じ参照画像を使用する
