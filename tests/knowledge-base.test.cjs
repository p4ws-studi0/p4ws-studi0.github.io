'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const kb = require('../assets/knowledge-base.js');
const root = path.resolve(__dirname, '..');

function fakeClient(options = {}) {
  const calls = [];
  const user = {id: 'staff-id'};
  const client = {
    auth: {async getSession() {
      calls.push(['getSession']);
      if (options.sessionThrows) throw new Error('offline');
      return {data: {session: options.signedOut ? null : {user}}, error: options.sessionError || null};
    }},
    from(table) {
      calls.push(['from', table]);
      let filters = [];
      const query = {
        select(columns) { calls.push(['select', table, columns]); return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        async maybeSingle() {
          calls.push(['single', table, filters]);
          if (table === 'hq_tour_staff') {
            if (options.approvalThrows) throw new Error('network');
            return {data: options.missingApproval ? null : {user_id: options.otherUser ? 'other' : user.id, active: options.active !== false}, error: options.approvalError || null};
          }
          return {data: options.noPage ? null : {path: filters.find(pair => pair[0] === 'path')[1], title: 'Page', html_content: '<h1>Private page</h1>'}, error: options.pageError || null};
        },
        async order(column) {
          calls.push(['order', table, column, filters]);
          return {data: options.searchRows || [], error: options.searchError || null};
        }
      };
      return query;
    },
    storage: {from(bucket) { return {async download(object) { calls.push(['download', bucket, object]); return {data: options.imageError ? null : new Blob(['image']), error: options.imageError || null}; }}; }}
  };
  return {client, calls};
}

test('legacy, clean, index, and archived addresses preserve a stable private key', () => {
  for (const [source, expected] of [
    ['/kb/index.html', '/kb/'], ['/kb/', '/kb/'],
    ['/kb/activity-procedures/index.html', '/kb/activity-procedures/'],
    ['/kb/activity-procedures/Group_Playtimes.html?from=old#list', '/kb/activity-procedures/Group_Playtimes'],
    ['/kb%20copy/%20other/2025_Peak_Rate_Calendar.html', '/kb copy/ other/2025_Peak_Rate_Calendar']
  ]) assert.equal(kb.cleanPath(source), expected);
  for (const source of ['/settings', '/kb/%00bad', '/kb/%5Cbad', '/kb/%ZZ', '/kb/%2e%2e/settings']) assert.throws(() => kb.cleanPath(source));
});

test('formatting CSS survives while executable or requesting CSS is removed', () => {
  assert.equal(kb.safeStyle('font-size: 16px; width: 90%; margin-left: 12px; position: fixed'), 'font-size: 16px; width: 90%; margin-left: 12px');
  for (const css of ['background: url(https://example.test/private)', 'list-style-image: image-set("https://example.test/private" 1x)', 'width: expression(alert(1))', 'color: red; --payload: x', '@import "other.css"', 'color: red\\3b']) {
    const result = kb.safeStyle(css);
    assert.ok(!/url|image-set|expression|@import|--payload|\\/.test(result));
  }
});

test('article links retain relative paths, old anchors and external resources safely', () => {
  const current = 'https://hq.pawspet.com/kb/petcare-procedures/Feeding';
  assert.equal(kb.safeLink('../activity-procedures/Group_Playtimes.html#schedule', current), '/kb/activity-procedures/Group_Playtimes#schedule');
  assert.equal(kb.safeLink('/kb/index.html?from=old', current), '/kb/?from=old');
  assert.equal(kb.safeLink('https://drive.google.com/file/d/test/view', current), 'https://drive.google.com/file/d/test/view');
  for (const value of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', 'https://user:secret@example.test/', 'file:///private']) assert.equal(kb.safeLink(value, current), null);
});

test('private search excludes archived rows and malformed content', () => {
  const rows = kb.searchRows([
    {path: '/kb/one', title: 'One', search_text: 'Private prose', is_archive: false, page_kind: 'article'},
    {path: '/kb copy/one', search_text: 'Archived', is_archive: true},
    {path: '/kb/two', search_text: '<still text>', is_archive: true},
    {path: '/settings', search_text: 'other'}, {path: '/kb/bad', search_text: null}
  ]);
  assert.deepEqual(rows, [{path: '/kb/one', title: 'One', category: '', search_text: 'Private prose', page_kind: 'article'}]);
});

test('the existing active staff session reads an article without creating or changing auth', async () => {
  const fixture = fakeClient();
  const result = await kb.createService(fixture.client).readPage('/kb/one.html');
  assert.equal(result.html_content, '<h1>Private page</h1>');
  assert.deepEqual(fixture.calls.filter(call => call[0] === 'from').map(call => call[1]), ['hq_tour_staff', 'hq_knowledge_pages']);
  assert.equal(fixture.calls[0][0], 'getSession');
});

for (const [name, options, code] of [
  ['anonymous', {signedOut: true}, 'SIGN_IN_REQUIRED'],
  ['inactive staff', {active: false}, 'ACCESS_DENIED'],
  ['unapproved staff', {missingApproval: true}, 'ACCESS_DENIED'],
  ['a mismatched staff record', {otherUser: true}, 'ACCESS_DENIED']
]) test(name + ' cannot request any article or search data', async () => {
  for (const method of ['readPage', 'readSearchIndex']) {
    const fixture = fakeClient(options), service = kb.createService(fixture.client);
    await assert.rejects(service[method]('/kb/one'), error => error.code === code && error.confirmed === true);
    assert.ok(!fixture.calls.some(call => call[0] === 'from' && call[1] === 'hq_knowledge_pages'));
  }
});

test('temporary auth and approval failures never claim the account is deactivated', async () => {
  for (const options of [{sessionThrows: true}, {sessionError: {message: 'timeout'}}, {approvalThrows: true}, {approvalError: {status: 401}}]) {
    const fixture = fakeClient(options);
    await assert.rejects(kb.createService(fixture.client).readPage('/kb/one'), error => error.code === 'UNAVAILABLE' && error.confirmed === false);
  }
});

test('missing article and transport failure provide retryable errors without session mutation', async () => {
  for (const [options, code] of [[{noPage: true}, 'NOT_FOUND'], [{pageError: {status: 503}}, 'UNAVAILABLE']]) {
    const fixture = fakeClient(options);
    await assert.rejects(kb.createService(fixture.client).readPage('/kb/one'), error => error.code === code && !error.confirmed);
    assert.equal(Object.keys(fixture.client.auth).join(','), 'getSession');
  }
});

test('search asks the protected table for nonarchive content and never requests HTML', async () => {
  const fixture = fakeClient({searchRows: [{path: '/kb/one', title: 'One', search_text: 'Private prose', is_archive: false}]});
  const rows = await kb.createService(fixture.client).readSearchIndex();
  assert.equal(rows[0].search_text, 'Private prose');
  const select = fixture.calls.find(call => call[0] === 'select' && call[1] === 'hq_knowledge_pages');
  assert.ok(!select[2].includes('html_content'));
  assert.deepEqual(fixture.calls.find(call => call[0] === 'order')[3], [['is_archive', false]]);
});

test('image reads use private bucket downloads, rejecting arbitrary paths and extensions', async () => {
  const fixture = fakeClient(), service = kb.createService(fixture.client), object = 'images/' + 'a'.repeat(64) + '.png';
  assert.ok(await service.readImage(object) instanceof Blob);
  assert.deepEqual(fixture.calls.find(call => call[0] === 'download'), ['download', 'hq-knowledge-media', object]);
  for (const value of ['../../secret', 'https://example.test/a.png', 'images/' + 'a'.repeat(64) + '.svg', 'images/logo.png']) await assert.rejects(service.readImage(value), error => error.code === 'INVALID_IMAGE');
});

test('an image failure confirms revocation before returning an access-denied state', async () => {
  const fixture = fakeClient({imageError: {status: 403}, active: false});
  await assert.rejects(kb.createService(fixture.client).readImage('images/' + 'a'.repeat(64) + '.png'), error => error.code === 'ACCESS_DENIED' && error.confirmed);
});

test('database policies enforce active-staff reads and no browser writes', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/knowledge-base-setup.sql'), 'utf8');
  assert.match(sql, /hq_knowledge_pages enable row level security/);
  assert.match(sql, /revoke all on table public\.hq_knowledge_pages from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.hq_knowledge_pages to authenticated/);
  assert.match(sql, /s\.user_id = \(select auth\.uid\(\)\) and s\.active/g);
  assert.match(sql, /values \('hq-knowledge-media', 'hq-knowledge-media', false\)/);
  assert.match(sql, /as restrictive for select to anon\s+using \(bucket_id <> 'hq-knowledge-media'\)/);
  assert.match(sql, /as restrictive for select to authenticated/);
  assert.ok(!/grant\s+(?:all|insert|update|delete)[^;]*to authenticated/i.test(sql));
  assert.ok(!/update\s+auth\.|delete\s+from\s+auth\.|alter\s+role/i.test(sql));
});

test('the browser feature cannot sign anyone out or persist private prose', () => {
  const source = fs.readFileSync(path.join(root, 'assets/knowledge-base.js'), 'utf8');
  assert.ok(!/\.signOut\s*\(|\.createClient\s*\(|\.createSignedUrl\s*\(|(?:localStorage|sessionStorage|indexedDB)\s*\./.test(source));
  assert.match(source, /revokeObjectURL/);
  assert.match(source, /paws-access-revoked/);
  assert.match(source, /event\.persisted && host/);
});

test('exporter preserves active and archive formatting while moving local images into a private bundle', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'paws-private-kb-test-'));
  try {
    const fixture = path.join(temporary, 'site'), output = path.join(temporary, 'private');
    fs.mkdirSync(path.join(fixture, 'kb/category'), {recursive: true});
    fs.mkdirSync(path.join(fixture, 'kb copy/ other'), {recursive: true});
    fs.mkdirSync(path.join(fixture, 'images/qu'), {recursive: true});
    fs.writeFileSync(path.join(fixture, 'images/qu/example.png'), Buffer.from('private-image-fixture'));
    fs.writeFileSync(path.join(fixture, 'images/qu/old.jpg'), Buffer.from('private-orphan-fixture'));
    const page = '<html><head><title>Example - Paws Help Site</title></head><body><article><h1>Example</h1><table style="width: 90%"><tr><td>O\'Brien &amp; friends</td></tr></table><img src="/images/qu/example.png" onerror="alert(1)"><a href="Next.html#info">Next</a><script>window.bad=1</script><p style="background:url(https://bad.example)">Safe text</p><img src="https://example.test/old-image.png"></article></body></html>';
    fs.writeFileSync(path.join(fixture, 'kb/category/Example.html'), page);
    fs.writeFileSync(path.join(fixture, 'kb copy/ other/Example.html'), page);
    const result = spawnSync('python3', [path.join(root, 'scripts/prepare-private-kb.py'), '--repo', fixture, '--output', output], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout), rows = JSON.parse(fs.readFileSync(path.join(output, 'knowledge-pages.json')));
    assert.equal(summary.active_pages, 1); assert.equal(summary.archive_pages, 1); assert.equal(summary.local_media_files, 2);
    assert.equal(rows.length, 2); assert.equal(rows[0].path, '/kb/category/Example'); assert.equal(rows[1].path, '/kb copy/ other/Example');
    assert.match(rows[0].html_content, /<table style="width: 90%">/);
    assert.match(rows[0].html_content, /O'Brien &amp; friends/);
    assert.match(rows[0].html_content, /data-knowledge-image="[a-f0-9]{64}\.png"/);
    assert.match(rows[0].html_content, /href="\/kb\/category\/Next#info"/);
    assert.match(rows[0].html_content, /src="https:\/\/example.test\/old-image.png"/);
    assert.ok(!/onerror|<script|window\.bad|url\(/.test(rows[0].html_content));
    assert.match(rows[0].search_text, /O'Brien & friends/);
    assert.ok(!rows[0].search_text.includes('window.bad'));
    const plan = JSON.parse(fs.readFileSync(path.join(output, 'knowledge-shell-plan.json')));
    assert.match(plan[0].article_replacement, /data-knowledge-page/);
    assert.ok(!plan[0].article_replacement.includes("O'Brien"));
    assert.ok(fs.readFileSync(path.join(output, 'knowledge-pages-seed.sql'), 'utf8').includes("O''Brien"));
    assert.ok(fs.existsSync(path.join(output, 'knowledge-pages.csv')));
    for (const file of fs.readdirSync(path.join(output, 'sql-chunks'))) assert.ok(fs.statSync(path.join(output, 'sql-chunks', file)).size < 150000);
    assert.equal(fs.statSync(output).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(output, 'knowledge-pages.json')).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(fixture, 'kb/category/Example.html'), 'utf8'), page);
    const unsafe = spawnSync('python3', [path.join(root, 'scripts/prepare-private-kb.py'), '--repo', fixture, '--output', path.join(fixture, 'unsafe')], {encoding: 'utf8'});
    assert.equal(unsafe.status, 1); assert.match(unsafe.stderr, /OUTSIDE/);
    assert.ok(!fs.existsSync(path.join(fixture, 'unsafe')));
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
