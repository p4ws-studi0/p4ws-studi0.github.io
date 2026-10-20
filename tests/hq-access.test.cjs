'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createController, createNotice, POLL_MS} = require('../assets/hq-access.js');
const session = id => ({user: {id}, access_token: 'unchanged-existing-token', refresh_token: 'unchanged-existing-refresh'});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function target() {
  const listeners = new Map();
  return {listeners, addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); }, removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }, dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); return true; }};
}
function harness(options = {}) {
  const document = Object.assign(target(), {visibilityState: 'visible'});
  const timers = new Map(), intervals = new Map();
  let timerId = 0, callback = null, unsubscribed = 0, activeSession = session('active');
  const window = Object.assign(target(), {document, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++timerId; intervals.set(id, {fn, ms}); return id; }, clearInterval(id) { intervals.delete(id); },
  });
  const changes = [], events = [], calls = [], mutations = [];
  document.addEventListener('paws-access-change', event => events.push(event.detail));
  const response = {data: {user_id: 'active', active: true}, error: null};
  const client = {auth: {
    async getSession() { calls.push({method: 'getSession'}); return options.getSession ? options.getSession() : {data: {session: activeSession}, error: null}; },
    onAuthStateChange(fn) { callback = fn; return {data: {subscription: {unsubscribe() { unsubscribed++; }}}}; },
    signOut() { mutations.push('signOut'); throw Error('Must not sign out.'); },
    setSession() { mutations.push('setSession'); throw Error('Must not replace a session.'); },
    refreshSession() { mutations.push('refreshSession'); throw Error('Must not force refresh a session.'); },
  }, from(table) {
    const call = {table}; calls.push(call);
    return {select(fields) { call.fields = fields; return this; }, eq(field, value) { call[field] = value; return this; }, maybeSingle() { return options.staff ? options.staff(call) : Promise.resolve(response); }};
  }};
  const controller = createController({client, window, document, onChange: next => changes.push(next)});
  return {client, controller, window, document, changes, events, calls, mutations, response, timers, intervals,
    setSession(next) { activeSession = next; }, emit(event, value) { assert.ok(callback); callback(event, value); },
    async runTimers() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); await flush(); },
    get unsubscribed() { return unsubscribed; }, staffCalls() { return calls.filter(call => call.table); },
  };
}

test('active accounts keep their existing session and share concurrent checks', async () => {
  const pending = deferred(), h = harness({staff: () => pending.promise});
  const first = h.controller.check(), second = h.controller.check();
  assert.equal(first, second);
  await flush();
  assert.equal(h.staffCalls().length, 1);
  assert.deepEqual(h.staffCalls()[0], {table: 'hq_tour_staff', fields: 'user_id,active', user_id: 'active'});
  pending.resolve({data: {user_id: 'active', active: true}, error: null});
  assert.equal((await first).status, 'allowed');
  assert.equal(h.controller.getState().allowed, true);
  assert.deepEqual(h.mutations, []);
  assert.equal((await h.client.auth.getSession()).data.session.refresh_token, 'unchanged-existing-refresh');
});

test('an explicit false approval revokes access without signing out', async () => {
  const h = harness();
  await h.controller.check();
  h.response.data.active = false;
  const result = await h.controller.check();
  assert.equal(result.status, 'revoked');
  assert.equal(result.confirmed, true);
  assert.equal(result.allowed, false);
  assert.deepEqual(h.events.map(event => event.status), ['allowed', 'revoked']);
  assert.deepEqual(h.mutations, []);
  assert.ok((await h.client.auth.getSession()).data.session);
});

test('a missing staff row is unapproved rather than confirmed Slack deactivation', async () => {
  const h = harness(); h.response.data = null;
  const result = await h.controller.check(session('guest'));
  assert.equal(result.status, 'unapproved');
  assert.equal(result.reason, 'staff-not-approved');
  assert.equal(result.confirmed, true);
  assert.equal(result.allowed, false);
  assert.deepEqual(h.mutations, []);
});

test('transient database and session failures preserve the same active account access', async () => {
  let sessionError = false;
  const h = harness({getSession: () => sessionError ? Promise.reject(Error('offline')) : {data: {session: session('active')}, error: null}});
  await h.controller.check();
  h.response.error = {code: '42501', message: 'Network or policy failure'};
  const tableFailure = await h.controller.check();
  assert.equal(tableFailure.status, 'unavailable');
  assert.equal(tableFailure.confirmed, false);
  assert.equal(tableFailure.allowed, true);
  assert.equal(tableFailure.lastConfirmedStatus, 'allowed');
  assert.equal(tableFailure.reason, 'staff-unavailable');
  sessionError = true;
  const authFailure = await h.controller.check();
  assert.equal(authFailure.reason, 'session-unavailable');
  assert.equal(authFailure.allowed, true);
  assert.deepEqual(h.events.map(event => event.status), ['allowed']);
  assert.deepEqual(h.mutations, []);
});

test('errors never grant initial access and never confirm deactivation', async () => {
  const h = harness({staff: async () => { throw Error('offline'); }});
  const result = await h.controller.check(session('active'));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.allowed, false);
  assert.equal(result.confirmed, false);
  assert.equal(result.lastConfirmedStatus, null);
  assert.equal(h.events.length, 0);
});

test('malformed or cross-identity permission responses are unavailable, never allowed', async () => {
  const h = harness();
  const mismatch = await h.controller.check(session('another-user'));
  assert.equal(mismatch.status, 'unavailable');
  assert.equal(mismatch.reason, 'staff-identity-mismatch');
  h.response.data = {user_id: 'another-user', active: null};
  const incomplete = await h.controller.check(session('another-user'));
  assert.equal(incomplete.status, 'unavailable');
  assert.equal(incomplete.reason, 'staff-response-incomplete');
  assert.equal(incomplete.allowed, false);
});

test('a delayed response for the previous identity cannot restore its access', async () => {
  const pending = deferred();
  const h = harness({staff: call => call.user_id === 'old' ? pending.promise : {data: {user_id: call.user_id, active: false}, error: null}});
  const old = h.controller.check(session('old'));
  const next = await h.controller.check(session('new'));
  assert.equal(next.status, 'revoked');
  pending.resolve({data: {user_id: 'old', active: true}, error: null});
  await old;
  assert.equal(h.controller.getState().userId, 'new');
  assert.equal(h.controller.getState().status, 'revoked');
  assert.ok(!h.events.some(event => event.userId === 'old' && event.status === 'allowed'));
});

test('a delayed getSession cannot override a newer supplied identity', async () => {
  const pending = deferred();
  const h = harness({getSession: () => pending.promise, staff: call => ({data: {user_id: call.user_id, active: true}, error: null})});
  const old = h.controller.check();
  await h.controller.check(session('new'));
  pending.resolve({data: {session: session('old')}, error: null});
  await old;
  assert.equal(h.controller.getState().userId, 'new');
  assert.deepEqual(h.staffCalls().map(call => call.user_id), ['new']);
});

test('an identity change immediately drops the previous identity data allowance', async () => {
  const pending = deferred();
  let waiting = false;
  const h = harness({staff: call => waiting ? pending.promise : {data: {user_id: call.user_id, active: true}, error: null}});
  await h.controller.check(session('active'));
  waiting = true;
  const next = h.controller.check(session('new'));
  assert.equal(h.controller.getState().allowed, false);
  assert.equal(h.changes.at(-1).reason, 'identity-changed');
  pending.resolve({data: null, error: null}); await next;
  assert.equal(h.controller.getState().status, 'unapproved');
});

test('a confirmed missing session invalidates pending staff responses without auth mutation', async () => {
  const pending = deferred(), h = harness({staff: () => pending.promise});
  const old = h.controller.check(session('active'));
  const result = await h.controller.check(null);
  pending.resolve({data: {user_id: 'active', active: true}, error: null}); await old;
  assert.equal(result.status, 'session-missing');
  assert.equal(h.controller.getState().status, 'session-missing');
  assert.equal(h.controller.getState().allowed, false);
  assert.deepEqual(h.mutations, []);
});

test('start checks once per visible minute and on focus/online without interrupting an allowed view', async () => {
  const h = harness();
  assert.equal(h.controller.start(), h.controller);
  h.controller.start();
  await flush();
  assert.equal(h.intervals.size, 1);
  const timer = [...h.intervals.values()][0];
  assert.equal(timer.ms, POLL_MS);
  assert.equal(POLL_MS, 60000);
  const changes = h.changes.length;
  timer.fn(); await flush();
  h.window.dispatchEvent({type: 'focus'}); await flush();
  h.window.dispatchEvent({type: 'online'}); await flush();
  assert.equal(h.staffCalls().length, 4);
  assert.equal(h.changes.length, changes);
  assert.equal(h.events.length, 1);
  h.document.visibilityState = 'hidden'; timer.fn(); await flush();
  assert.equal(h.staffCalls().length, 4);
  h.document.visibilityState = 'visible'; h.document.dispatchEvent({type: 'visibilitychange'}); await flush();
  assert.equal(h.staffCalls().length, 5);
  assert.deepEqual(h.mutations, []);
  h.controller.dispose();
});

test('auth callbacks defer Supabase work, coalesce repeated events, and keep active refreshes uninterrupted', async () => {
  const h = harness(); h.controller.start(); await flush();
  const before = h.staffCalls().length, changes = h.changes.length;
  h.emit('TOKEN_REFRESHED', session('active'));
  h.emit('USER_UPDATED', session('active'));
  h.emit('TOKEN_REFRESHED', session('active'));
  assert.equal(h.staffCalls().length, before);
  assert.equal(h.timers.size, 1);
  await h.runTimers();
  assert.equal(h.staffCalls().length, before + 1);
  assert.equal(h.changes.length, changes);
  assert.equal(h.controller.getState().status, 'allowed');
  assert.deepEqual(h.mutations, []);
  h.controller.dispose();
});

test('a pending old response is invalidated immediately when a new auth event arrives', async () => {
  const pending = deferred(); let delayed = false;
  const h = harness({staff: call => delayed ? pending.promise : {data: {user_id: call.user_id, active: true}, error: null}});
  h.controller.start(); await flush();
  delayed = true;
  const old = h.controller.check(session('old'));
  h.emit('SIGNED_IN', session('new'));
  pending.resolve({data: {user_id: 'old', active: true}, error: null}); await old;
  assert.ok(!h.events.some(event => event.status === 'allowed' && event.userId === 'old'));
  delayed = false;
  await h.runTimers();
  assert.equal(h.controller.getState().userId, 'new');
  assert.equal(h.controller.getState().status, 'allowed');
  h.controller.dispose();
});

test('dispose unsubscribes and prevents timers or in-flight checks from changing the view', async () => {
  const pending = deferred(), h = harness({staff: () => pending.promise});
  h.controller.start(); await flush();
  h.emit('TOKEN_REFRESHED', session('active'));
  const changes = h.changes.length;
  h.controller.dispose(); h.controller.dispose();
  pending.resolve({data: {user_id: 'active', active: true}, error: null}); await flush();
  assert.equal(h.changes.length, changes);
  assert.equal(h.events.length, 0);
  assert.equal(h.unsubscribed, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.document.listeners.get('visibilitychange').size, 0);
  assert.equal(h.window.listeners.get('focus').size, 0);
  await h.controller.check(session('active'));
  assert.equal(h.changes.length, changes);
  h.emit('TOKEN_REFRESHED', session('active'));
  assert.equal(h.timers.size, 0);
});

test('an omitted or explicitly undefined optional session reads the existing session', async () => {
  const h = harness();
  assert.equal((await h.controller.check(undefined)).status, 'allowed');
  assert.equal(h.calls.filter(call => call.method === 'getSession').length, 1);
  assert.equal((await h.controller.check(null)).status, 'session-missing');
  assert.equal(h.calls.filter(call => call.method === 'getSession').length, 1);
});

function element(tag) {
  const node = Object.assign(target(), {tagName: tag, children: [], attributes: {}, textContent: '', open: false, disabled: false,
    append(...children) { this.children.push(...children); }, setAttribute(name, value) { this.attributes[name] = value; if (name === 'open') this.open = true; },
    showModal() { this.open = true; this.modalCount = (this.modalCount || 0) + 1; }, close() { this.open = false; }, remove() { this.removed = true; },
  }); return node;
}
test('the native notice blocks revoked access above existing forms and Retry preserves their contents', async () => {
  const existingForm = {value: 'Unsaved work stays intact'}, body = element('body'); body.append(existingForm);
  const document = {body, createElement: element};
  let state = {status: 'revoked', allowed: false, confirmed: true}, checks = 0;
  const controller = {getState: () => state, async check() { checks++; return state; }};
  const notice = createNotice({controller, document});
  notice.render(state);
  assert.equal(notice.element.open, true);
  assert.equal(notice.element.tagName, 'dialog');
  assert.equal(body.children[0], existingForm);
  const [title, message, retry] = notice.element.children;
  assert.equal(title.textContent, 'Paws HQ access paused');
  assert.match(message.textContent, /work on this page has been kept/);
  let prevented = false; notice.element.dispatchEvent({type: 'cancel', preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  state = {status: 'allowed', allowed: true, confirmed: true};
  retry.dispatchEvent({type: 'click'}); await flush();
  assert.equal(checks, 1);
  assert.equal(notice.element.open, false);
  assert.equal(existingForm.value, 'Unsaved work stays intact');
  notice.dispose(); assert.equal(notice.element.removed, true);
});

test('a transient refresh failure never opens a notice over an already allowed account', () => {
  const document = {body: element('body'), createElement: element};
  const notice = createNotice({controller: {check() {}, getState() {}}, document});
  notice.render({status: 'unavailable', allowed: true, lastConfirmedStatus: 'allowed', confirmed: false});
  assert.equal(notice.element.open, false);
  notice.render({status: 'unavailable', allowed: false, lastConfirmedStatus: 'revoked', confirmed: false});
  assert.equal(notice.element.open, true);
  assert.equal(notice.element.children[0].textContent, 'Paws HQ access paused');
  notice.dispose();
});
