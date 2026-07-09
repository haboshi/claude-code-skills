/**
 * OpenAI Realtime API 向け RealtimeVoicePort アダプタ
 *
 * モデルIDは AI_MODELS 経由でマッピングする（port-design.md / port.ts 参照）。値は
 * ../model-catalog.md を正とし、stale_days を超えたら使用前に鮮度チェックする
 * （手順は本スキル SKILL.md「鮮度ゲート（能動）」節を参照）。
 *
 * このファイルはコピーして使う成果物。外部 import は ./port のみ。WebSocket 実装は
 * RealtimeSocketFactory（port.ts で定義。RealtimeSocket と併せて両アダプタ共通の契約）として
 * 型のみ注入する構造にしてあり、実 ws パッケージに依存せず契約テスト（conformance-test.ts）で
 * 検証できる。
 *
 * 音声: OpenAI GA API は audio/pcm の rate を明示指定できる（../model-catalog.md 参照）ため、
 * 本アダプタはセッションを 16kHz PCM16 で直接ネゴシエートし、コーデック変換を発生させない
 * （AudioCodecPort は passthroughCodec で足りる）。g711_ulaw 等を直接中継したい場合は
 * capabilities().directRelayFormats を確認のうえ、別途コーデックを注入すること。
 *
 * 注意: Buffer を使用するため Node.js ランタイムを前提とする。
 */
import {
  AI_MODELS,
  RealtimeEventQueue,
  RealtimeVoiceError,
  passthroughCodec,
  type AudioChunk,
  type AudioCodecPort,
  type RealtimeCapabilities,
  type RealtimeSessionConfig,
  type RealtimeSocketFactory,
  type RealtimeVoicePort,
  type RealtimeVoiceSession,
} from './port'

export type { RealtimeSocket, RealtimeSocketFactory } from './port'

const DEFAULT_OPEN_TIMEOUT_MS = 10_000

function requireSocketFactory(): RealtimeSocketFactory {
  throw new Error(
    'OpenAIRealtimeAdapter には RealtimeSocketFactory の実装（ws パッケージ等）を注入してください'
  )
}

// OpenAI 固有イベント → 共有エラー分類へのマッピング。code 文字列は変わりうるため、
// 更新時は model-catalog.md の鮮度チェック手順で再確認する。
function mapOpenAIErrorEvent(error: { type?: string; code?: string; message?: string }): RealtimeVoiceError {
  const code = error.code ?? ''
  const message = error.message ?? 'OpenAI Realtime API error'
  if (code === 'rate_limit_exceeded') {
    return new RealtimeVoiceError({ kind: 'rate_limited', message, providerName: 'openai', retryable: true, failoverable: false, sourceError: error })
  }
  if (code === 'insufficient_quota') {
    return new RealtimeVoiceError({ kind: 'quota_exhausted', message, providerName: 'openai', retryable: false, failoverable: true, sourceError: error })
  }
  if (code === 'invalid_value' || error.type === 'invalid_request_error') {
    return new RealtimeVoiceError({ kind: 'invalid_input', message, providerName: 'openai', retryable: false, failoverable: false, sourceError: error })
  }
  if (code === 'session_expired') {
    return new RealtimeVoiceError({ kind: 'session_expired', message, providerName: 'openai', retryable: false, failoverable: true, sourceError: error })
  }
  if (code === 'input_audio_buffer_commit_empty') {
    return new RealtimeVoiceError({ kind: 'commit_rejected', message, providerName: 'openai', retryable: false, failoverable: false, sourceError: error })
  }
  // 未分類は安全側に倒し自動リトライしない（フェイルオーバーの余地だけ残す）。
  // 実運用でよく踏むコードが判明したら、ここに追記して分類を広げる。
  return new RealtimeVoiceError({ kind: 'transient', message, providerName: 'openai', retryable: false, failoverable: true, sourceError: error })
}

// WebSocket クローズコード → 共有エラー分類へのマッピング。OpenAI のクローズコード仕様は
// ドキュメント横断で未確認のため（../model-catalog.md「未確認事項」参照）、message の文字列判定に
// 頼る保守的な実装にしてある（adapter-gemini-live.ts の mapGeminiCloseEvent と同型）。
// session_expired（60分上限到達）は正常系の error イベントとしてアプリ側に観測可能にする
// （H2: 従来は close コードを無視して黙って queue を閉じていた）。
function mapOpenAICloseEvent(code: number, reason: string): RealtimeVoiceError {
  if (/session.*(expired|timed?.?out)|60.?min/i.test(reason)) {
    return new RealtimeVoiceError({ kind: 'session_expired', message: reason, providerName: 'openai', retryable: false, failoverable: true })
  }
  if (code === 1008 || /quota/i.test(reason)) {
    return new RealtimeVoiceError({ kind: 'quota_exhausted', message: reason, providerName: 'openai', retryable: false, failoverable: true })
  }
  if (/unauthorized|unauthenticated|invalid.*key|api.?key/i.test(reason)) {
    return new RealtimeVoiceError({ kind: 'auth', message: reason, providerName: 'openai', retryable: false, failoverable: false })
  }
  return new RealtimeVoiceError({ kind: 'connection_dropped', message: reason || `WebSocket closed (${code})`, providerName: 'openai', retryable: true, failoverable: true })
}

// transcription 設定を OpenAI の audio.input.transcription 形状へ変換する。未指定（false/undefined）
// なら transcription フィールド自体を省略する（H3: 省略するとサーバは transcript イベントを
// 一切発火しない。既定で off という仕様であり、アダプタが明示指定しない限り
// 'conversation.item.input_audio_transcription.completed' は届かない）。
function buildTranscriptionConfig(transcription: RealtimeSessionConfig['transcription']): Record<string, unknown> | undefined {
  if (!transcription) return undefined
  const opts = typeof transcription === 'object' ? transcription : {}
  return { model: opts.model ?? 'gpt-4o-transcribe', ...(opts.language && { language: opts.language }) }
}

function buildSessionUpdate(config: RealtimeSessionConfig): Record<string, unknown> {
  const openaiOptions = config.providerOptions?.openai ?? {}
  const vad = config.vad
  const transcription = buildTranscriptionConfig(config.transcription)
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: config.instructions,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 16000 },
          ...(transcription && { transcription }),
          turn_detection:
            vad?.mode === 'semantic_vad'
              ? { type: 'semantic_vad', eagerness: vad.eagerness, interrupt_response: true, create_response: true }
              : vad?.mode === 'server_vad'
                ? {
                    type: 'server_vad',
                    threshold: vad.threshold,
                    prefix_padding_ms: vad.prefixPaddingMs,
                    silence_duration_ms: vad.silenceDurationMs,
                  }
                : undefined,
        },
        output: {
          format: { type: 'audio/pcm', rate: 16000 },
          voice: config.voice,
        },
      },
      ...(config.tools && config.tools.length > 0 && { tools: config.tools }),
      // 旧モデルに default true を暗黙送出するとセッション切断を招いた実録があるため、
      // 明示指定時のみ送出する（../drift-landmines.md 参照）。
      ...(config.parallelToolCalls !== undefined && { parallel_tool_calls: config.parallelToolCalls }),
      // 非ポータブル上書き。escape-hatch.md に従い openai 名前空間のみを読む。
      ...openaiOptions,
    },
  }
}

function handleOpenAIEvent(
  event: Record<string, unknown>,
  queue: RealtimeEventQueue,
  codec: AudioCodecPort,
  onReady: () => void
): void {
  const type = event['type'] as string | undefined
  switch (type) {
    case 'session.updated':
      onReady()
      queue.push({ type: 'session.ready' })
      break

    case 'response.output_audio.delta': {
      const delta = event['delta'] as string | undefined
      if (delta) {
        // Uint8Array.from() で要素単位の新規コピーを作る（adapter-gemini-live.ts の同一コメント参照）。
        // Buffer.from(base64, ...) は Node の内部プールから非ゼロ byteOffset で割り当てられることが
        // あり、後で誰かが .buffer（プール全体の ArrayBuffer）を直接参照するコードに変更した場合に
        // 無関係なバイト列を巻き込む事故を防ぐため、byteOffset に依存しない要素コピー経路を明示的に使う。
        const raw = Uint8Array.from(Buffer.from(delta, 'base64'))
        queue.push({ type: 'audio.output', audio: { data: codec.toCanonical(raw), sampleRate: 16000 } })
      }
      break
    }

    case 'input_audio_buffer.speech_started':
      queue.push({ type: 'speech.started' })
      break

    case 'input_audio_buffer.speech_stopped':
      queue.push({ type: 'speech.stopped' })
      break

    case 'response.created':
      queue.push({ type: 'response.started' })
      break

    case 'response.done':
      queue.push({ type: 'response.done' })
      break

    case 'conversation.item.input_audio_transcription.completed':
      queue.push({ type: 'transcript', role: 'user', text: String(event['transcript'] ?? ''), final: true })
      break

    case 'response.output_audio_transcript.done':
      queue.push({ type: 'transcript', role: 'assistant', text: String(event['transcript'] ?? ''), final: true })
      break

    case 'response.function_call_arguments.done': {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(String(event['arguments'] ?? '{}')) as Record<string, unknown>
      } catch {
        // パース失敗時は空引数で通知する（呼び出し側がエラーハンドリングできるようにするため
        // ここで例外にせず、tool.call は必ず発火させる）。
      }
      queue.push({
        type: 'tool.call',
        call: { callId: String(event['call_id'] ?? ''), name: String(event['name'] ?? ''), arguments: args },
      })
      break
    }

    case 'error':
      queue.push({ type: 'error', error: mapOpenAIErrorEvent(event['error'] as Record<string, string>) })
      break

    default:
      // 正規化しきれないイベントは raw escape hatch でそのまま流す（escape-hatch.md）。
      queue.push({ type: 'raw', providerEvent: event })
      break
  }
}

export class OpenAIRealtimeAdapter implements RealtimeVoicePort {
  private readonly apiKey?: string
  private readonly socketFactory: RealtimeSocketFactory
  private readonly codec: AudioCodecPort
  private readonly modelId: string

  constructor(
    opts: {
      apiKey?: string
      socketFactory?: RealtimeSocketFactory
      codec?: AudioCodecPort
      internalModel?: keyof typeof AI_MODELS.openai
    } = {}
  ) {
    this.apiKey = opts.apiKey
    this.socketFactory = opts.socketFactory ?? requireSocketFactory()
    this.codec = opts.codec ?? passthroughCodec
    this.modelId = AI_MODELS.openai[opts.internalModel ?? 'general-purpose']
  }

  // 呼び出し時に判定する理由は provider-image-gen の isConfigured() と同じ（構築後の dotenv 遅延ロード対応）。
  isConfigured(): boolean {
    return Boolean(this.apiKey ?? process.env.OPENAI_API_KEY)
  }

  capabilities(): RealtimeCapabilities {
    return {
      bargeIn: true,
      serverVad: true,
      directRelayFormats: ['g711_ulaw', 'g711_alaw'],
      parallelToolCalls: true,
      // OpenAI に resumption 機能なし（ドキュメント横断確認済み。../model-catalog.md 参照）。
      sessionResumption: false,
      maxSessionDurationMs: 60 * 60 * 1000,
    }
  }

  async open(config: RealtimeSessionConfig): Promise<RealtimeVoiceSession> {
    const apiKey = this.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new RealtimeVoiceError({
        kind: 'auth',
        message: 'OPENAI_API_KEY が未設定です',
        providerName: 'openai',
        retryable: false,
        failoverable: false,
      })
    }

    const queue = new RealtimeEventQueue()
    const codec = this.codec
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.modelId)}`
    const socket = this.socketFactory.connect(url, { Authorization: `Bearer ${apiKey}` })

    // H1: ready が session.updated でしか resolve されない実装だと、認証失敗等で WS が即座に
    // close/error した場合に open() が永久にハングする。onError/onClose 側でも reject できるよう
    // resolve/reject の両方を保持し、settle 済みなら以降の呼び出しは無視する（二重 settle 防止）。
    let settled = false
    let resolveReady: (() => void) | null = null
    let rejectReady: ((err: unknown) => void) | null = null
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const onReady = (): void => {
      if (settled) return
      settled = true
      resolveReady?.()
    }
    const failBeforeReady = (error: RealtimeVoiceError): void => {
      if (settled) return
      settled = true
      rejectReady?.(error)
    }

    // openTimeoutMs 超過時は timeout として reject する（正準 timeout 種の転用。port.ts 参照）。
    // ready を待たずに応答が返らないケース（サーバがハンドシェイク段階で無応答等）を救うための保険。
    const openTimeoutMs = config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
    const timeoutHandle = setTimeout(() => {
      failBeforeReady(
        new RealtimeVoiceError({
          kind: 'timeout',
          message: `open() が ${openTimeoutMs}ms 以内に session.ready へ到達しませんでした`,
          providerName: 'openai',
          retryable: true,
          failoverable: true,
        })
      )
      socket.close()
    }, openTimeoutMs)

    socket.onOpen(() => {
      socket.send(JSON.stringify(buildSessionUpdate(config)))
    })

    socket.onMessage((raw) => {
      let event: Record<string, unknown>
      try {
        event = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return
      }
      handleOpenAIEvent(event, queue, codec, onReady)
    })

    socket.onError((err) => {
      const error = new RealtimeVoiceError({
        kind: 'connection_dropped',
        message: err.message,
        providerName: 'openai',
        retryable: true,
        failoverable: true,
        sourceError: err,
      })
      queue.push({ type: 'error', error })
      failBeforeReady(error)
    })

    socket.onClose((code, reason) => {
      // H2: クローズコードを無視せず正準分類へマッピングする（60分上限到達時の session_expired 等、
      // 異常クローズの観測可能性を確保する）。1000（正常終了）はキュー終了のみで足りる。
      if (code !== 1000) {
        const error = mapOpenAICloseEvent(code, reason)
        queue.push({ type: 'error', error })
        failBeforeReady(error)
      } else if (!settled) {
        // 通常起きないが、ready 到達前に正常クローズした場合も open() を永久ハングさせない。
        failBeforeReady(
          new RealtimeVoiceError({ kind: 'connection_dropped', message: 'ready 到達前に接続が閉じられました', providerName: 'openai', retryable: true, failoverable: true })
        )
      }
      queue.close()
    })

    try {
      await ready
    } finally {
      clearTimeout(timeoutHandle)
    }

    // close() 後の send 系呼び出しを無言で無視するためのローカルフラグ（LOW: 未接続/close 後ガード）。
    // RealtimeSocket インターフェース自体は接続状態を問い合わせる手段を持たないため、close() 呼び出しを
    // ここで捕捉して以降の send を止める。
    let sessionClosed = false

    return {
      events: () => queue,
      sendAudio(chunk: AudioChunk): void {
        if (sessionClosed) return
        const wire = codec.fromCanonical(chunk.data)
        socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(wire).toString('base64') }))
      },
      sendToolResult(callId: string, result: unknown): void {
        if (sessionClosed) return
        socket.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: typeof result === 'string' ? result : JSON.stringify(result),
            },
          })
        )
        socket.send(JSON.stringify({ type: 'response.create' }))
      },
      interrupt(): void {
        if (sessionClosed) return
        // barge-in: response.cancel + バッファクリア。エコー防止の先行ミュートはアプリ側の責務
        // （../session-lifecycle.md「barge-in の実装型」参照）。
        socket.send(JSON.stringify({ type: 'response.cancel' }))
        socket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }))
      },
      async close(): Promise<void> {
        sessionClosed = true
        socket.close()
        queue.close()
      },
    }
  }
}
