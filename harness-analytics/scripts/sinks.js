'use strict';
// ダイジェスト/高シグナルの出力先を差し替え可能にする sink 抽象化。
// - LocalSink: セッションダイジェストをローカルに書く（必須・常時 ON）。
// - FetchDbOutboxSink: 高シグナル record を outbox(JSONL) に queue する（任意）。
//   ※ MCP ツールは Node プロセスから直接呼べない（Claude のみ）。よって Node 側は「送信待ち」を
//     outbox に貯め、実際の mcp__fetch-db__record_interaction 送信は SKILL(Claude) が drain する。
//   未接続でもローカルは完結する（FetchDB は「可能であれば」の従属 sink）。

const fs = require('fs');
const path = require('path');
const C = require('./common');

const OUTBOX_PATH = path.join(C.HA_DIR, 'outbox', 'fetchdb.jsonl');

// セッションダイジェストをローカルに書き込む（1セッション=1ファイル、上書き＝冪等）。
class LocalSink {
  constructor() { this.name = 'local'; }
  available() { return true; }
  emit(digest) {
    const dir = path.join(C.DIGESTS_DIR, digest.cwd_slug || 'unknown');
    const p = path.join(dir, `${digest.session_id}.json`);
    C.writeJson(p, digest);
    return { ok: true, sink: this.name, skipped: false, path: p };
  }
  flush() {}
}

// 高シグナル record を FetchDB outbox に queue する（config で ON のときのみ）。
class FetchDbOutboxSink {
  constructor(config) {
    this.name = 'fetchdb-outbox';
    const fc = (config && config.sinks && config.sinks.fetchdb) || {};
    this.enabled = fc.enabled === true;
    this.minSeverity = fc.min_severity || 'failure';
    this._buf = [];
  }
  // Node 側は queue できるかだけを返す（実送信可否＝MCP 到達性は SKILL が判定）。
  available() { return this.enabled; }
  // record: { type, peer, content, tags, impact_scope, tool_source, severity }
  emit(record) {
    if (!this.enabled) return { ok: true, sink: this.name, skipped: true, reason: 'disabled' };
    // secret/path を外部送信前に必ず畳む（ローカルより高リスク）
    const safe = {
      ...record,
      content: C.sanitize(record.content || '', 500),
      queued_at: C.nowIso(),
    };
    this._buf.push(safe);
    return { ok: true, sink: this.name, skipped: false };
  }
  flush() {
    if (!this.enabled || this._buf.length === 0) return;
    fs.mkdirSync(path.dirname(OUTBOX_PATH), { recursive: true });
    const lines = this._buf.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(OUTBOX_PATH, lines);
    this._buf = [];
  }
}

// config から有効な sink 群を返す。呼び出し側は available() で分岐する。
function getSinks(config) {
  return [new LocalSink(), new FetchDbOutboxSink(config)];
}

module.exports = { LocalSink, FetchDbOutboxSink, getSinks, OUTBOX_PATH };
