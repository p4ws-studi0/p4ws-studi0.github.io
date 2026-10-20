/* Synthetic identities only. Never invokes Slack or an actual Supabase project. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/hq-slack-access-sync/index.ts'), 'utf8');
const loaded = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const SQL = fs.readFileSync(path.join(__dirname, '../supabase/slack-access-sync-setup.sql'), 'utf8');
const PROJECT = 'https://fixture.supabase.co', TEAM = 'TTEST123', SECRET = 'a'.repeat(64);
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const RUN = '00000000-0000-4000-8000-000000000099';
const candidate = (id, slack, count = 1) => ({user_id: id, slack_user_id: slack, identity_count: count});
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
async function harness(options = {}) {
  const {createHandler} = await loaded;
  const state = {clock: Date.parse('2026-10-20T15:00:00Z'), enabled: true, dry_run: true, max_revocations: 3,
    candidates: [candidate(A, 'UACTIVE'), candidate(B, 'UDEACTIVATED')], users: {UACTIVE: {id: 'UACTIVE', team_id: TEAM, deleted: false, is_bot: false}, UDEACTIVATED: {id: 'UDEACTIVATED', team_id: TEAM, deleted: true, is_bot: false}},
    calls: [], logs: [], results: null, active: new Map([[A, true], [B, true]]), runs: new Set(), busy: false, startedMode: true, intercept: null, ...options};
  const env = {SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-only-key', SLACK_BOT_TOKEN: 'fixture-bot-only-token', SLACK_TEAM_ID: TEAM, ...options.env};
  const handler = createHandler({env, now: () => state.clock, log: value => state.logs.push(value), fetch: async (input, init = {}) => {
    const url = new URL(input), body = url.hostname === 'slack.com' ? Object.fromEntries(init.body) : JSON.parse(init.body);
    const call = {url, init, body}; state.calls.push(call);
    if (state.intercept) { const intercepted = await state.intercept(call); if (intercepted !== undefined) return intercepted; }
    if (url.hostname === 'slack.com') {
      assert.equal(init.headers.Authorization, `Bearer ${env.SLACK_BOT_TOKEN}`); assert.equal(init.headers.apikey, undefined);
      if (url.pathname === '/api/auth.test') return response({ok: true, team_id: TEAM});
      assert.equal(url.pathname, '/api/users.info');
      return response(state.users[body.user] ? {ok: true, user: state.users[body.user]} : {ok: false, error: 'user_not_found'});
    }
    assert.equal(url.origin, PROJECT); assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY); assert.equal(init.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    if (url.pathname.endsWith('/hq_slack_sync_config')) return response({enabled: state.enabled, dry_run: state.dry_run, max_revocations: state.max_revocations, trigger_secret: SECRET});
    if (url.pathname.endsWith('/hq_slack_sync_start')) {
      if (!state.enabled) return response({accepted: false, reason: 'disabled'});
      if (state.runs.has(body.p_run_id)) return response({accepted: false, reason: 'replay'});
      if (state.busy) return response({accepted: false, reason: 'busy'});
      state.runs.add(body.p_run_id); state.startedMode = state.dry_run;
      return response({accepted: true, dry_run: state.startedMode, candidates: state.candidates});
    }
    if (url.pathname.endsWith('/hq_slack_sync_fail')) return response({changed: 0});
    assert.ok(url.pathname.endsWith('/hq_slack_sync_finish'));
    state.results = body.p_results;
    if (!state.enabled) return response({status: 'disabled', changed: 0});
    if (state.startedMode || state.dry_run) return response({status: 'dry_run', changed: 0});
    let changed = 0;
    for (const result of body.p_results) if (result.status === 'deactivated' && state.active.get(result.user_id)) { state.active.set(result.user_id, false); changed++; }
    return response({status: changed ? 'applied' : 'unchanged', changed});
  }});
  return {state, env, handler, calls: name => state.calls.filter(call => call.url.pathname.endsWith(name)), request: (body = {run_id: RUN, requested_at: new Date(state.clock).toISOString()}, init = {}) => {
    const headers = {'x-hq-sync-secret': SECRET, 'Content-Type': 'application/json', ...init.headers};
    for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
    return handler(new Request(`${PROJECT}/functions/v1/hq-slack-access-sync${init.query || ''}`, {method: 'POST', ...init, headers, body: typeof body === 'string' ? body : JSON.stringify(body)}));
  }};
}
async function errorIs(result, status, code) { assert.equal(result.status, status); assert.deepEqual(await result.json(), {error: {code}}); }
const untouched = h => { assert.ok([...h.state.active.values()].every(Boolean)); assert.equal(h.calls('/hq_slack_sync_finish').length, 0); };

test('dedicated constant-time trigger authentication gates candidate and Slack access', async () => {
  const {constantTimeEqual} = await loaded;
  assert.equal(constantTimeEqual(SECRET, SECRET), true); assert.equal(constantTimeEqual(SECRET, 'b'.repeat(64)), false);
  assert.equal(constantTimeEqual(SECRET, SECRET + '0'), false); assert.equal(constantTimeEqual(null, SECRET), false);
  for (const secret of [null, '', 'Bearer public-key', 'a'.repeat(63), 'b'.repeat(64)]) {
    const h = await harness(); await errorIs(await h.request(undefined, {headers: {'x-hq-sync-secret': secret}}), 403, 'ACCESS_DENIED');
    assert.ok(h.state.calls.every(call => call.url.pathname.endsWith('/hq_slack_sync_config'))); untouched(h);
  }
});
test('browser requests, methods, and malformed headers cannot perform privileged reads', async () => {
  for (const init of [{method: 'GET'}, {method: 'OPTIONS'}, {method: 'DELETE'}]) {
    const h = await harness(); await errorIs(await h.handler(new Request(PROJECT, init)), 405, 'METHOD_NOT_ALLOWED'); assert.equal(h.state.calls.length, 0);
  }
  const h = await harness(); const denied = await h.request(undefined, {headers: {Origin: 'https://hq.pawspet.com'}});
  await errorIs(denied, 403, 'ACCESS_DENIED'); assert.equal(denied.headers.has('Access-Control-Allow-Origin'), false); assert.equal(h.state.calls.length, 0);
});
test('disabled is the first-install behavior and never lists accounts or contacts Slack', async () => {
  const h = await harness({enabled: false}); const result = await h.request();
  assert.deepEqual(await result.json(), {status: 'disabled', changed: 0}); assert.equal(h.state.calls.length, 1); untouched(h);
});
test('dry run observes explicit deactivation while preserving all approvals', async () => {
  const h = await harness(); const result = await h.request(), data = await result.json();
  assert.equal(result.status, 200); assert.deepEqual(data, {status: 'dry_run', checked: 2, proposed: 1, unknown: 0, changed: 0});
  assert.deepEqual(h.state.results, [{user_id: A, slack_user_id: 'UACTIVE', status: 'active'}, {user_id: B, slack_user_id: 'UDEACTIVATED', status: 'deactivated'}]);
  assert.ok([...h.state.active.values()].every(Boolean)); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(!JSON.stringify(data).includes(SECRET)); assert.ok(!JSON.stringify(data).includes(A)); assert.deepEqual(h.state.logs, []);
});
test('write mode revokes only the explicit deleted account and leaves active staff unchanged', async () => {
  const h = await harness({dry_run: false}), data = await (await h.request()).json();
  assert.deepEqual(data, {status: 'applied', checked: 2, proposed: 1, unknown: 0, changed: 1}); assert.equal(h.state.active.get(A), true); assert.equal(h.state.active.get(B), false);
  assert.ok(h.state.calls.every(call => !/auth\/v1|\/hq_tour_staff/.test(call.url.pathname)));
});
test('guest and away accounts remain active; missing Slack IDs are unknown', async () => {
  const h = await harness({dry_run: false}); h.state.users.UACTIVE = {...h.state.users.UACTIVE, is_restricted: true, is_ultra_restricted: true, presence: 'away'}; delete h.state.users.UDEACTIVATED;
  assert.deepEqual(await (await h.request()).json(), {status: 'unchanged', checked: 2, proposed: 0, unknown: 1, changed: 0}); assert.ok([...h.state.active.values()].every(Boolean));
});
test('missing, ambiguous, conflicting, or bot profiles never infer deactivation', async () => {
  for (const profile of [null, {}, {id: 'UOTHER', team_id: TEAM, deleted: true, is_bot: false}, {id: 'UDEACTIVATED', team_id: 'TOTHER', deleted: true, is_bot: false},
    {id: 'UDEACTIVATED', team_id: TEAM, deleted: true, is_bot: true}, {id: 'UDEACTIVATED', team_id: TEAM, deleted: 'true', is_bot: false}, {id: 'UDEACTIVATED', team_id: TEAM, deleted: true}, {id: 'UDEACTIVATED', team_id: TEAM, is_bot: false}]) {
    const h = await harness({dry_run: false}); h.state.users.UDEACTIVATED = profile;
    const data = await (await h.request()).json(); assert.equal(data.proposed, 0); assert.equal(data.changed, 0); assert.ok([...h.state.active.values()].every(Boolean));
  }
  for (const row of [candidate(B, null, 0), candidate(B, null, 2), candidate(B, null, 1)]) {
    const h = await harness({candidates: [candidate(A, 'UACTIVE'), row]}); assert.equal((await h.request()).status, 200);
    assert.equal(h.calls('/api/users.info').length, 1); assert.equal(h.state.results[1].status, 'unknown');
  }
});
test('every systemic Slack failure aborts the complete batch before updates', async () => {
  for (const failure of ['missing_scope', 'account_inactive', 'invalid_auth', 'rate_limited', 'internal_error', 'token_revoked']) {
    const h = await harness({dry_run: false, intercept: call => call.url.pathname === '/api/users.info' && call.body.user === 'UDEACTIVATED' ? response({ok: false, error: failure}) : undefined});
    await errorIs(await h.request(), 502, 'SLACK_UNAVAILABLE'); untouched(h); assert.equal(h.calls('/hq_slack_sync_fail').length, 1);
    assert.deepEqual(h.state.logs, [{code: 'SLACK_UNAVAILABLE'}]);
  }
  for (const mode of ['network', '429', 'bad-json', 'oversized']) {
    const h = await harness({dry_run: false, intercept: call => {
      if (call.url.pathname !== '/api/users.info') return;
      if (mode === 'network') throw new Error('private upstream details');
      if (mode === '429') return response({}, 429, {'Retry-After': '100'});
      if (mode === 'bad-json') return new Response('not JSON');
      return response({ok: true, padding: 'x'.repeat(131073)});
    }});
    assert.equal((await h.request()).status, 502); untouched(h);
    assert.ok(!JSON.stringify(h.state.logs).includes('private upstream'));
  }
});
test('a healthy bot must belong to the configured workspace before any member lookup', async () => {
  const h = await harness({intercept: call => call.url.pathname === '/api/auth.test' ? response({ok: true, team_id: 'TOTHER'}) : undefined});
  await errorIs(await h.request(), 503, 'WORKSPACE_MISMATCH'); assert.equal(h.calls('/api/users.info').length, 0); untouched(h);
});
test('mass revocations and absence of positively active staff block every update', async () => {
  const candidates = Array.from({length: 5}, (_, i) => candidate(`00000000-0000-4000-8000-00000000000${i + 1}`, `UMEMBER${i}`));
  const users = Object.fromEntries(candidates.map((row, i) => [row.slack_user_id, {id: row.slack_user_id, team_id: TEAM, is_bot: false, deleted: i !== 0}]));
  const h = await harness({dry_run: false, candidates, users}); assert.equal((await (await h.request()).json()).status, 'blocked'); untouched(h);
  const all = await harness({dry_run: false}); all.state.users.UACTIVE.deleted = true;
  assert.equal((await (await all.request()).json()).status, 'blocked'); untouched(all);
});
test('replays and overlapping runs skip without a second provider pass', async () => {
  const h = await harness(); assert.equal((await h.request()).status, 200); const count = h.calls('/api/users.info').length;
  assert.deepEqual(await (await h.request()).json(), {status: 'replay', changed: 0}); assert.equal(h.calls('/api/users.info').length, count);
  const busy = await harness({busy: true}); assert.deepEqual(await (await busy.request()).json(), {status: 'busy', changed: 0}); assert.equal(busy.calls('/api/auth.test').length, 0);
});
test('stale, future, duplicate-field authority overrides, and excessive bodies cannot start a run', async () => {
  const h = await harness();
  for (const body of [null, [], 'invalid', {run_id: RUN, requested_at: new Date(h.state.clock - 300001).toISOString()}, {run_id: RUN, requested_at: new Date(h.state.clock + 30001).toISOString()},
    {run_id: RUN, requested_at: new Date(h.state.clock).toISOString(), dry_run: false}, {run_id: 'not-a-uuid', requested_at: new Date(h.state.clock).toISOString()}, 'x'.repeat(1025)]) {
    const result = await h.request(body); assert.equal(result.status, 400);
  }
  await errorIs(await h.request(undefined, {query: '?dry_run=false'}), 400, 'INVALID_REQUEST'); assert.equal(h.calls('/hq_slack_sync_start').length, 0); untouched(h);
});
test('disabled or dry-run switches stay safe when changed while a run is in progress', async () => {
  const disabled = await harness({dry_run: false, intercept: call => { if (call.url.pathname === '/api/users.info') disabled.state.enabled = false; }});
  assert.equal((await (await disabled.request()).json()).status, 'disabled'); assert.ok([...disabled.state.active.values()].every(Boolean));
  const dry = await harness({intercept: call => { if (call.url.pathname === '/api/users.info') dry.state.dry_run = false; }});
  assert.equal((await (await dry.request()).json()).status, 'dry_run'); assert.ok([...dry.state.active.values()].every(Boolean));
});
test('misconfiguration and malformed database snapshots fail without contacting Slack or changing approvals', async () => {
  for (const env of [{SUPABASE_URL: 'http://fixture.test'}, {SUPABASE_SERVICE_ROLE_KEY: ''}, {SLACK_BOT_TOKEN: ''}, {SLACK_TEAM_ID: 'wrong'}]) {
    const h = await harness({env}); await errorIs(await h.request(), 503, 'CONFIGURATION_REQUIRED'); assert.equal(h.state.calls.length, 0); untouched(h);
  }
  for (const candidates of [[candidate(A, 'UACTIVE'), candidate(A, 'UDUP')], [candidate('bad', 'UACTIVE')], [candidate(A, 'UACTIVE', 2)], [candidate(A, 'UACTIVE', -1)]]) {
    const h = await harness({candidates}); await errorIs(await h.request(), 502, 'DATABASE_PAYLOAD'); assert.equal(h.calls('/api/auth.test').length, 0); untouched(h);
  }
});
test('SQL preserves sessions and defaults disabled with service-only, transactional, false-only RPCs', () => {
  assert.match(SQL, /enabled boolean not null default false/); assert.match(SQL, /dry_run boolean not null default true/);
  assert.match(SQL, /extensions\.gen_random_bytes\(32\)/); assert.match(SQL, /cron\.schedule\('paws-hq-slack-access-sync','\*\/5 \* \* \* \*'/);
  assert.match(SQL, /where c\.singleton and c\.enabled/); assert.match(SQL, /r\.dry_run or c\.dry_run/);
  assert.match(SQL, /update public\.hq_tour_staff s set active=false where s\.active/);
  assert.doesNotMatch(SQL, /(?:delete\s+from|update)\s+auth\.(?:users|sessions|refresh_tokens)/i);
  assert.doesNotMatch(source, /signOut|ban_duration|\/auth\/v1\/admin|\.auth\.admin/);
  assert.match(SQL, /pg_advisory_xact_lock/); assert.match(SQL, /Results must match the server snapshot/);
  assert.match(SQL, /current_candidates:=public\.hq_slack_sync_candidates\(r\.team_id\)/);
  for (const signature of ['config\\(\\)', 'candidates\\(text\\)', 'start\\(uuid,timestamptz,text\\)', 'fail\\(uuid,text\\)', 'finish\\(uuid,jsonb\\)']) {
    assert.match(SQL, new RegExp(`revoke all on function public.hq_slack_sync_${signature} from public,anon,authenticated`));
    assert.match(SQL, new RegExp(`grant execute on function public.hq_slack_sync_${signature} to service_role`));
  }
});
