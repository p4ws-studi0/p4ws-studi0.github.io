'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shared = fs.readFileSync(require.resolve('../script.js'), 'utf8');
const access = fs.readFileSync(require.resolve('../assets/hq-access.js'), 'utf8');
const session = id => ({user: {id, user_metadata: {full_name: 'Active Staff'}}});
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
function target() {
  const listeners = new Map();
  return {addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); }, removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }, dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); }};
}
function node(tag) {
  return Object.assign(target(), {tagName: tag, children: [], dataset: {}, style: {}, attributes: {}, classList: {add() {}, remove() {}, contains() { return false; }}, open: false,
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name]; },
    querySelector(selector) { return this.children.find(child => child.tagName === selector) || null; }, querySelectorAll() { return []; },
    showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.removed = true; },
  });
}
function harness(options = {}) {
  const scripts = [], styles = [], events = [], authCallbacks = [], timers = new Map(), intervals = new Map(), redirects = [], calls = [], authMutations = [], storageMutations = [];
  let id = 0, context;
  const state = {session: session('active'), active: true, staffMissing: false, staffError: null, authError: null, kbFailure: Boolean(options.kbFailure), knowledge: options.knowledge || (async () => [{path: '/kb/safety', title: 'Safety', search_text: 'Private approved content'}])};
  const elements = {searchResults: node('div')};
  const body = node('body'), html = node('html'), head = node('head');
  const document = Object.assign(target(), {readyState: 'loading', visibilityState: 'visible', body, documentElement: html, head, createElement: node,
    getElementById(key) { return elements[key] || null; }, querySelector() { return null; }, querySelectorAll(selector) { return selector.startsWith('link') ? styles : []; },
  });
  head.append = child => styles.push(child);
  body.append = child => {
    body.children.push(child);
    if (!child.src) return;
    scripts.push(child.src);
    if (child.src.includes('hq-access.js')) { vm.runInContext(access, context); child.onload?.(); }
    else if (child.src.includes('knowledge-base.js')) {
      if (state.kbFailure) { state.kbFailure = false; child.onerror?.(); }
      else { context.PawsKnowledgeBase = {loadSearchIndex: () => state.knowledge()}; child.onload?.(); }
    }
  };
  const client = {auth: {
    async getSession() { calls.push('getSession'); return {data: {session: state.session}, error: state.authError}; },
    onAuthStateChange(callback) { authCallbacks.push(callback); return {data: {subscription: {unsubscribe() {}}}}; },
    signOut() { authMutations.push('signOut'); return Promise.resolve(); },
  }, functions: {async invoke(name, request) {
    calls.push({invoke: name, request});
    return options.invoke ? options.invoke(state, name, request) : {data: {success: false, error: {code: state.active === false ? 'SLACK_DEACTIVATED' : 'WORKSPACE_ACCESS_DENIED'}}, error: null};
  }}, from(table) { return {select(fields) { calls.push({table, fields}); return this; }, eq(key, value) { this.userId = value; return this; }, async maybeSingle() { if (options.staffPending) return options.staffPending; return {data: state.staffMissing ? null : {user_id: this.userId, active: state.active}, error: state.staffError}; }}; }};
  const sandbox = Object.assign(target(), {document, URL, Promise, Date, console: {log() {}, warn() {}},
    location: {href: 'https://hq.pawspet.com/tours', origin: 'https://hq.pawspet.com', replace(value) { redirects.push(value); }, reload() { authMutations.push('reload'); }},
    localStorage: {getItem() { return null; }, setItem(...args) { storageMutations.push(args); }, removeItem() { storageMutations.push('removeItem'); }, clear() { storageMutations.push('clear'); }},
    supabase: {createClient(...args) { calls.push({createClient: args}); return client; }},
    MutationObserver: class { observe() {} disconnect() {} }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; }},
    setTimeout(fn) { const next = ++id; timers.set(next, fn); return next; }, clearTimeout(next) { timers.delete(next); },
    setInterval(fn, ms) { const next = ++id; intervals.set(next, {fn, ms}); return next; }, clearInterval(next) { intervals.delete(next); },
    requestAnimationFrame(fn) { fn(); },
  });
  sandbox.window = sandbox;
  const dispatch = sandbox.dispatchEvent;
  sandbox.dispatchEvent = event => { events.push(event); dispatch(event); };
  context = vm.createContext(sandbox);
  vm.runInContext(shared + '\nglobalThis.sharedAccessTest = {enforceAuthGate, ensureHqAccessController, ensureHqWorkspaceAccess, loadSearchIndex, searchKB, getController: () => hqAccessController, getSearchState: () => ({ready: SEARCH_READY, rows: SEARCH_INDEX}), receiveHqAccess};', context);
  return {context, state, scripts, styles, calls, elements, body, html, events, timers, redirects, authMutations, storageMutations, authCallbacks,
    api: context.sharedAccessTest, async start() { document.dispatchEvent({type: 'DOMContentLoaded'}); sandbox.dispatchEvent({type: 'load'}); await flush(); },
    async runTimers() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); await flush(); },
  };
}

test('shared auth keeps the same persistent client and loads security dependencies before navigation', async () => {
  const h = harness(); await h.start();
  const clients = h.calls.filter(call => call.createClient);
  assert.equal(clients.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(clients[0].createClient[2])), {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
  const asset = name => h.scripts.findIndex(src => src.includes(name));
  assert.ok(asset('hq-access.js') < asset('knowledge-base.js'));
  assert.ok(asset('knowledge-base.js') < asset('paws-navigation.js'));
  assert.ok(h.scripts.every(src => src.includes('v=20261025a')));
  assert.equal(h.body.dataset.auth, 'ok');
  assert.equal(h.body.style.opacity, '1');
  assert.deepEqual(h.authMutations, []);
  assert.deepEqual(h.storageMutations, []);
  assert.deepEqual(h.redirects, []);
});

test('routine and delayed sign-in checks never display a connection screen', async () => {
  const pending = deferred(), h = harness({staffPending: pending.promise});
  await h.start();
  assert.ok(!h.html.children.some(child => child.className === 'hq-access-connection' && !child.removed));
  assert.equal(h.api.getController().getState().allowed, false);
  pending.resolve({data: {user_id: 'active', active: true}, error: null});
  await flush();
  assert.equal(h.body.dataset.auth, 'ok');
  assert.ok(!h.html.children.some(child => child.className === 'hq-access-connection' && !child.removed));
  assert.deepEqual(h.authMutations, []);
  assert.deepEqual(h.storageMutations, []);
});

test('account switches hide old content without a checking screen or discarded drafts', async () => {
  const options = {}, h = harness(options), form = {unsaved: 'Keep this draft'};
  h.body.children.push(form); await h.start();
  const pending = deferred(); options.staffPending = pending.promise;
  h.state.session = session('another-user');
  const checking = h.api.getController().check(h.state.session); await flush();
  assert.equal(h.body.style.opacity, '0');
  assert.ok(!h.html.children.some(child => child.className === 'hq-access-connection' && !child.removed));
  assert.ok(h.body.children.includes(form));
  pending.resolve({data: {user_id: 'another-user', active: true}, error: null});
  await checking;
  assert.equal(h.body.style.opacity, '1');
  assert.equal(h.body.dataset.auth, 'ok');
  assert.deepEqual(h.authMutations, []);
});

test('active users survive connection failures without login redirects, reloads, or session changes', async () => {
  const h = harness(); await h.start();
  h.state.authError = {message: 'offline'};
  await h.api.enforceAuthGate();
  assert.equal(h.api.getController().getState().status, 'unavailable');
  assert.equal(h.api.getController().getState().allowed, true);
  assert.equal(h.body.dataset.auth, 'ok');
  assert.deepEqual(h.redirects, []);
  assert.deepEqual(h.authMutations, []);
  assert.deepEqual(h.storageMutations, []);
});

test('confirmed deactivation clears private search, raises a notice, and preserves unsaved form nodes', async () => {
  const h = harness(); const form = {unsaved: 'Keep this draft'}; h.body.children.push(form);
  await h.start(); await h.api.loadSearchIndex();
  assert.equal(h.api.searchKB('private').length, 1);
  h.state.active = false;
  await h.api.getController().check();
  assert.equal(h.body.dataset.auth, 'restricted');
  assert.equal(h.api.getSearchState().ready, false);
  assert.equal(h.api.searchKB('private').length, 0);
  assert.ok(h.events.some(event => event.type === 'paws-access-revoked'));
  assert.equal(h.body.children.find(child => child.tagName === 'dialog').open, true);
  assert.ok(h.body.children.includes(form));
  assert.equal(form.unsaved, 'Keep this draft');
  assert.deepEqual(h.authMutations, []);
  assert.deepEqual(h.storageMutations, []);
});

test('confirmed restoration refreshes protected KB once without reloading the page or disturbing token refreshes', async () => {
  const h = harness(); await h.start();
  h.state.active = false; await h.api.getController().check();
  h.state.active = true; await h.api.getController().check();
  assert.equal(h.events.filter(event => event.type === 'paws-access-restored').length, 1);
  await h.api.getController().check();
  for (const callback of h.authCallbacks) callback('TOKEN_REFRESHED', session('active'));
  await h.runTimers();
  assert.equal(h.events.filter(event => event.type === 'paws-access-restored').length, 1);
  assert.equal(h.body.dataset.auth, 'ok');
  assert.deepEqual(h.authMutations, []);
});

test('a truly absent session retains the login flow but an initial network error does not impersonate logout', async () => {
  const missing = harness(); missing.state.session = null; await missing.start();
  assert.deepEqual(missing.redirects, ['/login']);
  assert.deepEqual(missing.authMutations, []);
  const offline = harness(); offline.state.staffError = {message: 'offline'}; await offline.start();
  assert.deepEqual(offline.redirects, []);
  assert.ok(offline.html.children.some(child => child.className === 'hq-access-connection' && !child.removed));
  assert.equal(offline.body.children.find(child => child.tagName === 'dialog').open, false);
  assert.deepEqual(offline.authMutations, []);
});

test('legacy private search ignores a pending result from the prior identity', async () => {
  const pending = deferred(), h = harness({knowledge: () => pending.promise}); await h.start();
  const search = h.api.loadSearchIndex(); await flush();
  h.state.session = session('another-user');
  await h.api.getController().check(h.state.session);
  pending.resolve([{path: '/kb/old-account', title: 'Old private page', search_text: 'Previous identity secret'}]);
  await search;
  assert.equal(h.api.getSearchState().ready, false);
  assert.equal(h.api.searchKB('secret').length, 0);
  assert.ok(h.events.some(event => event.type === 'paws-access-revoked' && event.detail.reason === 'identity-changed'));
  assert.ok(h.events.some(event => event.type === 'paws-access-restored'));
});

test('shared auth UI never calls Supabase synchronously inside the auth callback', async () => {
  const h = harness(); await h.start();
  const calls = h.calls.length;
  for (const callback of h.authCallbacks) callback('TOKEN_REFRESHED', session('active'));
  assert.equal(h.calls.length, calls);
  await h.runTimers();
  assert.equal(h.api.getController().getState().status, 'allowed');
  assert.deepEqual(h.authMutations, []);
});

test('a transient dependency failure can be retried without recreating the client or losing navigation', async () => {
  const h = harness({kbFailure: true}); await h.start();
  await h.api.enforceAuthGate(); await flush();
  assert.equal(h.api.getController().getState().status, 'allowed');
  assert.equal(h.scripts.filter(src => src.includes('paws-navigation.js')).length, 1);
  assert.equal(h.calls.filter(call => call.createClient).length, 1);
  assert.deepEqual(h.authMutations, []);
  assert.deepEqual(h.storageMutations, []);
});


test('an explicitly removed membership clears private caches even when Slack verification is unavailable', async () => {
  const h = harness({invoke:()=>({data:null,error:new Error('offline')})}); await h.start(); await h.api.loadSearchIndex();
  assert.equal(h.api.searchKB('private').length,1);
  h.state.active=false; await h.api.getController().check();
  assert.equal(h.api.getController().getState().allowed,false);
  assert.equal(h.api.searchKB('private').length,0);
  assert.ok(h.events.some(event=>event.type==='paws-access-revoked'));
  assert.deepEqual(h.authMutations,[]);
});
