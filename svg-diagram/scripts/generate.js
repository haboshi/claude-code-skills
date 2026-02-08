#!/usr/bin/env node
/**
 * SVG Diagram Generator
 *
 * OpenRouter経由でLLMにカスタムSVG図解を自由生成させる。
 * Mermaidでは対応できないカスタムデザインの図解用。
 */

import "dotenv/config";
import OpenAI from "openai";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    output: null,
    theme: "dark",
    model: null,
    width: 1920,
    height: 1080,
    systemPrompt: null,
    maxTokens: null,
    temperature: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--prompt": case "-p":
        options.prompt = nextArg; i++; break;
      case "--output": case "-o":
        options.output = nextArg; i++; break;
      case "--theme": case "-t":
        options.theme = nextArg; i++; break;
      case "--model": case "-m":
        options.model = nextArg; i++; break;
      case "--width": case "-w":
        options.width = parseInt(nextArg, 10); i++; break;
      case "--height": case "-h":
        options.height = parseInt(nextArg, 10); i++; break;
      case "--system-prompt":
        options.systemPrompt = nextArg; i++; break;
      case "--max-tokens":
        options.maxTokens = parseInt(nextArg, 10); i++; break;
      case "--temperature":
        options.temperature = parseFloat(nextArg); i++; break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`SVG Diagram Generator

Usage:
  node generate.js --prompt <description> --output <file.svg> [options]

Options:
  --prompt, -p       Diagram description (required)
  --output, -o       Output SVG file path (required)
  --theme, -t        Theme: dark, light (default: dark)
  --model, -m        OpenRouter model (default: google/gemini-3-flash-preview)
  --width, -w        SVG viewBox width (default: 1920)
  --height, -h       SVG viewBox height (default: 1080)
  --system-prompt    Custom system prompt override
  --max-tokens       Max output tokens
  --temperature      Sampling temperature (0.0-2.0)
  --help             Show this help

Environment:
  OPENROUTER_API_KEY   OpenRouter API key (required)`);
}

function buildSystemPrompt(theme, width, height) {
  return `You are an expert SVG diagram designer. Create professional SVG diagrams based on user requests.

## Output Rules
- Output ONLY pure SVG code (no markdown, no code blocks)
- Include <?xml version="1.0" encoding="UTF-8"?> header
- viewBox="0 0 ${width} ${height}"
- Japanese font: 'Noto Sans JP', 'Hiragino Sans', sans-serif
- English font: 'Inter', 'Helvetica Neue', Arial, sans-serif

## Theme: ${theme === "light" ? "Light" : "Dark"}
${
  theme === "light"
    ? `Background: #ffffff to #f8fafc
Text: #1e293b, #475569
Accent: #3b82f6 (blue), #10b981 (green), #ef4444 (red)`
    : `Background: #0f172a to #1e293b
Text: #f8fafc, #94a3b8
Accent: #38bdf8 (blue), #34d399 (green), #f472b6 (pink)`
}

## Design Guidelines
- Clear visual hierarchy
- Proper margins and balance
- Use arrows/connectors to show relationships
- Use gradients/shadows for depth
- Minimum font size: 18px

## Font Size Hierarchy
- Title: 48-64px (bold, prominent)
- Subtitle: 32-40px
- Labels: 24-28px (font-weight: 700)
- Body text: 20-24px (font-weight: 400-500)
- Notes: 16-18px (lighter color)

## font-weight for emphasis
- Most important: font-weight: 800-900
- Headings/keywords: font-weight: 700
- Normal text: font-weight: 400-500
- Supplementary: font-weight: 300

Create a beautiful, professional diagram.`;
}

/**
 * Validate SVG structure using XML parser.
 */
function validateSvg(svg) {
  const errors = [];

  if (!svg.includes("<svg")) {
    errors.push("<svg> tag not found");
  }
  if (!svg.includes("</svg>")) {
    errors.push("</svg> closing tag not found");
  }

  const parseErrors = [];
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level === "error" || level === "fatalError") {
        parseErrors.push(msg);
      }
    },
  });

  try {
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const svgElement = doc.getElementsByTagName("svg")[0];

    if (!svgElement) {
      errors.push("SVG root element not found");
    } else {
      if (!svgElement.getAttribute("viewBox")) {
        errors.push("viewBox attribute missing");
      }
      if (!svgElement.getAttribute("xmlns")) {
        errors.push("xmlns attribute missing");
      }
    }
  } catch (e) {
    errors.push(`XML parse error: ${e.message}`);
  }

  if (parseErrors.length > 0) {
    errors.push(...parseErrors.slice(0, 5));
  }

  return { valid: errors.length === 0, errors };
}

async function main() {
  const options = parseArgs();

  if (!options.prompt) {
    console.error("Error: --prompt is required");
    console.error("Usage: node generate.js --prompt <description> --output <file.svg>");
    process.exit(1);
  }

  if (!options.output) {
    console.error("Error: --output is required");
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENROUTER_API_KEY environment variable is required");
    process.exit(1);
  }

  const model = options.model ?? "google/gemini-3-flash-preview";

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://github.com/haboshi/claude-code-skills",
      "X-Title": "SVG Diagram Generator",
    },
  });

  const systemPrompt = options.systemPrompt ?? buildSystemPrompt(options.theme, options.width, options.height);

  console.error(`[SVG Diagram] Requesting ${model}...`);
  const start = Date.now();

  try {
    const requestParams = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: options.prompt },
      ],
    };

    if (options.maxTokens) {
      requestParams.max_tokens = options.maxTokens;
    }
    if (options.temperature !== null && options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const completion = await client.chat.completions.create(requestParams);

    const duration = Date.now() - start;
    console.error(`[SVG Diagram] Success (${duration}ms). Model: ${completion.model}`);

    let svg = completion.choices[0]?.message?.content?.trim();
    if (!svg) {
      console.error("Error: Empty response from API");
      process.exit(1);
    }

    // Strip markdown code block wrappers if present
    svg = svg.replace(/^```(?:xml|svg)?\n?/i, "").replace(/\n?```$/i, "");

    // Write output (before validation so Claude can fix errors)
    const outputPath = resolve(options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, svg, "utf-8");
    console.error(`Output: ${outputPath}`);

    // SVG validation
    const { valid, errors } = validateSvg(svg);
    if (!valid) {
      console.error("");
      console.error("=".repeat(60));
      console.error("[SVG Validation Error] Fix the following issues:");
      console.error("=".repeat(60));
      errors.forEach((err, i) => console.error(`  ${i + 1}. ${err}`));
      console.error("");
      console.error(`File: ${outputPath}`);
      console.error("");
      console.error("-> Read this SVG file and fix the errors above.");
      console.error("=".repeat(60));
      process.exit(1);
    }

    console.error("[SVG Validation] OK");
  } catch (error) {
    console.error("API error:", error.message);
    process.exit(1);
  }
}

main();
