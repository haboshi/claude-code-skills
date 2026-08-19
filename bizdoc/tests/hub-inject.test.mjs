// 保存時の導出領域注入（tokens / hub ナビ）と、その冪等性を固定する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';
import { findNavAnchor, injectNavFrame, jsLiteral, maskNonContent, renderNav } from '../scripts/inject.mjs';

const DOC = (title, body = '<p>本文</p>') =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<style data-bizdoc="tokens"></style></head><body>${body}</body></html>`;

function write(base, name, html) {
  const p = path.join(base, name);
  fs.writeFileSync(p, html);
  return p;
}

test('add: tokens マーカーに tokens.css が注入される', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'a.html', DOC('文書A')), '--project', proj]).trim();
  const saved = fs.readFileSync(out, 'utf8');
  assert.match(saved, /--measure:/, 'tokens.css の中身が入っていない');
  assert.match(saved, /@media print/, '印刷層まで注入されていない');
  assert.equal(saved.match(/<style\b[^>]*data-bizdoc="tokens"/g).length, 1, 'マーカーが増殖している');
});

test('add: マーカーを持たない文書は 1 バイトも変えない（tokens 部分）', () => {
  const { base, hub, proj } = setup();
  const raw = '<!doctype html><html><head><title>素の文書</title></head><body><p>本文</p></body></html>';
  const out = runHub(hub, ['add', write(base, 'b.html', raw), '--project', proj]).trim();
  const saved = fs.readFileSync(out, 'utf8');
  assert.ok(!saved.includes('--measure:'), 'マーカーなしなのに tokens が注入された');
  // nav は <body> があるので入る。nav 区間を取り除けば原文と一致するはず
  const stripped = saved.replace(/<!-- bizdoc:nav:start -->[\s\S]*?<!-- bizdoc:nav:end -->\n?/, '');
  assert.equal(stripped, raw);
});

test('add: nav 枠が <body> 直後に入り、戻りリンクが hub 一覧を指す', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'c.html', DOC('文書C')), '--project', proj]).trim();
  const saved = fs.readFileSync(out, 'utf8');
  const projectId = JSON.parse(fs.readFileSync(path.join(path.dirname(out), 'manifest.json'), 'utf8')).project_id;
  assert.match(saved, /<body[^>]*><!-- bizdoc:nav:start -->/, '<body> 直後にマーカーが無い');
  assert.ok(saved.includes(`href="../../../../index.html#p-${projectId}"`), '戻りリンクが不正');
  // 相対パスが実在の hub index に解決すること
  const resolved = path.resolve(path.dirname(out), '../../../../index.html');
  assert.equal(resolved, path.join(hub, 'index.html'));
  assert.ok(fs.existsSync(resolved));
});

test('nav: 既定 hidden で、[hidden] を !important で打ち消している（持ち出しコピー対策）', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'd.html', DOC('文書D')), '--project', proj]).trim();
  const saved = fs.readFileSync(out, 'utf8');
  assert.match(saved, /<nav class="bizdoc-hubnav" hidden/, '既定で hidden になっていない');
  assert.match(saved, /\.bizdoc-hubnav\[hidden\]\{display:none!important\}/, '[hidden] の打ち消しが無い');
  assert.match(saved, /@media print\{\.bizdoc-hubnav\{display:none!important\}\}/, '印刷時に消えない');
});

test('nav: 2本目を追加すると 1本目の nav に sibling が現れる（reindex 経由の鮮度）', () => {
  const { base, hub, proj } = setup();
  const first = runHub(hub, ['add', write(base, 'e1.html', DOC('一本目')), '--project', proj, '--slug', 'doc-one']).trim();
  assert.ok(!fs.readFileSync(first, 'utf8').includes('二本目'), '1本目の時点で sibling があるのはおかしい');
  runHub(hub, ['add', write(base, 'e2.html', DOC('二本目')), '--project', proj, '--slug', 'doc-two']);
  const saved = fs.readFileSync(first, 'utf8');
  assert.match(saved, /<details class="bizdoc-hubnav-more">/, 'sibling の details が無い');
  assert.ok(saved.includes('二本目'), '1本目の nav が更新されていない');
  assert.ok(!/<li><a href="\.\.\/[^"]*\/index\.html">一本目<\/a><\/li>/.test(saved), '自分自身が sibling に載っている');
});

test('add: --update を 2 回実行しても保存ファイルのバイト列が一致する（冪等）', () => {
  const { base, hub, proj } = setup();
  const src = write(base, 'f.html', DOC('冪等テスト'));
  const out = runHub(hub, ['add', src, '--project', proj, '--slug', 'idem']).trim();
  runHub(hub, ['add', src, '--project', proj, '--slug', 'idem', '--update']);
  const a = fs.readFileSync(out, 'utf8');
  runHub(hub, ['add', src, '--project', proj, '--slug', 'idem', '--update']);
  const b = fs.readFileSync(out, 'utf8');
  assert.equal(b, a, '再 add でバイト列が変わった');
  assert.equal((a.match(/<!-- bizdoc:nav:start -->/g) || []).length, 1, 'nav が二重注入されている');
});

test('reindex: 2 回目は書き込みが発生しない（mtime 不変）', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'g.html', DOC('文書G')), '--project', proj]).trim();
  runHub(hub, ['reindex']);
  const before = fs.statSync(out).mtimeMs;
  const bytes = fs.readFileSync(out, 'utf8');
  runHub(hub, ['reindex']);
  assert.equal(fs.statSync(out).mtimeMs, before, '無変更なのに書き込まれた');
  assert.equal(fs.readFileSync(out, 'utf8'), bytes);
});

test('add: <body> を省いた文書でも最初の本文要素の直前に入る（実在する最小構成）', () => {
  // <html>/<head>/<body> をすべて省いた文書は doc-hub に実在する（113 件中 15 件）。
  // HTML は <body> の省略を許すので、スキップせず本文の先頭に差し込む。
  const { base, hub, proj } = setup();
  const raw = '<title>断片</title><style>p{color:#333}</style><p>本文</p>';
  const out = runHub(hub, ['add', write(base, 'h.html', raw), '--project', proj]);
  assert.equal(out.trim().split('\n').length, 1, 'stdout が 1 行でない');
  const saved = fs.readFileSync(out.trim(), 'utf8');
  assert.match(saved, /<\/style><!-- bizdoc:nav:start -->/, '本文要素の直前に入っていない');
  assert.match(saved, /<!-- bizdoc:nav:end -->\n<p>本文<\/p>/, '本文が後ろに残っていない');
  assert.ok(saved.includes('p{color:#333}'), '元の CSS が失われている');
});

test('add: 差し込み位置が無い文書（本文要素なし）はスキップする', () => {
  const { base, hub, proj } = setup();
  const raw = '<title>タイトルだけ</title>';
  const out = runHub(hub, ['add', write(base, 'h2.html', raw), '--project', proj, '--slug', 'title-only']);
  assert.equal(out.trim().split('\n').length, 1, 'stdout が 1 行でない');
  const saved = fs.readFileSync(out.trim(), 'utf8');
  assert.ok(!saved.includes('bizdoc:nav'), 'アンカーが無いのに nav が入った');
  assert.equal(saved, raw, '原文が変更されている');
});

test('add: stdout は保存先パス 1 行のみ（診断は stderr へ）', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'i.html', DOC('文書I')), '--project', proj]);
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 1, `stdout が ${lines.length} 行ある: ${JSON.stringify(lines)}`);
  assert.ok(lines[0].endsWith('/index.html'));
});

test('nav: 破損 manifest のドキュメントは sibling に載らない', () => {
  const { base, hub, proj } = setup();
  const first = runHub(hub, ['add', write(base, 'j1.html', DOC('正常')), '--project', proj, '--slug', 'ok-doc']).trim();
  const other = runHub(hub, ['add', write(base, 'j2.html', DOC('壊す方')), '--project', proj, '--slug', 'bad-doc']).trim();
  fs.writeFileSync(path.join(path.dirname(other), 'manifest.json'), '{ broken');
  runHub(hub, ['reindex']);
  assert.ok(!fs.readFileSync(first, 'utf8').includes('壊す方'), '破損 doc が sibling に出ている');
});

test('nav: sibling が上限を超えたら「一覧で見る」へ送る', () => {
  const { base, hub, proj } = setup();
  const first = runHub(hub, ['add', write(base, 'k0.html', DOC('基準')), '--project', proj]).trim();
  for (let i = 1; i <= 9; i++) {
    runHub(hub, ['add', write(base, `k${i}.html`, DOC(`資料${i}`)), '--project', proj]);
  }
  const saved = fs.readFileSync(first, 'utf8');
  const items = saved.match(/<li><a href="\.\.\/[^"]+\/index\.html">/g) || [];
  assert.equal(items.length, 8, `sibling リンクが ${items.length} 件（上限 8 を超えている）`);
  assert.match(saved, /…他 1 件を一覧で見る/);
});

test('nav: projectId は JS 文字列としてリテラル化される（script 脱出の防止）', () => {
  // projectId は project.json の id、無ければ projects/ 配下のディレクトリ名に落ちるため
  // 機械生成値とは限らない。注入先の文書は外部へ配布されるので、脱出を許すと受信者側で
  // 任意 JS が走る。HTML エスケープは JS 文字列文脈を守らないので別経路で固定する。
  const evil = 'x</script><script>alert(1)</script>';
  const nav = renderNav({ projectId: evil, label: 'ラベル', docs: [], selfDir: 'self' });
  assert.equal((nav.match(/<script/g) || []).length, 1, 'script タグが増えている（脱出した）');
  assert.ok(!/<\/script><script>alert/.test(nav), '生の </script> が残っている');
  assert.match(nav, /var p="x\\u003c\/script>/, 'JS リテラル化されていない');
  // HTML 文脈側（戻りリンク・ラベル）もエスケープ済みであること
  assert.ok(!nav.includes('#p-x</script>'), 'href が HTML エスケープされていない');
});

test('jsLiteral: 引用符・改行・行区切りを安全に畳む', () => {
  assert.equal(jsLiteral('a"b'), '"a\\"b"');
  assert.equal(jsLiteral('a\nb'), '"a\\nb"');
  assert.equal(jsLiteral('<'), '"\\u003c"');
  assert.equal(jsLiteral(''), '""');
});

test('アンカー探索: コメント・script・style 内の偽タグを本文要素と誤認しない', () => {
  // これらを誤認すると、コメントやコード文字列の途中へ nav を挿して HTML を壊す
  const cases = [
    ['コメント内', '<title>t</title><!-- <div>ダミー</div> --><p>本物</p>', '<p>本物</p>'],
    ['script 内', '<title>t</title><script>var s="<p>ダミー</p>";</script><div>本物</div>', '<div>本物</div>'],
    ['style 内', '<title>t</title><style>/* <section> */body{color:#333}</style><main>本物</main>', '<main>本物</main>'],
    ['コメント内の body', '<title>t</title><!-- <body> --><p>本物</p>', '<p>本物</p>'],
    // 中身が生テキスト / RCDATA として扱われる要素（タグに見えても要素にならない）
    ['title 内', '<title><div>ダミー</div></title><p>本物</p>', '<p>本物</p>'],
    ['textarea 内', '<style>a{}</style><textarea><section>ダミー</section></textarea><main>本物</main>', '<main>本物</main>'],
    ['noscript 内', '<style>a{}</style><noscript><p>ダミー</p></noscript><div>本物</div>', '<div>本物</div>'],
    ['iframe 内', '<style>a{}</style><iframe><p>ダミー</p></iframe><h1>本物</h1>', '<h1>本物</h1>'],
  ];
  for (const [name, html, expected] of cases) {
    const at = findNavAnchor(html);
    assert.ok(at >= 0, `${name}: アンカーが見つからない`);
    assert.equal(html.slice(at, at + expected.length), expected, `${name}: 偽タグを誤認している`);
    const { html: out, injected } = injectNavFrame(html);
    assert.ok(injected, `${name}: 注入されていない`);
    assert.ok(out.includes('<!-- <div>ダミー</div> -->') || !html.includes('<!-- <div>'), `${name}: コメントが壊れた`);
  }
});

test('maskNonContent: 長さを保つ（index がずれない）', () => {
  const src = '<title>t</title><!-- xx --><script>a</script><p>本文</p>';
  const masked = maskNonContent(src);
  assert.equal(masked.length, src.length, '長さが変わっている');
  assert.ok(!masked.includes('<script'), 'script がマスクされていない');
  assert.ok(masked.includes('<p>本文</p>'), '本文までマスクされている');
});
