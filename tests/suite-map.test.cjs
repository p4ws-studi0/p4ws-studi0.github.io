const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../assets/suite-map.js'), 'utf8');
const now = Date.parse('2026-11-24T18:00:00Z');
const reservation = {room: 'lq 1', reservationId: '403', pet: 'Maple', breed: 'Poodle', owner: 'Example'};
const occupancy = (rooms = [reservation], changes = {}) => ({
  rooms, complete: true, unmappedCount: 0, updatedAt: new Date(now).toISOString(), ...changes
});
const session = {user: {id: 'staff-a'}, access_token: 'fixture-token'};
const settle = () => new Promise(setImmediate);

function harness(initial = {}) {
  const state = {
    now, session, payload: occupancy(), calls: [], windows: [], timeouts: [],
    intervals: [], denied: false, ...initial
  };
  const document = {hidden: false, documentElement: {clientWidth: 1050, clientHeight: 640}};
  class EventTarget {
    constructor() { this.listeners = {}; }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    emit(name, event = {}) { for (const listener of this.listeners[name] || []) listener(event); }
  }
  class Node extends EventTarget {
    constructor(tagName) {
      super();
      this.tagName = tagName;
      this.children = [];
      this.hidden = true;
      this.attributes = new Map();
      this.dataset = {};
      this.style = {};
      const classes = new Set();
      this.classList = {
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)
      };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) {
      if (this.contains(document.activeElement)) this.emit('focusout', {relatedTarget: null});
      this.children = nodes;
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    querySelectorAll(tag) {
      return this.children.flatMap(node => [
        ...(node.tagName === tag ? [node] : []), ...node.querySelectorAll(tag)
      ]);
    }
    querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
    get textContent() { return this.text || this.children.map(node => node.textContent).join(' '); }
    set textContent(value) { this.text = value; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    matches() { return true; }
    focus() { document.activeElement = this; this.emit('focus'); }
    getBoundingClientRect() { return {width: 50, height: 32, left: 110, top: 190, bottom: 222}; }
  }
  const nodes = Object.fromEntries(['map-status', 'map-tooltip', 'map-scroll'].map(id => [id, Object.assign(new Node('div'), {id})]));
  const rooms = ['LQ1', 'LQ2'].map(room => Object.assign(new Node('button'), {dataset: {room}}));
  const docEvents = new EventTarget();
  Object.assign(document, {
    addEventListener: docEvents.addEventListener.bind(docEvents),
    querySelectorAll: () => rooms,
    getElementById: id => nodes[id],
    createElement: tag => new Node(tag),
    activeElement: null
  });
  const window = new EventTarget();
  window.open = (...args) => state.windows.push(args);
  let authChanged;
  class Clock extends Date { static now() { return state.now; } }
  vm.runInNewContext(source, {
    document, window, AbortController, Date: Clock,
    setTimeout(fn, delay) { state.timeouts.push({fn, delay}); },
    clearTimeout() {},
    setInterval(fn, delay) { state.intervals.push({fn, delay}); },
    supabaseClient: {
      auth: {
        async getSession() { return {data: {session: state.session}}; },
        onAuthStateChange(listener) { authChanged = listener; }
      },
      functions: {
        async invoke(name, options) {
          state.calls.push({name, options});
          return state.invoke ? state.invoke() : {data: state.payload};
        }
      }
    },
    async ensureHqWorkspaceAccess() {
      if (state.denied) throw Object.assign(new Error('not staff'), {code: 'ACCESS'});
    }
  });
  return {
    state, document, window, docEvents, rooms,
    tooltip: nodes['map-tooltip'], status: nodes['map-status'],
    authChanged,
    async tick() { state.now += 60000; state.intervals[0].fn(); await settle(); }
  };
}

test('live occupancy uses the signed HQ client; hovering and activating a single room use its reservation', async () => {
  const h = harness();
  await settle();
  assert.equal(h.state.calls[0].name, 'hq-map-occupancy');
  assert.equal(JSON.stringify(h.state.calls[0].options.body), '{}');
  assert.equal(h.state.calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(h.state.intervals[0].delay, 60000);
  assert.equal(h.rooms[0].classList.contains('is-occupied'), true);
  h.rooms[0].emit('pointerenter', {pointerType: 'mouse'});
  assert.match(h.tooltip.textContent, /Maple Poodle · Owner Example/);
  assert.equal(h.state.windows.length, 0);
  h.rooms[0].emit('click', {pointerType: 'mouse'});
  assert.deepEqual(h.state.windows, [[
    'https://pawspet.gingrapp.com/reservations/edit/id/403', '_blank', 'noopener,noreferrer'
  ]]);
});

test('shared rooms list every pet and provide stable per-reservation links on activation', async () => {
  const h = harness({payload: occupancy([reservation, {...reservation, pet: 'Clover', reservationId: '404'}])});
  await settle();
  h.rooms[0].emit('pointerenter', {pointerType: 'mouse'});
  assert.match(h.tooltip.textContent, /Maple.*Clover/);
  h.rooms[0].emit('click', {pointerType: 'mouse'});
  assert.equal(h.tooltip.attributes.get('role'), 'dialog');
  assert.equal(h.rooms[0].attributes.get('aria-expanded'), 'true');
  const links = h.tooltip.querySelectorAll('a');
  assert.deepEqual(links.map(link => link.href), [
    'https://pawspet.gingrapp.com/reservations/edit/id/403',
    'https://pawspet.gingrapp.com/reservations/edit/id/404'
  ]);
  assert.equal(h.document.activeElement, links[0]);
  await h.tick();
  assert.equal(h.tooltip.hidden, false);
  assert.equal(h.document.activeElement.href, links[0].href);
  h.docEvents.emit('keydown', {key: 'Escape'});
  assert.equal(h.tooltip.hidden, true);
  assert.equal(h.document.activeElement, h.rooms[0]);
});

test('unmatched assignments leave empty rooms unconfirmed and untrusted IDs cannot link', async () => {
  const h = harness({payload: occupancy([{...reservation, reservationId: '44/../../bad'}], {
    complete: false, unmappedCount: 1
  })});
  await settle();
  assert.match(h.status.textContent, /unmatched/);
  h.rooms[1].emit('pointerenter', {pointerType: 'mouse'});
  assert.match(h.tooltip.textContent, /Occupancy unconfirmed/);
  h.rooms[1].emit('click', {pointerType: 'mouse'});
  h.rooms[0].emit('click', {pointerType: 'mouse'});
  assert.deepEqual(h.state.windows, []);
});

test('signed out and unapproved users never invoke Gingr occupancy', async () => {
  for (const settings of [{session: null}, {denied: true}]) {
    const h = harness(settings);
    await settle();
    await h.tick();
    assert.equal(h.state.calls.length, 0);
    assert.doesNotMatch(h.rooms[0].attributes.get('aria-label'), /Maple/);
  }
});

test('visible polling refreshes data; errors and revocations clear names and links', async () => {
  const h = harness();
  await settle();
  h.document.hidden = true;
  await h.tick();
  assert.equal(h.state.calls.length, 1);
  h.document.hidden = false;
  h.state.invoke = () => ({error: new Error('server failure')});
  await h.tick();
  assert.equal(h.status.textContent, 'Occupancy unavailable');
  assert.doesNotMatch(h.rooms[0].attributes.get('aria-label'), /Maple/);
  h.state.invoke = null;
  await h.tick();
  h.rooms[0].emit('pointerenter', {pointerType: 'mouse'});
  h.window.emit('paws-access-revoked');
  assert.equal(h.tooltip.hidden, true);
  assert.equal(h.tooltip.textContent, '');
  h.rooms[0].emit('click', {pointerType: 'mouse'});
  assert.deepEqual(h.state.windows, []);
});

test('account changes and pagehide discard late responses and reservation details', async () => {
  let respond;
  const response = new Promise(resolve => {respond = resolve;});
  const h = harness({invoke: () => response});
  await settle();
  h.authChanged('SIGNED_OUT', null);
  respond({data: occupancy()});
  await settle();
  assert.equal(h.status.textContent, 'Sign in to view occupancy');
  assert.doesNotMatch(h.rooms[0].attributes.get('aria-label'), /Maple/);

  const next = harness();
  await settle();
  next.rooms[0].emit('pointerenter', {pointerType: 'mouse'});
  next.window.emit('pagehide');
  assert.equal(next.tooltip.textContent, '');
  assert.equal(next.rooms[0].classList.contains('has-reservation'), false);
  next.rooms[0].emit('click', {pointerType: 'mouse'});
  assert.deepEqual(next.state.windows, []);
});
