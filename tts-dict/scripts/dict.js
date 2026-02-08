#!/usr/bin/env node
/**
 * TTS Dictionary Manager
 *
 * 英単語のカタカナ読み辞書の管理CLI。
 * COEIROINK辞書API経由で発音を制御。
 * LLM自動読み取得、手動登録、適用、確認、ヘルスチェックに対応。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DICT_FILE = path.join(__dirname, "../data/dictionary.json");
const GET_READING_SCRIPT = path.join(__dirname, "get-english-reading.js");

// scan コマンド用定数
// 最低3文字の英単語を抽出（2文字 "AI","ML" 等はノイズが多いため意図的に除外）
const ENGLISH_WORD_PATTERN = /[A-Za-z][A-Za-z0-9._-]{1,}[A-Za-z0-9]/g;

const EXCLUDE_WORDS = new Set([
  // JSON構造キー
  "text", "speaker", "segments", "start", "end", "duration", "type",
  "name", "value", "index", "id", "key", "data", "file", "path",
  "style", "volume", "speed", "pitch", "rate", "format",
  // 一般英単語（冠詞・前置詞・接続詞・代名詞等）
  "in", "on", "at", "to", "of", "for", "by", "with", "from",
  "the", "an", "is", "am", "are", "was", "were", "be", "been",
  "it", "he", "she", "we", "you", "they", "me", "us", "him", "her",
  "and", "or", "but", "not", "no", "if", "so", "as", "do", "did",
  "has", "had", "have", "will", "can", "may", "let", "get", "got",
  "all", "any", "each", "own", "new", "old", "one", "two",
  "this", "that", "then", "than", "what", "when", "how", "who",
  "true", "false", "null", "undefined",
  // 話者名（COEIROINK / VOICEVOX）
  "tsukuyomi", "ginga", "zundamon", "shikoku", "metan",
  // ファイルパス・拡張子関連
  "json", "txt", "csv", "wav", "mp3", "mp4", "png", "jpg",
  "http", "https", "www", "com", "org", "net",
  // プログラミング汎用語
  "var", "let", "const", "function", "return", "class",
  "import", "export", "default", "async", "await",
]);

// Default API endpoint (overridable via --api-base)
let API_BASE = "http://127.0.0.1:50032";

/**
 * Count moras in katakana string (simplified).
 */
function countMoras(yomi) {
  const smallKana = /[ャュョッァィゥェォヮ]/g;
  const totalChars = yomi.length;
  const smallCount = (yomi.match(smallKana) || []).length;
  return totalChars - smallCount;
}

/**
 * Convert ASCII to full-width characters.
 */
function toFullWidth(str) {
  return str
    .replace(/[A-Za-z0-9]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0))
    .replace(/\./g, "。");
}

/**
 * Load dictionary with merge conflict detection.
 */
function loadDictionary() {
  if (!fs.existsSync(DICT_FILE)) {
    const dir = path.dirname(DICT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return [];
  }

  const data = fs.readFileSync(DICT_FILE, "utf-8");

  if (data.includes("<<<<<<< ") || data.includes("=======") || data.includes(">>>>>>> ")) {
    console.error("Error: Merge conflict detected in dictionary.json");
    console.error(`File: ${DICT_FILE}`);
    console.error("Fix the conflict markers and ensure valid JSON.");
    process.exit(1);
  }

  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      throw new Error("Dictionary must be a JSON array");
    }
    return parsed;
  } catch (error) {
    console.error("Error: Failed to parse dictionary.json");
    console.error(`File: ${DICT_FILE}`);
    console.error(`Detail: ${error.message}`);
    process.exit(1);
  }
}

function saveDictionary(entries) {
  const dir = path.dirname(DICT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DICT_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

async function applyDictionary(entries) {
  const dictionaryWords = entries.map((entry) => ({
    word: toFullWidth(entry.word),
    yomi: entry.yomi,
    accent: entry.accent || 1,
    numMoras: entry.numMoras,
  }));

  const response = await fetch(`${API_BASE}/v1/set_dictionary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dictionaryWords }),
  });

  if (!response.ok) {
    throw new Error(`Dictionary API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function cmdAdd(word, yomi) {
  if (!word || !yomi) {
    console.error("Usage: dict.js add <word> <yomi>");
    process.exit(1);
  }

  const entries = loadDictionary();
  const numMoras = countMoras(yomi);

  const existingIndex = entries.findIndex((e) => e.word.toLowerCase() === word.toLowerCase());
  const newEntry = { word, yomi, accent: 1, numMoras };

  if (existingIndex >= 0) {
    entries[existingIndex] = newEntry;
    console.log(`Updated: ${word} -> ${yomi} (${numMoras} moras)`);
  } else {
    entries.push(newEntry);
    console.log(`Added: ${word} -> ${yomi} (${numMoras} moras)`);
  }

  saveDictionary(entries);
}

function cmdList() {
  const entries = loadDictionary();

  if (entries.length === 0) {
    console.log("Dictionary is empty.");
    return;
  }

  console.log(`\nDictionary entries (${entries.length}):\n`);
  entries.forEach((entry, index) => {
    const fw = toFullWidth(entry.word);
    console.log(`${index + 1}. ${entry.word} (${fw}) -> ${entry.yomi}`);
    console.log(`   Moras: ${entry.numMoras}, Accent: ${entry.accent}`);
  });
}

async function cmdApply() {
  const entries = loadDictionary();

  if (entries.length === 0) {
    console.log("Dictionary is empty. Nothing to apply.");
    return;
  }

  console.log(`Applying ${entries.length} entries...`);
  await applyDictionary(entries);
  console.log("Dictionary applied successfully.");
}

async function cmdReset() {
  saveDictionary([]);
  console.log("Local dictionary cleared.");

  try {
    await applyDictionary([]);
    console.log("Engine dictionary reset.");
  } catch (error) {
    console.error("Failed to reset engine dictionary:", error.message);
    process.exit(1);
  }
}

async function cmdAutoAdd(words, options = {}) {
  if (!words || words.length === 0) {
    console.error("Usage: dict.js auto-add <word1> [word2] ...");
    console.error("       dict.js auto-add --json '[\"word1\", \"word2\"]'");
    process.exit(1);
  }

  const entries = loadDictionary();
  const existingWords = new Set(entries.map((e) => e.word.toLowerCase()));
  const newWords = words.filter((w) => !existingWords.has(w.toLowerCase()));

  if (newWords.length === 0) {
    console.log("All words are already registered.");
    return;
  }

  console.log(`\nFetching readings for ${newWords.length} words...`);
  console.log(`  Words: ${newWords.join(", ")}`);

  const result = await new Promise((resolve, reject) => {
    const args = ["--json", JSON.stringify(newWords)];
    const child = spawn("node", [GET_READING_SCRIPT, ...args], {
      cwd: __dirname,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`get-english-reading.js exited with code ${code}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`Failed to parse output: ${e.message}\nOutput: ${stdout}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn: ${err.message}`));
    });
  });

  let addedCount = 0;
  let updatedCount = 0;

  for (const item of result) {
    if (!item.word || !item.yomi) continue;

    const numMoras = countMoras(item.yomi);
    const existingIndex = entries.findIndex((e) => e.word.toLowerCase() === item.word.toLowerCase());
    const newEntry = { word: item.word, yomi: item.yomi, accent: 1, numMoras };

    if (existingIndex >= 0) {
      entries[existingIndex] = newEntry;
      updatedCount++;
      console.log(`  Updated: ${item.word} -> ${item.yomi}`);
    } else {
      entries.push(newEntry);
      addedCount++;
      console.log(`  Added: ${item.word} -> ${item.yomi}`);
    }
  }

  saveDictionary(entries);
  console.log(`\nSaved: ${addedCount} added, ${updatedCount} updated`);

  if (options.apply) {
    console.log("\nApplying to engine...");
    await applyDictionary(entries);
    console.log("Dictionary applied.");
  } else {
    console.log('\nTip: Run "dict.js apply" to apply changes to engine');
  }
}

function cmdCheck(words) {
  if (!words || words.length === 0) {
    console.error("Usage: dict.js check <word1> [word2] ...");
    process.exit(1);
  }

  const entries = loadDictionary();
  const existingWords = new Map(entries.map((e) => [e.word.toLowerCase(), e]));

  const registered = [];
  const notRegistered = [];

  for (const word of words) {
    const entry = existingWords.get(word.toLowerCase());
    if (entry) {
      registered.push(entry);
    } else {
      notRegistered.push(word);
    }
  }

  if (registered.length > 0) {
    console.log("\nRegistered:");
    for (const entry of registered) {
      console.log(`  ${entry.word} -> ${entry.yomi}`);
    }
  }

  if (notRegistered.length > 0) {
    console.log("\nNot registered:");
    for (const word of notRegistered) {
      console.log(`  ${word}`);
    }
    console.log("\nNot registered (JSON):");
    console.log(JSON.stringify(notRegistered));
  }
}

async function cmdHealthcheck() {
  console.log("\n=== TTS Dictionary Health Check ===\n");
  let hasError = false;

  // 1. Dictionary file
  console.log("1. Dictionary file...");
  let entries = [];
  try {
    entries = loadDictionary();
    console.log(`   OK: ${entries.length} entries loaded`);
  } catch (error) {
    console.log(`   FAIL: ${error.message}`);
    hasError = true;
  }

  // 2. Engine connection
  console.log("\n2. TTS engine connection...");
  try {
    const response = await fetch(`${API_BASE}/v1/speakers`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      console.log(`   OK: Connected to ${API_BASE}`);
    } else {
      console.log(`   WARN: Error response: ${response.status}`);
      hasError = true;
    }
  } catch {
    console.log(`   FAIL: Cannot connect to ${API_BASE}`);
    hasError = true;
  }

  // 3. Case variations
  console.log("\n3. Case variation check...");
  const lowerCaseMap = new Map();
  const duplicates = [];

  for (const entry of entries) {
    const lower = entry.word.toLowerCase();
    if (lowerCaseMap.has(lower)) {
      duplicates.push({ existing: lowerCaseMap.get(lower), dup: entry.word });
    } else {
      lowerCaseMap.set(lower, entry.word);
    }
  }

  if (duplicates.length > 0) {
    console.log(`   INFO: ${duplicates.length} case variations found`);
    duplicates.slice(0, 5).forEach((d) => console.log(`     "${d.existing}" / "${d.dup}"`));
  } else {
    console.log("   INFO: No case variations");
  }

  // 4. Summary
  console.log("\n" + "=".repeat(40));
  if (hasError) {
    console.log("FAIL: Fix the errors above.");
    process.exit(1);
  } else {
    console.log("OK: Health check passed");
  }
}

/**
 * Extract English words from text, filtering excluded words.
 */
function extractEnglishWords(text) {
  const matches = text.match(ENGLISH_WORD_PATTERN) || [];
  const seen = new Set();
  const results = [];

  for (const word of matches) {
    const lower = word.toLowerCase();
    if (EXCLUDE_WORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    results.push(word);
  }

  return results;
}

/**
 * Extract text content from a dialogue JSON file.
 * Supports both array format [{text: "..."}, ...] and
 * nested format with segments [{segments: [{text: "..."}]}].
 */
function extractTextFromDialogue(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  const texts = [];

  function walk(obj) {
    if (typeof obj === "string") {
      texts.push(obj);
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    if (obj && typeof obj === "object") {
      // text プロパティを収集し、子オブジェクトは再帰探索
      if (typeof obj.text === "string") {
        texts.push(obj.text);
      }
      for (const [key, val] of Object.entries(obj)) {
        if (key === "text") continue; // 既に処理済み
        if (typeof val === "object" && val !== null) {
          walk(val);
        }
      }
    }
  }

  walk(data);
  return texts.join("\n");
}

/**
 * Generate case variants for a word.
 * Returns an array of unique case variations:
 * - Original (as-is)
 * - lowercase
 * - UPPERCASE
 * - PascalCase (first letter capitalized)
 */
function generateCaseVariants(word) {
  const variants = new Set();

  // Original
  variants.add(word);

  // lowercase
  variants.add(word.toLowerCase());

  // UPPERCASE
  variants.add(word.toUpperCase());

  // PascalCase (first letter uppercase, rest lowercase)
  variants.add(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  return [...variants];
}

async function cmdScan(options) {
  let text = "";

  if (options.text) {
    text = options.text;
  } else if (options.input) {
    const inputPath = path.resolve(options.input);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: File not found: ${inputPath}`);
      process.exit(1);
    }

    if (inputPath.endsWith(".json")) {
      try {
        text = extractTextFromDialogue(inputPath);
      } catch (error) {
        console.error(`Error: Failed to parse JSON: ${error.message}`);
        process.exit(1);
      }
    } else {
      text = fs.readFileSync(inputPath, "utf-8");
    }
  } else {
    console.error("Usage: dict.js scan --input <file> | --text <string> [--dry-run] [--apply]");
    process.exit(1);
  }

  // 英単語抽出
  const words = extractEnglishWords(text);

  if (words.length === 0) {
    console.log("No English words found.");
    return;
  }

  console.log(`\nExtracted ${words.length} English words:`);
  console.log(`  ${words.join(", ")}`);

  // 辞書チェック（既登録を除外）
  const entries = loadDictionary();
  const existingWords = new Set(entries.map((e) => e.word.toLowerCase()));
  const newWords = words.filter((w) => !existingWords.has(w.toLowerCase()));

  if (newWords.length === 0) {
    console.log("\nAll extracted words are already registered.");
    return;
  }

  console.log(`\nUnregistered words (${newWords.length}):`);
  console.log(`  ${newWords.join(", ")}`);

  // ケースバリアント生成
  let wordsToRegister = newWords;
  if (options.withCaseVariants) {
    const variantSet = new Set();
    for (const word of newWords) {
      for (const variant of generateCaseVariants(word)) {
        // 既登録チェック
        if (!existingWords.has(variant.toLowerCase())) {
          variantSet.add(variant);
        }
      }
    }
    wordsToRegister = [...variantSet];
    console.log(`\nWith case variants (${wordsToRegister.length}):`);
    console.log(`  ${wordsToRegister.join(", ")}`);
  }

  if (options.dryRun) {
    console.log("\n[dry-run] No changes made.");
    return;
  }

  if (options.apply) {
    // auto-add に委譲（--apply 付き）
    console.log("\nRegistering via auto-add...");
    await cmdAutoAdd(wordsToRegister, { apply: true });
  } else {
    // JSON出力（auto-addへの入力用）
    console.log("\nUnregistered words (JSON for auto-add):");
    console.log(JSON.stringify(wordsToRegister));
    console.log('\nTo register: dict.js auto-add --json \'' + JSON.stringify(wordsToRegister) + "' --apply");
  }
}

async function cmdVerify(words) {
  if (!words || words.length === 0) {
    console.error("Usage: dict.js verify <word1> [word2] ...");
    process.exit(1);
  }

  console.log("\n=== Pronunciation Verification ===\n");

  for (const word of words) {
    try {
      const response = await fetch(`${API_BASE}/v1/estimate_prosody`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: word }),
      });

      if (!response.ok) {
        console.log(`  ${word.padEnd(20)} WARN: API error (${response.status})`);
        continue;
      }

      const result = await response.json();
      const phonemes = result.detail || [];
      const reading = phonemes.flat().map((p) => p.hira || "").join("");

      console.log(`  ${word.padEnd(20)} -> ${reading}`);
    } catch (error) {
      console.log(`  ${word.padEnd(20)} FAIL: ${error.message}`);
    }
  }

  console.log("\nIf pronunciation is incorrect, register with: dict.js add <word> <yomi>");
}

async function main() {
  const args = process.argv.slice(2);

  // Extract global options
  const apiBaseIdx = args.indexOf("--api-base");
  if (apiBaseIdx >= 0 && args[apiBaseIdx + 1]) {
    const customBase = args[apiBaseIdx + 1];
    // SSRF prevention: only allow localhost URLs
    try {
      const parsed = new URL(customBase);
      const allowed = ["localhost", "127.0.0.1", "::1", "[::1]"];
      if (!allowed.includes(parsed.hostname)) {
        console.error(
          `Error: --api-base must be localhost (got: ${parsed.hostname}). ` +
          `Allowed hosts: ${allowed.join(", ")}`
        );
        process.exit(1);
      }
    } catch {
      console.error(`Error: Invalid --api-base URL: ${customBase}`);
      process.exit(1);
    }
    API_BASE = customBase;
    args.splice(apiBaseIdx, 2);
  }

  const command = args[0];

  switch (command) {
    case "add":
      cmdAdd(args[1], args[2]);
      break;
    case "list":
      cmdList();
      break;
    case "apply":
      await cmdApply();
      break;
    case "reset":
      await cmdReset();
      break;
    case "auto-add": {
      const words = [];
      const options = { apply: false };

      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--json") {
          try {
            const jsonWords = JSON.parse(args[++i]);
            if (Array.isArray(jsonWords)) words.push(...jsonWords);
          } catch (e) {
            console.error("Failed to parse --json:", e.message);
            process.exit(1);
          }
        } else if (args[i] === "--apply") {
          options.apply = true;
        } else if (!args[i].startsWith("--")) {
          words.push(args[i]);
        }
      }
      await cmdAutoAdd(words, options);
      break;
    }
    case "check":
      cmdCheck(args.slice(1));
      break;
    case "healthcheck":
      await cmdHealthcheck();
      break;
    case "verify":
      await cmdVerify(args.slice(1));
      break;
    case "scan": {
      const scanOptions = { input: null, text: null, dryRun: false, apply: false, withCaseVariants: false };
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--input" && args[i + 1]) {
          scanOptions.input = args[++i];
        } else if (args[i] === "--text" && args[i + 1]) {
          scanOptions.text = args[++i];
        } else if (args[i] === "--dry-run") {
          scanOptions.dryRun = true;
        } else if (args[i] === "--apply") {
          scanOptions.apply = true;
        } else if (args[i] === "--with-case-variants") {
          scanOptions.withCaseVariants = true;
        }
      }
      await cmdScan(scanOptions);
      break;
    }
    default:
      console.log(`TTS Dictionary Manager

Usage: dict.js <command> [args]

Commands:
  healthcheck           Health check (run before TTS)
  add <word> <yomi>     Add entry manually
  auto-add <words...>   Auto-add with LLM reading detection
  scan                  Scan text/file for English words and register
  check <words...>      Check if words are registered
  verify <words...>     Verify pronunciation in engine
  list                  List all entries
  apply                 Apply dictionary to engine
  reset                 Reset dictionary

Scan Options:
  --input <file>        Input file (JSON dialogue or text)
  --text <string>       Direct text input
  --dry-run             Preview extracted words without registering
  --apply               Register and apply to engine
  --with-case-variants  Auto-register case variants (lowercase, UPPER, Pascal)

Global Options:
  --api-base <url>      Override API base URL (default: http://127.0.0.1:50032)

Examples:
  dict.js healthcheck
  dict.js add "Claude" "クロード"
  dict.js auto-add Claude OpenAI ChatGPT --apply
  dict.js scan --text "Claude CodeのPlan ModeでTypeScriptを書く" --apply
  dict.js scan --input dialogue.json --dry-run
  dict.js verify Git GitHub user`);
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
