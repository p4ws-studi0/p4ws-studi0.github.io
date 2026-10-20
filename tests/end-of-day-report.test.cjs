/* Synthetic read-only financial report fixtures; no network or live account data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createReport, csv, html } = require('../assets/end-of-day-report.js');

const keys = ['staff_name', 'cash_received', 'checks_received', 'card_tips_received', 'card_tips_paid', 'receipts_paid', 'receipt_description', 'drawer_total', 'cash_replaced', 'cash_deposit', 'check_deposit', 'total_deposit', 'notes', 'additional_note', 'bills_100', 'bills_50', 'bills_20', 'bills_10', 'bills_5', 'bills_1', 'quarters', 'dimes', 'nickels', 'pennies'];
const fields = keys.map(key => [key, key.replaceAll('_', ' '), 200]);
const row = (extra = {}) => ({ entry_date: '2026-10-20', ...Object.fromEntries(keys.map(key => [key, ''])), ...extra });
const report = (extra = {}) => createReport({ start: '2026-10-14', end: '2026-10-20', rows: [], fields, ...extra });

function parseCsv(value) {
  const result = []; let record = [], cell = '', quoted = false;
  value = value.replace(/^\ufeff/, '');
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && character === ',') { record.push(cell); cell = ''; }
    else if (!quoted && character === '\r' && value[index + 1] === '\n') { record.push(cell); result.push(record); record = []; cell = ''; index++; }
    else cell += character;
  }
  assert.equal(quoted, false, 'CSV quotes must be balanced');
  assert.equal(cell, ''); assert.equal(record.length, 0);
  return result;
}

test('reports include chronological calendar dates across DST and year boundaries', () => {
  for (const [start, end] of [['2026-03-05', '2026-03-11'], ['2026-10-29', '2026-11-04'], ['2025-12-29', '2026-01-04']]) {
    const result = report({ start, end });
    assert.equal(result.days.length, 7); assert.equal(result.days[0].date, start); assert.equal(result.days[6].date, end);
    assert.equal(new Set(result.days.map(day => day.date)).size, 7);
    assert.ok(result.days.every((day, index, days) => !index || days[index - 1].date < day.date));
  }
});

test('CSV and print retain every date across report sheets, including empty and deleted days', () => {
  const dates = Array.from({ length: 18 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
  const sparse = [
    row({ entry_date: dates[0], cash_received: '42' }),
    row({ entry_date: dates[7], cash_received: '999', notes: 'Removed entry', deleted_at: '2026-10-09T12:00:00Z' }),
    row({ entry_date: dates[17], cash_received: '0' })
  ];
  for (const rows of [[], sparse]) {
    const result = report({ start: dates[0], end: dates.at(-1), rows });
    const csvRows = parseCsv(csv(result)).slice(1), markup = html(result);
    const printDates = [...markup.matchAll(/<span>(\d{4}-\d{2}-\d{2})<\/span>/g)].map(match => match[1]);
    assert.deepEqual(result.days.map(day => day.date), dates);
    assert.deepEqual(csvRows.map(day => day[0]), dates);
    assert.deepEqual(printDates, dates);
    assert.equal((markup.match(/class="eod-report-sheet"/g) || []).length, 3);
    for (const day of result.days) {
      if (day.status !== 'Recorded') assert.ok(Object.values(day.values).every(value => value === ''));
    }
    if (rows.length) {
      assert.equal(csvRows[0][3], '42');
      assert.equal(csvRows[7][1], 'Deleted');
      assert.ok(csvRows[7].slice(2).every(value => value === ''));
      assert.equal(csvRows[17][3], '0');
      assert.doesNotMatch(csv(result) + markup, /Removed entry|999/);
    }
  }
});

test('only real ISO dates and inclusive ranges of one to 366 days are accepted', () => {
  assert.equal(report({ start: '2024-01-01', end: '2024-12-31' }).days.length, 366);
  assert.equal(report({ start: '2024-02-29', end: '2024-02-29' }).days.length, 1);
  for (const [start, end] of [['2026-02-29', '2026-03-01'], ['2026-04-31', '2026-05-01'], ['2026-1-01', '2026-01-01'], ['2026-10-21', '2026-10-20'], ['2024-01-01', '2025-01-01'], ['0001-01-01', '0001-01-01'], ['2026-10-20T00:00:00Z', '2026-10-20']]) assert.throws(() => report({ start, end }), RangeError);
  assert.throws(() => createReport(), RangeError);
});

test('all 24 stored literals and original totals survive without metadata or mutations', () => {
  const literals = Object.fromEntries(keys.map((key, index) => [key, `  Value ${index}\r\nline two  `]));
  const original = row({ ...literals, drawer_total: '199.99', bills_20: '200', total_deposit: '29.50', cash_deposit: '10', check_deposit: '20', id: 'private-record-id', revision: 9, source_values: ['private-source'], created_by: 'private-user' });
  const before = JSON.stringify(original), result = report({ rows: [original] }), day = result.days.at(-1);
  assert.equal(result.fields.length, 24); assert.deepEqual(result.fields, fields.map(([key, label]) => ({ key, label })));
  for (const key of keys) assert.equal(day.values[key], original[key], key);
  assert.equal(day.status, 'Recorded'); assert.equal(JSON.stringify(original), before);
  assert.doesNotMatch(JSON.stringify(result) + csv(result) + html(result), /private-record-id|private-source|private-user|created_by|source_values|revision/);
});

test('missing and deleted days are distinct and contain no financial or staff values', () => {
  const result = report({ rows: [row({ entry_date: '2026-10-19', staff_name: 'Deleted staff', notes: 'Private deleted note', cash_received: '400', deleted_at: '2026-10-20T12:00:00Z' }), row({ cash_received: '0', checks_received: '0.00', quarters: '' })] });
  assert.equal(result.days[0].status, 'No entry'); assert.equal(result.days[5].status, 'Deleted');
  assert.ok(Object.values(result.days[0].values).every(value => value === ''));
  assert.ok(Object.values(result.days[5].values).every(value => value === ''));
  assert.equal(result.days[6].values.cash_received, '0'); assert.equal(result.days[6].values.checks_received, '0.00'); assert.equal(result.days[6].values.quarters, '');
  assert.doesNotMatch(csv(result) + html(result), /Deleted staff|Private deleted note|400/);
});

test('range data ignores unrelated rows but rejects conflicting entries for the same date', () => {
  const result = report({ rows: [row({ entry_date: '2026-10-01', notes: 'Outside report' }), row({ notes: 'Inside report' })] });
  assert.doesNotMatch(csv(result), /Outside report/); assert.match(csv(result), /Inside report/);
  assert.throws(() => report({ rows: [row(), row({ notes: 'Conflicting row' })] }), /at most one/);
});

test('report fields cannot expose internal metadata or ambiguous duplicate columns', () => {
  for (const invalid of [[['created_by', 'User', 200]], [['source_values', 'Source', 200]], [fields[0], fields[0]], [['notes', '', 200]], []]) assert.throws(() => report({ fields: invalid }), TypeError);
  assert.throws(() => report({ rows: null }), TypeError);
});

test('CSV uses stable day-per-row columns, UTF-8 BOM and quoted CRLF records', () => {
  const notes = 'Comma, quote " and\r\na full second line\nThird line — café 🐾';
  const result = report({ rows: [row({ staff_name: 'Closer, "A"', cash_received: '  $1,234.50  ', notes, additional_note: ' End note  ' })] });
  const output = csv(result), parsed = parseCsv(output);
  assert.equal(output.charCodeAt(0), 0xfeff); assert.ok(output.endsWith('\r\n'));
  assert.deepEqual(parsed[0], ['Date', 'Entry', ...fields.map(([, label]) => label)]);
  assert.equal(parsed.length, 8); assert.ok(parsed.every(record => record.length === 26));
  assert.equal(parsed[1][0], '2026-10-14'); assert.equal(parsed[7][0], '2026-10-20');
  assert.equal(parsed[7][2], 'Closer, "A"'); assert.equal(parsed[7][3], '  $1,234.50  ');
  assert.equal(parsed[7][2 + keys.indexOf('notes')], notes); assert.equal(parsed[7][2 + keys.indexOf('additional_note')], ' End note  ');
});

test('CSV escapes formula prefixes including whitespace and controls but retains strict signed decimals', () => {
  const dangerous = ['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1)', ' \t=HYPERLINK("https://example.invalid")', '\r=2', '\n@SUM(A1)', '\ufeff+2+2', '-$12', '-12 ', '\tPlain note'];
  for (const value of dangerous) {
    const result = report({ rows: [row({ notes: value })] });
    assert.equal(parseCsv(csv(result)).at(-1)[2 + keys.indexOf('notes')], "'" + value, JSON.stringify(value));
  }
  for (const value of ['-12', '+12', '-12.34', '+.25', '0', '001.00', 'Plain note', '$-12.00']) {
    assert.equal(parseCsv(csv(report({ rows: [row({ notes: value })] }))).at(-1)[2 + keys.indexOf('notes')], value, value);
  }
});

test('print layout has all fields grouped beneath date columns, without computing new totals', () => {
  const output = html(report({ rows: [row({ drawer_total: '199.99', bills_20: '200', total_deposit: '29.50', cash_deposit: '10', check_deposit: '20' })] }));
  assert.equal((output.match(/class="eod-report-sheet"/g) || []).length, 1);
  assert.equal((output.match(/class="eod-report-table"/g) || []).length, 1);
  assert.equal((output.match(/scope="row"/g) || []).length, 25);
  assert.equal((output.match(/class="is-total"/g) || []).length, 2);
  assert.equal((output.match(/class="is-notes"/g) || []).length, 3);
  assert.match(output, /Money in &amp; out/); assert.match(output, /Drawer · dollar amounts/); assert.match(output, /Deposits &amp; notes/);
  assert.match(output, /199\.99/); assert.match(output, /29\.50/); assert.match(output, /not counts/); assert.match(output, /stored values/);
  const first = output.indexOf('2026-10-14'), last = output.indexOf('2026-10-20'); assert.ok(first < last);
  assert.match(output, /<thead><tr><th scope="col">/); assert.match(output, /<tbody>/);
});

test('long notes and labels are fully escaped and every seven days start a new print sheet', () => {
  const notes = '<img src=x onerror="alert(1)">\n' + 'Long & complete note. '.repeat(900);
  const labels = fields.map(field => field[0] === 'notes' ? ['notes', '<Notes & details>', 20000] : field);
  const result = report({ start: '2026-10-01', end: '2026-10-20', rows: [row({ notes })], fields: labels });
  const output = html(result);
  assert.equal((output.match(/class="eod-report-sheet"/g) || []).length, 3);
  assert.equal((output.match(/class="eod-report-column-header"/g) || []).length, 20);
  assert.doesNotMatch(output, /<img|onerror="alert/); assert.match(output, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(output, /&lt;Notes &amp; details&gt;/); assert.equal((output.match(/Long &amp; complete note\./g) || []).length, 900);
  assert.equal((output.match(/<th scope="row">&lt;Notes &amp; details&gt;<\/th>/g) || []).length, 3);
});

test('browser utility exposes only pure report functions and needs no DOM, network or auth', () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/end-of-day-report.js'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.window.PawsEodReport), ['createReport', 'csv', 'html']);
  const result = browser.window.PawsEodReport.createReport({ start: '2026-10-20', end: '2026-10-20', rows: [], fields });
  assert.equal(result.days.length, 1); assert.match(browser.window.PawsEodReport.html(result), /No entry/);
});
