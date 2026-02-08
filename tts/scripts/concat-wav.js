#!/usr/bin/env node
/**
 * WAV File Concatenator
 *
 * 複数のWAVファイルを1つに結合する。
 * バイナリレベルでのヘッダー解析・フォーマット互換性チェック付き。
 */

import { readFile, writeFile, readdir } from "fs/promises";
import { join, basename } from "path";

/**
 * Parse WAV file header.
 * @param {Buffer} buffer
 * @returns {{ audioFormat: number, numChannels: number, sampleRate: number, byteRate: number, blockAlign: number, bitsPerSample: number, fmtChunk: Buffer, dataOffset: number, dataSize: number }}
 */
function parseWavHeader(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const riff = String.fromCharCode(...buffer.slice(0, 4));
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV file: RIFF header not found");
  }

  const wave = String.fromCharCode(...buffer.slice(8, 12));
  if (wave !== "WAVE") {
    throw new Error("Invalid WAV file: WAVE header not found");
  }

  let offset = 12;
  let fmtChunk = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length - 8) {
    const chunkId = String.fromCharCode(...buffer.slice(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      fmtChunk = buffer.slice(offset + 8, offset + 8 + chunkSize);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (!fmtChunk) {
    throw new Error("Invalid WAV file: fmt chunk not found");
  }

  const fmtView = new DataView(fmtChunk.buffer, fmtChunk.byteOffset, fmtChunk.byteLength);

  return {
    audioFormat: fmtView.getUint16(0, true),
    numChannels: fmtView.getUint16(2, true),
    sampleRate: fmtView.getUint32(4, true),
    byteRate: fmtView.getUint32(8, true),
    blockAlign: fmtView.getUint16(12, true),
    bitsPerSample: fmtView.getUint16(14, true),
    fmtChunk,
    dataOffset,
    dataSize,
  };
}

/**
 * Concatenate multiple WAV files into one.
 * @param {string[]} inputFiles - Array of WAV file paths
 * @param {string} outputPath - Output WAV file path
 * @returns {Promise<string>} Output file path
 */
async function concatWavFiles(inputFiles, outputPath) {
  if (inputFiles.length === 0) {
    throw new Error("No input files provided");
  }

  console.log(`Concatenating ${inputFiles.length} files...`);

  const firstBuffer = await readFile(inputFiles[0]);
  const format = parseWavHeader(firstBuffer);

  console.log(`Format: ${format.sampleRate}Hz, ${format.bitsPerSample}bit, ${format.numChannels}ch`);

  const audioDataArrays = [];
  let totalDataSize = 0;

  for (const file of inputFiles) {
    const buffer = await readFile(file);
    const info = parseWavHeader(buffer);

    if (
      info.sampleRate !== format.sampleRate ||
      info.bitsPerSample !== format.bitsPerSample ||
      info.numChannels !== format.numChannels
    ) {
      console.warn(`Warning: ${basename(file)} has incompatible format. Skipping.`);
      continue;
    }

    const audioData = buffer.slice(info.dataOffset, info.dataOffset + info.dataSize);
    audioDataArrays.push(audioData);
    totalDataSize += audioData.length;

    console.log(`  + ${basename(file)} (${(audioData.length / 1024).toFixed(1)}KB)`);
  }

  // Build new WAV file
  const headerSize = 44;
  const outputBuffer = Buffer.alloc(headerSize + totalDataSize);

  // RIFF header
  outputBuffer.write("RIFF", 0);
  outputBuffer.writeUInt32LE(36 + totalDataSize, 4);
  outputBuffer.write("WAVE", 8);

  // fmt chunk
  outputBuffer.write("fmt ", 12);
  outputBuffer.writeUInt32LE(16, 16);
  outputBuffer.writeUInt16LE(format.audioFormat, 20);
  outputBuffer.writeUInt16LE(format.numChannels, 22);
  outputBuffer.writeUInt32LE(format.sampleRate, 24);
  outputBuffer.writeUInt32LE(format.byteRate, 28);
  outputBuffer.writeUInt16LE(format.blockAlign, 32);
  outputBuffer.writeUInt16LE(format.bitsPerSample, 34);

  // data chunk
  outputBuffer.write("data", 36);
  outputBuffer.writeUInt32LE(totalDataSize, 40);

  let offset = headerSize;
  for (const audioData of audioDataArrays) {
    audioData.copy(outputBuffer, offset);
    offset += audioData.length;
  }

  await writeFile(outputPath, outputBuffer);

  const durationSec = totalDataSize / format.byteRate;
  console.log(`\nDone: ${outputPath}`);
  console.log(`Size: ${(outputBuffer.length / 1024 / 1024).toFixed(2)}MB`);
  console.log(`Duration: ${Math.floor(durationSec / 60)}m${(durationSec % 60).toFixed(1)}s`);

  return outputPath;
}

/**
 * Get WAV files in numerical order from a directory.
 * @param {string} dir - Directory path
 * @returns {Promise<string[]>} Sorted array of WAV file paths
 */
async function getWavFilesInOrder(dir) {
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith(".wav") && /^\d+_/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)_/)[1]);
      const numB = parseInt(b.match(/^(\d+)_/)[1]);
      return numA - numB;
    })
    .map((f) => join(dir, f));
}

// CLI parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = { inputDir: null, output: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input-dir":
        options.inputDir = args[++i];
        break;
      case "--output":
        options.output = args[++i];
        break;
      case "--help":
        console.log(`
WAV Concatenator

Usage:
  node concat-wav.js --input-dir <dir> --output <file>

Options:
  --input-dir <path>  Directory with WAV files (required)
  --output <path>     Output file path (required)
  --help              Show this help message

Files matching 001_*.wav, 002_*.wav etc. are concatenated in order.
`);
        process.exit(0);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();

  if (!options.inputDir || !options.output) {
    console.error("Error: --input-dir and --output are required");
    process.exit(1);
  }

  try {
    const wavFiles = await getWavFilesInOrder(options.inputDir);
    if (wavFiles.length === 0) {
      console.error("Error: No WAV files found");
      process.exit(1);
    }
    await concatWavFiles(wavFiles, options.output);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

export { concatWavFiles, getWavFilesInOrder };

// CLI execution
if (process.argv[1]?.includes("concat-wav")) {
  main();
}
