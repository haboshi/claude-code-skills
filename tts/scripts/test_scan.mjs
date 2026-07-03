/**
 * dict.js scan コマンドのテスト
 *
 * extractEnglishWords, extractTextFromDialogue, cmdScan の動作確認と
 * 既存コマンドの後方互換性テスト
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DICT_JS = path.join(__dirname, "dict.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function run(args, options = {}) {
  try {
    const result = execFileSync("node", [DICT_JS, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      ...options,
    });
    return { stdout: result, exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    };
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL: ${name}: ${error.message}`);
  }
}

// === scan --text --dry-run テスト ===

test("scan: 英単語を正しく抽出する", () => {
  const result = run(["scan", "--text", "Claude CodeのPlan ModeでTypeScriptを書く", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("Claude"), "Claude not found");
  assert(result.stdout.includes("Code"), "Code not found");
  assert(result.stdout.includes("Plan"), "Plan not found");
  assert(result.stdout.includes("Mode"), "Mode not found");
  assert(result.stdout.includes("TypeScript"), "TypeScript not found");
});

test("scan: EXCLUDE_WORDS に含まれる単語を除外する", () => {
  const result = run(["scan", "--text", "import the function from this class with async", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  // "import", "the", "function", "from", "this", "class", "with", "async" は全て除外対象
  assert(
    result.stdout.includes("No English words found"),
    `Expected no words, got: ${result.stdout}`
  );
});

test("scan: 3文字未満の単語を除外する", () => {
  const result = run(["scan", "--text", "AI ML CI CD は2文字で除外される", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(
    result.stdout.includes("No English words found"),
    `Expected no words but got: ${result.stdout}`
  );
});

test("scan: 重複する単語を1つにまとめる", () => {
  const result = run(["scan", "--text", "Claude Claude Claude Code Code", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  // "Extracted 2 English words" のような表示
  assert(result.stdout.includes("Extracted 2"), `Expected 2 words: ${result.stdout}`);
});

test("scan: 辞書に既登録の単語を除外する", () => {
  const result = run(["scan", "--text", "Claude TypeScript", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  // Claude と TypeScript は dictionary.json に既登録
  assert(
    result.stdout.includes("All extracted words are already registered"),
    `Expected all registered: ${result.stdout}`
  );
});

test("scan: --dry-run では変更を加えない", () => {
  const result = run(["scan", "--text", "SomeNewUniqueWord TestWord", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("[dry-run]"), "dry-run indicator missing");
  assert(result.stdout.includes("SomeNewUniqueWord"), "word missing");
});

test("scan: 引数なしでエラーメッセージを表示する", () => {
  const result = run(["scan"]);
  assert(result.exitCode === 1, `Expected exit 1: ${result.exitCode}`);
});

test("scan: 存在しないファイルでエラー", () => {
  const result = run(["scan", "--input", "/tmp/nonexistent-file-12345.json"]);
  assert(result.exitCode === 1, `Expected exit 1: ${result.exitCode}`);
});

// === scan --input JSONファイル テスト ===

test("scan: JSONファイルからテキスト抽出", () => {
  const tmpFile = path.join(__dirname, "_test_dialogue.json");
  const dialogue = [
    { text: "Claude Codeの使い方を説明します", speaker: "narrator" },
    { text: "TypeScriptでPlaywrightのテストを書きましょう", speaker: "narrator" },
    { text: "GitHubにpushしてPullRequestを作成", speaker: "narrator" },
  ];
  fs.writeFileSync(tmpFile, JSON.stringify(dialogue), "utf-8");

  try {
    const result = run(["scan", "--input", tmpFile, "--dry-run"]);
    assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
    // Claude, Code は抽出されるべき
    assert(result.stdout.includes("Extracted"), `No extraction: ${result.stdout}`);
    assert(result.stdout.includes("Playwright"), "Playwright not found");
    assert(result.stdout.includes("PullRequest"), "PullRequest not found");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("scan: ネストされたJSON構造からテキスト抽出", () => {
  const tmpFile = path.join(__dirname, "_test_nested.json");
  const data = {
    segments: [
      { text: "Kubernetes上でDockerコンテナを管理", start: 0, end: 5 },
      {
        text: "Terraformでインフラを定義する",
        start: 5,
        end: 10,
        nested: { text: "Ansible も使える" },
      },
    ],
  };
  fs.writeFileSync(tmpFile, JSON.stringify(data), "utf-8");

  try {
    const result = run(["scan", "--input", tmpFile, "--dry-run"]);
    assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
    assert(result.stdout.includes("Kubernetes"), "Kubernetes not found");
    assert(result.stdout.includes("Docker"), "Docker not found");
    assert(result.stdout.includes("Terraform"), "Terraform not found");
    assert(result.stdout.includes("Ansible"), "Ansible not found");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("scan: テキストファイルからの読み込み", () => {
  const tmpFile = path.join(__dirname, "_test_input.txt");
  fs.writeFileSync(tmpFile, "WebSocket と GraphQL でリアルタイムAPI", "utf-8");

  try {
    const result = run(["scan", "--input", tmpFile, "--dry-run"]);
    assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
    assert(result.stdout.includes("WebSocket"), "WebSocket not found");
    assert(result.stdout.includes("GraphQL"), "GraphQL not found");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

// === --apply なし（JSON出力）テスト ===

test("scan: --apply も --dry-run もなしで JSON出力", () => {
  const result = run(["scan", "--text", "SomeVeryUniqueTestWord AnotherTestWord123"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  // JSON出力があること
  assert(result.stdout.includes("JSON for auto-add"), `No JSON output: ${result.stdout}`);
  assert(result.stdout.includes("SomeVeryUniqueTestWord"), "word missing");
});

// === 既存コマンド後方互換性テスト ===

test("list: 既存コマンドが正常動作", () => {
  const result = run(["list"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("Dictionary entries") || result.stdout.includes("empty"), "unexpected output");
});

test("check: 既存コマンドが正常動作", () => {
  const result = run(["check", "Claude", "TypeScript", "NotRegistered"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("Registered"), "Registered section missing");
});

test("help: ヘルプにscanが含まれること", () => {
  const result = run([]);
  assert(result.stdout.includes("scan"), "scan not in help");
  assert(result.stdout.includes("--dry-run"), "--dry-run not in help");
});

// === 英単語パターンのエッジケース ===

test("scan: ドット含みの単語を抽出", () => {
  const result = run(["scan", "--text", "Node.js で express.Router を使う", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("Node.js"), "Node.js not found");
});

test("scan: ハイフン含みの単語を抽出", () => {
  const result = run(["scan", "--text", "vue-router と react-dom を比較", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("vue-router"), "vue-router not found");
  assert(result.stdout.includes("react-dom"), "react-dom not found");
});

test("scan: 大文字小文字の区別を保持", () => {
  const result = run(["scan", "--text", "JavaScript TypeScript CamelCase", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("JavaScript"), "JavaScript not found (case preserved)");
  assert(result.stdout.includes("CamelCase"), "CamelCase not found (case preserved)");
});

// === --with-case-variants テスト ===

test("scan: --with-case-variants でケースバリアントを生成", () => {
  const result = run(["scan", "--text", "TestWord", "--with-case-variants", "--dry-run"]);
  assert(result.exitCode === 0, `exit code: ${result.exitCode}`);
  assert(result.stdout.includes("With case variants"), "case variants section missing");
  // TestWord -> testword, TESTWORD, Testword の3バリアント
  assert(result.stdout.includes("testword") || result.stdout.includes("TESTWORD"), "case variants not generated");
});

test("scan: --with-case-variants がヘルプに含まれる", () => {
  const result = run([]);
  assert(result.stdout.includes("--with-case-variants"), "--with-case-variants not in help");
});

// === 結果表示 ===

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
}
