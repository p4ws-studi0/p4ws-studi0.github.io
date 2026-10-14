/* Synthetic records only: exercise the trust boundary between HQ and Gingr. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/hq-gingr-whiteboard/index.ts'),'utf8');
const loaded=import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const USER='00000000-0000-4000-8000-000000000001',PROJECT='https://fixture.supabase.co',ORIGIN='https://hq.pawspet.com';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const row=(extra={})=>({id:'11',owner_id:'22',animal_id:'33',o_last:'Example',a_first:'Pet',type_id:'1',type:'Daycare',check_in_stamp:null,check_out_stamp:null,start_date:'1791903600',end_date:'1791943200',run_name:null,area_name:null,belonging_count:'0',belonging_area:null,status_id:2,status_string:'Checking In Soon',event_time:1791903600,...extra});
async function harness(options={}) {
  const {createHandler}=await loaded;
  const state={clock:Date.parse('2026-10-13T13:00:00Z'),approved:true,user:{id:USER},checking_in:[row()],checking_out:[],types:[{id:'1'},{id:'2'}],calls:[],logs:[],intercept:null,...options};
  const env={SUPABASE_URL:PROJECT,SUPABASE_ANON_KEY:'fixture-public-key',GINGR_API_KEY:'fixture-private-key',GINGR_SUBDOMAIN:'fixture',GINGR_LOCATION_ID:'1',GINGR_TYPE_IDS:'1,2',...options.env};
  const handler=createHandler({env,now:()=>state.clock,log:entry=>state.logs.push(entry),fetch:async(input,init={})=>{
    const url=new URL(input),call={url,init};state.calls.push(call);
    if(state.intercept){const value=await state.intercept(call);if(value!==undefined)return value;}
    if(url.pathname==='/auth/v1/user')return json(state.user);
    if(url.pathname==='/rest/v1/hq_tour_staff')return json(state.approved?[{user_id:USER}]:[]);
    assert.equal(url.hostname,'fixture.gingrapp.com');
    if(url.pathname==='/api/v1/reservation_types')return json(state.types);
    assert.equal(url.pathname,'/api/v1/back_of_house');
    return json({success:true,error:false,data:{checking_in:state.checking_in,checking_out:state.checking_out}});
  }});
  return {state,env,handler,advance:ms=>{state.clock+=ms;},calls:pathname=>state.calls.filter(call=>call.url.pathname===pathname),request:async(body={},init={})=>{
    const headers={Origin:ORIGIN,Authorization:'Bearer fixture-user-jwt','Content-Type':'application/json',...init.headers};
    for(const name of Object.keys(headers))if(headers[name]===null)delete headers[name];
    return handler(new Request('https://fixture.supabase.co/functions/v1/hq-gingr-whiteboard',{method:'POST',...init,headers,body:typeof body==='string'?body:JSON.stringify(body)}));
  }};
}
async function errorIs(response,status,code){assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});}
const upstream=h=>h.calls('/api/v1/back_of_house');

test('whiteboard authorizes the caller and uses fixed configured scope and no browser cache',async()=>{
  const h=await harness(),response=await h.request(),data=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),ORIGIN);
  assert.equal(data.full_day,true);assert.equal(data.mins_future,null);assert.equal(data.timezone,'America/New_York');
  assert.equal(data.gingr_url,'https://fixture.gingrapp.com');assert.equal(data.checking_in[0].start_date,1791903600);assert.equal(data.checking_in[0].belonging_count,0);
  assert.equal(data.checking_in[0].check_in_stamp,null);
  const call=upstream(h)[0];assert.equal(call.url.searchParams.get('key'),h.env.GINGR_API_KEY);
  assert.deepEqual(call.url.searchParams.getAll('type_ids[]'),['1','2']);assert.equal(call.url.searchParams.get('location_id'),'1');
  assert.equal(call.url.searchParams.get('full_day'),'true');assert.equal(call.init.redirect,'error');assert.ok(call.init.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(data).includes(h.env.GINGR_API_KEY));
  const staff=h.calls('/rest/v1/hq_tour_staff')[0];assert.equal(staff.url.searchParams.get('user_id'),`eq.${USER}`);assert.equal(staff.url.searchParams.get('active'),'eq.true');
  assert.equal(staff.init.headers.Authorization,'Bearer fixture-user-jwt');assert.equal(call.init.headers.Authorization,undefined);
});
test('time windows stay distinct and full day takes precedence',async()=>{
  const h=await harness();
  for(const body of [{mins_future:60},{full_day:false,mins_future:120},{full_day:true,mins_future:240}]) {
    const response=await h.request(body);assert.equal(response.status,200);
  }
  const calls=upstream(h);assert.equal(calls.length,3);
  assert.equal(calls[0].url.searchParams.get('mins_future'),'60');assert.equal(calls[0].url.searchParams.has('full_day'),false);
  assert.equal(calls[1].url.searchParams.get('mins_future'),'120');assert.equal(calls[2].url.searchParams.get('full_day'),'true');assert.equal(calls[2].url.searchParams.has('mins_future'),false);
});
test('GET supports the same safe scope and rejects duplicate or unrecognized parameters',async()=>{
  const h=await harness();
  const get=query=>h.handler(new Request(`https://fixture.test/?${query}`,{headers:{Authorization:'Bearer fixture-user-jwt'}}));
  const valid=await get('mins_future=60');assert.equal(valid.status,200);assert.equal((await valid.json()).mins_future,60);
  for(const query of ['key=evil','location_id=2','type_ids[]=5','url=https://evil.example','mins_future=60&mins_future=120','full_day=1','mins_future=NaN','mins_future=-5','full_day=false'])await errorIs(await get(query),400,'INVALID_REQUEST');
});
test('CORS, methods and preflight never reach a provider',async()=>{
  const h=await harness();
  const preflight=await h.handler(new Request('https://fixture.test',{method:'OPTIONS',headers:{Origin:ORIGIN}}));assert.equal(preflight.status,204);
  await errorIs(await h.request({}, {headers:{Origin:'https://evil.example'}}),403,'ACCESS_DENIED');
  await errorIs(await h.handler(new Request('https://fixture.test',{method:'DELETE'})),405,'METHOD_NOT_ALLOWED');assert.equal(h.state.calls.length,0);
});
test('untrusted request input cannot supply secret, URL, location, reservation type or arbitrary time range',async()=>{
  const h=await harness();
  for(const body of ['null','[]','not JSON',JSON.stringify({x:'a'.repeat(4096)}),{key:'override'},{location_id:2},{type_ids:[2]},{url:'https://evil.example'},{full_day:'true'},{full_day:false},{mins_future:'60'},{mins_future:0},{mins_future:1441},{mins_future:1.5}])await errorIs(await h.request(body),400,'INVALID_REQUEST');
  assert.equal(h.state.calls.length,0);
});
test('request streaming bounds are enforced without Content-Length',async()=>{
  const h=await harness();await errorIs(await h.request(' '.repeat(4097)),400,'INVALID_REQUEST');assert.equal(h.state.calls.length,0);
});
test('missing authorization, expired sessions and invalid identities cannot reach Gingr',async()=>{
  for(const bearer of [null,'','fixture-user-jwt','Bearer a b']){const h=await harness();await errorIs(await h.request({}, {headers:{Authorization:bearer}}),401,'AUTH_REQUIRED');assert.equal(h.state.calls.length,0);}
  for(const user of [null,{}, {id:'not-a-uuid'},{id:'1'.repeat(36)}]){const h=await harness({user});await errorIs(await h.request(),401,'AUTH_REQUIRED');assert.equal(upstream(h).length,0);}
  const h=await harness({intercept:call=>call.url.pathname==='/auth/v1/user'?json({},401):undefined});await errorIs(await h.request(),401,'AUTH_REQUIRED');
});
test('inactive and unapproved staff are denied even when another user populated a cache',async()=>{
  const h=await harness();assert.equal((await h.request()).status,200);h.state.approved=false;
  await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(upstream(h).length,1);assert.equal(h.calls('/rest/v1/hq_tour_staff').length,2);
});
test('auth provider failures are distinct from empty data and never reach Gingr',async()=>{
  for(const suffix of ['/auth/v1/user','/rest/v1/hq_tour_staff']) {
    const h=await harness({intercept:call=>call.url.pathname===suffix?json({},500):undefined});await errorIs(await h.request(),502,'AUTH_UNAVAILABLE');assert.equal(upstream(h).length,0);
  }
});
test('misconfigured secrets fail without leaking their contents',async()=>{
  for(const [name,value] of [['SUPABASE_URL','https://evil.example/path'],['SUPABASE_ANON_KEY','bad key'],['GINGR_API_KEY',''],['GINGR_SUBDOMAIN','evil.example/path'],['GINGR_SUBDOMAIN','name@evil'],['GINGR_LOCATION_ID','-1'],['GINGR_TYPE_IDS','1,not-an-id'],['GINGR_TYPE_IDS','[]'],['GINGR_TYPE_IDS','[null]']]) {
    const h=await harness({env:{[name]:value}});await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.equal(upstream(h).length,0);
    assert.ok(h.state.logs.every(entry=>Object.keys(entry).length===1&&typeof entry.reason==='string'));
  }
});
test('configuration whitespace is trimmed and duplicate configured type IDs collapse',async()=>{
  const h=await harness({env:{GINGR_API_KEY:' fixture-private-key\n',GINGR_SUBDOMAIN:' fixture ',GINGR_LOCATION_ID:' 1 ',GINGR_TYPE_IDS:' ["1",2,"1"] '}});
  assert.equal((await h.request()).status,200);assert.deepEqual(upstream(h)[0].url.searchParams.getAll('type_ids[]'),['1','2']);
});
test('automatic reservation type discovery supports documented endpoint collection shapes',async()=>{
  for(const types of [[{id:'1'},{id:'2'}],{data:[{id:1},{id:2}],success:true,error:false},{'1':{id:'1'},'2':{id:'2'}}]) {
    const h=await harness({types,env:{GINGR_TYPE_IDS:''}});assert.equal((await h.request()).status,200);
    assert.equal(h.calls('/api/v1/reservation_types').length,1);assert.deepEqual(upstream(h)[0].url.searchParams.getAll('type_ids[]'),['1','2']);
  }
});
test('automatic discovery caches only numeric type IDs, refreshes after five minutes and checks staff each time',async()=>{
  const h=await harness({env:{GINGR_TYPE_IDS:''}});assert.equal((await h.request()).status,200);
  h.advance(16000);assert.equal((await h.request()).status,200);assert.equal(h.calls('/api/v1/reservation_types').length,1);assert.equal(upstream(h).length,2);
  h.advance(300000);assert.equal((await h.request()).status,200);assert.equal(h.calls('/api/v1/reservation_types').length,2);assert.equal(h.calls('/rest/v1/hq_tour_staff').length,3);
});
test('unknown, empty, oversized and unsuccessful type collections fail closed instead of querying all reservations',async()=>{
  for(const types of [[],{},[{name:'Unknown'}],{success:false,error:'private detail'},Array.from({length:201},(_,i)=>({id:String(i+1)}))]) {
    const h=await harness({types,env:{GINGR_TYPE_IDS:''}});await errorIs(await h.request(),502,'GINGR_UNAVAILABLE');assert.equal(upstream(h).length,0);
  }
});
test('both Gingr endpoints map expired credentials to connection required with safe diagnostics',async()=>{
  for(const endpoint of ['/api/v1/reservation_types','/api/v1/back_of_house']){
    const h=await harness({env:{GINGR_TYPE_IDS:endpoint.endsWith('reservation_types')?'':'1,2'},intercept:call=>call.url.pathname===endpoint?json({message:'secret provider response'},403):undefined});
    await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.deepEqual(h.state.logs,[{reason:'GINGR_CREDENTIALS'}]);
  }
});
test('successful empty arrays are an empty day but missing, malformed and duplicate entries are failures',async()=>{
  const h=await harness({checking_in:[],checking_out:[]});const res=await h.request();assert.equal(res.status,200);assert.deepEqual((await res.json()).checking_in,[]);
  for(const data of [{checking_in:[],checking_out:null},{checking_in:[]},{checking_in:{},checking_out:[]},{checking_in:[row(),row()],checking_out:[]},{checking_in:[row({id:null})],checking_out:[]},{checking_in:[row({type_id:'999'})],checking_out:[]}]) {
    const broken=await harness({intercept:call=>call.url.pathname==='/api/v1/back_of_house'?json({success:true,error:false,data}):undefined});await errorIs(await broken.request(),502,'GINGR_UNAVAILABLE');
  }
});
test('normalization strips unknown fields, bounds text and does not invent timestamps or belongings',async()=>{
  const h=await harness({checking_in:[row({a_first:'Name\n'+'x'.repeat(300),notes:'private omitted',api_key:'secret omitted',check_in_stamp:'bad',check_out_stamp:0,end_date:'',belonging_count:-1,status_id:'2',run_name:'  Room A  '})]});
  const body=await (await h.request()).json(),item=body.checking_in[0];assert.equal(item.a_first.length,200);assert.equal(item.a_first.includes('\n'),false);
  assert.equal(item.check_in_stamp,null);assert.equal(item.check_out_stamp,null);assert.equal(item.end_date,null);assert.equal(item.belonging_count,null);assert.equal(item.status_id,2);assert.equal(item.run_name,'Room A');
  assert.equal(item.notes,undefined);assert.equal(item.api_key,undefined);
});
test('upstream body limits work with declared and streamed lengths and row count bounds',async()=>{
  for(const makeResponse of [()=>json({},200,{'Content-Length':String(4*1024*1024+1)}),()=>new Response(' '.repeat(4*1024*1024+1)),()=>json({success:true,error:false,data:{checking_in:Array.from({length:5001},(_,i)=>row({id:String(i+1)})),checking_out:[]}})]) {
    const h=await harness({intercept:call=>call.url.pathname==='/api/v1/back_of_house'?makeResponse():undefined});await errorIs(await h.request(),502,'GINGR_UNAVAILABLE');
  }
});
test('malformed JSON, unsuccessful responses and provider transport errors expose no raw details',async()=>{
  for(const response of [()=>new Response('secret invalid JSON'),()=>json({success:false,error:'secret details'}),()=>json({},500),()=>{throw new Error('secret request URL');}]) {
    const h=await harness({intercept:call=>call.url.pathname==='/api/v1/back_of_house'?response():undefined});await errorIs(await h.request(),502,'GINGR_UNAVAILABLE');assert.ok(!JSON.stringify(h.state.logs).includes('secret'));
  }
});
test('server snapshots have a short TTL and retain the real fetch timestamp',async()=>{
  const h=await harness(),first=await (await h.request()).json();h.advance(10000);const second=await (await h.request()).json();assert.equal(second.updated_at,first.updated_at);assert.equal(upstream(h).length,1);
  h.advance(6000);const third=await (await h.request()).json();assert.notEqual(third.updated_at,first.updated_at);assert.equal(upstream(h).length,2);
});
test('concurrent viewers share the same upstream request after separate authorization checks',async()=>{
  let unblock;const hold=new Promise(resolve=>unblock=resolve);
  const h=await harness({intercept:async call=>{if(call.url.pathname==='/api/v1/back_of_house')await hold;}});
  const a=h.request(),b=h.request();await new Promise(resolve=>setTimeout(resolve,10));unblock();
  assert.deepEqual((await Promise.all([a,b])).map(res=>res.status),[200,200]);assert.equal(upstream(h).length,1);assert.equal(h.calls('/rest/v1/hq_tour_staff').length,2);
});
test('rate limits honor a bounded retry interval and suppress repeated provider calls',async()=>{
  const h=await harness({intercept:call=>call.url.pathname==='/api/v1/back_of_house'?json({private:'omitted'},429,{'Retry-After':'3600'}):undefined});
  const first=await h.request();await errorIs(first,429,'RATE_LIMITED');assert.equal(first.headers.get('Retry-After'),'300');
  h.advance(10000);const retry=await h.request();await errorIs(retry,429,'RATE_LIMITED');assert.equal(retry.headers.get('Retry-After'),'290');assert.equal(upstream(h).length,1);
  h.advance(300000);h.state.intercept=null;assert.equal((await h.request()).status,200);assert.equal(upstream(h).length,2);
});
