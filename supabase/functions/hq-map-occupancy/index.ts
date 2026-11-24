/* Live room assignments for signed-in Paws HQ staff. Provider reads only. */
const BOARDING_TYPES = new Map([
  ['7', 'Cat Boarding'],
  ['20', 'Standard Dog Boarding'],
  ['22', 'Luxury Dog Boarding']
]);
const BOARD_WINDOW_MINUTES = 20160;
const TTL = 45000;

const ROOM_NUMBERS = {
  X: [1, 18], LQ: [1, 20], LK: [1, 4], TD: [12, 26], LD: [1, 11],
  OW: [1, 23], W: [1, 23], OE: [1, 23], E: [1, 23], N: [1, 33],
  MM: [1, 17], CR: [1, 9]
};

function roomCode(value) {
  if (typeof value !== 'string') return null;
  const match = /^([A-Z]+)([1-9]\d?)$/.exec(value.replace(/\s+/g, '').toUpperCase());
  if (!match || !Object.hasOwn(ROOM_NUMBERS, match[1])) return null;
  const [, wing, digits] = match;
  const number = Number(digits);
  const [min, max] = ROOM_NUMBERS[wing];
  return number >= min && number <= max && number !== 13 && !(wing === 'LD' && number === 2)
    ? `${wing}${number}` : null;
}

function identifier(value) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) return null;
  const text = String(value);
  return /^[1-9]\d{0,19}$/.test(text) ? text : null;
}

function text(value, length = 100) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, length) : '';
}

function emptyStamp(value) {
  return value === null || value === undefined || value === '' || value === 0 || value === '0';
}

function checkInStamp(value) {
  const numeric = identifier(value);
  return numeric !== null || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

class Failure extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code) {
  throw new Failure(status, code);
}

async function boundedJson(response, limit, code) {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel().catch(() => {});
    fail(502, code);
  }
  const stream = response.body?.getReader();
  if (!stream) fail(502, code);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await stream.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail(502, code);
      chunks.push(value);
    }
  } catch {
    fail(502, code);
  } finally {
    await stream.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(502, code);
  }
}

function responseRows(data, limit) {
  const rows = Array.isArray(data) ? data
    : data && typeof data === 'object' && Object.keys(data).every(key => /^\d+$/.test(key))
    ? Object.values(data) : null;
  if (!rows || rows.length > limit || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    fail(502, 'GINGR_UNAVAILABLE');
  }
  return rows;
}

function gingrData(payload) {
  if (!payload || typeof payload !== 'object' || payload.success === false || payload.error ||
    (typeof payload.status === 'string' && /error|fail|unauthor/i.test(payload.status))) {
    fail(502, 'GINGR_UNAVAILABLE');
  }
  return payload.data === undefined ? payload : payload.data;
}

function checkedIn(rows, knownTypes) {
  const byId = new Map();
  const ambiguousIds = new Set();
  let malformedCount = 0;
  for (const row of rows) {
    const type = identifier(row.reservation_type?.id);
    if (!type || !knownTypes.has(type)) {
      malformedCount++;
      continue;
    }
    const expectsRoom = knownTypes.get(type).expectsRoom;
    if (row.cancelled === true || row.cancelled === '1' || row.cancelled === 1 ||
        !emptyStamp(row.cancelled_date ?? row.cancelled_at) ||
        !emptyStamp(row.check_out_date ?? row.check_out_stamp)) continue;
    const reservationId = identifier(row.reservation_id);
    const animalId = identifier(row.animal?.id);
    const pet = text(row.animal?.name);
    if (!reservationId || !animalId || !pet || !checkInStamp(row.check_in_date ?? row.check_in_stamp)) {
      if (expectsRoom) {
        if (reservationId) ambiguousIds.add(reservationId);
        else malformedCount++;
      }
      continue;
    }
    const entry = {
      reservationId,
      animalId,
      type,
      expectsRoom,
      pet,
      breed: text(row.animal?.breed),
      owner: text(row.owner?.last_name)
    };
    const prior = byId.get(reservationId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) ambiguousIds.add(reservationId);
    byId.set(reservationId, entry);
  }
  return {byId, ambiguousIds, malformedCount};
}

function mapRooms(active, board) {
  if (!Array.isArray(board?.checking_in) || !Array.isArray(board?.checking_out)) fail(502, 'GINGR_UNAVAILABLE');
  const rows = responseRows([...board.checking_in, ...board.checking_out], 12000);
  const roomsByReservation = new Map();
  const {byId, ambiguousIds, malformedCount} = active;
  for (const row of rows) {
    const reservationId = identifier(row.id);
    const reservation = byId.get(reservationId);
    if (!reservation) continue;
    if (identifier(row.animal_id) !== reservation.animalId || identifier(row.type_id) !== reservation.type) {
      ambiguousIds.add(reservationId);
      continue;
    }
    if (!emptyStamp(row.check_out_stamp)) {
      ambiguousIds.add(reservationId);
      continue;
    }
    if (!checkInStamp(row.check_in_stamp) || !text(row.run_name)) continue;
    const room = roomCode(row.run_name);
    if (!room) {
      ambiguousIds.add(reservationId);
      continue;
    }
    const prior = roomsByReservation.get(reservationId);
    if (prior && prior !== room) ambiguousIds.add(reservationId);
    roomsByReservation.set(reservationId, room);
  }

  const rooms = [];
  for (const {reservationId, pet, breed, owner, expectsRoom} of byId.values()) {
    const room = roomsByReservation.get(reservationId);
    if (!room || ambiguousIds.has(reservationId)) {
      if (expectsRoom) ambiguousIds.add(reservationId);
      continue;
    }
    rooms.push({room, reservationId, pet, breed, owner});
  }
  rooms.sort((a, b) => a.room.localeCompare(b.room, undefined, {numeric: true}) || a.pet.localeCompare(b.pet));
  return {rooms, unmappedCount: ambiguousIds.size + malformedCount};
}

export function createHandler({env, fetch: request = fetch, now = Date.now, log = (_entry) => {}}) {
  const origin = text(env.HQ_ORIGIN) || 'https://hq.pawspet.com';
  const project = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anon = String(env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const key = String(env.GINGR_API_KEY || '').trim();
  const subdomain = String(env.GINGR_SUBDOMAIN || 'pawspet').trim();
  const location = String(env.GINGR_LOCATION_ID || '1').trim();
  const upstream = 'https://pawspet.gingrapp.com/api/v1/';
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  let snapshot = null;
  let pending = null;
  let catalog = null;
  let cooldownUntil = 0;

  function json(payload, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {...headers, 'Content-Type': 'application/json', ...extraHeaders}
    });
  }

  async function authorize(req) {
    const bearer = req.headers.get('Authorization');
    if (!/^Bearer\s+\S+$/i.test(bearer || '')) fail(401, 'AUTH_REQUIRED');
    try {
      const url = new URL(project);
      if (url.protocol !== 'https:' || url.username || url.password || url.search ||
          url.hash || url.pathname !== '/' || !anon || /\s/.test(anon)) throw new Error();
    } catch {
      fail(503, 'CONNECTION_REQUIRED');
    }

    const options = {
      headers: {apikey: anon, Authorization: bearer},
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    };
    let response;
    try {
      response = await request(`${project}/auth/v1/user`, options);
    } catch {
      fail(502, 'AUTH_UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403) fail(401, 'AUTH_REQUIRED');
    if (!response.ok) fail(502, 'AUTH_UNAVAILABLE');
    const user = await boundedJson(response, 256 * 1024, 'AUTH_UNAVAILABLE');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id || '')) {
      fail(401, 'AUTH_REQUIRED');
    }
    const url = `${project}/rest/v1/hq_tour_staff?select=user_id&user_id=eq.${user.id}&active=eq.true&limit=1`;
    let staff;
    try {
      staff = await request(url, options);
    } catch {
      fail(502, 'AUTH_UNAVAILABLE');
    }
    if (staff.status === 401 || staff.status === 403) fail(403, 'ACCESS_DENIED');
    if (!staff.ok) fail(502, 'AUTH_UNAVAILABLE');
    const approvals = await boundedJson(staff, 32 * 1024, 'AUTH_UNAVAILABLE');
    if (!Array.isArray(approvals) || !approvals.some(row => row?.user_id === user.id)) fail(403, 'ACCESS_DENIED');
  }

  async function provider(path, values, signal, method = 'GET') {
    if (cooldownUntil > now()) fail(429, 'RATE_LIMITED');
    const form = new URLSearchParams([['key', key], ...values]);
    const url = new URL(path, upstream);
    if (method === 'GET') url.search = form;
    let response;
    try {
      response = await request(url.href, {
        method,
        body: method === 'POST' ? form : undefined,
        headers: {Accept: 'application/json', ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})},
        redirect: 'error',
        signal
      });
    } catch {
      fail(502, 'GINGR_UNAVAILABLE');
    }
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
        : retry && Number.isFinite(Date.parse(retry)) ? (Date.parse(retry) - now()) / 1000 : 60;
      cooldownUntil = Math.max(cooldownUntil, now() + 1000 * Math.max(1, Math.min(300, Math.ceil(seconds))));
      fail(429, 'RATE_LIMITED');
    }
    if (response.status === 401 || response.status === 403) {
      snapshot = null;
      catalog = null;
      fail(503, 'CONNECTION_REQUIRED');
    }
    if (!response.ok) fail(502, 'GINGR_UNAVAILABLE');
    return gingrData(await boundedJson(response, 8 * 1024 * 1024, 'GINGR_UNAVAILABLE'));
  }

  async function readCatalog(signal) {
    if (catalog && catalog.until > now()) return catalog.types;
    const rows = responseRows(await provider('reservation_types', [], signal), 200);
    const types = new Map();
    for (const row of rows) {
      const typeId = identifier(row.id);
      const label = text(row.type);
      if (!typeId || !label || types.has(typeId)) fail(502, 'GINGR_UNAVAILABLE');
      const capacityByLodging = row.capacity_by_lodging;
      types.set(typeId, {label, expectsRoom: BOARDING_TYPES.has(typeId) ||
        capacityByLodging === true || capacityByLodging === 1 || capacityByLodging === '1'});
    }
    for (const [typeId, label] of BOARDING_TYPES) {
      if (types.get(typeId)?.label !== label) fail(502, 'SOURCE_MAPPING_REQUIRED');
    }
    catalog = {types, until: now() + 300000};
    return types;
  }

  function readSnapshot() {
    if (snapshot && snapshot.until > now()) return Promise.resolve(snapshot.data);
    if (pending) return pending;
    pending = (async () => {
      if (!key || key.length > 4096 || /\s/.test(key) || subdomain !== 'pawspet' || location !== '1') {
        fail(503, 'CONNECTION_REQUIRED');
      }
      const signal = AbortSignal.timeout(12000);
      const [knownTypes, reservations] = await Promise.all([
        readCatalog(signal),
        provider('reservations', [['checked_in', 'true'], ['location_id', location]], signal, 'POST')
      ]);
      const active = checkedIn(responseRows(reservations, 5000), knownTypes);
      let result = {rooms: [], unmappedCount: active.ambiguousIds.size + active.malformedCount};
      if (active.byId.size) {
        const board = await provider('back_of_house', [
          ['location_id', location],
          ['mins_future', String(BOARD_WINDOW_MINUTES)],
          ...[...knownTypes.keys()].map(type => ['type_ids[]', type])
        ], signal);
        result = mapRooms(active, board);
      }
      const data = {
        ...result,
        updatedAt: new Date(now()).toISOString(),
        complete: result.unmappedCount === 0
      };
      try {
        log({
          code: 'OCCUPANCY_COVERAGE',
          checkedIn: active.byId.size,
          mapped: data.rooms.length,
          unmapped: data.unmappedCount
        });
      } catch { /* Logs never affect responses. */ }
      snapshot = {data, until: now() + TTL};
      return data;
    })().finally(() => { pending = null; });
    return pending;
  }

  return async function handler(req) {
    if (req.headers.get('Origin') && req.headers.get('Origin') !== origin) return json({error: {code: 'ACCESS_DENIED'}}, 403);
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (!['GET', 'POST'].includes(req.method)) return json({error: {code: 'METHOD_NOT_ALLOWED'}}, 405);
    try {
      if (new URL(req.url).search) fail(400, 'INVALID_REQUEST');
      await authorize(req);
      if (req.method === 'POST') {
        let body;
        try { body = await boundedJson(req, 1024, 'INVALID_REQUEST'); }
        catch { fail(400, 'INVALID_REQUEST'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) fail(400, 'INVALID_REQUEST');
      }
      return json(await readSnapshot());
    } catch (error) {
      const status = error instanceof Failure ? error.status : 502;
      const code = error instanceof Failure ? error.code : 'GINGR_UNAVAILABLE';
      if (status >= 429) try { log({code}); } catch { /* Logs never affect responses. */ }
      return json({error: {code}}, status, status === 429
        ? {'Retry-After': String(Math.max(1, Math.ceil((cooldownUntil - now()) / 1000)))} : {});
    }
  };
}

if (typeof Deno !== 'undefined') {
  const keys = ['HQ_ORIGIN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
    'GINGR_API_KEY', 'GINGR_SUBDOMAIN', 'GINGR_LOCATION_ID'];
  Deno.serve(createHandler({
    env: Object.fromEntries(keys.map(key => [key, Deno.env.get(key)])),
    log: entry => console.warn('hq-map-occupancy', JSON.stringify(entry))
  }));
}
