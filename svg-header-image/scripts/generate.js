#!/usr/bin/env node
/**
 * SVG Header Image Generator
 *
 * テンプレートベースのヘッダー画像をSVGで生成。
 * 複数テーマ対応、カスタムテーマ読み込み、サイズ可変。
 * 外部API不要（純粋Node.js）。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { validateThemeColors } from "./theme-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default dimensions
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

const STYLE_CSS = `
  .title { font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif; font-weight: 900; dominant-baseline: central; }
  .subtitle { font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif; font-weight: 700; dominant-baseline: central; }
  .meta { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; dominant-baseline: central; }
  .badge-text { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-weight: 800; dominant-baseline: central; }
`;

// Built-in themes
const THEMES = {
  // v3 Palettes (rich effects)
  midnight: {
    name: "Midnight",
    type: "v3",
    bg: ["#0f172a", "#1e293b", "#334155"],
    accent: ["#38bdf8", "#818cf8", "#c084fc"],
    text: "#f8fafc",
    subText: "#94a3b8",
  },
  sunset: {
    name: "Sunset",
    type: "v3",
    bg: ["#4c0519", "#881337", "#be123c"],
    accent: ["#fb7185", "#f43f5e", "#e11d48"],
    text: "#fff1f2",
    subText: "#fecdd3",
  },
  forest: {
    name: "Forest",
    type: "v3",
    bg: ["#022c22", "#064e3b", "#065f46"],
    accent: ["#34d399", "#10b981", "#059669"],
    text: "#ecfdf5",
    subText: "#a7f3d0",
  },
  ocean: {
    name: "Ocean Deep",
    type: "v3",
    bg: ["#0c1929", "#1e3a5f", "#234876"],
    accent: ["#0ea5e9", "#06b6d4", "#22d3ee"],
    text: "#f0f9ff",
    subText: "#bae6fd",
  },
  lavender: {
    name: "Lavender Dream",
    type: "v3",
    bg: ["#1e1b4b", "#312e81", "#4338ca"],
    accent: ["#a78bfa", "#c4b5fd", "#e9d5ff"],
    text: "#faf5ff",
    subText: "#e9d5ff",
  },
  // v2 Themes (stylish)
  neon: {
    name: "Neon Cyber",
    type: "v2-neon",
    bg: ["#0f172a", "#1e1b4b", "#312e81"],
    accent: ["#06b6d4", "#8b5cf6", "#d946ef"],
    text: "#f8fafc",
    subText: "#cbd5e1",
  },
  glass: {
    name: "Soft Glass",
    type: "v2-glass",
    bg: ["#fdfbf7", "#e2e8f0", "#cbd5e1"],
    accent: ["#3b82f6", "#10b981", "#f59e0b"],
    text: "#1e293b",
    subText: "#475569",
  },
  geometric: {
    name: "Bold Geometric",
    type: "v2-geometric",
    bg: ["#18181b", "#27272a", "#3f3f46"],
    accent: ["#fbbf24", "#f59e0b", "#d97706"],
    text: "#ffffff",
    subText: "#d4d4d8",
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    output: null,
    title: null,
    subtitle: "",
    theme: "midnight",
    themeFile: null,
    badge: "",
    category: "",
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    listThemes: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--output":
      case "-o":
        options.output = nextArg;
        i++;
        break;
      case "--title":
      case "-t":
        options.title = nextArg;
        i++;
        break;
      case "--subtitle":
      case "-s":
        options.subtitle = nextArg;
        i++;
        break;
      case "--theme":
        options.theme = nextArg;
        i++;
        break;
      case "--theme-file":
        options.themeFile = nextArg;
        i++;
        break;
      case "--badge":
        options.badge = nextArg;
        i++;
        break;
      case "--category":
        options.category = nextArg;
        i++;
        break;
      case "--width":
      case "-w":
        options.width = parseInt(nextArg, 10);
        i++;
        break;
      case "--height":
      case "-h":
        options.height = parseInt(nextArg, 10);
        i++;
        break;
      case "--list-themes":
        options.listThemes = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
SVG Header Image Generator

Usage:
  node generate.js --output <path> --title <title> [options]

Required:
  --output, -o        Output SVG file path
  --title, -t         Main title text

Options:
  --subtitle, -s      Subtitle text
  --theme             Theme name (default: midnight)
                      Built-in: midnight, sunset, forest, ocean, lavender,
                                neon, glass, geometric
  --theme-file        Custom theme JSON file path
  --badge             Badge text (displayed top-right)
  --category          Category label (displayed above title)
  --width, -w         Output width in px (default: 1920)
  --height, -h        Output height in px (default: 1080)
  --list-themes       List all available themes and exit
  --help              Show this help message

Examples:
  node generate.js -o header.svg -t "AI Agent Guide" --theme midnight
  node generate.js -o header.svg -t "New Feature" -s "2025 Edition" --badge "NEW"
  node generate.js -o header.svg -t "Custom" --theme-file ./my-theme.json
  node generate.js --list-themes
`);
}

function listThemes(customThemes) {
  const allThemes = { ...THEMES, ...customThemes };
  console.log("\nAvailable themes:\n");
  console.log(
    "  Name".padEnd(16) +
      "Display Name".padEnd(20) +
      "Type".padEnd(14) +
      "Background"
  );
  console.log("  " + "-".repeat(62));

  for (const [key, theme] of Object.entries(allThemes)) {
    const source = THEMES[key] ? "" : " (custom)";
    console.log(
      `  ${key.padEnd(14)} ${(theme.name + source).padEnd(20)} ${theme.type.padEnd(14)} ${theme.bg[0]}`
    );
  }
  console.log("");
}

function loadCustomTheme(themeFilePath) {
  if (!themeFilePath) return {};
  if (!fs.existsSync(themeFilePath)) {
    console.error(`Error: Theme file not found: ${themeFilePath}`);
    process.exit(1);
  }
  try {
    const data = fs.readFileSync(themeFilePath, "utf-8");
    const parsed = JSON.parse(data);

    // Single theme object or map of themes
    if (parsed.bg && parsed.accent && parsed.text) {
      const theme = { type: parsed.type || "v3", ...parsed };
      validateThemeColors(theme);
      const name = parsed.name || path.basename(themeFilePath, ".json");
      return { [name]: theme };
    }
    // Map of themes: validate each
    for (const [name, theme] of Object.entries(parsed)) {
      validateThemeColors(theme);
    }
    return parsed;
  } catch (error) {
    console.error(`Error: Failed to parse theme file: ${error.message}`);
    process.exit(1);
  }
}

function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // Strip control characters
}

function getCommonDefs() {
  return `
    <filter id="noise" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.05 0" in="noise" result="coloredNoise"/>
      <feComposite operator="in" in="coloredNoise" in2="SourceGraphic" result="composite"/>
      <feBlend mode="overlay" in="composite" in2="SourceGraphic"/>
    </filter>

    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="30" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="0" dy="10" result="offsetblur"/>
      <feFlood flood-color="#000000" flood-opacity="0.5"/>
      <feComposite in2="offsetblur" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  `;
}

function generateV3Background(theme, w, h) {
  return `
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.bg[0]}" />
        <stop offset="50%" stop-color="${theme.bg[1]}" />
        <stop offset="100%" stop-color="${theme.bg[2]}" />
      </linearGradient>
      <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="${theme.text}" stroke-width="0.5" opacity="0.05"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bgGradient)" />
    <circle cx="0" cy="0" r="${Math.min(w, h) * 0.7}" fill="${theme.accent[0]}" opacity="0.15" filter="url(#glow)" />
    <circle cx="${w}" cy="${h}" r="${Math.min(w, h) * 0.55}" fill="${theme.accent[2]}" opacity="0.15" filter="url(#glow)" />
    <rect width="${w}" height="${h}" fill="url(#grid)" />
    <rect width="${w}" height="${h}" filter="url(#noise)" opacity="0.4" />
  `;
}

function generateNeonBackground(theme, w, h) {
  return `
    <defs>
      <radialGradient id="neonGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stop-color="${theme.bg[1]}" />
        <stop offset="100%" stop-color="${theme.bg[0]}" />
      </radialGradient>
      <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
        <path d="M 50 0 L 0 0 0 50" fill="none" stroke="${theme.accent[1]}" stroke-width="0.5" opacity="0.1"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#neonGradient)" />
    <rect width="${w}" height="${h}" fill="url(#grid)" />
    <circle cx="${w * 0.1}" cy="${h * 0.2}" r="150" fill="${theme.accent[0]}" opacity="0.2" filter="url(#glow)" />
    <circle cx="${w * 0.9}" cy="${h * 0.8}" r="200" fill="${theme.accent[2]}" opacity="0.15" filter="url(#glow)" />
    <circle cx="${w / 2}" cy="${h / 2}" r="400" fill="${theme.accent[1]}" opacity="0.05" filter="url(#glow)" />
    <rect width="${w}" height="${h}" filter="url(#noise)" opacity="0.3" />
  `;
}

function generateGlassBackground(theme, w, h) {
  return `
    <defs>
      <linearGradient id="glassGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.bg[0]}" />
        <stop offset="100%" stop-color="${theme.bg[2]}" />
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#glassGradient)" />
    <circle cx="${w * 0.2}" cy="${h * 0.3}" r="300" fill="${theme.accent[0]}" opacity="0.3" />
    <circle cx="${w * 0.8}" cy="${h * 0.7}" r="250" fill="${theme.accent[2]}" opacity="0.3" />
    <circle cx="${w * 0.5}" cy="${h * 0.5}" r="400" fill="${theme.accent[1]}" opacity="0.2" />
    <rect width="${w}" height="${h}" fill="#ffffff" opacity="0.05" />
  `;
}

function generateGeometricBackground(theme, w, h) {
  return `
    <rect width="${w}" height="${h}" fill="${theme.bg[0]}" />
    <path d="M0 0 L${w} 0 L${w} ${h * 0.185} L0 ${h * 0.37} Z" fill="${theme.bg[1]}" />
    <path d="M0 ${h} L${w} ${h} L${w} ${h * 0.815} L0 ${h * 0.63} Z" fill="${theme.bg[1]}" />
    <rect x="${w * 0.1}" y="${h * 0.1}" width="100" height="100" fill="none" stroke="${theme.accent[0]}" stroke-width="4" opacity="0.5" transform="rotate(15 ${w * 0.1} ${h * 0.1})" />
    <rect x="${w * 0.9}" y="${h * 0.8}" width="150" height="150" fill="none" stroke="${theme.accent[1]}" stroke-width="4" opacity="0.5" transform="rotate(-15 ${w * 0.9} ${h * 0.8})" />
    <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${theme.bg[2]}" stroke-width="2" stroke-dasharray="20,20" />
  `;
}

function generateBackground(theme, w, h) {
  switch (theme.type) {
    case "v2-glass":
      return generateGlassBackground(theme, w, h);
    case "v2-geometric":
      return generateGeometricBackground(theme, w, h);
    case "v2-neon":
      return generateNeonBackground(theme, w, h);
    default:
      return generateV3Background(theme, w, h);
  }
}

/**
 * Split title into multiple lines for display.
 * Uses Intl.Segmenter for Japanese word boundaries when available.
 */
function splitTitle(title, maxChars = 16) {
  if (title.length <= maxChars) {
    return [title];
  }

  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    try {
      // Detect language: use ja-JP segmenter only if Japanese characters present
      const hasJapanese = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(title);
      const locale = hasJapanese ? "ja-JP" : "en";
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      const rawSegments = Array.from(segmenter.segment(title)).map((s) => s.segment);

      // Merge number + suffix patterns (Japanese counters)
      const suffixes = ["年", "月", "日", "時", "分", "秒", "版", "回", "個", "本", "枚", "冊", "人", "つ"];
      const segments = [];

      rawSegments.forEach((seg, i) => {
        if (i > 0 && segments.length > 0) {
          const prev = segments[segments.length - 1];
          if (suffixes.includes(seg) && /[0-9０-９]$/.test(prev)) {
            segments[segments.length - 1] += seg;
            return;
          }
        }
        segments.push(seg);
      });

      if (segments.length <= 1) {
        const mid = Math.floor(title.length / 2);
        return [title.substring(0, mid), title.substring(mid)];
      }

      const targetLength = title.length / 2;
      let currentLength = 0;
      let splitIndex = 0;
      let bestDiff = Infinity;

      for (let i = 0; i < segments.length; i++) {
        currentLength += segments[i].length;
        const diff = Math.abs(currentLength - targetLength);
        if (diff < bestDiff && i < segments.length - 1) {
          bestDiff = diff;
          splitIndex = i + 1;
        }
      }

      const line1 = segments.slice(0, splitIndex).join("");
      const line2 = segments.slice(splitIndex).join("");
      return [line1, line2];
    } catch (_e) {
      // Fallback to simple split
    }
  }

  const mid = Math.floor(title.length / 2);
  return [title.substring(0, mid), title.substring(mid)];
}

function generateContent(options, theme) {
  const { title, subtitle, category, badge, width: w, height: h } = options;

  const cardW = w * 0.85;
  const cardH = h * 0.7;
  const cardX = (w - cardW) / 2;
  const cardY = (h - cardH) / 2;

  const titleLines = splitTitle(title);

  // Scale font sizes relative to canvas
  const scale = Math.min(w / DEFAULT_WIDTH, h / DEFAULT_HEIGHT);
  const titleFontSize = Math.round(100 * scale);
  const subtitleFontSize = Math.round(48 * scale);
  const categoryFontSize = Math.round(24 * scale);
  const badgeFontSize = Math.round(30 * scale);
  const titleLineHeight = Math.round(120 * scale);

  const layoutItems = [];

  if (category) {
    layoutItems.push({
      type: "category",
      h: Math.round(50 * scale),
      gap: Math.round(40 * scale),
      render: (y) => `
        <g transform="translate(${w / 2}, ${y})">
          <rect x="-100" y="-25" width="200" height="50" rx="25" fill="${theme.accent[1]}" fill-opacity="0.2" stroke="${theme.accent[1]}" stroke-width="2" />
          <text x="0" y="0" text-anchor="middle" class="meta" fill="${theme.accent[0]}" font-size="${categoryFontSize}">${escapeXml(category)}</text>
        </g>
      `,
    });
  }

  const titleBlockHeight = titleLines.length * titleLineHeight;
  layoutItems.push({
    type: "title",
    h: titleBlockHeight,
    gap: subtitle ? Math.round(40 * scale) : 0,
    render: (y) => {
      const startY = y - titleBlockHeight / 2 + titleLineHeight / 2;
      return titleLines
        .map(
          (line, i) => `
        <text x="${w / 2}" y="${startY + i * titleLineHeight}" text-anchor="middle" class="title"
              fill="${theme.text}" font-size="${titleFontSize}" filter="url(#dropShadow)">${escapeXml(line)}</text>
      `
        )
        .join("");
    },
  });

  if (subtitle) {
    layoutItems.push({
      type: "subtitle",
      h: Math.round(50 * scale),
      gap: 0,
      render: (y) => `
        <text x="${w / 2}" y="${y}" text-anchor="middle" class="subtitle"
              fill="${theme.subText}" font-size="${subtitleFontSize}">${escapeXml(subtitle)}</text>
      `,
    });
  }

  const totalContentHeight = layoutItems.reduce((sum, item, i) => {
    return sum + item.h + (i < layoutItems.length - 1 ? item.gap : 0);
  }, 0);

  let currentTopY = h / 2 - totalContentHeight / 2;
  let contentHtml = "";

  layoutItems.forEach((item, i) => {
    const itemCenterY = currentTopY + item.h / 2;
    contentHtml += item.render(itemCenterY);
    currentTopY += item.h + (i < layoutItems.length - 1 ? item.gap : 0);
  });

  let badgeHtml = "";
  if (badge) {
    badgeHtml = `
      <g transform="translate(${w - Math.round(250 * scale)}, ${Math.round(100 * scale)}) rotate(10)">
        <rect x="-100" y="-30" width="200" height="60" rx="10" fill="${theme.accent[0]}" transform="skewX(-10)" />
        <text x="0" y="0" text-anchor="middle" class="badge-text" fill="#fff" font-size="${badgeFontSize}">${escapeXml(badge)}</text>
      </g>
    `;
  }

  const decorationHtml = `
    <line x1="${cardX + 100}" y1="${cardY}" x2="${cardX + 100}" y2="${cardY + cardH}" stroke="${theme.accent[0]}" stroke-width="1" opacity="0.3" stroke-dasharray="10,10" />
    <line x1="${cardX + cardW - 100}" y1="${cardY}" x2="${cardX + cardW - 100}" y2="${cardY + cardH}" stroke="${theme.accent[0]}" stroke-width="1" opacity="0.3" stroke-dasharray="10,10" />
    <path d="M ${cardX} ${cardY + 50} L ${cardX} ${cardY} L ${cardX + 50} ${cardY}" fill="none" stroke="${theme.accent[1]}" stroke-width="4" />
    <path d="M ${cardX + cardW} ${cardY + 50} L ${cardX + cardW} ${cardY} L ${cardX + cardW - 50} ${cardY}" fill="none" stroke="${theme.accent[1]}" stroke-width="4" />
    <path d="M ${cardX} ${cardY + cardH - 50} L ${cardX} ${cardY + cardH} L ${cardX + 50} ${cardY + cardH}" fill="none" stroke="${theme.accent[1]}" stroke-width="4" />
    <path d="M ${cardX + cardW} ${cardY + cardH - 50} L ${cardX + cardW} ${cardY + cardH} L ${cardX + cardW - 50} ${cardY + cardH}" fill="none" stroke="${theme.accent[1]}" stroke-width="4" />
  `;

  return `
    ${decorationHtml}
    ${contentHtml}
    ${badgeHtml}
  `;
}

function generateSvg(options, allThemes) {
  const theme = allThemes[options.theme] || THEMES.midnight;
  const { width: w, height: h } = options;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <style>
    ${STYLE_CSS}
  </style>
  ${getCommonDefs()}
  ${generateBackground(theme, w, h)}
  ${generateContent(options, theme)}
</svg>`;
}

function validateOptions(options, allThemes) {
  if (options.listThemes) {
    return; // No validation needed for listing
  }

  if (!options.output) {
    console.error("Error: --output is required");
    printHelp();
    process.exit(1);
  }
  if (!options.title) {
    console.error("Error: --title is required");
    printHelp();
    process.exit(1);
  }
  if (!allThemes[options.theme]) {
    console.error(`Error: Unknown theme "${options.theme}"`);
    console.error(`Available themes: ${Object.keys(allThemes).join(", ")}`);
    console.error('Use --list-themes to see details, or --theme-file to load a custom theme.');
    process.exit(1);
  }
  if (isNaN(options.width) || options.width <= 0) {
    console.error("Error: --width must be a positive integer");
    process.exit(1);
  }
  if (isNaN(options.height) || options.height <= 0) {
    console.error("Error: --height must be a positive integer");
    process.exit(1);
  }
}

// Main
const options = parseArgs();
const customThemes = loadCustomTheme(options.themeFile);
const allThemes = { ...THEMES, ...customThemes };

if (options.listThemes) {
  listThemes(customThemes);
  process.exit(0);
}

validateOptions(options, allThemes);

const svg = generateSvg(options, allThemes);

const outputDir = path.dirname(options.output);
if (outputDir && !fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(options.output, svg);

const themeDef = allThemes[options.theme];
console.log(`SVG Header Image Generator`);
console.log(`--------------------------`);
console.log(`  Title: ${options.title}`);
if (options.subtitle) console.log(`  Subtitle: ${options.subtitle}`);
console.log(`  Theme: ${options.theme} (${themeDef.name})`);
console.log(`  Size: ${options.width}x${options.height}`);
if (options.badge) console.log(`  Badge: ${options.badge}`);
if (options.category) console.log(`  Category: ${options.category}`);
console.log(`  Output: ${options.output}`);
