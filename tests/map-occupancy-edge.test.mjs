import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/hq-map-occupancy/index.ts';

const user = 'a0d61469-96a2-4737-aa63-7ba977f0ec12';
const origin = 'https://hq.pawspet.com';
const time = '1795532400';
const catalog = [
  {id: '7', type: 'Cat Boarding'},
  {id: '20', type: 'Standard Dog Boarding'},
  {id: '22', type: 'Luxury Dog Boarding'},
  {id: '5', type: 'Daycare', capacity_by_lodging: '0'},
  {id: '8', type: 'Training', capacity_by_lodging: '1'}
];
const checkedIn = (id, type = '20', extra = {}) => ({
  reservation_id: id,
  reservation_type: {id: type},
  check_in_date: time,
  check_out_date: null,
  animal: {id, name: `Demo pet ${id}`, breed: 'Mixed'},
  owner: {last_name: 'Sample', address_1: 'Private offset'},
  ...extra
});
const boardRow = (id, run, type = '20', extra = {}) => ({
  id, animal_id: id, type_id: type, run_name: run,
  check_in_stamp: time, check_out_stamp: null, ...extra
});

function fixture({checked = [], rows = [], otherRows = [], providerError = null} = {}) {
  const calls = [];
  const logs = [];
  const state = {approved: true, now: Date.parse('2026-11-24T20:00:00.000Z')};
  const handler = createHandler({
    env: {SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key', GINGR_API_KEY: 'dummy-private-key'},
    now: () => state.now,
    log: entry => logs.push(entry),
    fetch: async (input, init) => {
      const url = new URL(input);
      calls.push(url.pathname);
      if (url.pathname === '/auth/v1/user') {
        return init.headers.Authorization === 'Bearer invalid'
          ? Response.json({}, {status: 401})
          : Response.json({id: user});
      }
      if (url.pathname === '/rest/v1/hq_tour_staff') {
        assert.equal(url.searchParams.get('active'), 'eq.true');
        return Response.json(state.approved ? [{user_id: user}] : []);
      }
      assert.equal(url.origin, 'https://pawspet.gingrapp.com');
      assert.equal(init.redirect, 'error');
      switch (url.pathname) {
        case '/api/v1/reservation_types':
          return Response.json({success: true, data: catalog});
        case '/api/v1/reservations':
          assert.equal(init.method, 'POST');
          assert.equal(url.search, '');
          assert.equal(init.body.get('checked_in'), 'true');
          assert.equal(init.body.get('location_id'), '1');
          return Response.json({data: Object.fromEntries(checked.map((row, i) => [String(i), row]))});
        case '/api/v1/back_of_house':
          assert.equal(init.method, 'GET');
          assert.deepEqual(url.searchParams.getAll('type_ids[]'), catalog.map(row => row.id));
          assert.equal(url.searchParams.get('mins_future'), '20160');
          assert.equal(url.searchParams.has('full_day'), false);
          return providerError || Response.json({success: true, error:false, data: {checking_in: otherRows, checking_out: rows}});
        default: throw new Error('Unexpected endpoint');
      }
    }
  });

  function request({bearer = 'approved', headerOrigin = origin, body = '{}'} = {}) {
    const headers = {Origin: headerOrigin, 'Content-Type': 'application/json'};
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return handler(new Request('https://example.supabase.co/functions/v1/hq-map-occupancy', {method: 'POST', headers, body}));
  }

  return {request, calls, logs, state};
}

test('authorization gates both provider and cached occupancy results', async () => {
  const h = fixture({checked: [checkedIn('101')], rows:[boardRow('101','LQ 2')]});
  assert.equal((await h.request({bearer: null})).status, 401);
  assert.equal((await h.request({bearer: 'invalid'})).status, 401);
  assert.equal((await h.request({headerOrigin: 'https://other.example'})).status, 403);
  assert.equal((await h.request({body:'{"location":"8"}'})).status, 400);
  assert.equal(h.calls.some(path => path.startsWith('/api/v1/')), false);
  const approved = await h.request();
  assert.equal(approved.status,200);
  assert.equal(approved.headers.get('Cache-Control'), 'private, no-store');
  const before = h.calls.filter(path => path.startsWith('/api/v1/')).length;
  h.state.approved = false;
  assert.equal((await h.request()).status,403);
  assert.equal(h.calls.filter(path => path.startsWith('/api/v1/')).length, before);
});

test('joins current pets by verified reservation and animal and preserves shared rooms', async () => {
  const h = fixture({
    checked:[checkedIn('101'),checkedIn('102'),checkedIn('103','5'),checkedIn('104','5'),checkedIn('105','20',{check_out_date:time})],
    rows:[boardRow('101',' LQ   2 '),boardRow('102','LQ2'),boardRow('103','E 5','5'),boardRow('105','W8'),boardRow('900','W1')],
    otherRows:[boardRow('101','lq 2')]
  });
  const response = await h.request();
  assert.equal(response.status,200);
  const data = await response.json();
  assert.deepEqual(data.rooms, [
    {room:'E5',reservationId:'103',pet:'Demo pet 103',breed:'Mixed',owner:'Sample'},
    {room:'LQ2',reservationId:'101',pet:'Demo pet 101',breed:'Mixed',owner:'Sample'},
    {room:'LQ2',reservationId:'102',pet:'Demo pet 102',breed:'Mixed',owner:'Sample'}
  ]);
  assert.equal(data.complete,true);
  assert.equal(data.unmappedCount,0);
  assert.doesNotMatch(JSON.stringify(data),/private|animalId|address/i);
  assert.deepEqual(h.logs, [{code:'OCCUPANCY_COVERAGE',checkedIn:4,mapped:3,unmapped:0}]);
});

test('gaps, mismatches, unknown room codes and conflicts yield incomplete occupancy', async () => {
  const h = fixture({
    checked:['101','102','103','104','105','106'].map(id=>checkedIn(id,id==='106'?'8':'20')),
    rows:[
      boardRow('101','E 1'),boardRow('102','W 1',{toString:()=> '20'},{animal_id:'22'}),
      boardRow('103','LD 2'),boardRow('104','N14'),boardRow('104','N15')
    ]
  });
  const response = await h.request();
  assert.equal(response.status,200);
  const data = await response.json();
  assert.equal(data.rooms.length,1);
  assert.equal(data.rooms[0].room,'E1');
  assert.equal(data.complete,false);
  assert.equal(data.unmappedCount,5);
});

test('coalesces fresh loads and obeys retry-after without leaking provider data', async () => {
  const h = fixture({checked:[checkedIn('101')],rows:[boardRow('101','E1')]});
  const pair = await Promise.all([h.request(),h.request()]);
  assert.deepEqual(await pair[0].json(),await pair[1].json());
  assert.equal(h.calls.filter(path=>path==='/api/v1/back_of_house').length,1);
  h.state.now+=46000;
  assert.equal((await h.request()).status,200);
  assert.equal(h.calls.filter(path=>path==='/api/v1/back_of_house').length,2);

  const limited = fixture({checked:[checkedIn('101')], providerError:Response.json({notes:'Private upstream'}, {status:429,headers:{'Retry-After':'90'}})});
  const error = await limited.request();
  assert.equal(error.status,429);
  assert.equal(error.headers.get('Retry-After'),'90');
  assert.deepEqual(await error.json(),{error:{code:'RATE_LIMITED'}});
  assert.equal((await limited.request()).status,429);
  assert.equal(limited.calls.filter(path=>path==='/api/v1/back_of_house').length,1);
});
