/**
 * TTS プロバイダ選択・辞書純粋関数のスモークテスト
 *
 * ネットワーク（TTSエンジン / OpenAI API）を一切叩かない範囲で、
 * プロバイダ生成ロジック・SSRF検証・純粋関数を検証する。
 * 実行: node --test scripts/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProvider,
  CoeiroinkProvider,
  VoicevoxProvider,
  OpenaiTtsProvider,
} from "./provider.js";
import { countMoras, generateCaseVariants } from "./dict.js";

// === createProvider: プロバイダ選択ロジック ===

test("createProvider: coeiroink を既定として生成する", () => {
  const provider = createProvider();
  assert.ok(provider instanceof CoeiroinkProvider);
  assert.equal(provider.name, "COEIROINK");
  assert.equal(provider.baseUrl, "http://localhost:50032");
});

test("createProvider: voicevox を生成する", () => {
  const provider = createProvider("voicevox");
  assert.ok(provider instanceof VoicevoxProvider);
  assert.equal(provider.name, "VOICEVOX");
  assert.equal(provider.baseUrl, "http://localhost:50021");
});

test("createProvider: プロバイダ名は大文字小文字を区別しない", () => {
  const provider = createProvider("VOICEVOX");
  assert.ok(provider instanceof VoicevoxProvider);
});

test("createProvider: openai は OPENAI_API_KEY が必要", () => {
  const original = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.throws(() => createProvider("openai"), /OPENAI_API_KEY/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("createProvider: openai は API キーがあれば生成できる", () => {
  const original = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    const provider = createProvider("openai", undefined, { voice: "onyx" });
    assert.ok(provider instanceof OpenaiTtsProvider);
    assert.equal(provider.name, "OpenAI");
    assert.equal(provider.voice, "onyx");
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("createProvider: 未知のプロバイダは例外を投げる", () => {
  assert.throws(() => createProvider("unknown"), /Unknown TTS provider/);
});

// === SSRF 検証: ローカルTTSの --api-base は localhost のみ許可 ===

test("createProvider: coeiroink は localhost の api-base を許可する", () => {
  const provider = createProvider("coeiroink", "http://127.0.0.1:50032");
  assert.equal(provider.baseUrl, "http://127.0.0.1:50032");
});

test("createProvider: coeiroink は非 localhost の api-base を拒否する", () => {
  assert.throws(() => createProvider("coeiroink", "http://evil.example.com"), /localhost/);
});

test("createProvider: voicevox も非 localhost を拒否する", () => {
  assert.throws(() => createProvider("voicevox", "http://10.0.0.1:50021"), /localhost/);
});

// === OpenAI findSpeaker: voice 名の正規化（ネットワーク不要） ===

test("OpenaiTtsProvider.findSpeaker: voice 名を正規化して返す", async () => {
  const original = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    const provider = createProvider("openai");
    const result = await provider.findSpeaker("Nova");
    assert.equal(result.speakerName, "nova");
    assert.equal(result.speakerUuid, "nova");
    assert.equal(result.styleId, 0);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("OpenaiTtsProvider.findSpeaker: 未知の voice は例外を投げる", async () => {
  const original = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    const provider = createProvider("openai");
    await assert.rejects(() => provider.findSpeaker("no-such-voice"), /Unknown OpenAI voice/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

// === 発音辞書の純粋関数 ===

test("countMoras: 拗音・促音を含むモーラ数を数える", () => {
  // カタカナ長 - 小書き文字数 = モーラ数
  assert.equal(countMoras("クロード"), 4);
  assert.equal(countMoras("タイプスクリプト"), 8);
  // "ジャパン" は4文字だが小書きャを1つ差し引き → 3モーラ
  assert.equal(countMoras("ジャパン"), 3);
});

test("generateCaseVariants: 大文字・小文字・Pascal のバリアントを生成する", () => {
  const variants = generateCaseVariants("GitHub");
  assert.ok(variants.includes("GitHub")); // 原型
  assert.ok(variants.includes("github")); // lowercase
  assert.ok(variants.includes("GITHUB")); // UPPERCASE
  assert.ok(variants.includes("Github")); // PascalCase
});
