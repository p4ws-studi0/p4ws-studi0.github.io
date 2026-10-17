'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {canonicalize} = require('../assets/clean-urls.js');
const root = path.resolve(__dirname, '..');

function page(href, state = {position: 3}) {
  const calls = [];
  const win = {location: {href}, history: {state, replaceState(value, title, destination) {
    calls.push({value, title, destination});
    win.location.href = new URL(destination, win.location.href).href;
  }}};
  return {win, calls};
}

test('old page links present their clean URL without adding a history entry', () => {
  for (const [legacy, clean] of [
    ['/settings.html', '/settings'],
    ['/occupied-runs.html', '/occupied-runs'],
    ['/index.html', '/'],
    ['/kb/index.html', '/kb/'],
    ['/kb/activity-procedures/index.html', '/kb/activity-procedures/'],
    ['/kb/activity-procedures/Group_Playtimes.html', '/kb/activity-procedures/Group_Playtimes'],
    ['/kb%20copy/activity-procedures/Group_Playtimes.html', '/kb%20copy/activity-procedures/Group_Playtimes'],
  ]) {
    const h = page('https://hq.pawspet.com' + legacy);
    assert.equal(canonicalize(h.win), true);
    assert.equal(h.win.location.href, 'https://hq.pawspet.com' + clean);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].value, h.win.history.state);
    assert.equal(canonicalize(h.win), false);
    assert.equal(h.calls.length, 1);
  }
});

test('old reports, OAuth callbacks, and article links retain exact parameters and anchors', () => {
  for (const [legacy, clean] of [
    ['/report-loading.html?report=Daily%20Care%20Sheet', '/report-loading?report=Daily%20Care%20Sheet'],
    ['/auth/callback/index.html?code=example%2Bcode&next=%2Fsettings#access_token=example%2Btoken', '/auth/callback/?code=example%2Bcode&next=%2Fsettings#access_token=example%2Btoken'],
    ['/kb/activity-procedures/Group_Playtimes.html?from=old-link#safety', '/kb/activity-procedures/Group_Playtimes?from=old-link#safety'],
    ['/tours.html?file=old.html#booking.html', '/tours?file=old.html#booking.html'],
  ]) {
    const h = page('https://hq.pawspet.com' + legacy);
    canonicalize(h.win);
    assert.equal(h.calls[0].destination, clean);
  }
});

test('clean routes, directory slashes, and non-page resources are left intact', () => {
  for (const route of ['/', '/settings', '/kb/', '/kb/activity-procedures/', '/auth/callback/?code=example', '/styles.css', '/assets/page-transition.js']) {
    const h = page('https://hq.pawspet.com' + route);
    assert.equal(canonicalize(h.win), false);
    assert.equal(h.calls.length, 0);
  }
});

test('menu and search destinations resolve to retained physical HTML files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/navigation.json')));
  for (const entry of manifest.apps) {
    const url = new URL(entry.href, 'https://hq.pawspet.com');
    if (url.origin !== 'https://hq.pawspet.com' || entry.kind === 'action') continue;
    assert.ok(!url.pathname.endsWith('.html'), entry.href);
    const filename = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname + '.html';
    assert.ok(fs.statSync(path.join(root, decodeURIComponent(filename))).isFile(), entry.href);
  }
});

test('legacy URL normalization precedes auth and transition bootstrap on daily pages', () => {
  for (const name of ['index.html', 'login.html', 'settings.html', 'occupied-runs.html', 'end-of-day.html', 'kb/activity-procedures/Group_Playtimes.html', 'auth/callback/index.html', 'report-loading.html']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const hook = source.indexOf('/assets/clean-urls.js?');
    assert.ok(hook > 0, name);
    assert.ok(hook < source.indexOf('</head>'), name);
    const transition = source.indexOf('/assets/page-transition-bootstrap.js?');
    if (transition !== -1) assert.ok(hook < transition, name);
    const shared = source.indexOf('src="/script.js?');
    if (shared !== -1) assert.ok(hook < shared, name);
  }
});


test('the error page cleans its own legacy URL without rewriting a missing page address', () => {
  const direct = page('https://hq.pawspet.com/404.html');
  assert.equal(canonicalize(direct.win, '/404.html'), true);
  assert.equal(direct.win.location.href, 'https://hq.pawspet.com/404');
  const missing = page('https://hq.pawspet.com/missing-page.html?from=bookmark');
  assert.equal(canonicalize(missing.win, '/404.html'), false);
  assert.equal(missing.calls.length, 0);
});
