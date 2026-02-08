#!/usr/bin/env node
/**
 * Batch TTS Script
 *
 * JSON形式で複数の話者とテキストから音声を一括生成。
 * プロバイダ抽象化により COEIROINK / VOICEVOX に対応。
 * オプションで結合した1ファイルも出力可能。
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { concatWavFiles } from "./concat-wav.js";
import { createProvider } from "./provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Speaker name → file ID mapping (fallback)
const SPEAKER_FILE_ID = {
  "つくよみちゃん": "tsukuyomi",
  tsukuyomi: "tsukuyomi",
  "AI声優-銀芽": "ginga",
  ginga: "ginga",
};

/**
 * Clean text for TTS (remove brackets, normalize whitespace).
 */
function cleanTextForTts(text) {
  return text
    .replace(/[「」『』【】〈〉《》〔〕［］｛｝()（）[\]{}]/g, "")
    .replace(/[/\\／＼]/g, " ")
    .replace(/[!！]{2,}/g, "！")
    .replace(/[?？]{2,}/g, "？")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve speaker name using speaker map.
 */
function resolveTtsName(speaker, speakerMap) {
  const mapped = speakerMap[speaker.toLowerCase()];
  if (mapped?.ttsName) {
    return mapped.ttsName;
  }
  return speaker;
}

/**
 * Resolve file ID for output filename.
 */
function resolveFileId(speaker, speakerMap) {
  const mapped = speakerMap[speaker.toLowerCase()];
  if (mapped?.fileId) {
    return mapped.fileId;
  }
  return (
    SPEAKER_FILE_ID[speaker] ||
    speaker.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_")
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    concat: false,
    concatName: "combined.wav",
    indices: null,
    provider: "coeiroink",
    apiBase: null,
    speakerMap: null,
    voice: null,
    instructions: null,
    model: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
        options.input = args[++i];
        break;
      case "--concat":
        options.concat = true;
        break;
      case "--concat-name":
        options.concatName = args[++i];
        break;
      case "--indices":
        options.indices = args[++i].split(",").map((n) => parseInt(n.trim(), 10));
        break;
      case "--provider":
        options.provider = args[++i];
        break;
      case "--api-base":
        options.apiBase = args[++i];
        break;
      case "--speaker-map":
        options.speakerMap = args[++i];
        break;
      case "--voice":
        options.voice = args[++i];
        break;
      case "--instructions":
        options.instructions = args[++i];
        break;
      case "--model":
        options.model = args[++i];
        break;
      case "--help":
        showHelp();
        process.exit(0);
    }
  }
  return options;
}

function showHelp() {
  console.log(`
Batch TTS Generator

Usage:
  node batch-tts.js --input <json-file> [options]

Options:
  --input <path>         Input JSON file (required)
  --concat               Concatenate all generated files
  --concat-name <name>   Combined file name (default: combined.wav)
  --indices <list>       Regenerate specific segments (1-based, comma-separated)
                         e.g., --indices 1,5,10
  --provider <name>      TTS provider: coeiroink, voicevox, openai (default: coeiroink)
  --api-base <url>       API base URL override
  --speaker-map <path>   Speaker map JSON file
  --help                 Show this help message

OpenAI TTS Options:
  --voice <name>         OpenAI voice (alloy, ash, ballad, coral, echo, fable,
                         nova, onyx, sage, shimmer, verse, marin, cedar)
                         Default: nova
  --instructions <text>  Style instructions for OpenAI TTS
                         e.g., "Speak in a warm, friendly tone"
  --model <name>         OpenAI TTS model (default: gpt-4o-mini-tts)

Speakers (COEIROINK):
  tsukuyomi  つくよみちゃん (default)
  ginga      AI声優-銀芽

Voices (OpenAI):
  alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar

JSON format:
{
  "segments": [
    { "speaker": "tsukuyomi", "text": "こんにちは", "speed": 1.3 },
    { "speaker": "ginga", "text": "はじめまして", "speed": 1.3 }
  ],
  "outputDir": "./output",
  "concat": true,
  "concatName": "dialogue.wav"
}

JSON format (OpenAI):
{
  "segments": [
    { "speaker": "nova", "text": "こんにちは", "speed": 1.0, "instructions": "Speak cheerfully" },
    { "speaker": "onyx", "text": "はじめまして", "speed": 1.0 }
  ],
  "outputDir": "./output",
  "voice": "nova",
  "instructions": "Speak in a natural, conversational Japanese tone"
}

Speaker map JSON (optional):
{
  "narrator": { "ttsName": "つくよみちゃん", "fileId": "narrator" },
  "expert": { "ttsName": "AI声優-銀芽", "fileId": "expert" }
}

Output structure:
  outputDir/
  ├── parts/           # Individual audio files
  │   ├── 001_tsukuyomi.wav
  │   └── 002_ginga.wav
  ├── combined.wav     # Combined file (with --concat)
  └── summary.json     # Generation summary

Environment variables:
  OPENAI_API_KEY         Required for --provider openai
`);
}

async function loadSpeakerMap(mapPath) {
  if (!mapPath) return {};
  try {
    const content = await readFile(mapPath, "utf-8");
    return JSON.parse(content);
  } catch {
    console.warn(`Warning: Could not load speaker map: ${mapPath}`);
    return {};
  }
}

async function main() {
  const options = parseArgs();

  if (!options.input) {
    console.error("Error: --input is required");
    showHelp();
    process.exit(1);
  }

  try {
    // Load speaker map
    const speakerMap = await loadSpeakerMap(options.speakerMap);

    // Create TTS provider
    const openaiOptions = {
      voice: options.voice,
      model: options.model,
      instructions: options.instructions,
    };
    const provider = createProvider(
      options.provider,
      options.apiBase || undefined,
      openaiOptions
    );

    // Health check
    const healthy = await provider.healthcheck();
    if (!healthy) {
      console.error(`Error: ${provider.name} server is not running.`);
      console.error(`Check that ${provider.name} is running at ${provider.baseUrl}`);
      process.exit(1);
    }

    console.log(`Provider: ${provider.name} (${provider.baseUrl})`);

    // Read JSON input
    console.log(`Loading: ${options.input}`);
    const jsonContent = await readFile(options.input, "utf-8");
    const config = JSON.parse(jsonContent);

    if (!config.segments || !Array.isArray(config.segments)) {
      throw new Error('JSON file must contain a "segments" array');
    }

    const shouldConcat = options.concat || config.concat === true;
    const concatName =
      options.concatName !== "combined.wav"
        ? options.concatName
        : config.concatName || "combined.wav";

    const outputDir = config.outputDir || join(process.cwd(), "tts-output");
    const partsDir = join(outputDir, "parts");

    await mkdir(partsDir, { recursive: true });
    console.log(`Output: ${outputDir}`);
    console.log(`Parts: ${partsDir}\n`);

    // Speaker cache
    const speakerCache = new Map();

    const results = [];
    const generatedFiles = [];
    const targetIndices = options.indices;

    if (targetIndices) {
      console.log(`Regenerating segments: ${targetIndices.join(", ")}\n`);
    }

    const isOpenai = options.provider === "openai";
    const defaultSpeaker = isOpenai ? (options.voice || config.voice || "nova") : "tsukuyomi";
    const defaultSpeed = isOpenai ? 1.0 : 1.3;

    for (let i = 0; i < config.segments.length; i++) {
      const segment = config.segments[i];
      const { speaker = defaultSpeaker, text, speed = defaultSpeed } = segment;

      if (targetIndices && !targetIndices.includes(i + 1)) {
        continue;
      }

      if (!text) {
        console.warn(`Warning: Segment ${i + 1} has no text. Skipping.`);
        continue;
      }

      const ttsName = resolveTtsName(speaker, speakerMap);
      const isMapped = ttsName !== speaker;

      const cleanedText = cleanTextForTts(text);
      const textChanged = text !== cleanedText;

      console.log(`[${i + 1}/${config.segments.length}] Processing...`);
      console.log(`  Speaker: ${speaker}${isMapped ? ` -> ${ttsName}` : ""}`);
      console.log(`  Text: "${text.length > 40 ? text.slice(0, 40) + "..." : text}"`);
      if (textChanged) {
        console.log(`  Cleaned: "${cleanedText.length > 40 ? cleanedText.slice(0, 40) + "..." : cleanedText}"`);
      }
      console.log(`  Speed: ${speed}x`);

      // Get speaker info (cached)
      if (!speakerCache.has(ttsName)) {
        const speakerInfo = await provider.findSpeaker(ttsName);
        speakerCache.set(ttsName, speakerInfo);
      }
      const speakerInfo = speakerCache.get(ttsName);

      // Generate speech
      const synthParams = {
        speakerUuid: speakerInfo.speakerUuid,
        styleId: speakerInfo.styleId,
        speed,
      };
      // OpenAI TTS: pass voice and per-segment/global instructions
      if (options.provider === "openai") {
        synthParams.voice = speakerInfo.speakerName;
        const segmentInstructions = segment.instructions || config.instructions || options.instructions;
        if (segmentInstructions) {
          synthParams.instructions = segmentInstructions;
        }
      }
      const audioData = await provider.synthesize(cleanedText, synthParams);

      // Save file
      const paddedIndex = String(i + 1).padStart(3, "0");
      const fileId = resolveFileId(speaker, speakerMap);
      const filename = `${paddedIndex}_${fileId}.wav`;
      const outputPath = join(partsDir, filename);

      await writeFile(outputPath, Buffer.from(audioData));
      console.log(`  -> parts/${filename}\n`);

      generatedFiles.push(outputPath);
      results.push({
        index: i + 1,
        speaker,
        ttsName: speakerInfo.speakerName,
        text,
        file: `parts/${filename}`,
      });
    }

    // Concatenation
    let combinedFile = null;
    if (shouldConcat && generatedFiles.length > 0) {
      console.log("\n=== Concatenating ===");
      const combinedPath = join(outputDir, concatName);
      await concatWavFiles(generatedFiles, combinedPath);
      combinedFile = concatName;
    }

    // Summary
    console.log("\n=== Complete ===");
    console.log(`Total segments: ${config.segments.length}`);
    console.log(`Generated: ${results.length}`);
    console.log(`Parts: ${partsDir}`);
    if (combinedFile) {
      console.log(`Combined: ${join(outputDir, combinedFile)}`);
    }

    const summary = {
      provider: provider.name,
      totalSegments: config.segments.length,
      generatedFiles: results.length,
      partsDir: "parts/",
      combinedFile,
      segments: results,
    };
    const summaryPath = join(outputDir, "summary.json");
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`Summary: ${summaryPath}`);
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") {
      console.error("\nError: Cannot connect to TTS server.");
      console.error("Check that the TTS engine is running.");
    } else if (error.code === "ENOENT") {
      console.error(`\nError: File not found: ${options.input}`);
    } else if (error instanceof SyntaxError) {
      console.error("\nError: Invalid JSON format");
      console.error(error.message);
    } else {
      console.error("\nError:", error.message);
    }
    process.exit(1);
  }
}

main();
