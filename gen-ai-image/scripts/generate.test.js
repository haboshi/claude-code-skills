/**
 * gen-ai-image generate.js のダウンロード安全性テスト
 *
 * テスト対象: generate.js の validateImageUrl (export済み)
 * P1: SSRF保護（HTTPSスキーム検証、プライベートIP拒否、リダイレクト制御、サイズ上限）
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceCode = readFileSync(resolve(__dirname, "generate.js"), "utf-8");

// generate.js から validateImageUrl を直接インポート
import { validateImageUrl } from "./generate.js";

describe("ソースコード安全性チェック", () => {
  it("validateImageUrl 関数が存在する", () => {
    assert.ok(
      sourceCode.includes("validateImageUrl"),
      "validateImageUrl 関数が必要"
    );
  });

  it("downloadAndSave で redirect: manual を使用する", () => {
    assert.ok(
      sourceCode.includes('redirect: "manual"') ||
        sourceCode.includes("redirect: 'manual'"),
      'fetch に redirect: "manual" が必要'
    );
  });

  it("ダウンロードにサイズ上限チェックがある", () => {
    assert.ok(
      sourceCode.includes("MAX_DOWNLOAD_SIZE"),
      "ダウンロードサイズ上限チェック (MAX_DOWNLOAD_SIZE) が必要"
    );
  });

  it("fetch にタイムアウトが設定されている", () => {
    assert.ok(
      sourceCode.includes("AbortSignal.timeout"),
      "fetch にタイムアウト（AbortSignal.timeout）が必要"
    );
  });

  it("validateImageUrl が export されている", () => {
    assert.ok(
      sourceCode.includes("export function validateImageUrl"),
      "validateImageUrl が export されている必要がある"
    );
  });

  it("HTTPSスキームのみ許可するコードがある", () => {
    assert.ok(
      sourceCode.includes('protocol !== "https:"') ||
        sourceCode.includes("protocol !== 'https:'"),
      "HTTPSスキーム検証が必要"
    );
  });

  it("プライベートIP範囲のブロックがある", () => {
    assert.ok(
      sourceCode.includes("PRIVATE_IP_RANGES"),
      "プライベートIP範囲のブロック定義が必要"
    );
  });

  it("アトミック書き込みを使用している", () => {
    assert.ok(
      sourceCode.includes("renameSync"),
      "アトミック書き込み（tmpファイル→renameSync）が必要"
    );
  });

  it("リダイレクト先のURL検証がある", () => {
    assert.ok(
      sourceCode.includes("validateImageUrl(redirectUrl)"),
      "リダイレクト先URLの検証が必要"
    );
  });

  it("リダイレクト上限超過のエラーハンドリングがある", () => {
    assert.ok(
      sourceCode.includes("MAX_REDIRECTS") &&
        sourceCode.includes("リダイレクト回数が上限"),
      "リダイレクト回数上限超過時のエラーメッセージが必要"
    );
  });

  it("相対URLリダイレクトを絶対URLに解決している", () => {
    assert.ok(
      sourceCode.includes("new URL(rawLocation, currentUrl)"),
      "相対URLリダイレクトの絶対URL変換が必要"
    );
  });
});

describe("validateImageUrl（実関数テスト）", () => {
  // --- スキーム検証 ---

  it("HTTPS URLを許可する", () => {
    assert.doesNotThrow(() =>
      validateImageUrl("https://cdn.example.com/image.png")
    );
  });

  it("HTTP URLを拒否する", () => {
    assert.throws(
      () => validateImageUrl("http://example.com/image.png"),
      /HTTPS/i
    );
  });

  it("file:// スキームを拒否する", () => {
    assert.throws(() => validateImageUrl("file:///etc/passwd"));
  });

  // --- プライベートIP ---

  it("localhost を拒否する", () => {
    assert.throws(() => validateImageUrl("https://localhost/image.png"));
  });

  it("127.0.0.1 を拒否する", () => {
    assert.throws(() => validateImageUrl("https://127.0.0.1/image.png"));
  });

  it("10.0.0.1 を拒否する", () => {
    assert.throws(() => validateImageUrl("https://10.0.0.1/image.png"));
  });

  it("192.168.1.1 を拒否する", () => {
    assert.throws(() => validateImageUrl("https://192.168.1.1/image.png"));
  });

  it("172.16.0.1 を拒否する", () => {
    assert.throws(() => validateImageUrl("https://172.16.0.1/image.png"));
  });

  it("169.254.169.254 リンクローカルを拒否する", () => {
    assert.throws(() => validateImageUrl("https://169.254.169.254/image.png"));
  });

  it("0.0.0.0 を拒否する", () => {
    assert.throws(() => validateImageUrl("https://0.0.0.0/image.png"));
  });

  it("100.64.0.1 共有アドレス空間を拒否する", () => {
    assert.throws(() => validateImageUrl("https://100.64.0.1/image.png"));
  });

  // --- IPv6 ---

  it("[::1] IPv6ループバックを拒否する", () => {
    assert.throws(() => validateImageUrl("https://[::1]/image.png"));
  });

  it("[fe80::1] IPv6リンクローカルを拒否する", () => {
    assert.throws(() => validateImageUrl("https://[fe80::1]/image.png"));
  });

  it("[fc00::1] IPv6ユニークローカルを拒否する", () => {
    assert.throws(() => validateImageUrl("https://[fc00::1]/image.png"));
  });

  it("[::ffff:127.0.0.1] IPv4マップドIPv6ループバックを拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[::ffff:127.0.0.1]/image.png")
    );
  });

  it("[::ffff:10.0.0.1] IPv4マップドIPv6プライベートを拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[::ffff:10.0.0.1]/image.png")
    );
  });

  it("[::ffff:192.168.1.1] IPv4マップドIPv6を拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[::ffff:192.168.1.1]/image.png")
    );
  });

  it("[::ffff:169.254.169.254] IPv4マップドリンクローカルを拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[::ffff:169.254.169.254]/image.png")
    );
  });

  // --- IPv6 トンネリング ---

  it("[2002:c0a8:101::] 6to4トンネリングを拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[2002:c0a8:101::]/image.png"),
      /6to4/
    );
  });

  it("[2001:0:4136:e378:8000:63bf:3fff:fdd2] Teredoを拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/image.png"),
      /Teredo/
    );
  });

  it("[ff02::1] マルチキャストを拒否する", () => {
    assert.throws(() =>
      validateImageUrl("https://[ff02::1]/image.png"),
      /マルチキャスト/
    );
  });

  // --- パブリック許可 ---

  it("パブリックIP 8.8.8.8 を許可する", () => {
    assert.doesNotThrow(() =>
      validateImageUrl("https://8.8.8.8/image.png")
    );
  });

  it("パブリックドメインを許可する", () => {
    assert.doesNotThrow(() =>
      validateImageUrl("https://example.com/image.png")
    );
  });

  // --- エッジケース ---

  it("空URLを拒否する", () => {
    assert.throws(() => validateImageUrl(""));
  });

  it("nullを拒否する", () => {
    assert.throws(() => validateImageUrl(null));
  });

  it("undefinedを拒否する", () => {
    assert.throws(() => validateImageUrl(undefined));
  });
});
