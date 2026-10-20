/* One shared HQ membership for every verified active human in the Slack workspace. */
export const WORKSPACE = 'T02QW28SR39';

export function providerIdentity(user, team = WORKSPACE) {
  const identities = (Array.isArray(user?.identities) ? user.identities : []).filter(identity => {
    if (identity?.provider !== 'slack_oidc') return false;
    const data = identity.identity_data || {}, nested = data.custom_claims?.['https://slack.com/team_id'], direct = data['https://slack.com/team_id'];
    return (nested || direct) === team && !(nested && direct && nested !== direct);
  });
  if (identities.length !== 1) return null;
  const data = identities[0].identity_data || {}, subject = data.sub || data.provider_id;
  if (data.sub && data.provider_id && data.sub !== data.provider_id) return null;
  return typeof subject === 'string' && /^[UW][A-Z0-9]+$/.test(subject) ? subject : null;
}

export function createHandler({env, fetch: request = fetch, now = Date.now, log = (_entry) => {}}) {
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const project = clean(env.SUPABASE_URL).replace(/\/$/, ''), service = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  const publicKey = clean(env.SUPABASE_ANON_KEY) || clean(env.SUPABASE_PUBLISHABLE_KEY);
  const token = clean(env.SLACK_BOT_TOKEN), team = clean(env.SLACK_TEAM_ID);
  const hqOrigin = clean(env.HQ_ORIGIN).replace(/\/$/, '') || 'https://hq.pawspet.com';
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  function localOrigin(value) {
    try { const url = new URL(value); return url.origin === value && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
    catch { return false; }
  }
  const allowedOrigin = value => value === hqOrigin || localOrigin(value);
  function json(req, value, status = 200) {
    const supplied = req.headers.get('Origin');
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': supplied && allowedOrigin(supplied) ? supplied : hqOrigin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin'}});
  }
  class Failure extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
  const fail = (status, code) => { throw new Failure(status, code); };
  async function boundedText(response, maximum) {
    if (Number(response.headers.get('Content-Length') || 0) > maximum) fail(502, 'INCOMPLETE_RESPONSE');
    if (!response.body) return '';
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) { const {done, value} = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) fail(502, 'INCOMPLETE_RESPONSE'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  async function readJson(response, maximum = 262144) {
    try { return JSON.parse(await boundedText(response, maximum)); } catch { fail(502, 'INCOMPLETE_RESPONSE'); }
  }
  function configuration() {
    try {
      const url = new URL(project), origin = new URL(hqOrigin);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        origin.origin !== hqOrigin || !(origin.protocol === 'https:' || localOrigin(hqOrigin))) throw new Error();
    } catch { fail(503, 'CONFIGURATION_REQUIRED'); }
    if (!service || /\s/.test(service) || !publicKey || /\s/.test(publicKey) || !token || /\s/.test(token) || team !== WORKSPACE) fail(503, 'CONFIGURATION_REQUIRED');
  }
  async function fetchResponse(url, init, failure) {
    try { return await request(url, {...init, redirect: 'error', signal: AbortSignal.timeout(10000)}); } catch { fail(502, failure); }
  }
  async function slack(method, fields = {}) {
    const response = await fetchResponse(`https://slack.com/api/${method}`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(fields)}, 'SLACK_UNAVAILABLE');
    if (!response.ok) fail(502, 'SLACK_UNAVAILABLE');
    const data = await readJson(response);
    if (data?.ok !== true) fail(502, 'SLACK_UNAVAILABLE');
    return data;
  }
  return async function handler(req) {
    const origin = req.headers.get('Origin');
    if (origin && !allowedOrigin(origin)) return json(req, {error: {code: 'ACCESS_DENIED'}}, 403);
    if (req.method === 'OPTIONS') { const response = json(req, null); return new Response(null, {status: 204, headers: response.headers}); }
    if (req.method !== 'POST') return json(req, {error: {code: 'METHOD_NOT_ALLOWED'}}, 405);
    try {
      const bearer = req.headers.get('Authorization');
      if (!/^Bearer\s+\S+$/i.test(bearer || '')) fail(401, 'AUTH_REQUIRED');
      configuration();
      if (new URL(req.url).search) fail(400, 'INVALID_REQUEST');
      let body;
      try { const text = await boundedText(req, 1024); body = text ? JSON.parse(text) : {}; } catch { fail(400, 'INVALID_REQUEST'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) fail(400, 'INVALID_REQUEST');
      const userResponse = await fetchResponse(`${project}/auth/v1/user`, {headers: {apikey: publicKey, Authorization: bearer}}, 'AUTH_UNAVAILABLE');
      if (userResponse.status === 401 || userResponse.status === 403) fail(401, 'AUTH_REQUIRED');
      if (!userResponse.ok) fail(502, 'AUTH_UNAVAILABLE');
      const user = await readJson(userResponse);
      if (!uuid(user?.id)) fail(401, 'AUTH_REQUIRED');
      const slackUser = providerIdentity(user, team);
      if (!slackUser) fail(403, 'WORKSPACE_ACCESS_DENIED');
      const bot = await slack('auth.test');
      if (bot.team_id !== team) fail(503, 'WORKSPACE_MISMATCH');
      const checkedAt = new Date(now()).toISOString();
      const result = await slack('users.info', {user: slackUser}), member = result.user;
      if (!member || member.id !== slackUser || member.team_id !== team || member.is_bot !== false || typeof member.deleted !== 'boolean') fail(502, 'MEMBERSHIP_UNVERIFIED');
      // Guests and single-channel guests have exactly the same approval as everyone else.
      const applyResponse = await fetchResponse(`${project}/rest/v1/rpc/hq_workspace_access_apply`, {method: 'POST', headers: {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({p_user_id: user.id, p_slack_user_id: slackUser, p_team_id: team, p_deleted: member.deleted, p_checked_at: checkedAt})}, 'DATABASE_UNAVAILABLE');
      if (!applyResponse.ok) fail(502, 'MEMBERSHIP_UNVERIFIED');
      const applied = await readJson(applyResponse);
      const statuses = member.deleted ? ['revoked'] : ['active', 'enrolled', 'reactivated'];
      if (!applied || !statuses.includes(applied.status) || applied.allowed !== !member.deleted || typeof applied.changed !== 'boolean') fail(502, 'INCOMPLETE_RESPONSE');
      if (member.deleted) return json(req, {success:false,user_id:user.id,active:false,error:{code:'SLACK_DEACTIVATED'}},403);
      return json(req, {success:true,user_id:user.id,active:true,changed:applied.changed});
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'ACCESS_UNAVAILABLE';
      try { log({code}); } catch { /* Never log identities, tokens, or upstream responses. */ }
      return json(req, {success:false,error: {code}}, error instanceof Failure ? error.status : 502);
    }
  };
}

if (typeof Deno !== 'undefined') {
  const names = ['HQ_ORIGIN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'];
  Deno.serve(createHandler({env: Object.fromEntries(names.map(name => [name, Deno.env.get(name)])), log: entry => console.warn('hq-workspace-access', JSON.stringify(entry))}));
}
