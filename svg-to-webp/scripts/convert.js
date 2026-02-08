#!/usr/bin/env node
/**
 * SVG to WebP/PNG Converter
 *
 * SVG画像をWebPまたはPNG形式に変換。
 * 単一ファイル・ディレクトリ一括変換に対応。
 * sharpベースの高品質変換。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseBackground } from "./color-utils.js";

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

const VALID_FORMATS = ["webp", "png"];
const VALID_FITS = ["contain", "cover", "fill", "inside", "outside"];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    output: null,
    inputDir: null,
    outputDir: null,
    width: 1920,
    height: 1080,
    quality: 80,
    background: "transparent",
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
      case "--input-dir":
        options.inputDir = nextArg; i++; break;
      case "--output-dir":
        options.outputDir = nextArg; i++; break;
      case "--width": case "-w":
        options.width = parseInt(nextArg, 10); i++; break;
      case "--height": case "-h":
        options.height = parseInt(nextArg, 10); i++; break;
      case "--quality": case "-q":
        options.quality = parseInt(nextArg, 10); i++; break;
      case "--background": case "-b":
        options.background = nextArg; i++; break;
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
  console.log(`SVG to WebP/PNG Converter

Usage:
  Single file:
    node convert.js --input <input.svg> --output <output.webp> [options]

  Directory batch:
    node convert.js --input-dir <dir> --output-dir <dir> [options]

Options:
  --input, -i        Input SVG file path
  --output, -o       Output file path
  --input-dir        Input directory (batch mode)
  --output-dir       Output directory (batch mode)
  --width, -w        Output width (default: 1920)
  --height, -h       Output height (default: 1080)
  --quality, -q      Quality 1-100 (default: 80)
  --format, -f       Output format: webp, png (default: webp)
  --fit              Resize fit: contain, cover, fill, inside, outside (default: contain)
  --background, -b   Background color (default: transparent)
                     transparent, white, black, #RGB, #RRGGBB, #RRGGBBAA
  --help             Show this help`);
}

/**
 * Convert a single SVG file to WebP or PNG.
 */
async function convertSvg(inputPath, outputPath, options) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== ".svg") {
    throw new Error(`Input file is not SVG: ${inputPath}`);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const background = parseBackground(options.background);
  const svgBuffer = fs.readFileSync(inputPath);

  let pipeline = sharp(svgBuffer, { density: 300 })
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
 * Batch convert all SVGs in a directory.
 */
async function convertDirectory(inputDir, outputDir, options) {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs.readdirSync(inputDir).filter((file) =>
    path.extname(file).toLowerCase() === ".svg"
  );

  if (files.length === 0) {
    console.log("No SVG files found.");
    return [];
  }

  console.log(`Converting ${files.length} SVG files...`);

  const results = [];
  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputFile = file.replace(/\.svg$/i, `.${options.format}`);
    const outputPath = path.join(outputDir, outputFile);

    try {
      const result = await convertSvg(inputPath, outputPath, options);
      const sizeKb = (result.size / 1024).toFixed(1);
      console.log(`  [OK] ${file} -> ${outputFile} (${sizeKb} KB)`);
      results.push({ input: inputPath, output: outputPath, success: true, size: result.size });
    } catch (error) {
      console.error(`  [ERROR] ${file}: ${error.message}`);
      results.push({ input: inputPath, output: outputPath, success: false, error: error.message });
    }
  }

  return results;
}

function validateOptions(options) {
  const isSingleFile = options.input && options.output;
  const isDirectory = options.inputDir && options.outputDir;

  if (!isSingleFile && !isDirectory) {
    console.error("Error: Specify --input and --output, or --input-dir and --output-dir.");
    printHelp();
    process.exit(1);
  }

  if (isSingleFile && isDirectory) {
    console.error("Error: Cannot use single file and directory mode simultaneously.");
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

  if (!VALID_FITS.includes(options.fit)) {
    console.error(`Error: Fit must be one of: ${VALID_FITS.join(", ")}`);
    process.exit(1);
  }

  return isSingleFile ? "single" : "directory";
}

async function main() {
  const options = parseArgs();
  const mode = validateOptions(options);

  try {
    if (mode === "single") {
      console.log(`Converting: ${options.input} -> ${options.output}`);
      console.log(`  Size: ${options.width}x${options.height}, Quality: ${options.quality}, Format: ${options.format}, Fit: ${options.fit}`);

      const result = await convertSvg(options.input, options.output, options);
      const sizeKb = (result.size / 1024).toFixed(1);
      console.log(`Done: ${options.output} (${sizeKb} KB)`);
    } else {
      console.log(`Input: ${options.inputDir}`);
      console.log(`Output: ${options.outputDir}`);
      console.log(`  Size: ${options.width}x${options.height}, Quality: ${options.quality}, Format: ${options.format}, Fit: ${options.fit}`);

      const results = await convertDirectory(options.inputDir, options.outputDir, options);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      console.log(`\nDone: ${successCount} succeeded, ${failCount} failed`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();

export { convertSvg, convertDirectory, parseBackground };
