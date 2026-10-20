'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/paws-navigation.js'), 'utf8');
const PRIVATE = 'confidentialnarwhalprocedure unique secret body';
const metadata = () => ({apps: [
  {id: 'tours', href: '/tours', title: 'Tours', kind: 'page', category: 'Front Desk', section: '', aliases: ['facility visits'], iconKey: 'calendar'},
  {id: 'kb-example', href: '/kb/activity-procedures/Example', title: 'Example', kind: 'article', category: 'Knowledge Base', section: 'Activity Procedures', aliases: [], iconKey: 'book'},
  {id: 'kb-next', href: '/kb/activity-procedures/Next', title: 'Next', kind: 'article', category: 'Knowledge Base', section: 'Activity Procedures', aliases: [], iconKey: 'book'},
]});
const rows = text => [{path: '/kb/activity-procedures/Example', search_text: text}];
const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }

// Execute the actual navigation indexing/loading boundary with a tiny event
// surface. Layout/rendering is intentionally stubbed; no test auth clients exist.
async function harness(manifest = metadata(), options = {}) {
  const requests = [], listeners = new Map(), publicCalls = [];
  const window = {addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); }};
  if (options.knowledge !== false) window.PawsKnowledgeBase = {loadSearchIndex() { const pending = deferred(); requests.push(pending); return pending.promise; }};
  const start = source.indexOf('  function indexDestinations()');
  const end = source.lastIndexOf('\n})();');
  assert.ok(start > 0 && end > start, 'The actual navigation indexing boundary is present.');
  const normalize = source.match(/^  const normalize = .+;$/m)?.[0];
  const normalizePath = source.match(/^  const normalizePath = .+;$/m)?.[0];
  assert.ok(normalize && normalizePath);
  const context = vm.createContext({window, URL, Map, Set, location: {href: 'https://hq.pawspet.com/'}, inputManifest: structuredClone(manifest),
    fetch: async (url, settings) => { publicCalls.push({url, settings}); return {ok: true, async json() { return context.inputManifest; }}; }});
  vm.runInContext(`
    let apps=[],privateSearchGeneration=0,opened=true,query='confidential',renderCount=0;
    const heading={},content={append(){}},make=()=>({});
    function render(){renderCount++;}
    ${normalize}
    ${normalizePath}
    ${source.slice(start, end)}
    globalThis.boundary={refreshPrivateSearch,clearPrivateSearch,
      snapshot:()=>JSON.parse(JSON.stringify({apps,renderCount,privateSearchGeneration}))};
  `, context);
  await flush();
  return {requests, publicCalls, snapshot: () => context.boundary.snapshot(), refresh: () => context.boundary.refreshPrivateSearch(),
    async event(type, fields = {}) { for (const callback of listeners.get(type) || []) callback({type, ...fields}); await flush(); }};
}
const article = h => h.snapshot().apps.find(app => app.id === 'kb-example');
function assertNoPrivate(h) {
  const result = h.snapshot();
  assert.ok(!JSON.stringify(result).includes('confidentialnarwhalprocedure'));
  for (const app of result.apps) { assert.equal(app.searchText, undefined); assert.equal(app._searchSnippet, undefined); assert.equal(app._searchIndex.body, ''); }
}

test('public navigation and legacy search JSON contain destination metadata only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/navigation.json'), 'utf8'));
  const allowed = new Set(['id', 'href', 'title', 'kind', 'category', 'section', 'aliases', 'iconKey', 'quickAccess', 'pinned']);
  assert.ok(manifest.apps.length > 100, 'The KB/private migration must retain the existing destinations.');
  for (const app of manifest.apps) for (const key of Object.keys(app)) assert.ok(allowed.has(key), `Unexpected public navigation property: ${key} (${app.href})`);
  const legacy = JSON.parse(fs.readFileSync(path.join(root, 'search/index.json'), 'utf8'));
  assert.ok(Array.isArray(legacy));
  for (const entry of legacy) for (const key of Object.keys(entry)) assert.ok(['title', 'url'].includes(key), `Private legacy search field: ${key}`);
});

test('navigation builder never emits prose from the available KB sources', () => {
  const script = `import importlib.util,json,pathlib,sys\np=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('private_nav_builder',p/'scripts/build-navigation.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.manifest_from(p)))`;
  const generated = spawnSync('python3', ['-c', script, root], {encoding: 'utf8', maxBuffer: 1024 * 1024});
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = JSON.parse(generated.stdout);
  assert.ok(manifest.apps.length > 100);
  for (const app of manifest.apps) for (const key of ['searchText', 'search_text', 'content', 'html_content', 'body', 'excerpt']) assert.equal(app[key], undefined, app.href);
});

test('runtime ignores stale public searchText and only hydrates matching KB destinations from the authenticated service', async () => {
  const manifest = metadata(); manifest.apps.forEach(app => {app.searchText = PRIVATE;});
  const h = await harness(manifest); assertNoPrivate(h);
  assert.equal(h.publicCalls.length, 1); assert.equal(h.publicCalls[0].settings.cache, 'no-store');
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve([...rows(PRIVATE), {path: '/tours', search_text: 'must not attach to operation pages'}, {path: '/kb/not-in-menu', search_text: 'must not create new destinations'}]);
  await flush();
  assert.equal(article(h).searchText, PRIVATE); assert.equal(article(h)._searchIndex.body, PRIVATE);
  assert.equal(h.snapshot().apps.find(app => app.id === 'tours').searchText, undefined); assert.equal(h.snapshot().apps.length, 3);
});

test('confirmed revocation clears private text, snippets, and the complete normalized search index', async () => {
  const h = await harness(); h.requests[0].resolve(rows(PRIVATE)); await flush(); assert.equal(article(h).searchText, PRIVATE);
  const before = h.snapshot().renderCount;
  await h.event('paws-access-revoked'); assertNoPrivate(h); assert.ok(h.snapshot().renderCount > before);
  assert.equal(h.snapshot().apps.length, 3); assert.ok(article(h)._searchIndex.all.includes('example'));
});

test('a private search request resolving after revocation cannot restore confidential text', async () => {
  const h = await harness(); await h.event('paws-access-revoked');
  h.requests[0].resolve(rows(PRIVATE)); await flush(); assertNoPrivate(h);
});

test('a new identity refresh supersedes old in-flight results in either resolution order', async () => {
  const h = await harness(); const fresh = h.refresh(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(rows('newidentitybody')); await fresh;
  h.requests[0].resolve(rows(PRIVATE)); await flush();
  assert.equal(article(h).searchText, 'newidentitybody'); assert.ok(!JSON.stringify(h.snapshot()).includes(PRIVATE));
});

test('private fetch errors remove the existing private index without changing public destinations', async () => {
  const h = await harness(); h.requests[0].resolve(rows(PRIVATE)); await flush();
  const retry = h.refresh(); h.requests[1].reject(Error('connection failed')); await retry;
  assertNoPrivate(h); assert.equal(h.snapshot().apps.length, 3);
});

test('denied and pagehide events clear caches, while BFCache restore fetches current approved data again', async () => {
  const h = await harness(); h.requests[0].resolve(rows(PRIVATE)); await flush();
  await h.event('paws-knowledge-access-denied'); assertNoPrivate(h);
  await h.event('pageshow', {persisted: true}); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(rows(PRIVATE)); await flush(); assert.equal(article(h).searchText, PRIVATE);
  await h.event('pagehide'); assertNoPrivate(h);
  await h.event('pageshow', {persisted: false}); assert.equal(h.requests.length, 2);
  await h.event('paws-access-restored'); assert.equal(h.requests.length, 3);
  h.requests[2].resolve(rows('restoredprivatebody')); await flush(); assert.equal(article(h).searchText, 'restoredprivatebody');
});

test('missing private client leaves metadata search usable and never creates a second auth client', async () => {
  const h = await harness(metadata(), {knowledge: false}); assert.equal(h.requests.length, 0); assertNoPrivate(h);
  assert.ok(!source.includes('supabase.createClient')); assert.ok(!source.includes('localStorage.setItem(\'knowledge'));
  assert.ok(h.snapshot().apps.find(app => app.id === 'tours')._searchIndex.all.includes('facility visits'));
});

test('retired category generator fails safely without replacing public pages or the shared sidebar', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'paws-retired-kb-generator-'));
  try {
    fs.mkdirSync(path.join(temporary, 'kb/category'), {recursive: true}); fs.mkdirSync(path.join(temporary, 'partials'));
    const files = {'template.html': '<article>{{CONTENT}}</article>', 'partials/sidebar.html': 'KEEP ALL OPERATIONAL CATEGORIES', 'kb/category/index.html': '<article data-knowledge-page="/kb/category/">Loading knowledgebase…</article>'};
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(temporary, name), content);
    const retired = spawnSync('python3', [path.join(root, 'generate_kb_indexes.py')], {cwd: temporary, encoding: 'utf8'});
    assert.equal(retired.status, 2); assert.match(retired.stderr, /Retired/); assert.match(retired.stderr, /private hq_knowledge_pages/); assert.match(retired.stderr, /build-navigation\.py/);
    for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(temporary, name), 'utf8'), content);
    const help = spawnSync('python3', [path.join(root, 'generate_kb_indexes.py'), '--help'], {cwd: temporary, encoding: 'utf8'});
    assert.equal(help.status, 0); assert.match(help.stdout, /private content belongs in Supabase/);
  } finally {fs.rmSync(temporary, {recursive: true, force: true});}
});
