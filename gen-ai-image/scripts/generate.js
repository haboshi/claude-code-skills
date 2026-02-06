#!/usr/bin/env node
/**
 * gen-ai-image - fal.ai GPT Image 1.5 Generator
 *
 * fal.aiのGPT Image 1.5モデルを使用してAI画像を生成。
 * シンプルモード（CLIオプション直接指定）と
 * 詳細モード（--detailed フラグでパラメータ説明出力）に対応。
 */

import { config as dotenvConfig } from "dotenv";
import { fal } from "@fal-ai/client";
import { writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "fs";
import { dirname, resolve, extname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env resolution: plugin root -> cwd -> home
const envPaths = [
  resolve(__dirname, "../.env"),
  resolve(process.cwd(), ".env"),
  resolve(process.env.HOME || "", ".env"),
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    break;
  }
}

// Valid sizes
const VALID_SIZES = {
  "1024x1024": "Square (1:1)",
  "1536x1024": "Landscape (3:2)",
  "1024x1536": "Portrait (2:3)",
};

// Quality descriptions
const QUALITY_DESC = {
  low: "Fast generation, good for references and drafts",
  medium: "Balanced quality, good for labeled/detailed images",
  high: "Maximum quality, best for Japanese text/complex details",
};

function showHelp() {
  console.log(`
gen-ai-image - fal.ai GPT Image 1.5 Generator

Usage:
  node generate.js --prompt <text> --output <path> [options]

Required:
  -p, --prompt <text>   Image generation prompt
  -o, --output <path>   Output file path (PNG)

Options:
  -s, --size <size>     Image size (default: 1536x1024)
  -q, --quality <level> Quality: low, medium, high (default: low)
  --detailed            Show parameter guide for interactive mode
  --help                Show this help message

Sizes:
  1024x1024  Square (1:1)
  1536x1024  Landscape (3:2) - default
  1024x1536  Portrait (2:3)

Quality:
  low     Fast, good for references
  medium  Balanced, good for labeled images
  high    Maximum, best for Japanese text

Environment:
  FAL_AI_API_KEY  fal.ai API key (required, from .env or env var)

Examples:
  node generate.js -p "A sunset over mountains" -o ./output.png
  node generate.js -p "Cat portrait" -o ./cat.png -s 1024x1024 -q medium
  node generate.js --detailed
`);
}

function showDetailedGuide() {
  console.log(`
=== gen-ai-image 詳細モード ===

このガイドはClaude等のAIアシスタントがAskUserQuestion等で
ユーザーに最適なパラメータを対話的に確認するための情報です。

## サイズ選択ガイド
`);

  for (const [size, desc] of Object.entries(VALID_SIZES)) {
    console.log(`  ${size}  ${desc}`);
  }

  console.log(`
  用途別推奨:
    ブログアイキャッチ/OGP  → 1536x1024 (Landscape)
    SNS投稿/アイコン        → 1024x1024 (Square)
    スマホ壁紙/縦長バナー   → 1024x1536 (Portrait)

## 品質選択ガイド
`);

  for (const [quality, desc] of Object.entries(QUALITY_DESC)) {
    console.log(`  ${quality.padEnd(8)} ${desc}`);
  }

  console.log(`
  用途別推奨:
    ラフ/参考画像    → low (速い、コスト低)
    説明画像/ラベル  → medium (バランス良い)
    日本語テキスト多 → high (最高品質)

## プロンプトのコツ

  1. 具体的に描写する（色、構図、スタイル、雰囲気）
  2. 英語プロンプトが品質が高い傾向
  3. ネガティブ指定は非対応（不要要素の除外は文章で工夫）
  4. スタイル指定例: "digital art", "watercolor", "photorealistic", "flat illustration"

## 対話フロー例

  1. ユーザーに画像の用途・内容を確認
  2. サイズを提案（用途から推奨を選択）
  3. 品質を提案（内容の複雑さから判断）
  4. プロンプトをユーザーと一緒に作成
  5. 生成実行
`);
}

async function generateImage(prompt, size, quality) {
  const apiKey = process.env.FAL_AI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FAL_AI_API_KEY is not set.\n" +
        "Set it in .env file or as environment variable.\n" +
        "Get your API key at: https://fal.ai/dashboard/keys"
    );
  }

  fal.config({ credentials: apiKey });

  console.log("Generating image with fal.ai GPT Image 1.5...");
  console.log(`  Size: ${size} (${VALID_SIZES[size]})`);
  console.log(`  Quality: ${quality} (${QUALITY_DESC[quality]})`);
  console.log(
    `  Prompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}`
  );

  const result = await fal.subscribe("fal-ai/gpt-image-1.5", {
    input: {
      prompt,
      image_size: size,
      quality,
    },
  });

  const images = result.data?.images || result.images;
  if (!images || images.length === 0) {
    throw new Error("No image was generated. The API returned empty result.");
  }

  return images[0].url;
}

const MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_REDIRECTS = 5;

// SSRF保護: プライベート/ループバック/リンクローカル/予約済みIP範囲
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
  /^0+\d/,        // 8進数表記 (0177.x.x.x)
  /^\d{4,}$/,     // 10進数表記 (2130706433)
];

const BLOCKED_HOSTS = new Set(["localhost", "[::1]", "[::]"]);

/**
 * 画像URLの安全性を検証する（SSRF保護）
 * @param {string} url
 * @throws {Error} 安全でないURLの場合
 */
export function validateImageUrl(url) {
  if (!url) {
    throw new Error("URLが指定されていません");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`無効なURLです: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`HTTPSのみ許可されています: ${url}`);
  }

  const hostname = parsed.hostname;

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`ブロックされたホストです: ${hostname}`);
  }

  // IPv6アドレスのチェック（Node.js URL はブラケット付きで返す: [::1]）
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const bare = hostname.slice(1, -1).toLowerCase();

    // IPv4-mapped IPv6: Node.js は ::ffff:127.0.0.1 を ::ffff:7f00:1 に正規化する
    // ドット表記形式
    const dottedMatch = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dottedMatch) {
      const ipv4Part = dottedMatch[1];
      for (const pattern of PRIVATE_IP_RANGES) {
        if (pattern.test(ipv4Part)) {
          throw new Error(`ブロックされたIPv4マップドIPv6アドレスです: ${hostname}`);
        }
      }
      return;
    }
    // 16進数形式 (::ffff:7f00:1 = 127.0.0.1, ::ffff:a00:1 = 10.0.0.1 等)
    const hexMatch = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const o1 = (hi >> 8) & 0xff;
      const o2 = hi & 0xff;
      const o3 = (lo >> 8) & 0xff;
      const o4 = lo & 0xff;
      const ipv4Str = `${o1}.${o2}.${o3}.${o4}`;
      for (const pattern of PRIVATE_IP_RANGES) {
        if (pattern.test(ipv4Str)) {
          throw new Error(`ブロックされたIPv4マップドIPv6アドレスです: ${hostname} (${ipv4Str})`);
        }
      }
      return;
    }

    // 6to4 tunneling (2002::/16) — 内包するIPv4にルーティングされる
    if (bare.startsWith("2002:")) {
      throw new Error(`ブロックされた6to4 IPv6アドレスです: ${hostname}`);
    }
    // Teredo tunneling (2001:0000::/32)
    if (bare.startsWith("2001:0:") || bare.startsWith("2001:0000:")) {
      throw new Error(`ブロックされたTeredo IPv6アドレスです: ${hostname}`);
    }
    // マルチキャスト (ff00::/8)
    if (bare.startsWith("ff")) {
      throw new Error(`ブロックされたマルチキャストIPv6アドレスです: ${hostname}`);
    }
    // その他のIPv6パターン
    if (
      bare === "::1" ||
      bare.startsWith("fe80:") ||
      bare.startsWith("fc") ||
      bare.startsWith("fd") ||
      bare === "::"
    ) {
      throw new Error(`ブロックされたIPv6アドレスです: ${hostname}`);
    }
    return;
  }

  // IPv4アドレスチェック
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(hostname)) {
      throw new Error(`プライベートIPアドレスへのアクセスは禁止されています: ${hostname}`);
    }
  }
}

async function downloadAndSave(imageUrl, outputPath) {
  validateImageUrl(imageUrl);

  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  // リダイレクト手動制御
  let currentUrl = imageUrl;
  let response;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const rawLocation = response.headers.get("location");
      if (!rawLocation) {
        throw new Error("リダイレクト先URLが取得できません");
      }
      // 相対URLを絶対URLに解決
      const redirectUrl = new URL(rawLocation, currentUrl).href;
      validateImageUrl(redirectUrl);
      currentUrl = redirectUrl;
      continue;
    }
    break;
  }

  // リダイレクト上限超過チェック
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`リダイレクト回数が上限(${MAX_REDIRECTS})を超えました`);
  }

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  // サイズ事前チェック
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
    throw new Error(`ファイルサイズが上限(${MAX_DOWNLOAD_SIZE} bytes)を超えています`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_DOWNLOAD_SIZE) {
    throw new Error(`ダウンロードサイズが上限(${MAX_DOWNLOAD_SIZE} bytes)を超えました`);
  }

  // アトミック書き込み（tmpファイル→rename）
  const tmpPath = resolve(outputDir, `.tmp-${randomBytes(8).toString("hex")}${extname(outputPath)}`);
  try {
    writeFileSync(tmpPath, buffer);
    renameSync(tmpPath, outputPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // cleanup best-effort
    }
    throw err;
  }

  const sizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`Image saved: ${outputPath} (${sizeKB} KB)`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      output: { type: "string", short: "o" },
      size: { type: "string", short: "s", default: "1536x1024" },
      quality: { type: "string", short: "q", default: "low" },
      detailed: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.detailed) {
    showDetailedGuide();
    process.exit(0);
  }

  if (!values.prompt) {
    console.error("Error: --prompt is required");
    showHelp();
    process.exit(1);
  }

  if (!values.output) {
    console.error("Error: --output is required");
    showHelp();
    process.exit(1);
  }

  // Validate size
  if (!VALID_SIZES[values.size]) {
    console.error(`Error: Invalid size '${values.size}'`);
    console.error(`Valid options: ${Object.keys(VALID_SIZES).join(", ")}`);
    process.exit(1);
  }

  // Validate quality
  if (!QUALITY_DESC[values.quality]) {
    console.error(`Error: Invalid quality '${values.quality}'`);
    console.error(`Valid options: ${Object.keys(QUALITY_DESC).join(", ")}`);
    process.exit(1);
  }

  // Ensure output has extension
  let outputPath = resolve(values.output);
  if (!extname(outputPath)) {
    outputPath += ".png";
  }

  try {
    const imageUrl = await generateImage(values.prompt, values.size, values.quality);
    await downloadAndSave(imageUrl, outputPath);
    console.log("\nImage generation completed successfully!");
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

// テスト時のimportで自動実行しないようガード
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main();
}
