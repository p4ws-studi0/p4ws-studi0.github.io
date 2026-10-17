'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {coverFrame, revealFrame, eligibleHref, validHandoff} = require('../assets/page-transition.js');

const BASE = 'https://hq.pawspet.com/training.html';
const KEY = 'paws.page-transition.v1';
const NOW = 1800000000000;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
}

function anchor(href, attributes = {}, optOut = false) {
  const values = {href, ...attributes};
  return {
    getAttribute: name => Object.hasOwn(values, name) ? values[name] : null,
    hasAttribute: name => Object.hasOwn(values, name),
    closest: selector => selector === '[data-no-page-transition]' && optOut ? {} : null,
  };
}

const click = overrides => ({defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides});

test('cover follows the supplied quadratic-out position, tilt, and logo timeline', () => {
  const frames = [
    [-1, -110, 28, 0],
    [0, -110, 28, 0],
    [100, -76.66666666666667, 28, 0],
    [150, -65, 15.75, .6],
    [200, -56.66666666666667, 7, .8],
    [250, -51.66666666666667, 1.75, .35],
    [300, -50, 0, .2],
    [350, -50, 0, .8],
    [400, -50, 0, 0],
    [550, -50, 0, 0],
    [2000, -50, 0, 0],
  ];
  for (const [ms, x, rotate, logo] of frames) {
    const frame = coverFrame(ms);
    near(frame.x, x, `cover x at ${ms}ms`);
    near(frame.rotate, rotate, `cover tilt at ${ms}ms`);
    near(frame.logo, logo, `cover logo at ${ms}ms`);
  }
});

test('reveal completes translation at 400ms and delayed tilt at 500ms', () => {
  const frames = [
    [0, 5, 6, false],
    [100, 29.0625, 6, false],
    [200, 46.25, 6, false],
    [250, 52.265625, 4.166666666666667, false],
    [300, 56.5625, 2.666666666666667, false],
    [400, 60, .6666666666666666, false],
    [500, 60, 0, true],
    [2000, 60, 0, true],
  ];
  for (const [ms, x, rotate, done] of frames) {
    const frame = revealFrame(ms);
    near(frame.x, x, `reveal x at ${ms}ms`);
    near(frame.rotate, rotate, `reveal tilt at ${ms}ms`);
    assert.equal(frame.logo, 0);
    assert.equal(frame.done, done, `reveal completion at ${ms}ms`);
  }
  assert.equal(revealFrame(499).done, false);
});

test('ordinary same-origin page navigation preserves path and query', () => {
  for (const [href, expected] of [
    ['/tours.html', 'https://hq.pawspet.com/tours.html'],
    ['tours.html', 'https://hq.pawspet.com/tours.html'],
    ['/', 'https://hq.pawspet.com/'],
    ['/kb/', 'https://hq.pawspet.com/kb/'],
    ['/tours.html?view=week', 'https://hq.pawspet.com/tours.html?view=week'],
  ]) {
    assert.equal(eligibleHref(anchor(href), click(), BASE), expected);
  }
  assert.equal(eligibleHref(anchor('/tours.html', {target: '_SELF'}), click({button: undefined}), BASE), 'https://hq.pawspet.com/tours.html');
});

test('hash jumps, Run Cards shortcuts, query-only changes, and canonical same pages stay native', () => {
  for (const href of ['', '#', '#run-cards', '?view=week', '/training.html?view=week', '/tours.html#run-cards', '/tours.html#']) {
    assert.equal(eligibleHref(anchor(href), click(), BASE), null, href);
  }
  assert.equal(eligibleHref(anchor('/index.html?mode=dark'), click(), 'https://hq.pawspet.com/'), null);
  assert.equal(eligibleHref(anchor('/kb/index.html'), click(), 'https://hq.pawspet.com/kb/'), null);
  assert.equal(eligibleHref(null, click(), BASE), null);
});

test('new tabs, downloads, external links, and explicit opt-outs stay native', () => {
  for (const item of [
    anchor('/tours.html', {target: '_blank'}),
    anchor('/tours.html', {target: 'reports'}),
    anchor('/tours.html', {download: ''}),
    anchor('/tours.html', {rel: 'noopener external noreferrer'}),
    anchor('/tours.html', {rel: 'noopener EXTERNAL noreferrer'}),
    anchor('/tours.html', {}, true),
    anchor('https://example.com/tours.html'),
    anchor('http://hq.pawspet.com/tours.html'),
    anchor('mailto:info@pawspet.com'),
    anchor('tel:2032507297'),
    anchor('javascript:void(0)'),
  ]) {
    assert.equal(eligibleHref(item, click(), BASE), null);
  }
});

test('prevented, modified, and non-primary clicks stay native', () => {
  for (const overrides of [
    {defaultPrevented: true}, {button: 1}, {button: 2},
    {metaKey: true}, {ctrlKey: true}, {shiftKey: true}, {altKey: true},
  ]) {
    assert.equal(eligibleHref(anchor('/tours.html'), click(overrides), BASE), null);
  }
});

test('authentication, API, and non-HTML asset destinations stay native', () => {
  for (const href of [
    '/login.html', '/login', '/LOGIN.HTML', '/auth/callback/index.html', '/auth',
    '/oauth/callback', '/api/v1/example', '/assets/run-cards.js', '/favicon.ico',
    '/images/card.png', '/instructions.pdf', '/export.csv',
  ]) {
    assert.equal(eligibleHref(anchor(href), click(), BASE), null, href);
  }
});

test('handoff accepts exact destinations through the 8000ms TTL boundary', () => {
  for (const age of [0, 1, 7999, 8000]) {
    assert.equal(validHandoff({target: BASE, startedAt: NOW - age}, BASE, NOW), true, `age ${age}`);
  }
  assert.equal(validHandoff({target: BASE, startedAt: NOW - 8001}, BASE, NOW), false);
  assert.equal(validHandoff({target: BASE, startedAt: NOW + 1}, BASE, NOW), false);
});

test('handoff canonicalizes directory index paths while requiring exact queries and origin', () => {
  assert.equal(validHandoff({target: 'https://hq.pawspet.com/index.html', startedAt: NOW}, 'https://hq.pawspet.com/', NOW), true);
  assert.equal(validHandoff({target: 'https://hq.pawspet.com/kb/index.html', startedAt: NOW}, 'https://hq.pawspet.com/kb/', NOW), true);
  assert.equal(validHandoff({target: `${BASE}?view=week#top`, startedAt: NOW}, `${BASE}?view=week`, NOW), true);
  for (const target of ['https://example.com/training.html', 'http://hq.pawspet.com/training.html', 'https://hq.pawspet.com/tours.html', `${BASE}?view=week`]) {
    assert.equal(validHandoff({target, startedAt: NOW}, BASE, NOW), false, target);
  }
});

test('invalid handoffs and reduced-motion requests never activate a transition', () => {
  for (const data of [null, {}, {target: BASE}, {target: null, startedAt: NOW}, {target: '/training.html', startedAt: NOW}, {target: BASE, startedAt: String(NOW)}, {target: BASE, startedAt: NaN}, {target: BASE, startedAt: Infinity}]) {
    assert.equal(validHandoff(data, BASE, NOW), false);
  }
  assert.equal(validHandoff({target: BASE, startedAt: NOW}, 'invalid URL', NOW), false);
  assert.equal(validHandoff({target: BASE, startedAt: NOW}, BASE, NOW, true), false);
});

const bootstrapSource = fs.readFileSync(require.resolve('../assets/page-transition-bootstrap.js'), 'utf8');
function bootstrap(raw, {href = BASE, reduced = false, storageThrows = false} = {}) {
  const values = new Map(raw === undefined ? [] : [[KEY, raw]]);
  const attributes = new Map();
  const dispatched = [];
  const timers = [];
  const context = {
    URL, Number, JSON,
    Date: {now: () => NOW},
    location: {href},
    sessionStorage: {
      getItem(key) { if (storageThrows) throw new Error('storage denied'); return values.get(key) ?? null; },
      removeItem(key) { values.delete(key); },
    },
    matchMedia: () => ({matches: reduced}),
    document: {
      documentElement: {
        setAttribute: (key, value) => attributes.set(key, value),
        removeAttribute: key => attributes.delete(key),
      },
      dispatchEvent: event => dispatched.push(event.type),
    },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout(callback, delay) { timers.push({callback, delay}); return timers.length; },
  };
  context.window = context;
  vm.runInNewContext(bootstrapSource, context);
  return {context, values, attributes, dispatched, timers};
}

test('head bootstrap consumes valid handoff before paint and fails open if the driver never loads', () => {
  const pending = {target: BASE, startedAt: NOW - 550};
  const state = bootstrap(JSON.stringify(pending));
  assert.equal(state.values.has(KEY), false);
  assert.equal(state.attributes.has('data-paws-transition-pending'), true);
  assert.equal(state.context.__pawsTransitionPending.target, BASE);
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0].delay, 5000);
  state.timers[0].callback();
  assert.equal(state.attributes.has('data-paws-transition-pending'), false);
  assert.equal(state.context.__pawsTransitionPending, null);
  assert.deepEqual(state.dispatched, ['paws-transition-failopen']);
});

test('head bootstrap leaves no cover for absent, corrupt, expired, mismatched, or inaccessible storage', () => {
  for (const raw of [undefined, 'not JSON', 'null', '{}', JSON.stringify({target: BASE, startedAt: NOW - 8001}), JSON.stringify({target: BASE, startedAt: NOW + 1}), JSON.stringify({target: 'https://example.com/training.html', startedAt: NOW}), JSON.stringify({target: `${BASE}?other`, startedAt: NOW})]) {
    const state = bootstrap(raw);
    assert.equal(state.attributes.has('data-paws-transition-pending'), false, String(raw));
    assert.equal(state.timers.length, 0);
    assert.equal(state.values.has(KEY), false);
  }
  const denied = bootstrap(undefined, {storageThrows: true});
  assert.equal(denied.attributes.has('data-paws-transition-pending'), false);
  assert.equal(denied.timers.length, 0);
  const reduced = bootstrap(JSON.stringify({target: BASE, startedAt: NOW}), {reduced: true});
  assert.equal(reduced.attributes.has('data-paws-transition-pending'), false);
  assert.equal(reduced.values.has(KEY), false);
});


test('clean and legacy page aliases share a transition handoff and never animate same-page navigation', () => {
  for (const [legacy, clean] of [
    ['/tours.html', '/tours'],
    ['/settings.html', '/settings'],
    ['/kb/activity-procedures/index.html', '/kb/activity-procedures/'],
    ['/kb/activity-procedures/Group_Playtimes.html', '/kb/activity-procedures/Group_Playtimes'],
  ]) {
    const oldHref = 'https://hq.pawspet.com' + legacy;
    const cleanHref = 'https://hq.pawspet.com' + clean;
    assert.equal(validHandoff({target: oldHref + '?view=week', startedAt: NOW}, cleanHref + '?view=week', NOW), true);
    assert.equal(validHandoff({target: cleanHref, startedAt: NOW}, oldHref, NOW), true);
    assert.equal(eligibleHref(anchor(legacy), click(), cleanHref), null);
    assert.equal(eligibleHref(anchor(clean), click(), oldHref), null);
  }
  assert.equal(eligibleHref(anchor('/tours?view=week'), click(), 'https://hq.pawspet.com/'), 'https://hq.pawspet.com/tours?view=week');
});
