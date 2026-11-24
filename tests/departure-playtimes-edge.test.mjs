import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHandler,cleanView} from '../supabase/functions/hq-departure-playtimes/handler.mjs';

const DAY='2026-11-24',NOW=Date.parse(`${DAY}T16:00:00Z`),USER='00000000-0000-4000-8000-000000000001';
const LEASE='00000000-0000-4000-8000-000000000002',ORIGIN='https://hq.pawspet.com',KEY='fixture-private-gingr-key',SERVICE='fixture-private-service-key';
const PROJECT='https://fixture.supabase.co',RPC='/rest/v1/rpc/';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
function harness({factory=createHandler,...options}={}) {
  const state={clock:NOW,approved:true,user:{id:USER},calls:[],logs:[],published:[],failed:[],claim:{claimed:true,leaseToken:LEASE,businessDate:DAY},intercept:null,...options};
  const detail={reservation_id:'6001',end_date:`${DAY}T17:00:00-05:00`,cancelled_date:null,wait_list_date:null,check_in_date:`${DAY}T08:00:00-05:00`,check_out_date:null,
    reservation_type:{id:'20',type:'Standard Dog Boarding'},animal:{id:'7001',name:'Synthetic pet'},owner:{last_name:'Fixture',email:'private@example.test'},
    services:[{id:'990001',name:'Gold Activity Package | Group',scheduled_at:`${DAY}T09:00:00-05:00`,scheduled_until:`${DAY}T09:30:00-05:00`,cost:'51.23'}]};
  state.detail=detail;
  const env={SUPABASE_URL:PROJECT,SUPABASE_ANON_KEY:'fixture-public-key',SUPABASE_SERVICE_ROLE_KEY:SERVICE,GINGR_API_KEY:KEY,...options.env};
  const handler=factory({env,now:()=>state.clock,log:entry=>state.logs.push(entry),fetch:async(input,init={})=>{
    const url=new URL(input),body=typeof init.body==='string'&&init.headers?.['Content-Type']==='application/json'?JSON.parse(init.body):null,call={url,init,body};state.calls.push(call);
    const intercepted=await state.intercept?.(call);if(intercepted!==undefined)return intercepted;
    if(url.pathname==='/auth/v1/user')return json(state.user);
    if(url.pathname==='/rest/v1/hq_tour_staff')return json(state.approved?[{user_id:USER}]:[]);
    if(url.pathname===RPC+'hq_departure_playtimes_claim_refresh')return json(state.claim);
    if(url.pathname===RPC+'hq_departure_playtimes_publish'){state.published.push(body);return json({published:true});}
    if(url.pathname===RPC+'hq_departure_playtimes_fail_refresh'){state.failed.push(body);return json({recorded:true});}
    assert.equal(url.origin,'https://pawspet.gingrapp.com');
    if(url.pathname==='/api/v1/reservation_types')return json([{id:'20',type:'Standard Dog Boarding'},{id:'22',type:'Luxury Dog Boarding'},{id:'7',type:'Cat Boarding'}]);
    if(url.pathname==='/api/v1/get_species')return json([{value:'1',label:'Dog'},{value:'2',label:'Cat'}]);
    if(url.pathname==='/api/v1/back_of_house')return json({success:true,error:false,data:{checking_out:[{id:'6001',animal_id:'7001',type_id:'20',end_date:String(Date.parse(detail.end_date)/1000)}],checking_in:[]}});
    if(url.pathname==='/api/v1/reservations')return json({6001:structuredClone(detail)});
    if(url.pathname==='/api/v1/get_services_by_type')return json({type_id:url.searchParams.get('type_id'),allowable_services:[{id:'85',name:'Gold Activity Package | Group',cost:'999.99'}]});
    throw new Error('Unexpected fixed endpoint');
  }});
  return {state,env,handler,request(body={action:'refresh'},headers={},query=''){
    const supplied={Origin:ORIGIN,Authorization:'Bearer fixture-user-token','Content-Type':'application/json',...headers};for(const key of Object.keys(supplied))if(supplied[key]===null)delete supplied[key];
    return handler(new Request(`${PROJECT}/functions/v1/hq-departure-playtimes${query}`,{method:'POST',headers:supplied,body:typeof body==='string'?body:JSON.stringify(body)}));
  }};
}
const providerCalls=h=>h.state.calls.filter(call=>call.url.hostname==='pawspet.gingrapp.com');
async function errorIs(response,status,code){assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});}

test('refresh verifies active HQ membership before acquiring the shared lease or reading Gingr',async()=>{
  const h=harness(),response=await h.request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,refreshed:true,refreshing:false,businessDate:DAY});
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),ORIGIN);
  assert.equal(h.state.calls[0].url.pathname,'/auth/v1/user');assert.equal(h.state.calls[1].url.pathname,'/rest/v1/hq_tour_staff');assert.equal(h.state.calls[2].url.pathname,RPC+'hq_departure_playtimes_claim_refresh');
  for(const call of h.state.calls.filter(call=>call.url.pathname.startsWith(RPC))){assert.equal(call.init.headers.apikey,SERVICE);assert.equal(call.init.headers.Authorization,`Bearer ${SERVICE}`);assert.equal(call.body.p_location_id,'1');}
  const membership=h.state.calls[1];assert.equal(membership.init.headers.Authorization,'Bearer fixture-user-token');assert.equal(membership.url.searchParams.get('active'),'eq.true');
  for(const call of providerCalls(h)){assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.init.redirect,'error');assert.ok(call.init.signal);assert.ok(!/invoice|charge|payment|delete|create|complete/.test(call.url.pathname));}
  const published=h.state.published[0];assert.equal(published.p_lease_token,LEASE);assert.equal(published.p_view.summary.playtimes,1);assert.equal(published.p_view.summary.pets,1);
  assert.equal(published.p_view.departures[0].services[0].key,`1:6001:7001:990001.${DAY}`);assert.equal(published.p_view.departures[0].noteKey,`departure:1:6001:7001:${DAY}`);
  const stored=JSON.stringify(published);for(const privateValue of [KEY,SERVICE,'private@example.test','51.23','999.99','priceCents','expectedCharges','billingEligible','scheduledAt'])assert.ok(!stored.includes(privateValue),privateValue);
  assert.equal(published.p_view.departures[0].services[0].verified,false);assert.equal(published.p_view.departures[0].services[0].status,'On today’s plan');
});

test('missing, invalid and unapproved callers cannot trigger cache or provider work',async()=>{
  for(const options of [{approved:false},{user:{id:'not-a-user'}},{intercept:call=>call.url.pathname==='/auth/v1/user'?json({},401):undefined}]){
    const h=harness(options),response=await h.request();assert.ok([401,403].includes(response.status));assert.equal(providerCalls(h).length,0);assert.equal(h.state.calls.filter(call=>call.url.pathname.startsWith(RPC)).length,0);
  }
  const missing=harness();await errorIs(await missing.request({action:'refresh'},{Authorization:null}),401,'AUTH_REQUIRED');assert.equal(missing.state.calls.length,0);
});

test('busy and fresh shared cache claims never duplicate the provider read or expose cached data',async()=>{
  for(const refreshing of [true,false]){
    const h=harness({claim:{claimed:false,businessDate:DAY,refreshing,source:{private:KEY}}}),response=await h.request();
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,refreshed:false,refreshing,businessDate:DAY});assert.equal(providerCalls(h).length,0);assert.equal(h.state.published.length,0);
  }
});

test('CORS, body and method boundaries cannot change the fixed tenant, key, location or action',async()=>{
  const h=harness();await errorIs(await h.request({action:'refresh'},{Origin:'https://evil.example'}),403,'ACCESS_DENIED');
  for(const body of [{},{action:'skip'},{action:'refresh',location_id:'2'},{action:'refresh',key:'evil'},[],null,'not JSON',JSON.stringify({action:'refresh',padding:'x'.repeat(2048)})])await errorIs(await h.request(body),400,'INVALID_REQUEST');
  await errorIs(await h.request({action:'refresh'},{},'?location=2'),400,'INVALID_REQUEST');
  assert.equal(h.state.calls.length,0);
  const preflight=await h.handler(new Request(PROJECT,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:8788'}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:8788');
  await errorIs(await h.handler(new Request(PROJECT,{method:'GET'})),405,'METHOD_NOT_ALLOWED');assert.equal(h.state.calls.length,0);
  const local=harness();assert.equal((await local.request({action:'refresh'},{Origin:'http://localhost:8788'})).status,200);
});

test('incomplete provider responses and unknown activity mappings record a fenced failure instead of publishing partial data',async()=>{
  const missing=harness({intercept:call=>call.url.pathname==='/api/v1/reservations'?json({success:false,error:'fixture-private-upstream-detail'}):undefined});
  await errorIs(await missing.request(),502,'SOURCE_UNAVAILABLE');assert.equal(missing.state.published.length,0);assert.deepEqual(missing.state.failed,[{p_location_id:'1',p_lease_token:LEASE,p_code:'SOURCE_UNAVAILABLE'}]);
  const unmapped=harness();unmapped.state.detail.services[0].name='Unreviewed activity package';await errorIs(await unmapped.request(),502,'SOURCE_MAPPING_REQUIRED');assert.equal(unmapped.state.published.length,0);assert.equal(unmapped.state.failed[0].p_code,'SOURCE_MAPPING_REQUIRED');
});

test('provider rate limits use private rate-limit backoff while keeping the public failure generic',async()=>{
  // Covers the initial read, a parallel probe failure, and the mapping lookup.
  for(const endpoint of ['reservation_types','back_of_house','get_services_by_type']){
    const limited=harness({intercept:call=>call.url.pathname===`/api/v1/${endpoint}`?json({error:KEY},429):undefined});
    await errorIs(await limited.request(),502,'SOURCE_UNAVAILABLE');
    assert.equal(limited.state.published.length,0);
    assert.deepEqual(limited.state.failed,[{p_location_id:'1',p_lease_token:LEASE,p_code:'GINGR_RATE_LIMITED'}]);
    assert.deepEqual(limited.state.logs,[{code:'GINGR_RATE_LIMITED'}]);
    assert.ok(!JSON.stringify([limited.state.failed,limited.state.logs]).includes(KEY));
  }
});

test('provider errors and malicious response failures cannot leak keys or raw details',async()=>{
  for(const intercepted of [json({},401),new Response('x',{headers:{'Content-Length':String(5*1024*1024)}}),{ok:true,status:200,headers:{get(){throw new Error(`secret key ${KEY}`);}}}]){
    const h=harness({intercept:call=>call.url.hostname==='pawspet.gingrapp.com'?intercepted:undefined}),response=await h.request(),body=await response.json();
    assert.ok([502,503].includes(response.status));const publicData=JSON.stringify([body,h.state.logs,h.state.failed]);assert.ok(!publicData.includes(KEY));assert.ok(!publicData.includes(SERVICE));assert.equal(h.state.published.length,0);
  }
  const transport=harness({intercept:call=>{if(call.url.hostname==='pawspet.gingrapp.com')throw new Error(`https://pawspet.gingrapp.com/?key=${KEY}`);}});
  await errorIs(await transport.request(),502,'SOURCE_UNAVAILABLE');assert.ok(!JSON.stringify(transport.state.logs).includes(KEY));
});

test('mismatched provider configuration and stale leases never publish a schedule',async()=>{
  for(const env of [{GINGR_SUBDOMAIN:'other'},{GINGR_LOCATION_ID:'2'},{GINGR_API_KEY:''}]){
    const h=harness({env});await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.equal(providerCalls(h).length,0);assert.equal(h.state.failed[0].p_lease_token,LEASE);
  }
  const old=harness({claim:{claimed:true,leaseToken:LEASE,businessDate:'2026-11-23'}});await errorIs(await old.request(),502,'SOURCE_UNAVAILABLE');assert.equal(providerCalls(old).length,0);
  const fenced=harness({intercept:call=>call.url.pathname===RPC+'hq_departure_playtimes_publish'?json({published:false}):undefined});await errorIs(await fenced.request(),409,'SOURCE_CHANGED');assert.equal(fenced.state.failed[0].p_lease_token,LEASE);
});

test('a provider refresh crossing Eastern midnight cannot publish the previous business day',async()=>{
  const h=harness({intercept:call=>{if(call.url.pathname==='/api/v1/get_services_by_type')h.state.clock=Date.parse('2026-11-25T05:01:00Z');}});
  await errorIs(await h.request(),502,'SOURCE_UNAVAILABLE');assert.equal(h.state.published.length,0);assert.equal(h.state.failed[0].p_lease_token,LEASE);
});

test('the repeatable dashboard bundle behaves exactly like the module handler',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'paws-departure-edge-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const output=join(dir,'index.ts');execFileSync(process.execPath,[new URL('../scripts/build-departure-function.mjs',import.meta.url).pathname,output]);
  const source=await readFile(output,'utf8');assert.match(source,/GENERATED: do not edit/);assert.equal([...source.matchAll(/^import /gm)].length,1);
  const bundled=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const moduleRun=harness(),bundleRun=harness({factory:bundled.createHandler});
  const [a,b]=await Promise.all([moduleRun.request(),bundleRun.request()]);assert.deepEqual(await a.json(),await b.json());assert.deepEqual(moduleRun.state.published,bundleRun.state.published);
  assert.equal(typeof cleanView,'function');
});
