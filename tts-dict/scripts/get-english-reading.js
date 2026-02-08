#!/usr/bin/env node
/**
 * English Word Katakana Reading Generator
 *
 * LLM API経由で英単語の日本語読み（カタカナ）を取得する。
 * Z.ai (primary) → OpenRouter (fallback) のデュアルAPI対応。
 */

import "dotenv/config";
import OpenAI from "openai";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { words: [], json: null, file: null, output: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--json":
        options.json = args[++i];
        break;
      case "--file":
        options.file = args[++i];
        break;
      case "--output":
        options.output = args[++i];
        break;
      case "--help":
        console.log(`
English Word Katakana Reading Generator

Usage:
  node get-english-reading.js <word1> [word2] ...
  node get-english-reading.js --json '["word1", "word2"]'
  node get-english-reading.js --file <words.txt>

Options:
  --json <array>    Words as JSON array
  --file <path>     Word list file (one per line)
  --output <path>   Output file path (default: stdout)
  --help            Show this help

Output: JSON array of { word, yomi } objects

Environment:
  ZAI_API_KEY          Z.ai API key (primary)
  OPENROUTER_API_KEY   OpenRouter API key (fallback)
`);
        process.exit(0);
      default:
        if (!args[i].startsWith("--")) {
          options.words.push(args[i]);
        }
    }
  }
  return options;
}

const zaiApiKey = process.env.ZAI_API_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

const zaiClient = zaiApiKey
  ? new OpenAI({
      apiKey: zaiApiKey,
      baseURL: "https://api.z.ai/api/coding/paas/v4",
    })
  : null;

const openRouterClient = openRouterApiKey
  ? new OpenAI({
      apiKey: openRouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://github.com/haboshi/claude-code-skills",
        "X-Title": "TTS Dictionary English Reading",
      },
    })
  : null;

function buildPrompt(words) {
  return `以下の英単語・略語・ブランド名の日本語での読み方（カタカナ）を教えてください。

## ルール
- 一般的な日本語での発音をカタカナで出力
- 略語（API, SDK）はアルファベット読み（エーピーアイ）
- ブランド名・製品名は日本で一般的な呼び方
- 技術用語は業界で広く使われている読み方
- JSON配列形式のみ出力（余計な説明不要）

## 入力
${JSON.stringify(words)}

## 出力形式（これだけを出力）
[
  { "word": "入力単語1", "yomi": "カタカナ読み1" },
  { "word": "入力単語2", "yomi": "カタカナ読み2" }
]`;
}

async function callZaiApi(prompt) {
  if (!zaiClient) throw new Error("Z.ai API key not configured");

  console.error("[Z.ai] Requesting...");
  const start = Date.now();

  const completion = await zaiClient.chat.completions.create({
    model: "glm-4.7",
    messages: [
      { role: "system", content: "あなたは英単語の日本語読みを正確に出力するアシスタントです。指定されたJSON形式のみを出力してください。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
  });

  console.error(`[Z.ai] Success (${Date.now() - start}ms)`);
  return completion.choices[0]?.message?.content?.trim();
}

async function callOpenRouterApi(prompt) {
  if (!openRouterClient) throw new Error("OpenRouter API key not configured");

  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-haiku";
  console.error(`[OpenRouter] Requesting ${model}...`);
  const start = Date.now();

  const completion = await openRouterClient.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "あなたは英単語の日本語読みを正確に出力するアシスタントです。指定されたJSON形式のみを出力してください。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
  });

  console.error(`[OpenRouter] Success (${Date.now() - start}ms)`);
  return completion.choices[0]?.message?.content?.trim();
}

function extractJson(response) {
  const jsonMatch =
    response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    response.match(/(\[[\s\S]*\])/);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // Fall through to try full parse
    }
  }

  try {
    return JSON.parse(response);
  } catch (e) {
    console.error("JSON parse error:", e.message);
    console.error("Response:", response);
    throw new Error("Failed to parse API response as JSON");
  }
}

async function main() {
  const options = parseArgs();

  let words = [...options.words];

  if (options.json) {
    try {
      const parsed = JSON.parse(options.json);
      if (Array.isArray(parsed)) words.push(...parsed);
    } catch (e) {
      console.error("Failed to parse --json:", e.message);
      process.exit(1);
    }
  }

  if (options.file) {
    const filePath = resolve(options.file);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    const content = readFileSync(filePath, "utf-8");
    const fileWords = content.split("\n").map((w) => w.trim()).filter((w) => w && !w.startsWith("#"));
    words.push(...fileWords);
  }

  words = [...new Set(words)];

  if (words.length === 0) {
    console.error("Error: No words specified");
    process.exit(1);
  }

  if (!zaiApiKey && !openRouterApiKey) {
    console.error("Error: ZAI_API_KEY or OPENROUTER_API_KEY is required");
    process.exit(1);
  }

  console.error(`[Input] ${words.length} words: ${words.join(", ")}`);

  const prompt = buildPrompt(words);
  let response = null;

  if (zaiClient) {
    try {
      response = await callZaiApi(prompt);
    } catch (error) {
      console.error(`[Z.ai] Failed: ${error?.message}`);
      if (openRouterClient) {
        response = await callOpenRouterApi(prompt);
      } else {
        throw error;
      }
    }
  } else if (openRouterClient) {
    response = await callOpenRouterApi(prompt);
  }

  if (!response) {
    console.error("Error: No response from API");
    process.exit(1);
  }

  const result = extractJson(response);

  if (options.output) {
    writeFileSync(resolve(options.output), JSON.stringify(result, null, 2));
    console.error(`Output: ${options.output}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
