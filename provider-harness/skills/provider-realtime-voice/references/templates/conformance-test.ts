/**
 * 共通コンフォーマンステストスイート（vitest）
 *
 * contract-testing.md の原則:
 * - 全アダプタが同一のテストスイートを通ることを確認する
 * - モック中心（実 WebSocket は張らない）で、EventEmitter で RealtimeSocket をモックする
 *   （voice-agent の gemini-live.test.ts の型を踏襲）
 * - このスイートが証明するのはポータブルな面（RealtimeEvent の形状・fire-and-forget send 系・
 *   ライフサイクル）のみ。providerOptions 経由の非ポータブル機能は個別テストでカバーする
 *
 * このファイルはコピーして使う成果物。外部 import は vitest / node:events / ./port / 各アダプタのみ。
 * ws パッケージは import しない（RealtimeSocketFactory は型のみの注入インターフェースのため）。
 *
 * 注意: 実 API（wss://...）に接続する Pin+Verify テストは、本テンプレートには含めていない。
 * 実 WebSocket 実装（ws パッケージ等）をコピー先プロジェクトで RealtimeSocketFactory に注入した後、
 * pin-and-verify.md のタイミングで別途疎通確認テストを追加すること（image-gen の REST API と異なり、
 * 実 WS ハンドシェイク+セッションライフサイクル全体を模擬する必要があり、本テンプレートのスコープ外）。
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiLiveAdapter, geminiDownsampleCodec } from './adapter-gemini-live'
import { OpenAIRealtimeAdapter } from './adapter-openai-realtime'
import { RealtimeVoiceError } from './port'
import type { RealtimeEvent, RealtimeSessionConfig, RealtimeSocket, RealtimeSocketFactory, RealtimeVoiceSession } from './port'

// ===== RealtimeSocket モック =====
// 両アダプタの RealtimeSocketFactory 契約（onOpen/onMessage/onError/onClose + send/close）を満たす。
class MockSocket extends EventEmitter implements RealtimeSocket {
  sent: string[] = []
  closed = false
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
    this.emit('close', 1000, '')
  }
  onOpen(handler: () => void): void {
    this.on('open', handler)
  }
  onMessage(handler: (data: string) => void): void {
    this.on('message', handler)
  }
  onError(handler: (err: Error) => void): void {
    this.on('error', handler)
  }
  onClose(handler: (code: number, reason: string) => void): void {
    this.on('close', handler)
  }
}

function makeFactory(): { factory: RealtimeSocketFactory; sockets: MockSocket[] } {
  const sockets: MockSocket[] = []
  const factory: RealtimeSocketFactory = {
    connect: () => {
      const socket = new MockSocket()
      sockets.push(socket)
      // onOpen ハンドラ登録後に発火させるため次 tick に回す
      setTimeout(() => socket.emit('open'), 0)
      return socket
    },
  }
  return { factory, sockets }
}

async function nextEvent(session: RealtimeVoiceSession): Promise<RealtimeEvent> {
  const iter = session.events()[Symbol.asyncIterator]()
  const { value, done } = await iter.next()
  if (done || value === undefined) throw new Error('イベントストリームが予期せず終了しました')
  return value
}

// ===== プロバイダ別セットアップ =====

async function openOpenAIReadySession(): Promise<{ session: RealtimeVoiceSession; socket: MockSocket }> {
  const { factory, sockets } = makeFactory()
  const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
  const sessionPromise = adapter.open({ instructions: 'test' })
  await new Promise((r) => setTimeout(r, 10))
  const socket = sockets[0]!
  socket.emit('message', JSON.stringify({ type: 'session.updated', session: {} }))
  const session = await sessionPromise
  return { session, socket }
}

function emitOpenAIAudioOutput(socket: MockSocket): void {
  const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04])
  socket.emit('message', JSON.stringify({ type: 'response.output_audio.delta', delta: pcm.toString('base64') }))
}

function emitOpenAIToolCall(socket: MockSocket, callId: string, name: string): void {
  socket.emit(
    'message',
    JSON.stringify({ type: 'response.function_call_arguments.done', call_id: callId, name, arguments: '{}' })
  )
}

// H1: session.ready 到達前に onError/onClose/timeout が発火した場合の失敗経路を検証するための
// helper。ready 到達を待たず、socketFactory.connect() が同期的に返した直後の socket を返す
// （open() は最初の await まで同期実行されるため、この時点で sockets[0] は必ず存在する）。
function openOpenAIPendingSession(config: RealtimeSessionConfig = {}): { sessionPromise: Promise<RealtimeVoiceSession>; socket: MockSocket } {
  const { factory, sockets } = makeFactory()
  const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
  const sessionPromise = adapter.open(config)
  return { sessionPromise, socket: sockets[0]! }
}

async function openGeminiReadySession(): Promise<{ session: RealtimeVoiceSession; socket: MockSocket }> {
  const { factory, sockets } = makeFactory()
  const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
  const sessionPromise = adapter.open({ instructions: 'test' })
  await new Promise((r) => setTimeout(r, 10))
  const socket = sockets[0]!
  socket.emit('message', JSON.stringify({ setupComplete: {} }))
  const session = await sessionPromise
  return { session, socket }
}

function emitGeminiAudioOutput(socket: MockSocket): void {
  // 24kHz PCM16, 6 samples (12 bytes)。geminiDownsampleCodec で 4 samples (8 bytes) に変換される想定。
  const pcm24k = Buffer.alloc(12)
  for (let i = 0; i < 6; i++) pcm24k.writeInt16LE(1000 * (i + 1), i * 2)
  socket.emit(
    'message',
    JSON.stringify({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm24k.toString('base64'), mimeType: 'audio/pcm;rate=24000' } }] } },
    })
  )
}

function emitGeminiToolCall(socket: MockSocket, callId: string, name: string): void {
  socket.emit('message', JSON.stringify({ toolCall: { functionCalls: [{ id: callId, name, args: {} }] } }))
}

// H1: openOpenAIPendingSession() と同型（adapter-gemini-live.ts 側の失敗経路検証用）。
function openGeminiPendingSession(config: RealtimeSessionConfig = {}): { sessionPromise: Promise<RealtimeVoiceSession>; socket: MockSocket } {
  const { factory, sockets } = makeFactory()
  const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
  const sessionPromise = adapter.open(config)
  return { sessionPromise, socket: sockets[0]! }
}

// ===== 共通コンフォーマンステスト =====

function runCommonConformanceTests(
  name: 'openai' | 'gemini',
  openReadySession: () => Promise<{ session: RealtimeVoiceSession; socket: MockSocket }>,
  emitAudioOutput: (socket: MockSocket) => void,
  emitToolCall: (socket: MockSocket, callId: string, name: string) => void
): void {
  describe(`${name} アダプタの共通コンフォーマンス`, () => {
    it('open() は session.ready イベントを最初に発火する', async () => {
      const { session } = await openReadySession()
      const event = await nextEvent(session)
      expect(event.type).toBe('session.ready')
    })

    it('audio.output イベントは常に正準 PCM16 16kHz で届く', async () => {
      const { session, socket } = await openReadySession()
      await nextEvent(session) // session.ready を読み捨て
      emitAudioOutput(socket)
      const event = await nextEvent(session)
      expect(event.type).toBe('audio.output')
      if (event.type === 'audio.output') {
        expect(event.audio.sampleRate).toBe(16000)
        expect(event.audio.data).toBeInstanceOf(Uint8Array)
        expect(event.audio.data.length).toBeGreaterThan(0)
      }
    })

    it('tool.call イベントは NormalizedToolCall 形状で届く', async () => {
      const { session, socket } = await openReadySession()
      await nextEvent(session)
      emitToolCall(socket, 'call-1', 'get_weather')
      const event = await nextEvent(session)
      expect(event.type).toBe('tool.call')
      if (event.type === 'tool.call') {
        expect(event.call.callId).toBe('call-1')
        expect(event.call.name).toBe('get_weather')
        expect(typeof event.call.arguments).toBe('object')
      }
    })

    it('sendToolResult() は fire-and-forget で wire メッセージを送出する', async () => {
      const { session, socket } = await openReadySession()
      const before = socket.sent.length
      session.sendToolResult('call-1', { ok: true })
      expect(socket.sent.length).toBeGreaterThan(before)
    })

    it('sendAudio() は正準 PCM16 チャンクを wire メッセージとして送出する', async () => {
      const { session, socket } = await openReadySession()
      const before = socket.sent.length
      session.sendAudio({ data: new Uint8Array([1, 2, 3, 4]), sampleRate: 16000 })
      expect(socket.sent.length).toBeGreaterThan(before)
    })

    it('close() はソケットを閉じる', async () => {
      const { session, socket } = await openReadySession()
      await session.close()
      expect(socket.closed).toBe(true)
    })

    it('capabilities() は RealtimeCapabilities の形状を満たす', () => {
      const adapter =
        name === 'openai'
          ? new OpenAIRealtimeAdapter({ apiKey: 'k', socketFactory: makeFactory().factory })
          : new GeminiLiveAdapter({ apiKey: 'k', socketFactory: makeFactory().factory })
      const caps = adapter.capabilities()
      expect(typeof caps.bargeIn.serverAuto).toBe('boolean')
      expect(typeof caps.bargeIn.clientCancel).toBe('boolean')
      expect(typeof caps.serverVad).toBe('boolean')
      expect(Array.isArray(caps.directRelayFormats)).toBe(true)
      expect(Array.isArray(caps.reasoningEffortLevels)).toBe(true)
      expect(typeof caps.sessionResumption).toBe('boolean')
    })
  })
}

runCommonConformanceTests('openai', openOpenAIReadySession, emitOpenAIAudioOutput, emitOpenAIToolCall)
runCommonConformanceTests('gemini', openGeminiReadySession, emitGeminiAudioOutput, emitGeminiToolCall)

// ===== H1: open() の失敗経路（両アダプタ）=====
// 旧実装は ready が session.updated/setupComplete でしか resolve されず、WS 認証失敗等の即時
// close/error で open() が永久にハングしていた。onError/onClose 側での reject と openTimeoutMs の
// 両方を検証する。

describe('openai アダプタ固有: open() の失敗経路（H1）', () => {
  it('ready 到達前に異常クローズすると connection_dropped で reject する', async () => {
    const { sessionPromise, socket } = openOpenAIPendingSession()
    socket.emit('close', 1006, 'abnormal closure')
    await expect(sessionPromise).rejects.toMatchObject({ kind: 'connection_dropped' })
  })

  it('ready 到達前に onError が発火すると connection_dropped で reject する', async () => {
    const { sessionPromise, socket } = openOpenAIPendingSession()
    socket.emit('error', new Error('network down'))
    await expect(sessionPromise).rejects.toMatchObject({ kind: 'connection_dropped' })
  })

  it('openTimeoutMs を超えると timeout として reject する', async () => {
    const { sessionPromise } = openOpenAIPendingSession({ openTimeoutMs: 20 })
    await expect(sessionPromise).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('gemini アダプタ固有: open() の失敗経路（H1）', () => {
  it('ready 到達前に異常クローズすると connection_dropped で reject する', async () => {
    const { sessionPromise, socket } = openGeminiPendingSession()
    socket.emit('close', 1006, 'abnormal closure')
    await expect(sessionPromise).rejects.toMatchObject({ kind: 'connection_dropped' })
  })

  it('ready 到達前に onError が発火すると connection_dropped で reject する', async () => {
    const { sessionPromise, socket } = openGeminiPendingSession()
    socket.emit('error', new Error('network down'))
    await expect(sessionPromise).rejects.toMatchObject({ kind: 'connection_dropped' })
  })

  it('openTimeoutMs を超えると timeout として reject する', async () => {
    const { sessionPromise } = openGeminiPendingSession({ openTimeoutMs: 20 })
    await expect(sessionPromise).rejects.toMatchObject({ kind: 'timeout' })
  })
})

// ===== isConfigured() / auth エラー =====

// 実行環境に OPENAI_API_KEY / GEMINI_API_KEY が設定されている場合（開発機のシェル環境等）でも
// 「未構成」を正しく再現するため、このブロックでは明示的に空文字へスタブする。
describe('openai アダプタ固有: 未構成時の挙動', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('APIキー未設定で open() すると auth エラーを投げる', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const { factory } = makeFactory()
    const adapter = new OpenAIRealtimeAdapter({ socketFactory: factory })
    await expect(adapter.open({})).rejects.toMatchObject({ kind: 'auth' })
  })

  it('isConfigured() はAPIキーの有無を反映する', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(new OpenAIRealtimeAdapter({ apiKey: 'k', socketFactory: makeFactory().factory }).isConfigured()).toBe(true)
    expect(new OpenAIRealtimeAdapter({ socketFactory: makeFactory().factory }).isConfigured()).toBe(false)
  })
})

describe('gemini アダプタ固有: 未構成時の挙動', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('APIキー未設定で open() すると auth エラーを投げる', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const { factory } = makeFactory()
    const adapter = new GeminiLiveAdapter({ socketFactory: factory })
    await expect(adapter.open({})).rejects.toMatchObject({ kind: 'auth' })
  })
})

// ===== OpenAI 固有: エラー分類・raw escape hatch・interrupt =====

describe('openai アダプタ固有: エラー分類マッピング', () => {
  it('rate_limit_exceeded は rate_limited かつ retryable', async () => {
    const { session, socket } = await openOpenAIReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit(
      'message',
      JSON.stringify({ type: 'error', error: { type: 'api_error', code: 'rate_limit_exceeded', message: 'too many requests' } })
    )
    const event = await promise
    expect(event.type).toBe('error')
    if (event.type === 'error') {
      expect(event.error.kind).toBe('rate_limited')
      expect(event.error.retryable).toBe(true)
    }
  })

  it('insufficient_quota は quota_exhausted かつ failoverable', async () => {
    const { session, socket } = await openOpenAIReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit(
      'message',
      JSON.stringify({ type: 'error', error: { type: 'api_error', code: 'insufficient_quota', message: 'quota exceeded' } })
    )
    const event = await promise
    expect(event.type).toBe('error')
    if (event.type === 'error') {
      expect(event.error.kind).toBe('quota_exhausted')
      expect(event.error.failoverable).toBe(true)
    }
  })
})

describe('openai アダプタ固有: 異常クローズのマッピング（H2）', () => {
  it('reason に session expired 相当の文言が含まれると session_expired として観測できる', async () => {
    const { session, socket } = await openOpenAIReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit('close', 1001, 'session expired after 60 minutes')
    const event = await promise
    expect(event.type).toBe('error')
    if (event.type === 'error') {
      expect(event.error.kind).toBe('session_expired')
    }
  })
})

describe('openai アダプタ固有: transcription 配線（H3）', () => {
  it('transcription: true を指定すると session.update に audio.input.transcription が含まれる', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({ transcription: true })
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const sessionUpdate = JSON.parse(socket.sent[0]!) as { session: { audio: { input: { transcription?: { model: string } } } } }
    expect(sessionUpdate.session.audio.input.transcription?.model).toBeTruthy()
    socket.emit('message', JSON.stringify({ type: 'session.updated', session: {} }))
    await sessionPromise
  })

  it('transcription 未指定では session.update に audio.input.transcription を含めない', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({})
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const sessionUpdate = JSON.parse(socket.sent[0]!) as { session: { audio: { input: { transcription?: unknown } } } }
    expect(sessionUpdate.session.audio.input.transcription).toBeUndefined()
    socket.emit('message', JSON.stringify({ type: 'session.updated', session: {} }))
    await sessionPromise
  })

  it('conversation.item.input_audio_transcription.completed が user transcript として届く', async () => {
    const { session, socket } = await openOpenAIReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit(
      'message',
      JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'こんにちは' })
    )
    const event = await promise
    expect(event.type).toBe('transcript')
    if (event.type === 'transcript') {
      expect(event.role).toBe('user')
      expect(event.text).toBe('こんにちは')
      expect(event.final).toBe(true)
    }
  })
})

describe('openai アダプタ固有: raw escape hatch', () => {
  it('正規化しきれないイベントは raw として素通しする', async () => {
    const { session, socket } = await openOpenAIReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit('message', JSON.stringify({ type: 'rate_limits.updated', rate_limits: [{ name: 'requests', remaining: 100 }] }))
    const event = await promise
    expect(event.type).toBe('raw')
    if (event.type === 'raw') {
      expect((event.providerEvent as { type: string }).type).toBe('rate_limits.updated')
    }
  })
})

describe('openai アダプタ固有: interrupt()', () => {
  it('response.cancel と input_audio_buffer.clear の両方を送出する', async () => {
    const { session, socket } = await openOpenAIReadySession()
    const before = socket.sent.length
    session.interrupt()
    const sentTypes = socket.sent.slice(before).map((raw) => (JSON.parse(raw) as { type: string }).type)
    expect(sentTypes).toContain('response.cancel')
    expect(sentTypes).toContain('input_audio_buffer.clear')
  })
})

describe('openai アダプタ固有: interrupt() の conversation.item.truncate 送出（H4）', () => {
  it('opts 省略時は truncate を送らない（cancel + clear のみ）', async () => {
    const { session, socket } = await openOpenAIReadySession()
    const before = socket.sent.length
    session.interrupt()
    const sentTypes = socket.sent.slice(before).map((raw) => (JSON.parse(raw) as { type: string }).type)
    expect(sentTypes).not.toContain('conversation.item.truncate')
  })

  it('itemId と audioEndMs を両方指定すると conversation.item.truncate を追加送出する', async () => {
    const { session, socket } = await openOpenAIReadySession()
    const before = socket.sent.length
    session.interrupt({ itemId: 'item-1', audioEndMs: 1200 })
    const sent = socket.sent.slice(before).map((raw) => JSON.parse(raw) as Record<string, unknown>)
    const truncate = sent.find((m) => m['type'] === 'conversation.item.truncate')
    expect(truncate).toMatchObject({ item_id: 'item-1', content_index: 0, audio_end_ms: 1200 })
  })

  it('itemId のみ（audioEndMs 省略）では truncate を送らない', async () => {
    const { session, socket } = await openOpenAIReadySession()
    const before = socket.sent.length
    session.interrupt({ itemId: 'item-1' })
    const sentTypes = socket.sent.slice(before).map((raw) => (JSON.parse(raw) as { type: string }).type)
    expect(sentTypes).not.toContain('conversation.item.truncate')
  })
})

describe('openai アダプタ固有: reasoningEffort 配線（世代ゲートされたノブ）', () => {
  it('reasoningEffort 指定時は session.update に reasoning.effort として反映される', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({ reasoningEffort: 'low' })
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const sessionUpdate = JSON.parse(socket.sent[0]!) as { session: { reasoning?: { effort: string } } }
    expect(sessionUpdate.session.reasoning?.effort).toBe('low')
    socket.emit('message', JSON.stringify({ type: 'session.updated', session: {} }))
    await sessionPromise
  })

  it('reasoningEffort 未指定では session.update に reasoning を含めない（暗黙 default 禁止）', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({})
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const sessionUpdate = JSON.parse(socket.sent[0]!) as { session: { reasoning?: unknown } }
    expect(sessionUpdate.session.reasoning).toBeUndefined()
    socket.emit('message', JSON.stringify({ type: 'session.updated', session: {} }))
    await sessionPromise
  })

  it('capabilities().reasoningEffortLevels は xhigh を含む5段階', () => {
    const adapter = new OpenAIRealtimeAdapter({ apiKey: 'k', socketFactory: makeFactory().factory })
    expect(adapter.capabilities().reasoningEffortLevels).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
  })
})

describe('openai アダプタ固有: VAD 設定の配線', () => {
  it('semantic_vad を指定すると session.update に turn_detection として反映される', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new OpenAIRealtimeAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({ vad: { mode: 'semantic_vad', eagerness: 'high' } })
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const sessionUpdate = JSON.parse(socket.sent[0]!) as { session: { audio: { input: { turn_detection?: { type: string; eagerness: string } } } } }
    expect(sessionUpdate.session.audio.input.turn_detection?.type).toBe('semantic_vad')
    expect(sessionUpdate.session.audio.input.turn_detection?.eagerness).toBe('high')
    socket.emit('message', JSON.stringify({ type: 'session.updated', session: {} }))
    await sessionPromise
  })
})

// ===== Gemini 固有: ダウンサンプル・tools 非正規化・resumption capability =====

describe('gemini アダプタ固有: 24kHz→16kHz ダウンサンプル', () => {
  it('geminiDownsampleCodec は 24kHz 6サンプルを 16kHz 4サンプルに変換する', () => {
    const pcm24k = Buffer.alloc(12)
    for (let i = 0; i < 6; i++) pcm24k.writeInt16LE(3000, i * 2)
    const out = geminiDownsampleCodec.toCanonical(new Uint8Array(pcm24k))
    expect(out.length).toBe(8) // 4 samples * 2 bytes
  })

  it('空バッファを処理できる', () => {
    const out = geminiDownsampleCodec.toCanonical(new Uint8Array(0))
    expect(out.length).toBe(0)
  })

  it('fromCanonical は16kHz入力をパススルーする（Gemini入力は正準フォーマットと一致）', () => {
    const pcm16k = new Uint8Array([1, 2, 3, 4])
    expect(geminiDownsampleCodec.fromCanonical(pcm16k)).toBe(pcm16k)
  })
})

describe('gemini アダプタ固有: tools 非正規化', () => {
  it('tools は functionDeclarations 形状のままプロバイダに渡す（意図的な非正規化）', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
    const tools = [{ functionDeclarations: [{ name: 'get_weather', description: 'Get weather' }] }]
    const sessionPromise = adapter.open({ tools })
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const setupMsg = JSON.parse(socket.sent[0]!) as { setup: { tools?: unknown[] } }
    expect(setupMsg.setup.tools).toEqual(tools)
    socket.emit('message', JSON.stringify({ setupComplete: {} }))
    await sessionPromise
  })
})

describe('gemini アダプタ固有: transcription 配線（H3）', () => {
  it('transcription: true を指定すると setup に inputAudioTranscription/outputAudioTranscription が含まれる', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({ transcription: true })
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const setupMsg = JSON.parse(socket.sent[0]!) as { setup: { inputAudioTranscription?: unknown; outputAudioTranscription?: unknown } }
    expect(setupMsg.setup.inputAudioTranscription).toBeDefined()
    expect(setupMsg.setup.outputAudioTranscription).toBeDefined()
    socket.emit('message', JSON.stringify({ setupComplete: {} }))
    await sessionPromise
  })

  it('outputTranscription が assistant transcript として届く', async () => {
    const { session, socket } = await openGeminiReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit('message', JSON.stringify({ serverContent: { outputTranscription: { text: 'hello' } } }))
    const event = await promise
    expect(event.type).toBe('transcript')
    if (event.type === 'transcript') {
      expect(event.role).toBe('assistant')
      expect(event.text).toBe('hello')
    }
  })
})

describe('gemini アダプタ固有: reasoningEffort 配線（thinkingLevel への写像と xhigh 拒否）', () => {
  it('reasoningEffort 指定時は setup の generationConfig.thinkingConfig.thinkingLevel として反映される', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({ reasoningEffort: 'medium' })
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const setupMsg = JSON.parse(socket.sent[0]!) as { setup: { generationConfig: { thinkingConfig?: { thinkingLevel: string } } } }
    expect(setupMsg.setup.generationConfig.thinkingConfig?.thinkingLevel).toBe('medium')
    socket.emit('message', JSON.stringify({ setupComplete: {} }))
    await sessionPromise
  })

  it('reasoningEffort 未指定では setup に thinkingConfig を含めない（暗黙 default 禁止）', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
    const sessionPromise = adapter.open({})
    await new Promise((r) => setTimeout(r, 10))
    const socket = sockets[0]!
    const setupMsg = JSON.parse(socket.sent[0]!) as { setup: { generationConfig: { thinkingConfig?: unknown } } }
    expect(setupMsg.setup.generationConfig.thinkingConfig).toBeUndefined()
    socket.emit('message', JSON.stringify({ setupComplete: {} }))
    await sessionPromise
  })

  it('xhigh（非対応レベル）は接続前に unsupported かつ failoverable で reject する', async () => {
    const { factory, sockets } = makeFactory()
    const adapter = new GeminiLiveAdapter({ apiKey: 'test-key', socketFactory: factory })
    await expect(adapter.open({ reasoningEffort: 'xhigh' })).rejects.toMatchObject({
      kind: 'unsupported',
      failoverable: true,
    })
    // 拒否は接続前に行われる（ソケットを一切張らない）。
    expect(sockets.length).toBe(0)
  })

  it('capabilities().reasoningEffortLevels は xhigh を含まない4段階（OpenAI との非対称）', () => {
    const adapter = new GeminiLiveAdapter({ apiKey: 'k', socketFactory: makeFactory().factory })
    expect(adapter.capabilities().reasoningEffortLevels).toEqual(['minimal', 'low', 'medium', 'high'])
  })
})

describe('gemini アダプタ固有: capabilities の非対称性', () => {
  it('sessionResumption は true、bargeIn は serverAuto=true/clientCancel=false（OpenAI との非対称の実例）', () => {
    const adapter = new GeminiLiveAdapter({ apiKey: 'k', socketFactory: makeFactory().factory })
    const caps = adapter.capabilities()
    expect(caps.sessionResumption).toBe(true)
    expect(caps.bargeIn).toEqual({ serverAuto: true, clientCancel: false })
    expect(caps.directRelayFormats).toEqual([])
  })
})

describe('gemini アダプタ固有: interrupt() は clientCancel 非対応（誤実装だった activityEnd の撤去）', () => {
  it('interrupt() は kind: unsupported の RealtimeVoiceError を投げる', async () => {
    const { session, socket } = await openGeminiReadySession()
    const before = socket.sent.length
    let thrown: unknown
    try {
      session.interrupt()
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RealtimeVoiceError)
    expect((thrown as RealtimeVoiceError).kind).toBe('unsupported')
    // activityEnd 等、誤った疑似対応のメッセージは一切送出しない。
    expect(socket.sent.length).toBe(before)
  })
})

describe('gemini アダプタ固有: sendToolResult() の name 補完・非オブジェクト結果のラップ', () => {
  it('tool.call で受け取った name を functionResponses に含める', async () => {
    const { session, socket } = await openGeminiReadySession()
    await nextEvent(session) // session.ready を読み捨て
    emitGeminiToolCall(socket, 'call-1', 'get_weather')
    await nextEvent(session) // tool.call を読み捨て
    const before = socket.sent.length
    session.sendToolResult('call-1', { ok: true })
    const sent = JSON.parse(socket.sent[before]!) as {
      toolResponse: { functionResponses: Array<{ id: string; name: string; response: unknown }> }
    }
    expect(sent.toolResponse.functionResponses[0]?.id).toBe('call-1')
    expect(sent.toolResponse.functionResponses[0]?.name).toBe('get_weather')
    expect(sent.toolResponse.functionResponses[0]?.response).toEqual({ ok: true })
  })

  it('非オブジェクトの結果は { result } に包んで送出する', async () => {
    const { session, socket } = await openGeminiReadySession()
    await nextEvent(session)
    emitGeminiToolCall(socket, 'call-2', 'get_temperature')
    await nextEvent(session)
    const before = socket.sent.length
    session.sendToolResult('call-2', 42)
    const sent = JSON.parse(socket.sent[before]!) as { toolResponse: { functionResponses: Array<{ response: unknown }> } }
    expect(sent.toolResponse.functionResponses[0]?.response).toEqual({ result: 42 })
  })
})

describe('gemini アダプタ固有: interrupted は正常系イベント', () => {
  it('serverContent.interrupted は error でなく speech.started として届く', async () => {
    const { session, socket } = await openGeminiReadySession()
    await nextEvent(session) // session.ready を読み捨て
    const promise = nextEvent(session)
    socket.emit('message', JSON.stringify({ serverContent: { interrupted: true } }))
    const event = await promise
    expect(event.type).toBe('speech.started')
  })
})
