'use strict';
// 自動リフレッシュ（決定論・Claude不要）。SessionEnd フックが stale 検知時に detached で起動する。
// cluster → build-report（openReport でサーバ起動＋ブラウザオープン）を順に走らせる。
// LLM 分析・codex 画像の"新規生成"は行わない（既存キャッシュは build-report が表示）。

const { spawnSync } = require('child_process');
const path = require('path');
const C = require('./common');

const config = C.loadConfig();
const win = (config.auto_refresh && config.auto_refresh.window) || (config.analysis && config.analysis.window) || '14d';

spawnSync(process.execPath, [path.join(__dirname, 'cluster.js'), '--window', win], { stdio: 'ignore' });
spawnSync(process.execPath, [path.join(__dirname, 'build-report.js')], { stdio: 'ignore' }); // openReport でサーバ起動＋オープン
