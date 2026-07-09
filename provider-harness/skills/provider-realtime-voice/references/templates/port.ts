/**
 * RealtimeVoicePort — リアルタイム音声のセッション + イベントストリーム型ポート定義
 *
 * provider-harness メタスキルの port-design.md / escape-hatch.md / abstraction-thickness.md に従う:
 * - リアルタイム音声は「抽象化より型を持つ」ドメイン（abstraction-thickness.md 参照）。
 *   統一ポートを厚くするより「接続ライフサイクルとイベント処理」の型を持つ方が有効なため、
 *   本ポートはメソッド呼び出し型ではなく単一イベントストリーム購読型にしてある。
 * - 個別の onAudioResponse / onToolCall のような setter 群はハンドラ登録順のレースを生む
 *   （実レース事例は ../port.md 参照）。events() の単一 AsyncIterable に統合することで
 *   「まだ登録していないハンドラに先にイベントが届く」事故を型レベルで起こらないようにする。
 * - 正規化するのは音声出力・ツール呼び出し・主要ライフサイクルのみ。プロバイダ固有イベントは
 *   `raw` escape hatch でそのまま流す（存在しないふりをしない。escape-hatch.md）。
 * - tools（ツール定義スキーマ）は意図的に非正規化。OpenAI はフラット schema、Gemini は
 *   { functionDeclarations: [...] } と形が異なり、3実装とも素通しを選んでいる（正規化コスト>便益）。
 * - capabilities フラグでプロバイダ非対称性を正直に公開する（ダックタイピング禁止）。
 *
 * このファイルはコピーして使う成果物。外部 import は zod のみ。
 * 注意: 本ファイル・adapter-openai-realtime.ts・adapter-gemini-live.ts・conformance-test.ts 内の
 * コメントにある `../model-catalog.md` 等の相対参照は、コピー元スキル（provider-realtime-voice）内の
 * ドキュメントを指す。コピー先プロジェクトにはそのファイルは存在しないため、必要なら該当箇所の
 * 記述内容も書き写すか、provider-realtime-voice スキルへのリンクとして残すこと。
 */
import { z } from 'zod'

// ===== 音声 =====
// ポート契約上の音声は常に正準フォーマット（PCM16 16kHz）。プロバイダ固有のレート・エンコーディング
// （Gemini 出力の 24kHz 固定、g711 系コーデック等）との変換は AudioCodecPort の責務にし、
// RealtimeVoicePort 自体は正準フォーマットしか扱わない（../port.md「コーデック分離の理由」参照）。
export const AudioChunkSchema = z.object({
  // z.instanceof(Uint8Array) でなく z.custom<Uint8Array>() を使う理由: zod の instanceof は
  // TypeScript 5.7+ の型定義上 Uint8Array<ArrayBuffer>（specific）に固定して推論されるため、
  // Buffer 由来の Uint8Array<ArrayBufferLike>（Node の Buffer 型・AudioCodecPort の戻り値等）を
  // 代入しようとすると構造的に弾かれる（実際に踏んだ既知の TS/Node 相互運用の摩擦）。
  // z.custom<Uint8Array>() は bare Uint8Array（ArrayBufferLike 既定）として推論され、
  // AudioCodecPort.toCanonical() の戻り値型と一致する。
  data: z.custom<Uint8Array>((v: unknown) => v instanceof Uint8Array),
  sampleRate: z.literal(16000),
})
export type AudioChunk = z.infer<typeof AudioChunkSchema>

// ===== ツール呼び出し =====
export const NormalizedToolCallSchema = z.object({
  callId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
})
export type NormalizedToolCall = z.infer<typeof NormalizedToolCallSchema>

// ===== VAD 設定（3方式を許容する設定型） =====
// OpenAI: semantic_vad（eagerness 4段階） / server_vad（threshold 等）。Gemini: automaticActivityDetection
// (server_vad 相当) / 手動 activityStart・End。ローカル VAD（Silero 等）は手動発火のため server_vad と
// 同じ形にはならず、mode:'local' を独立させてある（../session-lifecycle.md「VAD 3方式の選び方」参照）。
export const VadConfigSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('semantic_vad'), eagerness: z.enum(['low', 'medium', 'high', 'auto']) }),
  z.object({
    mode: z.literal('server_vad'),
    threshold: z.number().optional(),
    prefixPaddingMs: z.number().optional(),
    silenceDurationMs: z.number().optional(),
  }),
  // ローカル VAD 使用時、speech.started/stopped はアプリ側が RealtimeVoiceSession に外部から
  // 通知する経路が別途必要になる（本ポートはサーバ側 VAD イベントの受信のみを定義する）。
  z.object({ mode: z.literal('local') }),
])
export type VadConfig = z.infer<typeof VadConfigSchema>

// プロバイダ固有パラメータの非ポータブルなパススルー経路。プロバイダ名で名前空間化し、
// 各アダプタは自分宛ての名前空間だけを読み、他プロバイダ宛ての値は読まない（escape-hatch.md）。
export const RealtimeProviderOptionsSchema = z.object({
  openai: z.record(z.string(), z.unknown()).optional(),
  gemini: z.record(z.string(), z.unknown()).optional(),
})
export type RealtimeProviderOptions = z.infer<typeof RealtimeProviderOptionsSchema>

// 文字起こし要求。両プロバイダとも既定では transcript イベントが発火しない（サーバ側に明示指定して
// 初めて有効になる）。true で各アダプタの既定設定、オブジェクトで詳細指定する
// （../port.md「transcript が既定で発火しない」参照）。
export const TranscriptionConfigSchema = z.union([
  z.boolean(),
  z.object({ model: z.string().optional(), language: z.string().optional() }),
])
export type TranscriptionConfig = z.infer<typeof TranscriptionConfigSchema>

export const RealtimeSessionConfigSchema = z.object({
  instructions: z.string().optional(),
  voice: z.string().optional(),
  // 意図的に非正規化。プロバイダ形状のまま渡す（このファイル冒頭コメント「tools」参照）。
  tools: z.array(z.unknown()).optional(),
  vad: VadConfigSchema.optional(),
  transcription: TranscriptionConfigSchema.optional(),
  // session.update で暗黙 default を送ると旧モデルでセッション切断を招いた実録がある
  // （../drift-landmines.md 参照）。明示指定時のみアダプタから送出すること。
  parallelToolCalls: z.boolean().optional(),
  // open() が session.ready に到達するまでのタイムアウト（ms）。既定 10000ms。
  // 正準 timeout 種は本来 request/response の応答遅延を想定した分類だが、「セッション確立自体が
  // 完了しない」という接続確立フェーズの遅延にも同じ意味論（retryable: 一時的な遅延の可能性が
  // あるためリトライしてよい）が当てはまるため転用する（../port.md「open() の失敗経路」参照）。
  openTimeoutMs: z.number().int().positive().optional(),
  providerOptions: RealtimeProviderOptionsSchema.optional(),
})
export type RealtimeSessionConfig = z.infer<typeof RealtimeSessionConfigSchema>

// ===== 二層エラー: メタ正準8種 + リアルタイム拡張4種 =====
// 正準8種は provider-harness メタスキルの error-taxonomy.md と同じ語彙（意味も同一）。
// リアルタイム固有の4種は接続・セッションのライフサイクルに起因し、正準8種では表現できない
// （../port.md「二層エラーの理由」参照）。
export type RealtimeErrorKind =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'auth'
  | 'invalid_input'
  | 'content_blocked'
  | 'timeout'
  | 'transient'
  | 'unsupported'
  // ここから拡張4種
  | 'session_expired' // セッション上限時間到達（OpenAI 60分・Gemini 音声のみ15分等）
  | 'connection_dropped' // WebSocket 切断（ネットワーク起因）。再接続方針は session-lifecycle.md 参照
  | 'commit_rejected' // 音声バッファのコミットをプロバイダが拒否（空バッファ等）
  | 'no_speech' // VAD が発話を検出できないまま commit された

export class RealtimeVoiceError extends Error {
  readonly kind: RealtimeErrorKind
  readonly retryable: boolean
  readonly failoverable: boolean
  readonly providerName: string
  // 元のプロバイダ SDK 例外・生イベント（デバッグ用）。非ポータブルなので値の形に依存しないこと。
  readonly sourceError?: unknown

  constructor(params: {
    kind: RealtimeErrorKind
    message: string
    providerName: string
    retryable: boolean
    failoverable: boolean
    sourceError?: unknown
  }) {
    super(params.message)
    this.name = 'RealtimeVoiceError'
    this.kind = params.kind
    this.retryable = params.retryable
    this.failoverable = params.failoverable
    this.providerName = params.providerName
    this.sourceError = params.sourceError
  }
}

// ===== capabilities（ダックタイピング撲滅） =====
export const RealtimeCapabilitiesSchema = z.object({
  // barge-in（ユーザ発話によるAI応答の割り込み）対応を二軸で公開する。サーバ自動 barge-in と
  // クライアント起動の応答キャンセルは別の能力であり、単一 boolean に丸めるとどちらの意味か
  // 判別できなくなるため分離した（../port.md「barge-in capability の二軸分離」参照）。
  // - serverAuto: サーバ側が自動でユーザ発話を検出し進行中の応答を打ち切るか
  //   （OpenAI: VAD 有効時に自動キャンセル。Gemini: serverContent.interrupted フラグで通知）
  // - clientCancel: アプリ側から能動的に応答キャンセルを要求できる公式な手段があるか
  //   （OpenAI: response.cancel が対応。Gemini: 一次情報で確認できる公式手段が無い）
  bargeIn: z.object({ serverAuto: z.boolean(), clientCancel: z.boolean() }),
  serverVad: z.boolean(),
  // 素通し可能な直接リレー音声フォーマット（例: 'g711_ulaw'）。空配列は「常にコーデック変換が必要」を
  // 意味する（AudioCodecPort 参照）。
  directRelayFormats: z.array(z.string()),
  parallelToolCalls: z.boolean(),
  // セッション再開（切断後に会話コンテキストを引き継いで再接続）。Gemini のみ対応（handle 方式）。
  sessionResumption: z.boolean(),
  maxSessionDurationMs: z.number().int().optional(),
})
export type RealtimeCapabilities = z.infer<typeof RealtimeCapabilitiesSchema>

// ===== RealtimeEvent union =====
// audio.output は常に正準 PCM16（上記 AudioChunkSchema）。プロバイダ固有の生イベントはどの分類にも
// 当てはまらない場合 raw に流す（正規化しきれないプロバイダ固有イベントの受け皿。escape-hatch.md）。
export type RealtimeEvent =
  | { type: 'session.ready' }
  | { type: 'audio.output'; audio: AudioChunk }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; final: boolean }
  | { type: 'tool.call'; call: NormalizedToolCall }
  // barge-in による response 中断はエラーでなく正常系イベント（../port.md 参照）。
  | { type: 'speech.started' }
  | { type: 'speech.stopped' }
  | { type: 'response.started' }
  | { type: 'response.done' }
  | { type: 'error'; error: RealtimeVoiceError }
  | { type: 'raw'; providerEvent: unknown }

// ===== ポート本体 =====
export interface RealtimeVoicePort {
  open(config: RealtimeSessionConfig): Promise<RealtimeVoiceSession>
  capabilities(): RealtimeCapabilities
  // 任意: 構成済み（API キー等が揃っている）かどうかを返す。provider-image-gen の ImageGenPort と
  // 同じ契約（未実装のプロバイダは常に構成済み扱い）。
  isConfigured?(): boolean
}

export interface RealtimeVoiceSession {
  // 単一イベントストリーム購読。個別 onX ハンドラ群にしない理由は本ファイル冒頭コメント参照。
  events(): AsyncIterable<RealtimeEvent>
  // fire-and-forget。応答は events() 経由でしか観測できない（request/response 型ではない）。
  sendAudio(chunk: AudioChunk): void
  sendToolResult(callId: string, result: unknown): void
  // barge-in の明示トリガー。VAD がサーバ側で自動検出しないプロバイダ・ローカル VAD 構成のために
  // アプリ側から能動的に呼べる経路として用意する（../session-lifecycle.md「barge-in の実装型」参照）。
  // clientCancel 非対応のプロバイダ（capabilities().bargeIn.clientCancel === false）は
  // RealtimeVoiceError（kind: 'unsupported'）を投げてよい。opts は clientCancel 対応プロバイダ
  // （OpenAI 等）向けの追加コンテキストで、itemId・audioEndMs を両方指定すると
  // conversation.item.truncate 相当のコンテキスト整合処理を追加送出できる（../port.md「H4」参照）。
  interrupt(opts?: { itemId?: string; audioEndMs?: number }): void
  close(): Promise<void>
}

/**
 * コーデック変換ポート（RealtimeVoicePort とは意図的に別ポートにする）。
 *
 * WebRTC 経路ではブラウザが Opus/SDP で音声コーデックを抽象化するためコーデック変換自体が不要になり、
 * passthroughCodec（no-op）を差せる。WebSocket 生音声経路のみ実コーデックを注入する
 * （../port.md「コーデック分離の理由」参照）。
 */
export interface AudioCodecPort {
  /** プロバイダ固有フォーマット → 正準 PCM16 16kHz */
  toCanonical(raw: Uint8Array): Uint8Array
  /** 正準 PCM16 16kHz → プロバイダ固有フォーマット */
  fromCanonical(pcm16: Uint8Array): Uint8Array
}

export const passthroughCodec: AudioCodecPort = {
  toCanonical: (raw) => raw,
  fromCanonical: (pcm16) => pcm16,
}

/**
 * WebSocket 実装への型のみの注入インターフェース。両アダプタ（adapter-openai-realtime.ts /
 * adapter-gemini-live.ts）が共有する契約であり、ここに一本化することでシグネチャ乖離
 * （例: headers を必須にするか任意にするか）の再発を防ぐ。実装（ws パッケージ等）は
 * コピー先プロジェクトで用意し、契約テスト（conformance-test.ts）はこのインターフェースを
 * モックして実 ws を張らずに検証する。
 */
export interface RealtimeSocket {
  send(data: string): void
  close(): void
  onOpen(handler: () => void): void
  onMessage(handler: (data: string) => void): void
  onError(handler: (err: Error) => void): void
  onClose(handler: (code: number, reason: string) => void): void
}

// headers は Gemini（API キーを URL クエリで渡す）では使わないが、OpenAI（Authorization ヘッダが
// 必須）と同じシグネチャに揃えることで、テスト側が両アダプタに同一の socketFactory 実装を
// 注入できるようにする（conformance-test.ts 参照）。
export interface RealtimeSocketFactory {
  connect(url: string, headers?: Record<string, string>): RealtimeSocket
}

/**
 * モデルID の集中管理（durable-vs-volatile.md）。
 *
 * アダプタ内にモデルIDを直書きせず、必ずこのマップを経由する。値は ../model-catalog.md を正とし、
 * last_verified / stale_days を超えたら使用前に再検証する（アダプタ内の直書き散在を反面教師にした
 * 収穫元判断。SKILL.md「抽象化方針」参照）。
 */
export const AI_MODELS = {
  openai: {
    'general-purpose': 'gpt-realtime-2.1',
  },
  gemini: {
    'general-purpose': 'gemini-3.1-flash-live-preview',
  },
} as const

/**
 * RealtimeEvent の AsyncIterable キュー。WS の 'message' 等イベント駆動コールバックから
 * RealtimeVoiceSession.events() を合成するための共有ヘルパー。両アダプタが同じキューイング実装を
 * 重複させないためにここへ置く（provider-image-gen の withFallback と同様、port.ts は型定義だけでなく
 * アダプタ実装が共有する最小限のロジックも持つ）。
 *
 * 単一コンシューマ契約: このキューは「1つの for-await ループが順番に消費する」ことだけを想定した
 * 実装であり、複数箇所から同時に `events()[Symbol.asyncIterator]()` を呼んで並行に消費する
 * fan-out（1つのイベントを複数の購読者に配ること）は行わない。`next()` 呼び出しの待機者（waiters）は
 * FIFO の1本のキューであり、複数コンシューマが同時に `next()` を呼ぶと push されたイベントは
 * 待機順に1件ずつ排他的に配られる（ブロードキャストされない）。複数箇所でイベントを使い回したい
 * 場合は、呼び出し側が唯一の消費者として1本の for-await ループを回し、そこから必要な数だけ
 * アプリ内で配信し直すこと（例: EventEmitter へ再送する等）。
 *
 * backpressure なし: push() はコンシューマの消費速度を待たず即座にバッファへ積む。プロデューサ
 * （WS の 'message' コールバック）がコンシューマより速くイベントを生成し続けると、consumer が
 * 遅延・停止している間 buffer は無制限に伸びうる（LOW: 上限チェックや警告は未実装）。長時間
 * 無消費のまま接続を張り続ける用途では、アプリ側で定期的に消費するか、buffer 長を監視すること。
 */
export class RealtimeEventQueue implements AsyncIterable<RealtimeEvent> {
  private readonly buffer: RealtimeEvent[] = []
  private readonly waiters: Array<(v: IteratorResult<RealtimeEvent>) => void> = []
  private closed = false

  push(event: RealtimeEvent): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: event, done: false })
    } else {
      this.buffer.push(event)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()!({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RealtimeEvent> {
    return {
      next: (): Promise<IteratorResult<RealtimeEvent>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as RealtimeEvent, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}
