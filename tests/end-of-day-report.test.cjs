/* Synthetic read-only financial report fixtures; no network or live account data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createReport, csv, html, printHtml } = require('../assets/end-of-day-report.js');

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

// Resolve the real table-cell metric rules that caused screen/print height drift.
// Native PDF verification remains necessary for browser pagination and clipping.
function stylesheetRules(source, mode, filename, rules = []) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf('{', cursor); if (opening < 0) break;
    const selector = source.slice(cursor, opening).trim(); let depth = 1, closing = opening + 1;
    for (; closing < source.length && depth; closing++) { if (source[closing] === '{') depth++; else if (source[closing] === '}') depth--; }
    const body = source.slice(opening + 1, closing - 1); cursor = closing;
    if (selector.startsWith('@media')) {
      const applies = /\bprint\b/.test(selector) ? mode === 'print' : /\bscreen\b/.test(selector) ? mode === 'screen' : true;
      if (applies) stylesheetRules(body, mode, filename, rules);
    } else if (selector.startsWith('@supports')) stylesheetRules(body, mode, filename, rules);
    else if (!selector.startsWith('@') || selector === '@page') {
      const declarations = body.split(';').map(declaration => {
        const colon = declaration.indexOf(':'); if (colon < 0) return null;
        const value = declaration.slice(colon + 1).trim(), important = /!important\s*$/i.test(value);
        return { property: declaration.slice(0, colon).trim(), value: value.replace(/\s*!important\s*$/i, '').trim(), important };
      }).filter(Boolean);
      rules.push({ selector, declarations, filename });
    }
  }
  return rules;
}
function printStyles(mode) {
  const rules = [];
  for (const filename of ['styles.css', 'assets/end-of-day.css', 'assets/end-of-day-print.css']) stylesheetRules(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), mode, filename, rules);
  return rules;
}
function cellMetric(rules, cell, metric) {
  const candidates = [];
  for (const [order, rule] of rules.entries()) for (const selector of rule.selector.split(',').map(value => value.trim())) {
    const matches = selector === cell.tag || selector.includes('#weekReportPrint') && new RegExp(`\\s${cell.tag}$`).test(selector) && (!selector.includes('.eod-report-group') || cell.group) && (!selector.includes('.is-notes') || cell.notes);
    if (!matches) continue;
    for (const declaration of rule.declarations) {
      if (declaration.property !== metric) continue;
      const specificity = [(selector.match(/#/g) || []).length, (selector.match(/\./g) || []).length, selector.split(/\s+/).filter(token => /^[a-z]/.test(token)).length];
      candidates.push({ ...declaration, selector, filename: rule.filename, weight: [Number(declaration.important), ...specificity, order] });
    }
  }
  candidates.sort((left, right) => { for (let index = 0; index < left.weight.length; index++) if (left.weight[index] !== right.weight[index]) return left.weight[index] - right.weight[index]; return 0; });
  return candidates.at(-1);
}
function cssLengthPixels(value) {
  const match = value.match(/^(\d+(?:\.\d+)?)(px|pt|in|mm)$/); assert.ok(match, `supported physical metric: ${value}`);
  return Number(match[1]) * { px: 1, pt: 96 / 72, in: 96, mm: 96 / 25.4 }[match[2]];
}
function paddingPixels(value) {
  const values = value.split(/\s+/).map(cssLengthPixels);
  return values.length === 1 ? [values[0], values[0], values[0], values[0]] : values.length === 2 ? [values[0], values[1], values[0], values[1]] : values.length === 3 ? [values[0], values[1], values[2], values[1]] : values;
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

test('dedicated printing puts each seven-day group on one complete page with every field and date', () => {
  const result = report({ start: '2026-10-01', end: '2026-10-18', rows: [row({ entry_date:'2026-10-18', drawer_total:'199.99', total_deposit:'29.50' })] });
  const output = printHtml(result), pages = output.split('<section class="eod-print-page"').slice(1);
  assert.equal(pages.length,3);
  assert.equal((output.match(/class="eod-print-page-content"/g)||[]).length,3);
  assert.equal((output.match(/<h2>End Of Day<\/h2>/g)||[]).length,3);
  assert.equal((output.match(/class="eod-report-table"/g)||[]).length,3);
  assert.deepEqual([...output.matchAll(/<span>(\d{4}-\d{2}-\d{2})<\/span>/g)].map(match=>match[1]),result.days.map(day=>day.date));
  for(const [index,page] of pages.entries()) {
    const days=result.days.slice(index*7,index*7+7);
    assert.equal((page.match(/class="eod-report-column-header"/g)||[]).length,days.length);
    assert.equal((page.match(/scope="row"/g)||[]).length,25);
    for(const [,label] of fields) assert.ok(page.includes(`<th scope="row">${label}</th>`),label);
    assert.match(page,/Money in &amp; out/);assert.match(page,/Drawer · dollar amounts/);assert.match(page,/Deposits &amp; notes/);
  }
  assert.match(pages[2],/199\.99/);assert.match(pages[2],/29\.50/);
  assert.doesNotMatch(output,/eod-report-summary|Bill and coin values|Totals are the stored values/);
});

test('one-page print markup retains full long notes safely and omits deleted information', () => {
  const notes='<img src=x onerror="alert(1)">\n'+'Long & complete note. '.repeat(900);
  const labels=fields.map(field=>field[0]==='notes'?['notes','<Notes & details>',20000]:field);
  const result=report({rows:[row({notes}),row({entry_date:'2026-10-19',notes:'Deleted confidential note',deleted_at:'2026-10-20T12:00:00Z'})],fields:labels});
  const before=JSON.stringify(result),output=printHtml(result);
  assert.equal((output.match(/class="eod-print-page"/g)||[]).length,1);
  assert.equal((output.match(/Long &amp; complete note\./g)||[]).length,900);
  assert.match(output,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(output,/&lt;Notes &amp; details&gt;/);
  assert.doesNotMatch(output,/<img|onerror="alert|Deleted confidential note/);
  assert.equal(JSON.stringify(result),before);
});

test('print stylesheet measures complete fixed pages offscreen and applies saved fit scale only to content', () => {
  const stylesheet=fs.readFileSync(path.join(__dirname,'../assets/end-of-day-print.css'),'utf8');
  assert.match(stylesheet,/#weekReportPrint\.eod-print-output\s*\{[^}]*display:none/);
  assert.match(stylesheet,/#weekReportPrint\.is-measuring\s*\{[^}]*display:block[^}]*position:fixed[^}]*left:-20000px[^}]*visibility:hidden/);
  assert.match(stylesheet,/\.eod-print-page\s*\{[^}]*width:10\.2in[^}]*height:7\.65in[^}]*overflow:hidden/);
  assert.match(stylesheet,/\.eod-print-page-content\s*\{[^}]*position:absolute[^}]*transform:scale\(var\(--eod-print-scale,1\)\)[^}]*transform-origin:top center/);
  assert.match(stylesheet,/@page\s*\{size:letter landscape;margin:10mm/);
  assert.doesNotMatch(stylesheet,/page:eod-week|@page eod-week/);
  assert.match(stylesheet,/body\.eod-print-report\s+\.eod-print-page\s*\{[^}]*break-after:page/);
  assert.match(stylesheet,/body\.eod-print-report\s+\.eod-print-page:last-child\s*\{[^}]*break-after:auto/);
  assert.match(stylesheet,/body\.eod-print-report #weekReport > :not\(#weekReportPrint\)/);
  assert.doesNotMatch(stylesheet,/line-clamp|text-overflow|font-size:0/);
});

test('browser utility exposes only pure report functions and needs no DOM, network or auth', () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/end-of-day-report.js'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.window.PawsEodReport), ['createReport', 'csv', 'html', 'printHtml']);
  const result = browser.window.PawsEodReport.createReport({ start: '2026-10-20', end: '2026-10-20', rows: [], fields });
  assert.equal(result.days.length, 1); assert.match(browser.window.PawsEodReport.html(result), /No entry/);
  assert.match(browser.window.PawsEodReport.printHtml(result), /class="eod-print-page"/);
});


test('real global important print padding cannot make fitted snapshot cells taller than their screen measurements', () => {
  const screenRules = printStyles('screen'), actualPrintRules = printStyles('print');
  const globalOverride = actualPrintRules.find(rule => rule.filename === 'styles.css' && rule.selector.split(',').map(value => value.trim()).includes('td') && rule.declarations.some(declaration => declaration.property === 'padding' && declaration.important));
  assert.ok(globalOverride, 'the regression includes the actual site-wide important print override');
  const dangerousPadding = globalOverride.declarations.find(declaration => declaration.property === 'padding'); assert.deepEqual(paddingPixels(dangerousPadding.value), [6, 8, 6, 8]);
  for (const cell of [{ tag: 'td' }, { tag: 'th' }, { tag: 'th', group: true }, { tag: 'td', notes: true }]) {
    const measured = cellMetric(screenRules, cell, 'padding'), printed = cellMetric(actualPrintRules, cell, 'padding');
    assert.ok(measured && printed, `${JSON.stringify(cell)} has explicit snapshot padding in both media`);
    assert.equal(measured.filename, 'assets/end-of-day-print.css'); assert.equal(printed.filename, 'assets/end-of-day-print.css', `${JSON.stringify(cell)} must defeat global print padding`);
    assert.equal(measured.important, true); assert.equal(printed.important, true);
    assert.deepEqual(paddingPixels(printed.value), paddingPixels(measured.value), `${JSON.stringify(cell)} must have the same actual and measured row height`);
    assert.ok(paddingPixels(printed.value)[0] < 6, 'the compact print metrics remain compact');
    const unprotectedRules = actualPrintRules.map(rule => rule.filename !== 'assets/end-of-day-print.css' ? rule : { ...rule, declarations: rule.declarations.map(declaration => declaration.property === 'padding' ? { ...declaration, important: false } : declaration) });
    const unprotected = cellMetric(unprotectedRules, cell, 'padding'); assert.equal(unprotected.filename, 'styles.css', 'the old unprotected snapshot loses to the real global override'); assert.notDeepEqual(paddingPixels(unprotected.value), paddingPixels(measured.value), 'the regression would recreate measured/printed height drift');
    const measuredBorder = cellMetric(screenRules, cell, 'border'), printedBorder = cellMetric(actualPrintRules, cell, 'border');
    assert.equal(measuredBorder.filename, 'assets/end-of-day-print.css'); assert.equal(printedBorder.filename, 'assets/end-of-day-print.css'); assert.equal(measuredBorder.important, true); assert.equal(printedBorder.important, true);
    assert.equal(cssLengthPixels(measuredBorder.value.split(/\s+/)[0]), cssLengthPixels(printedBorder.value.split(/\s+/)[0]));
  }
});

test('the final anonymous page rule requests landscape and leaves enough physical space for complete weekly sheets', () => {
  const rules = printStyles('print'), pages = rules.filter(rule => rule.selector === '@page'); assert.ok(pages.length >= 2, 'include the earlier site-wide page rule as well as the report override');
  const last = pages.at(-1), size = last.declarations.find(declaration => declaration.property === 'size'), margin = last.declarations.find(declaration => declaration.property === 'margin');
  assert.equal(last.filename, 'assets/end-of-day-print.css'); assert.equal(size.value, 'letter landscape'); assert.deepEqual(paddingPixels(margin.value), [cssLengthPixels('10mm'), cssLengthPixels('10mm'), cssLengthPixels('10mm'), cssLengthPixels('10mm')]);
  const stylesheet = fs.readFileSync(path.join(__dirname, '../assets/end-of-day-print.css'), 'utf8');
  const page = stylesheetRules(stylesheet, 'screen', 'snapshot').find(rule => rule.selector === '#weekReportPrint .eod-print-page');
  const width = page.declarations.find(declaration => declaration.property === 'width'), height = page.declarations.find(declaration => declaration.property === 'height'), margins = paddingPixels(margin.value);
  assert.ok(cssLengthPixels(width.value) <= cssLengthPixels('11in') - margins[1] - margins[3]); assert.ok(cssLengthPixels(height.value) <= cssLengthPixels('8.5in') - margins[0] - margins[2]);
  const body = rules.findLast(rule => rule.selector === 'body.eod-print-report'); assert.ok(body.declarations.some(declaration => declaration.property === 'margin' && declaration.value === '0' && declaration.important), 'browser body margins cannot consume the fitted print area');
});

test('every weekly print page retains all bottom-row end markers and all dates after wrapped notes', () => {
  const dates = Array.from({ length: 21 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`), rows = dates.map(date => row({ entry_date: date, staff_name: 'Synthetic closer', receipt_description: 'Wrapped receipt detail. '.repeat(8), notes: 'Wrapped reconciliation note. '.repeat(15), additional_note: `END_OF_REPORT_${date.replaceAll('-', '')}` }));
  const result = report({ start: dates[0], end: dates.at(-1), rows }), output = printHtml(result), pages = output.split('<section class="eod-print-page"').slice(1); assert.equal(pages.length, 3);
  for (const [index, page] of pages.entries()) {
    const expectedDates = dates.slice(index * 7, index * 7 + 7); assert.deepEqual([...page.matchAll(/<span>(\d{4}-\d{2}-\d{2})<\/span>/g)].map(match => match[1]), expectedDates);
    const lastRow = page.match(/<tr class="is-notes"><th scope="row">additional note<\/th>([\s\S]*?)<\/tr>/); assert.ok(lastRow, 'the final Additional note row exists');
    assert.deepEqual([...lastRow[1].matchAll(/END_OF_REPORT_(\d{8})/g)].map(match => match[1]), expectedDates.map(date => date.replaceAll('-', '')));
    assert.match(page, /Wrapped receipt detail/); assert.match(page, /Wrapped reconciliation note/); assert.equal((page.match(/scope="row"/g) || []).length, 25);
  }
});
