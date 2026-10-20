/* Server-only Slack offboarding. It changes HQ approval, never Auth sessions. */
export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < 128; index++) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0 && a.length <= 128 && b.length <= 128;
}

export function createHandler({env, fetch: request = fetch, now = Date.now, log = (_entry) => {}}) {
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const project = clean(env.SUPABASE_URL).replace(/\/$/, '');
  const service = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  const token = clean(env.SLACK_BOT_TOKEN), team = clean(env.SLACK_TEAM_ID);
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const slackId = value => typeof value === 'string' && /^[UW][A-Z0-9]+$/.test(value);
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'};
  const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers});
  class Failure extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
  const fail = (status, code) => { throw new Failure(status, code); };
  async function boundedJson(response, maximum = 131072) {
    if (Number(response.headers.get('Content-Length') || 0) > maximum) fail(502, 'UPSTREAM_PAYLOAD');
    if (!response.body) fail(502, 'UPSTREAM_PAYLOAD');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        length += value.byteLength; if (length > maximum) fail(502, 'UPSTREAM_PAYLOAD'); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(502, 'UPSTREAM_PAYLOAD'); }
  }
  async function rpc(name, body = {}) {
    let response;
    try {
      response = await request(`${project}/rest/v1/rpc/${name}`, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    } catch { fail(502, 'DATABASE_UNAVAILABLE'); }
    if (!response.ok) fail(502, 'DATABASE_UNAVAILABLE');
    return boundedJson(response);
  }
  async function slack(method, parameters = {}) {
    let response;
    try {
      response = await request(`https://slack.com/api/${method}`, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(parameters)});
    } catch { fail(502, 'SLACK_UNAVAILABLE'); }
    if (!response.ok) fail(502, 'SLACK_UNAVAILABLE');
    const data = await boundedJson(response);
    if (data?.ok !== true) {
      if (method === 'users.info' && ['user_not_found', 'user_not_visible'].includes(data?.error)) return {missing: true};
      fail(502, 'SLACK_UNAVAILABLE');
    }
    return data;
  }
  function configuration() {
    try {
      const parsed = new URL(project);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    } catch { fail(503, 'CONFIGURATION_REQUIRED'); }
    if (!service || /\s/.test(service) || !token || /\s/.test(token) || !/^T[A-Z0-9]+$/.test(team)) fail(503, 'CONFIGURATION_REQUIRED');
  }
  return async function handler(req) {
    // This endpoint has no browser use, CORS response, or user-JWT mode.
    if (req.headers.has('Origin')) return json({error: {code: 'ACCESS_DENIED'}}, 403);
    if (req.method !== 'POST') return json({error: {code: 'METHOD_NOT_ALLOWED'}}, 405);
    const supplied = req.headers.get('x-hq-sync-secret');
    if (!/^[0-9a-f]{64}$/.test(supplied || '')) return json({error: {code: 'ACCESS_DENIED'}}, 403);
    let runId = null, started = false;
    try {
      configuration();
      // This is the only privileged read permitted before trigger authentication.
      const config = await rpc('hq_slack_sync_config');
      if (!/^[0-9a-f]{64}$/.test(config?.trigger_secret || '') || !constantTimeEqual(supplied, config.trigger_secret)) fail(403, 'ACCESS_DENIED');
      if (config.enabled !== true) return json({status: 'disabled', changed: 0});
      if (typeof config.dry_run !== 'boolean' || !Number.isInteger(config.max_revocations) || config.max_revocations < 1 || config.max_revocations > 3) fail(503, 'CONFIGURATION_REQUIRED');
      if (new URL(req.url).search) fail(400, 'INVALID_REQUEST');
      let body;
      try { body = await boundedJson(req, 1024); } catch { fail(400, 'INVALID_REQUEST'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['run_id', 'requested_at'].includes(key)) || !uuid(body.run_id)) fail(400, 'INVALID_REQUEST');
      const requestedAt = typeof body.requested_at === 'string' ? Date.parse(body.requested_at) : NaN;
      if (!Number.isFinite(requestedAt) || now() - requestedAt > 300000 || requestedAt - now() > 30000) fail(400, 'STALE_REQUEST');
      runId = body.run_id;
      const run = await rpc('hq_slack_sync_start', {p_run_id: runId, p_requested_at: body.requested_at, p_team_id: team});
      if (run?.accepted === false && ['disabled', 'replay', 'busy'].includes(run.reason)) return json({status: run.reason, changed: 0});
      if (run?.accepted !== true || !Array.isArray(run.candidates) || run.candidates.length > 100 || typeof run.dry_run !== 'boolean') fail(502, 'DATABASE_PAYLOAD');
      started = true;
      const seen = new Set();
      for (const candidate of run.candidates) {
        if (!uuid(candidate?.user_id) || seen.has(candidate.user_id) || !Number.isInteger(candidate.identity_count) || candidate.identity_count < 0 ||
          !(candidate.slack_user_id === null || slackId(candidate.slack_user_id)) || candidate.identity_count !== 1 && candidate.slack_user_id !== null) fail(502, 'DATABASE_PAYLOAD');
        seen.add(candidate.user_id);
      }
      const bot = await slack('auth.test');
      if (bot.team_id !== team) fail(503, 'WORKSPACE_MISMATCH');
      const results = [], runTime = now();
      for (const candidate of run.candidates) {
        if (now() - runTime > 90000) fail(502, 'SLACK_UNAVAILABLE');
        const result = {user_id: candidate.user_id, slack_user_id: candidate.slack_user_id, status: 'unknown'};
        if (candidate.identity_count !== 1 || !slackId(candidate.slack_user_id)) { results.push(result); continue; }
        const response = await slack('users.info', {user: candidate.slack_user_id});
        if (response.missing) { results.push(result); continue; }
        const user = response.user;
        if (!user || user.id !== candidate.slack_user_id || user.team_id !== team || user.is_bot !== false || typeof user.deleted !== 'boolean') {
          results.push(result); continue;
        }
        result.status = user.deleted === true ? 'deactivated' : 'active';
        results.push(result);
      }
      const proposed = results.filter(result => result.status === 'deactivated').length;
      const active = results.filter(result => result.status === 'active').length;
      // The database repeats these safeguards; keeping them here prevents unsafe apply calls.
      if (proposed > config.max_revocations || proposed > 0 && active === 0) {
        await rpc('hq_slack_sync_fail', {p_run_id: runId, p_code: 'SAFETY_LIMIT'});
        return json({status: 'blocked', checked: results.length, proposed, changed: 0});
      }
      const finished = await rpc('hq_slack_sync_finish', {p_run_id: runId, p_results: results});
      if (!finished || !['applied', 'dry_run', 'unchanged', 'blocked', 'disabled'].includes(finished.status) || !Number.isInteger(finished.changed) || finished.changed < 0 || finished.changed > proposed) fail(502, 'DATABASE_PAYLOAD');
      return json({status: finished.status, checked: results.length, proposed, unknown: results.filter(result => result.status === 'unknown').length, changed: finished.changed});
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'SYNC_UNAVAILABLE';
      if (started) try { await rpc('hq_slack_sync_fail', {p_run_id: runId, p_code: code}); } catch { /* Failures never grant or revoke access. */ }
      try { log({code}); } catch { /* No identities, tokens, or upstream bodies are logged. */ }
      return json({error: {code}}, error instanceof Failure ? error.status : 502);
    }
  };
}

if (typeof Deno !== 'undefined') {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'];
  Deno.serve(createHandler({env: Object.fromEntries(keys.map(key => [key, Deno.env.get(key)])), log: entry => console.warn('hq-slack-access-sync', JSON.stringify(entry))}));
}
