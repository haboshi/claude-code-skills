#!/usr/bin/env node
/**
 * Mermaid to WebP/PNG Converter
 *
 * Mermaid記法のテキストをWebPまたはPNG画像に変換。
 * mermaid-cliでPNG化後、sharpでリサイズ・形式変換。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import os from "os";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic sharp import
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch (_error) {
  console.error("Error: sharp library is not installed.");
  console.error("Install with: npm install sharp");
  console.error("  cd " + path.resolve(__dirname, "..") + " && npm install");
  process.exit(1);
}

// Local color-utils (no cross-plugin dependency)
import { parseBackground } from "./color-utils.js";

const VALID_FORMATS = ["webp", "png"];
const VALID_THEMES = ["default", "dark", "forest", "neutral"];
const VALID_FITS = ["contain", "cover", "fill", "inside", "outside"];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    output: null,
    stdin: false,
    width: 1920,
    height: 1080,
    quality: 85,
    background: "white",
    theme: "default",
    format: "webp",
    fit: "contain",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--input": case "-i":
        options.input = nextArg; i++; break;
      case "--output": case "-o":
        options.output = nextArg; i++; break;
      case "--stdin":
        options.stdin = true; break;
      case "--width": case "-w":
        options.width = parseInt(nextArg, 10); i++; break;
      case "--height": case "-h":
        options.height = parseInt(nextArg, 10); i++; break;
      case "--quality": case "-q":
        options.quality = parseInt(nextArg, 10); i++; break;
      case "--background": case "-b":
        options.background = nextArg; i++; break;
      case "--theme": case "-t":
        options.theme = nextArg; i++; break;
      case "--format": case "-f":
        options.format = nextArg.toLowerCase(); i++; break;
      case "--fit":
        options.fit = nextArg.toLowerCase(); i++; break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Mermaid to WebP/PNG Converter

Usage:
  From file:
    node convert.js --input <input.mmd> --output <output.webp> [options]

  From stdin:
    echo "graph TD; A-->B;" | node convert.js --stdin --output <output.webp> [options]

Options:
  --input, -i        Input Mermaid file path (.mmd)
  --output, -o       Output file path
  --stdin            Read Mermaid text from stdin
  --width, -w        Output width (default: 1920)
  --height, -h       Output height (default: 1080)
  --quality, -q      Quality 1-100 (default: 85)
  --format, -f       Output format: webp, png (default: webp)
  --fit              Resize fit: contain, cover, fill, inside, outside (default: contain)
  --background, -b   Background color (default: white)
  --theme, -t        Mermaid theme: default, dark, forest, neutral (default: default)
  --help             Show this help`);
}

/**
 * Read text from stdin.
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => { resolve(data); });
    process.stdin.on("error", reject);
  });
}

/**
 * Generate a unique temp file path.
 */
function getTempFilePath(extension) {
  const tempDir = os.tmpdir();
  const uniqueId = crypto.randomBytes(8).toString("hex");
  return path.join(tempDir, `mermaid-${uniqueId}${extension}`);
}

/**
 * Convert Mermaid text to PNG using mermaid-cli.
 */
async function convertMermaidToPng(mermaidText, theme, background, tempMmdPath, tempPngPath) {
  fs.writeFileSync(tempMmdPath, mermaidText, "utf8");

  const configPath = getTempFilePath(".json");
  fs.writeFileSync(configPath, JSON.stringify({ theme }), "utf8");

  // Use local mmdc binary from node_modules
  const mmdcPath = path.resolve(__dirname, "../node_modules/.bin/mmdc");

  return new Promise((resolve, reject) => {
    const mmdc = spawn(mmdcPath, [
      "-i", tempMmdPath,
      "-o", tempPngPath,
      "-c", configPath,
      "-b", background,
      "-s", "2",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    mmdc.stderr.on("data", (data) => { stderr += data.toString(); });

    mmdc.on("close", (code) => {
      try { fs.unlinkSync(configPath); } catch (_e) { /* ignore */ }

      if (code !== 0) {
        reject(new Error(`mermaid-cli failed with code ${code}: ${stderr}`));
      } else {
        resolve(tempPngPath);
      }
    });

    mmdc.on("error", (error) => {
      try { fs.unlinkSync(configPath); } catch (_e) { /* ignore */ }
      reject(new Error(`Failed to run mermaid-cli: ${error.message}`));
    });
  });
}

/**
 * Convert PNG to WebP/PNG using sharp.
 */
async function convertPngToOutput(pngPath, outputPath, options) {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const background = parseBackground(options.background);

  let pipeline = sharp(pngPath)
    .resize(options.width, options.height, {
      fit: options.fit,
      background,
    });

  if (background.alpha === 1) {
    pipeline = pipeline.flatten({ background });
  }

  if (options.format === "png") {
    pipeline = pipeline.png({ quality: options.quality });
  } else {
    pipeline = pipeline.webp({ quality: options.quality });
  }

  await pipeline.toFile(outputPath);

  const stats = fs.statSync(outputPath);
  return { path: outputPath, size: stats.size };
}

/**
 * Full pipeline: Mermaid text -> PNG -> WebP/PNG.
 */
async function convertMermaidToImage(mermaidText, outputPath, options) {
  const tempMmdPath = getTempFilePath(".mmd");
  const tempPngPath = getTempFilePath(".png");

  try {
    await convertMermaidToPng(mermaidText, options.theme, options.background, tempMmdPath, tempPngPath);
    return await convertPngToOutput(tempPngPath, outputPath, options);
  } finally {
    try { if (fs.existsSync(tempMmdPath)) fs.unlinkSync(tempMmdPath); } catch (_e) { /* ignore */ }
    try { if (fs.existsSync(tempPngPath)) fs.unlinkSync(tempPngPath); } catch (_e) { /* ignore */ }
  }
}

function validateOptions(options) {
  if (!options.stdin && !options.input) {
    console.error("Error: Specify --input or --stdin.");
    printHelp();
    process.exit(1);
  }

  if (options.stdin && options.input) {
    console.error("Error: Cannot use --input and --stdin simultaneously.");
    process.exit(1);
  }

  if (!options.output) {
    console.error("Error: --output is required.");
    printHelp();
    process.exit(1);
  }

  if (isNaN(options.width) || options.width <= 0) {
    console.error("Error: Width must be a positive integer.");
    process.exit(1);
  }

  if (isNaN(options.height) || options.height <= 0) {
    console.error("Error: Height must be a positive integer.");
    process.exit(1);
  }

  if (isNaN(options.quality) || options.quality < 1 || options.quality > 100) {
    console.error("Error: Quality must be between 1-100.");
    process.exit(1);
  }

  if (!VALID_FORMATS.includes(options.format)) {
    console.error(`Error: Format must be one of: ${VALID_FORMATS.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_THEMES.includes(options.theme)) {
    console.error(`Error: Theme must be one of: ${VALID_THEMES.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_FITS.includes(options.fit)) {
    console.error(`Error: Fit must be one of: ${VALID_FITS.join(", ")}`);
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs();
  validateOptions(options);

  try {
    let mermaidText;

    if (options.stdin) {
      console.log("Reading Mermaid text from stdin...");
      mermaidText = await readStdin();
    } else {
      if (!fs.existsSync(options.input)) {
        throw new Error(`Input file not found: ${options.input}`);
      }
      mermaidText = fs.readFileSync(options.input, "utf8");
    }

    if (!mermaidText.trim()) {
      throw new Error("Mermaid text is empty.");
    }

    console.log(`Converting: ${options.stdin ? "(stdin)" : options.input} -> ${options.output}`);
    console.log(`  Size: ${options.width}x${options.height}, Quality: ${options.quality}, Format: ${options.format}`);
    console.log(`  Theme: ${options.theme}, Background: ${options.background}, Fit: ${options.fit}`);

    const result = await convertMermaidToImage(mermaidText, options.output, options);
    const sizeKb = (result.size / 1024).toFixed(1);
    console.log(`Done: ${options.output} (${sizeKb} KB)`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();

export { convertMermaidToImage, convertPngToOutput };
