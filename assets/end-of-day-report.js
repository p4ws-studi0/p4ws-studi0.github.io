/* Read-only End Of Day reports. No records, sessions, or page state are changed. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PawsEodReport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const GROUPS = [
    ['Money in & out', ['staff_name', 'cash_received', 'checks_received', 'card_tips_received', 'card_tips_paid', 'receipts_paid', 'receipt_description', 'cash_replaced']],
    ['Drawer · dollar amounts', ['bills_100', 'bills_50', 'bills_20', 'bills_10', 'bills_5', 'bills_1', 'quarters', 'dimes', 'nickels', 'pennies', 'drawer_total']],
    ['Deposits & notes', ['cash_deposit', 'check_deposit', 'total_deposit', 'notes', 'additional_note']]
  ];
  const ALLOWED = new Set(GROUPS.flatMap(([, keys]) => keys));
  const TOTALS = new Set(['drawer_total', 'total_deposit']);
  const NOTES = new Set(['receipt_description', 'notes', 'additional_note']);
  const text = value => String(value ?? '');
  const escape = value => text(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function dateNumber(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Choose real dates in YYYY-MM-DD format.');
    const [year, month, day] = value.split('-').map(Number);
    const milliseconds = Date.UTC(year, month - 1, day), date = new Date(milliseconds);
    if (year < 1000 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RangeError('Choose real dates in YYYY-MM-DD format.');
    return milliseconds;
  }

  function createReport({ start, end, rows, fields } = {}) {
    const first = dateNumber(start), last = dateNumber(end), count = (last - first) / 86400000 + 1;
    if (count < 1 || count > 366) throw new RangeError('Choose a range of 1 to 366 days.');
    if (!Array.isArray(rows) || !Array.isArray(fields) || !fields.length) throw new TypeError('Report rows and fields are required.');
    const seen = new Set();
    const reportFields = fields.map(field => {
      if (!Array.isArray(field) || !ALLOWED.has(field[0]) || seen.has(field[0]) || typeof field[1] !== 'string' || !field[1].trim()) throw new TypeError('Use unique End Of Day business fields with labels.');
      seen.add(field[0]);
      return { key: field[0], label: field[1] };
    });
    const byDate = new Map();
    for (const row of rows) {
      if (!row || typeof row.entry_date !== 'string' || row.entry_date < start || row.entry_date > end) continue;
      dateNumber(row.entry_date);
      if (byDate.has(row.entry_date)) throw new TypeError('Each report date must have at most one entry.');
      byDate.set(row.entry_date, row);
    }
    const days = Array.from({ length: count }, (_, index) => {
      const date = new Date(first + index * 86400000).toISOString().slice(0, 10), row = byDate.get(date);
      const deleted = Boolean(row && row.deleted_at != null);
      return {
        date,
        status: !row ? 'No entry' : deleted ? 'Deleted' : 'Recorded',
        values: Object.fromEntries(reportFields.map(({ key }) => [key, row && !deleted ? text(row[key]) : '']))
      };
    });
    return { start, end, days, fields: reportFields };
  }

  // Quoting alone does not stop spreadsheet formulas. Signed plain decimals are safe.
  function csvCell(value) {
    let cell = text(value);
    const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cell);
    if (!numeric && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r]/.test(cell))) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }

  function csv(report) {
    const lines = [['Date', 'Entry', ...report.fields.map(field => field.label)]];
    for (const day of report.days) lines.push([day.date, day.status, ...report.fields.map(field => day.values[field.key])]);
    return '\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function friendly(value, options = {}) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...options }).format(new Date(value + 'T12:00:00Z'));
  }
  const range = (start, end) => start === end ? friendly(start) : `${friendly(start)} – ${friendly(end)}`;

  function table(report, days) {
    const byKey = new Map(report.fields.map(field => [field.key, field]));
    const headings = days.map(day => `<th scope="col"><div class="eod-report-column-header"><span>${escape(friendly(day.date, { weekday: 'short', year: undefined }))}</span><span>${escape(day.date)}</span></div></th>`).join('');
    const status = `<tr class="eod-report-entry-row"><th scope="row">Entry</th>${days.map(day => `<td>${escape(day.status)}</td>`).join('')}</tr>`;
    const groups = GROUPS.map(([title, keys]) => {
      const fields = keys.map(key => byKey.get(key)).filter(Boolean);
      if (!fields.length) return '';
      return `<tr class="eod-report-group"><th colspan="${days.length + 1}">${escape(title)}</th></tr>` + fields.map(field => {
        const classes = [TOTALS.has(field.key) ? 'is-total' : '', NOTES.has(field.key) ? 'is-notes' : ''].filter(Boolean).join(' ');
        return `<tr${classes ? ` class="${classes}"` : ''}><th scope="row">${escape(field.label)}</th>${days.map(day => `<td>${escape(day.values[field.key])}</td>`).join('')}</tr>`;
      }).join('');
    }).join('');
    return `<table class="eod-report-table"><thead><tr><th scope="col">End Of Day</th>${headings}</tr></thead><tbody>${status}${groups}</tbody></table>`;
  }

  function html(report) {
    const sheets = [];
    for (let offset = 0; offset < report.days.length; offset += 7) {
      const days = report.days.slice(offset, offset + 7), label = range(days[0].date, days.at(-1).date);
      sheets.push(`<section class="eod-report-sheet" aria-label="${escape(label)}"><h3>${escape(label)}</h3>${table(report, days)}</section>`);
    }
    return `<div class="eod-report-summary"><h2>End Of Day</h2><p>${escape(range(report.start, report.end))}</p><p>Bill and coin values are dollar amounts, not counts. Totals are the stored values for each day. Every date is included, even when its entry is blank.</p></div>${sheets.join('')}`;
  }

  // A fixed printable page per week; the caller measures each complete page and
  // scales its contents to fit without changing or shortening any saved value.
  function printHtml(report) {
    const pages = [];
    for (let offset = 0; offset < report.days.length; offset += 7) {
      const days = report.days.slice(offset, offset + 7), label = range(days[0].date, days.at(-1).date);
      pages.push(`<section class="eod-print-page" aria-label="${escape(label)}"><div class="eod-print-page-content"><header class="eod-print-heading"><h2>End Of Day</h2><p>${escape(label)}</p></header>${table(report, days)}</div></section>`);
    }
    return pages.join('');
  }

  return Object.freeze({ createReport, csv, html, printHtml });
});
