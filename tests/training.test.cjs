/* Offline behavior tests. All dog names and training text below are synthetic. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(process.env.TRAINING_TEST_ROOT || path.join(__dirname, '..'));
const html = fs.readFileSync(path.join(root, 'training.html'), 'utf8');
const scriptPath = fs.existsSync(path.join(root, 'assets/training.js'))
  ? path.join(root, 'assets/training.js') : path.join(root, 'training.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const fieldIds = {
  day_label: 'dayLabel', date_label: 'dateLabel', session_label: 'sessionLabel',
  time_label: 'timeLabel', trainer: 'trainer', work_detail: 'workDetail', notes: 'sessionNotes'
};
const fields = Object.keys(fieldIds);
const clone = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const dog = (patch = {}) => ({id: uuid(1), name: 'Fixture Dog', revision: 1, ...patch});
const log = (patch = {}) => ({
  id: uuid(11), dog_id: uuid(1), day_label: '1', date_label: '4/5', session_label: '1/3',
  time_label: '9:00–9:20', trainer: 'Test Coach', work_detail: 'Synthetic exercise', notes: '',
  position: '1', revision: 1, deleted_at: null,
  source_file: null, source_row: null, source_values: null, ...patch
});
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
async function until(check) {
  for (let i = 0; i < 300 && !check(); i++) await Promise.resolve();
  assert.ok(check(), 'asynchronous operation reached expected state');
}
async function flush() {for (let i = 0; i < 30; i++) await Promise.resolve();}
const submitEvent = () => ({preventDefault() {}});

function environment({dogs = [dog()], logs = [], active = true, session = {user: {id: uuid(900)}}, intercept = null} = {}) {
  const api = {dogs: clone(dogs), logs: clone(logs), active, session, calls: [], authCallbacks: [], intercept};
  const nodes = new Map();
  const timers = new Map();
  const windowEvents = {};
  let timerId = 0, nextUuid = 10000;
  const now = '2026-09-30T02:30:00.000Z'; // Still September 29 in New York.
  function makeNode(id, tag = 'div', type = '') {
    let value = '';
    const node = {
      id, tag, type, innerHTML: '', textContent: '', hidden: false, disabled: false,
      required: false, open: false, dataset: {}, attributes: {}, events: {}, classes: new Set(),
      get value() {return value;},
      set value(next) {
        value = String(next ?? '');
        // Model the browser's input-value normalization; the app must retain
        // original imported strings when an existing field was not edited.
        if (tag === 'input' && !['hidden', 'checkbox'].includes(type)) value = value.replace(/[\r\n]/g, '');
        if (tag === 'textarea') value = value.replace(/\r\n?/g, '\n');
      },
      addEventListener(name, callback) {(this.events[name] ||= []).push(callback);},
      async emit(name, event = {}) {for (const callback of this.events[name] || []) await callback(event);},
      setAttribute(name, value) {this.attributes[name] = String(value);},
      focus() {}, showModal() {this.open = true;},
      close() {
        const wasOpen = this.open; this.open = false;
        if (wasOpen) for (const callback of this.events.close || []) callback({});
      },
      querySelectorAll() {return [];}, reset() {}, reportValidity() {return true;}
    };
    node.classList = {
      add(name) {node.classes.add(name);}, remove(name) {node.classes.delete(name);},
      contains(name) {return node.classes.has(name);},
      toggle(name, on) {if (on) node.classes.add(name); else node.classes.delete(name);}
    };
    return node;
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const [, tag, attributes, id] = match;
    assert.ok(!nodes.has(id), `real HTML contains a unique #${id}`);
    const node = makeNode(id, tag.toLowerCase(), attributes.match(/\btype="([^"]+)"/)?.[1] || '');
    node.hidden = /\bhidden(?:\s|$)/.test(attributes);
    node.disabled = /\bdisabled(?:\s|$)/.test(attributes);
    nodes.set(id, node);
  }
  const get = id => {assert.ok(nodes.has(id), `real HTML contains #${id}`); return nodes.get(id);};
  for (const formId of ['sessionForm', 'dogForm']) {
    const formMarkup = html.match(new RegExp(`<form\\b[^>]*id="${formId}"[\\s\\S]*?<\\/form>`))?.[0];
    assert.ok(formMarkup, `real HTML contains form #${formId}`);
    const inputs = [...formMarkup.matchAll(/<(?:input|textarea|select)\b[^>]*\bid="([^"]+)"/g)].map(([, id]) => get(id));
    get(formId).querySelectorAll = () => inputs;
    get(formId).reset = () => inputs.forEach(input => {input.value = '';});
  }
  const views = [...html.matchAll(/data-log-view="([^"]+)"/g)].map(([, value]) => {
    const node = makeNode(`view-${value}`, 'button'); node.dataset.logView = value; return node;
  });
  assert.deepEqual(views.map(node => node.dataset.logView), ['active', 'deleted']);

  async function complete(call) {
    api.calls.push(call);
    const intercepted = api.intercept?.(call, api);
    if (intercepted !== undefined) return intercepted;
    if (call.table === 'hq_tour_staff') {
      return {data: api.active && api.session ? {user_id: api.session.user.id, active: true} : null, error: null};
    }
    const collection = call.table === 'hq_training_dogs' ? api.dogs : call.table === 'hq_training_logs' ? api.logs : null;
    assert.ok(collection, `query uses an expected training table: ${call.table}`);
    const matchesFilters = row => call.filters.every(([, key, value]) => row[key] === value);
    if (call.operation === 'insert') {
      if (collection.some(row => row.id === call.payload.id)) return {data: null, error: {code: '23505'}};
      const saved = call.table === 'hq_training_dogs' ? dog(call.payload) : log({
        ...call.payload, position: String(Math.max(0, ...api.logs.map(row => Number(row.position))) + 1)
      });
      collection.push(saved); return {data: clone(saved), error: null};
    }
    if (call.operation === 'update') {
      const index = collection.findIndex(matchesFilters);
      if (index < 0) return {data: null, error: null};
      collection[index] = {...collection[index], ...call.payload, revision: collection[index].revision + 1};
      return {data: clone(collection[index]), error: null};
    }
    let rows = collection.filter(matchesFilters);
    rows.sort((left, right) => {
      for (const [key, ascending] of call.orders) {
        const comparison = String(left[key]).localeCompare(String(right[key]));
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
    return {data: call.terminal === 'range' ? clone(rows) : clone(rows[0] || null), error: null};
  }
  const client = {
    auth: {
      async getSession() {return {data: {session: api.session}, error: null};},
      onAuthStateChange(callback) {api.authCallbacks.push(callback); return {data: {subscription: {unsubscribe() {}}}};}
    },
    from(table) {
      const call = {table, operation: 'select', filters: [], orders: []};
      const finish = terminal => {call.terminal = terminal; return complete(call);};
      const chain = {
        select(fields) {call.fields = fields; return chain;},
        insert(payload) {call.operation = 'insert'; call.payload = clone(payload); return chain;},
        update(payload) {call.operation = 'update'; call.payload = clone(payload); return chain;},
        eq(key, value) {call.filters.push(['eq', key, value]); return chain;},
        is(key, value) {call.filters.push(['is', key, value]); return chain;},
        order(key, {ascending = true} = {}) {call.orders.push([key, ascending]); return chain;},
        range(start, end) {call.range = [start, end]; return finish('range');},
        single() {return finish('single');}, maybeSingle() {return finish('maybeSingle');}
      };
      return chain;
    }
  };
  class TestDate extends Date {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return Date.parse(now);}}
  const document = {
    readyState: 'loading', hidden: false, getElementById: get,
    querySelectorAll(selector) {return selector === '[data-log-view]' ? views : [];},
    addEventListener() {}
  };
  const window = {addEventListener(name, callback) {(windowEvents[name] ||= []).push(callback);}};
  const context = vm.createContext({
    document, window, supabaseClient: client, Date: TestDate, Intl, console,
    crypto: {randomUUID: () => uuid(nextUuid++)},
    setInterval() {return 1;}, clearInterval() {},
    setTimeout(fn, delay) {timers.set(++timerId, {fn, delay}); return timerId;},
    clearTimeout(id) {timers.delete(id);}
  });
  const marker = "  if (document.readyState==='loading')";
  assert.equal(script.split(marker).length, 2, 'test hook is inserted only at the IIFE startup boundary');
  const instrumented = script.replace(marker, `  window.__trainingTest = {state,init,refresh,todayLabel,sortLogs,groupLogs,render,selectDog,openSession,sessionPayload,saveSession,openDog,saveDog,confirmDelete,removeLog,restoreLog,resetAuth};\n${marker}`);
  vm.runInContext(instrumented, context, {filename: scriptPath});
  const app = window.__trainingTest;
  return {
    get, api, app, views, timers,
    async start() {app.init(); await until(() => !app.state.loading);},
    async submitSession() {return get('sessionForm').emit('submit', submitEvent());},
    async submitDog() {return get('dogForm').emit('submit', submitEvent());},
    async click(id) {return get(id).emit('click');},
    signOut() {api.session = null; for (const callback of api.authCallbacks) callback('SIGNED_OUT', null);},
    signIn(userId = uuid(901)) {api.session = {user: {id: userId}}; for (const callback of api.authCallbacks) callback('SIGNED_IN', api.session);},
    runTimers(delay) {for (const [id, timer] of [...timers]) if (timer.delay === delay) {timers.delete(id); timer.fn();}}
  };
}

test('existing seven fields round-trip verbatim, including blank dates and normalized browser whitespace', async () => {
  const source = log({day_label: ' 6\r\n', date_label: '', session_label: ' 2 / 3  ', time_label: '\t9ish  ',
    trainer: ' Coach\r\nOne  ', work_detail: 'Line one\r\nLine two  ', notes: '\tNote  ',
    source_file: 'Synthetic.csv', source_row: 2});
  source.source_values = fields.map(key => source[key]);
  const h = environment({logs: [source]}); await h.start();
  h.app.openSession(h.app.state.logs[0]);
  assert.equal(h.get('dateLabel').value, '');
  assert.equal(h.get('dayLabel').value, ' 6');
  await h.submitSession();
  let mutation = h.api.calls.find(call => call.operation === 'update');
  assert.deepEqual(fields.map(key => mutation.payload[key]), source.source_values);
  assert.deepEqual(Object.keys(mutation.payload).sort(), ['dog_id', ...fields].sort());
  assert.equal(h.get('sessionDialog').open, false);

  h.app.openSession(h.app.state.logs[0]);
  h.get('sessionNotes').value = '  Revised synthetic note\t ';
  await h.submitSession();
  mutation = h.api.calls.filter(call => call.operation === 'update').at(-1);
  assert.equal(mutation.payload.notes, '  Revised synthetic note\t ');
  assert.deepEqual(fields.slice(0, -1).map(key => mutation.payload[key]), source.source_values.slice(0, -1));
  assert.deepEqual(h.app.state.logs[0].source_values, source.source_values);
  assert.equal(h.app.state.logs[0].revision, 3);
});

test('new entries use New York today only as an editable default and accept a day-only partial row', async () => {
  const h = environment(); await h.start();
  h.app.openSession();
  assert.equal(h.get('dateLabel').value, '09/29/2026');
  h.get('dateLabel').value = ''; h.get('dayLabel').value = ' 6 ';
  await h.submitSession();
  const mutation = h.api.calls.find(call => call.operation === 'insert');
  assert.equal(mutation.payload.day_label, ' 6 ');
  for (const key of fields.filter(key => key !== 'day_label')) assert.equal(mutation.payload[key], '');
  assert.equal('position' in mutation.payload, false);
  assert.equal('source_values' in mutation.payload, false);

  h.app.openSession(); for (const id of Object.values(fieldIds)) h.get(id).value = '';
  await h.submitSession();
  assert.match(h.get('sessionError').textContent, /at least one training detail/);
  assert.equal(h.api.calls.filter(call => call.operation === 'insert').length, 1);
});

test('ambiguous source date and time labels stay literal in the form and save request', async () => {
  const source = log({date_label: '4/5', time_label: 'Before lunch?', session_label: '2-ish'});
  const h = environment({logs: [source]}); await h.start();
  h.app.openSession(h.app.state.logs[0]);
  assert.equal(h.get('dateLabel').type, 'text'); assert.equal(h.get('timeLabel').type, 'text');
  assert.equal(h.get('dateLabel').value, '4/5');
  h.get('dateLabel').value = ' 5/6 '; h.get('timeLabel').value = ' 10–11? ';
  await h.submitSession();
  const patch = h.api.calls.find(call => call.operation === 'update').payload;
  assert.equal(patch.date_label, ' 5/6 '); assert.equal(patch.time_label, ' 10–11? ');
  assert.equal(patch.session_label, '2-ish');
});

test('source order and repeated day labels group together while carried labels remain display-only', async () => {
  const rows = [
    log({id: uuid(13), position: '90071992547409933', day_label: '', work_detail: 'target exercise'}),
    log({id: uuid(11), position: '90071992547409931', day_label: '2', work_detail: 'first exercise'}),
    log({id: uuid(12), position: '90071992547409932', day_label: '2', work_detail: 'second exercise'}),
    log({id: uuid(14), position: '90071992547409934', day_label: '3', work_detail: 'third day'})
  ];
  const snapshot = clone(rows); const h = environment({logs: rows}); await h.start();
  const groups = h.app.groupLogs(h.app.state.logs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, '2'); assert.equal(groups[0].rows.length, 3);
  assert.deepEqual(clone(groups[0].rows.map(row => row.id)), [uuid(11), uuid(12), uuid(13)]);
  const filtered = h.app.groupLogs(h.app.state.logs, 'target');
  assert.equal(filtered.length, 1); assert.equal(filtered[0].label, '2');
  assert.equal(filtered[0].rows[0].day_label, '');
  assert.deepEqual(rows, snapshot);
  h.app.openSession(h.app.state.logs.find(row => row.id === uuid(13)));
  await h.submitSession();
  assert.equal(h.api.calls.find(call => call.operation === 'update').payload.day_label, '');
});

test('search, exact trainer filtering, dog selection, and deleted view do not change stored records', async () => {
  const dogs = [dog(), dog({id: uuid(2), name: 'Second Fixture'})];
  const rows = [log({work_detail: 'Needle exercise', trainer: 'Coach A'}),
    log({id: uuid(12), position: '2', day_label: '', work_detail: 'Other exercise', trainer: 'Coach B'}),
    log({id: uuid(13), position: '3', deleted_at: '2026-01-01T00:00:00Z', work_detail: 'Deleted fixture'}),
    log({id: uuid(14), position: '4', dog_id: uuid(2), work_detail: 'Second dog fixture'})];
  const h = environment({dogs, logs: rows}); await h.start();
  h.get('logSearch').value = ' NEEDLE '; await h.get('logSearch').emit('input');
  assert.match(h.get('logList').innerHTML, /Needle exercise/);
  assert.doesNotMatch(h.get('logList').innerHTML, /Other exercise|Deleted fixture|Second dog fixture/);
  h.get('trainerFilter').value = 'Coach B'; await h.get('trainerFilter').emit('change');
  assert.match(h.get('logList').innerHTML, /No matching entries/);
  h.get('logSearch').value = ''; await h.get('logSearch').emit('input');
  assert.match(h.get('logList').innerHTML, /Other exercise/);
  assert.doesNotMatch(h.get('logList').innerHTML, /Needle exercise/);
  h.get('trainerFilter').value = ''; await h.views.find(view => view.dataset.logView === 'deleted').emit('click');
  assert.match(h.get('logList').innerHTML, /Deleted fixture/);
  assert.doesNotMatch(h.get('logList').innerHTML, /Needle exercise/);
  await h.get('dogList').emit('click', {target: {closest: () => ({dataset: {dogId: uuid(2)}})}});
  assert.equal(h.app.state.view, 'active'); assert.equal(h.get('logSearch').value, '');
  assert.equal(h.get('trainerFilter').value, '');
  assert.match(h.get('logList').innerHTML, /Second dog fixture/);
  assert.deepEqual(h.api.logs, rows);
});

test('active blank-day entries retain context from a deleted day header without filling their stored cells', async () => {
  const rows = [
    log({id: uuid(11), position: '1', day_label: ' 4 ', deleted_at: '2026-01-01T00:00:00Z', work_detail: 'Deleted day header'}),
    log({id: uuid(12), position: '2', day_label: '', date_label: '', work_detail: 'Active continuation'}),
    log({id: uuid(13), position: '3', day_label: '4', work_detail: 'Repeated explicit day'}),
    log({id: uuid(14), position: '4', day_label: '5', work_detail: 'Next day'})
  ];
  const h = environment({logs: rows}); await h.start();
  const groups = h.app.groupLogs(h.app.state.logs, '', '', 'active');
  assert.equal(groups.length, 2); assert.equal(groups[0].label, ' 4 ');
  assert.equal(groups[0].hasDay, true);
  assert.deepEqual(clone(groups[0].rows.map(row => row.id)), [uuid(12), uuid(13)]);
  assert.doesNotMatch(h.get('logList').innerHTML, /Deleted day header/);
  assert.match(h.get('logList').innerHTML, />Day\s+4\s*</);
  h.get('logSearch').value = 'continuation'; await h.get('logSearch').emit('input');
  assert.match(h.get('logList').innerHTML, />Day\s+4\s*</);
  h.app.openSession(h.app.state.logs.find(row => row.id === uuid(12)));
  assert.equal(h.get('dayLabel').value, ''); assert.equal(h.get('dateLabel').value, '');
  await h.submitSession();
  const patch = h.api.calls.find(call => call.operation === 'update').payload;
  assert.equal(patch.day_label, ''); assert.equal(patch.date_label, '');
});

test('rendering escapes text and attribute content from stored training fields', async () => {
  const h = environment({dogs: [dog({name: 'Fixture <img src=x>'})], logs: [log({
    trainer: 'Coach " onclick="bad()', work_detail: '<script>bad()</script>', notes: 'A & B\n  next line  '
  })]}); await h.start();
  assert.doesNotMatch(h.get('dogList').innerHTML, /<img/);
  assert.match(h.get('dogList').innerHTML, /&lt;img/);
  assert.doesNotMatch(h.get('logList').innerHTML, /<script>/);
  assert.match(h.get('logList').innerHTML, /&lt;script&gt;/);
  assert.match(h.get('logList').innerHTML, /A &amp; B\n  next line  /);
  assert.doesNotMatch(h.get('trainerFilter').innerHTML, /value="Coach " onclick=/);
});

test('stale entry revisions preserve the draft and never overwrite the newer row', async () => {
  const h = environment({logs: [log()]}); await h.start();
  h.app.openSession(h.app.state.logs[0]); h.get('sessionNotes').value = 'Unsaved current draft';
  h.api.logs[0] = {...h.api.logs[0], revision: 2, notes: 'Newer shared note'};
  await h.submitSession();
  assert.equal(h.get('sessionDialog').open, true);
  assert.equal(h.get('sessionNotes').value, 'Unsaved current draft');
  assert.match(h.get('sessionError').textContent, /Someone else changed/);
  const update = h.api.calls.find(call => call.operation === 'update');
  assert.deepEqual(update.filters, [['eq', 'id', uuid(11)], ['eq', 'revision', 1]]);
  assert.equal(h.api.logs[0].notes, 'Newer shared note');
});

test('lost insert response retries the same UUID and recovers without losing subsequent draft edits', async () => {
  let attempts = 0;
  const h = environment({intercept: (call, api) => {
    if (call.table === 'hq_training_logs' && call.operation === 'insert' && ++attempts === 1) {
      api.logs.push(log(call.payload)); return {data: null, error: {code: 'NETWORK'}};
    }
  }}); await h.start();
  h.app.openSession(); const id = h.get('sessionId').value;
  h.get('workDetail').value = 'First draft'; await h.submitSession();
  assert.equal(h.get('sessionDialog').open, true);
  h.get('workDetail').value = 'Newer unsaved draft  '; await h.submitSession();
  assert.deepEqual(h.api.calls.filter(call => call.operation === 'insert').map(call => call.payload.id), [id, id]);
  assert.equal(h.api.logs.length, 1); assert.equal(h.get('sessionDialog').open, true);
  assert.equal(h.get('workDetail').value, 'Newer unsaved draft  ');
  assert.match(h.get('sessionError').textContent, /earlier save succeeded/);
  await h.submitSession();
  assert.equal(h.api.logs.length, 1); assert.equal(h.api.logs[0].revision, 2);
  assert.equal(h.api.logs[0].work_detail, 'Newer unsaved draft  ');
  assert.equal(h.get('sessionDialog').open, false);
});

test('deletion, undo, and explicit restoration all use expected revisions', async () => {
  const h = environment({logs: [log()]}); await h.start();
  h.app.confirmDelete(h.app.state.logs[0]); await h.click('confirmDelete');
  assert.equal(h.get('deleteDialog').open, false); assert.ok(h.api.logs[0].deleted_at);
  assert.equal(h.get('undoDelete').hidden, false);
  await h.click('undoDelete'); await until(() => !h.app.state.busy);
  assert.equal(h.api.logs[0].deleted_at, null); assert.equal(h.api.logs[0].revision, 3);
  h.app.confirmDelete(h.app.state.logs[0]); await h.click('confirmDelete');
  await h.views.find(view => view.dataset.logView === 'deleted').emit('click');
  await h.app.restoreLog(h.app.state.logs[0]);
  assert.equal(h.api.logs[0].deleted_at, null); assert.equal(h.api.logs[0].revision, 5);
  assert.deepEqual(h.api.calls.filter(call => call.operation === 'update').map(call => call.filters.find(([, key]) => key === 'revision')[2]), [1, 2, 3, 4]);
  assert.equal(h.get('toast').hidden, false); h.runTimers(5000);
  assert.equal(h.get('toast').hidden, true); assert.equal(h.get('undoDelete').hidden, true);
});

test('stale deletion and restore operations report conflicts without destroying newer edits', async () => {
  const h = environment({logs: [log()]}); await h.start();
  h.app.confirmDelete(h.app.state.logs[0]); h.api.logs[0].revision = 2;
  await h.click('confirmDelete');
  assert.equal(h.get('deleteDialog').open, true); assert.equal(h.api.logs[0].deleted_at, null);
  assert.match(h.get('deleteDescription').textContent, /Someone else changed/);
  h.get('deleteDialog').close();
  const stale = log({deleted_at: '2026-01-01T00:00:00Z'});
  h.api.logs[0].deleted_at = stale.deleted_at;
  await h.app.restoreLog(stale);
  assert.equal(h.api.logs[0].deleted_at, stale.deleted_at);
  assert.match(h.get('pageMessage').textContent, /Someone else changed/);
});

test('dog creation and renaming use the same revision conflict protection', async () => {
  const h = environment(); await h.start();
  h.app.openDog(); h.get('dogName').value = ' Added Fixture '; await h.submitDog();
  const added = h.api.dogs.find(row => row.name === 'Added Fixture'); assert.ok(added);
  assert.equal(h.app.state.selectedDog, added.id);
  h.app.openDog(h.app.state.dogs.find(row => row.id === added.id));
  h.get('dogName').value = 'Renamed Fixture'; await h.submitDog();
  assert.equal(h.api.dogs.find(row => row.id === added.id).revision, 2);
  h.app.openDog(h.app.state.dogs.find(row => row.id === added.id));
  h.get('dogName').value = 'Keep this name draft';
  h.api.dogs.find(row => row.id === added.id).revision = 3;
  await h.submitDog();
  assert.match(h.get('dogError').textContent, /Someone else changed/);
  assert.equal(h.get('dogName').value, 'Keep this name draft');
  assert.equal(h.get('dogDialog').open, true);
});

test('lost dog-creation response recovers one record and retains a subsequently revised name', async () => {
  let attempts = 0;
  const h = environment({intercept: (call, api) => {
    if (call.table === 'hq_training_dogs' && call.operation === 'insert' && ++attempts === 1) {
      api.dogs.push(dog(call.payload)); return {data: null, error: {code: 'NETWORK'}};
    }
  }}); await h.start();
  h.app.openDog(); h.get('dogName').value = 'Initial Added Fixture';
  const id = h.get('dogId').value; await h.submitDog();
  h.get('dogName').value = 'Revised Added Fixture'; await h.submitDog();
  assert.deepEqual(h.api.calls.filter(call => call.operation === 'insert').map(call => call.payload.id), [id, id]);
  assert.equal(h.api.dogs.filter(row => row.id === id).length, 1);
  assert.match(h.get('dogError').textContent, /earlier save succeeded/);
  assert.equal(h.get('dogName').value, 'Revised Added Fixture');
  await h.submitDog();
  const saved = h.api.dogs.find(row => row.id === id);
  assert.equal(saved.name, 'Revised Added Fixture'); assert.equal(saved.revision, 2);
  assert.equal(h.get('dogDialog').open, false);
});

test('unapproved or signed-out accounts never fetch training tables', async () => {
  for (const options of [{active: false}, {session: null}]) {
    const h = environment(options); await h.start();
    assert.equal(h.app.state.ready, false); assert.equal(h.get('addDog').disabled, true);
    assert.equal(h.api.calls.some(call => call.table.startsWith('hq_training_')), false);
    assert.equal(h.app.state.logs.length, 0);
  }
  const h = environment({logs: [log()]}); await h.start();
  h.app.openSession(); h.get('workDetail').value = 'Retained draft'; h.api.active = false;
  await h.submitSession();
  assert.equal(h.api.calls.some(call => call.operation === 'insert'), false);
  assert.equal(h.get('workDetail').value, 'Retained draft');
  assert.match(h.get('sessionError').textContent, /does not have training access/);
  h.get('sessionDialog').close(); await h.app.refresh();
  assert.equal(h.app.state.logs.length, 0); assert.equal(h.app.state.dogs.length, 0);
});

test('pagination loads every dog and entry page before sorting by original position', async () => {
  const dogs = Array.from({length: 501}, (_, index) => dog({id: uuid(index + 1), name: `Fixture ${String(index).padStart(3, '0')}`}));
  const logs = Array.from({length: 1001}, (_, index) => log({id: uuid(index + 2000), position: String(1001 - index), day_label: index === 1000 ? '1' : ''}));
  const h = environment({dogs, logs}); await h.start();
  assert.equal(h.app.state.dogs.length, 501); assert.equal(h.app.state.logs.length, 1001);
  assert.equal(h.app.state.logs[0].position, '1'); assert.equal(h.app.state.logs.at(-1).position, '1001');
  for (const [table, expected] of [['hq_training_dogs', [[0, 499], [500, 999]]], ['hq_training_logs', [[0, 499], [500, 999], [1000, 1499]]]]) {
    assert.deepEqual(h.api.calls.filter(call => call.table === table).map(call => call.range), expected);
    assert.ok(h.api.calls.filter(call => call.table === table).every(call => call.orders.some(([key]) => key === 'id')));
  }
});

test('logout invalidates an in-flight load and clears private record state', async () => {
  const request = deferred(); let pending = false;
  const h = environment({intercept: call => {
    if (call.table === 'hq_training_logs') {pending = true; return request.promise;}
  }});
  h.app.init(); await until(() => pending);
  h.signOut(); request.resolve({data: [log({notes: 'Late prior-session fixture'})], error: null});
  await flush();
  assert.equal(h.app.state.logs.length, 0); assert.equal(h.app.state.dogs.length, 0);
  assert.equal(h.app.state.ready, false); assert.equal(h.app.state.loading, false);
  assert.doesNotMatch(h.get('logList').innerHTML, /Late prior-session fixture/);
  assert.match(h.get('pageMessage').textContent, /Sign in/);
});

test('old save completion after logout cannot restore private fields or unlock a newer save', async () => {
  const oldRequest = deferred(), newRequest = deferred(); let inserts = 0;
  const h = environment({intercept: call => {
    if (call.table === 'hq_training_logs' && call.operation === 'insert') return ++inserts === 1 ? oldRequest.promise : newRequest.promise;
  }}); await h.start();
  h.app.openSession(); h.get('workDetail').value = 'Prior session draft';
  const oldSave = h.submitSession(); await until(() => inserts === 1);
  h.signOut(); assert.equal(h.get('sessionDialog').open, false); assert.equal(h.get('workDetail').value, '');
  h.signIn(); h.runTimers(0); await until(() => h.app.state.ready && !h.app.state.loading);
  h.app.openSession(); h.get('workDetail').value = 'New session draft';
  const newSave = h.submitSession(); await until(() => inserts === 2);
  oldRequest.resolve({data: log({work_detail: 'Prior session saved'}), error: null}); await oldSave;
  assert.equal(h.app.state.busy, true); assert.equal(h.app.state.logs.length, 0);
  assert.equal(h.get('workDetail').value, 'New session draft'); assert.equal(h.get('sessionDialog').open, true);
  newRequest.resolve({data: log({id: uuid(99), work_detail: 'New session saved'}), error: null}); await newSave;
  assert.equal(h.app.state.busy, false); assert.equal(h.app.state.logs.length, 1);
  assert.equal(h.app.state.logs[0].work_detail, 'New session saved');
});

test('refresh does not replace records while a form is open or a save is pending', async () => {
  const h = environment({logs: [log()]}); await h.start();
  h.app.openSession(h.app.state.logs[0]); h.get('sessionNotes').value = 'Draft remains';
  const before = h.api.calls.length; await h.app.refresh();
  assert.equal(h.api.calls.length, before); assert.equal(h.get('sessionNotes').value, 'Draft remains');
});
