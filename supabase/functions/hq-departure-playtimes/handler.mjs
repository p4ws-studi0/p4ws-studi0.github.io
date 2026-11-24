/* Trusted, read-only Gingr refresh. Staff read/mutate the shared state through guarded SQL RPCs. */
import {createGingrReader} from './reader.mjs';
import {buildSource} from './adapter.mjs';
import {buildDailyView,easternDate} from './domain.mjs';

const LOCATION='1',MAX_VIEW_BYTES=2*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPCS=new Set(['hq_departure_playtimes_claim_refresh','hq_departure_playtimes_publish','hq_departure_playtimes_fail_refresh']);
const providerErrors=new Set(['GINGR_KEY_REQUIRED','GINGR_KEY_REJECTED','GINGR_KEY_OR_PERMISSION_REQUIRED']);

/** Whitelist only the staff display contract; never persist provider records or money fields. */
export function cleanView(snapshot,{now=Date.now}={}) {
  const view=buildDailyView(snapshot,[],{now});
  if(view.stale||view.locationId!==LOCATION||snapshot.services.some(service=>service.priceCents!==null))throw Object.assign(new Error('SOURCE_INCOMPLETE'),{code:'SOURCE_INCOMPLETE'});
  const emptyNote=()=>({note:'',noteRevision:0,noteUpdatedBy:null,noteUpdatedAt:null});
  const departures=view.departures.map(pet=>({
    reservationId:pet.reservationId,animalId:pet.animalId,dogName:pet.dogName,ownerLast:pet.ownerLast,species:pet.species,
    departureAt:pet.departureAt,checkedOutAt:pet.checkedOutAt,cancelled:false,
    noteKey:`departure:${LOCATION}:${pet.reservationId}:${pet.animalId}:${view.businessDate}`,...emptyNote(),
    services:pet.services.map(service=>({
      key:service.key,occurrenceId:service.occurrenceId,serviceId:service.serviceId,serviceName:service.serviceName,
      serviceDate:service.serviceDate,quantity:service.quantity,skipped:false,revision:0,status:'On today’s plan',verified:false,
      skippedBy:null,skippedAt:null,...emptyNote()
    }))
  }));
  const output={businessDate:view.businessDate,locationId:LOCATION,timezone:'America/New_York',fetchedAt:view.fetchedAt,
    scheduleVersion:view.scheduleVersion,sourceComplete:true,departures,
    summary:Object.fromEntries(['dogs','cats','pets','departures','playtimes','skipped'].map(key=>[key,view.summary[key]]))};
  if(new TextEncoder().encode(JSON.stringify(output)).byteLength>MAX_VIEW_BYTES)throw Object.assign(new Error('SOURCE_INCOMPLETE'),{code:'SOURCE_INCOMPLETE'});
  return output;
}

export function createHandler({env,fetch:request=fetch,now=Date.now,log=(_entry)=>{}}) {
  const clean=value=>typeof value==='string'?value.trim():'';
  const project=clean(env.SUPABASE_URL).replace(/\/$/,''),anon=clean(env.SUPABASE_ANON_KEY)||clean(env.SUPABASE_PUBLISHABLE_KEY);
  const service=clean(env.SUPABASE_SERVICE_ROLE_KEY),hq=clean(env.HQ_ORIGIN).replace(/\/$/,'')||'https://hq.pawspet.com';
  const key=clean(env.GINGR_API_KEY),subdomain=clean(env.GINGR_SUBDOMAIN)||'pawspet',location=clean(env.GINGR_LOCATION_ID)||LOCATION;
  let reader=null;
  class Failure extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
  const fail=(status,code)=>{throw new Failure(status,code);};
  const diagnose=code=>{try{log({code});}catch{/* No logging failure may change access or data. */}};
  function allowedOrigin(value) {
    if(value===hq)return true;
    try{const url=new URL(value);return url.origin===value&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{return false;}
  }
  function json(req,body,status=200) {
    const supplied=req.headers.get('Origin');
    return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':supplied&&allowedOrigin(supplied)?supplied:hq,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
  }
  async function text(response,limit,code) {
    if(Number(response.headers.get('Content-Length')||0)>limit){try{await response.body?.cancel();}catch{}fail(502,code);}
    if(!response.body)return '';
    const stream=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await stream.read();if(done)break;size+=value.byteLength;if(size>limit)fail(502,code);chunks.push(value);}}
    finally{try{await stream.cancel();}catch{}}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder().decode(bytes);
  }
  async function readJson(response,limit,code) {
    try{return JSON.parse(await text(response,limit,code));}catch{fail(502,code);}
  }
  async function fetchResponse(url,init,code) {
    try{return await request(url,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});}catch{fail(502,code);}
  }
  function projectConfiguration() {
    try{
      const url=new URL(project),origin=new URL(hq);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||origin.origin!==hq||origin.protocol!=='https:')throw new Error();
    }catch{fail(503,'CONNECTION_REQUIRED');}
    if(!anon||/\s/.test(anon)||!service||/\s/.test(service))fail(503,'CONNECTION_REQUIRED');
  }
  async function authorize(req) {
    const bearer=req.headers.get('Authorization');if(!/^Bearer\s+\S+$/i.test(bearer||''))fail(401,'AUTH_REQUIRED');
    projectConfiguration();
    const headers={apikey:anon,Authorization:bearer};
    const userResponse=await fetchResponse(`${project}/auth/v1/user`,{headers},'AUTH_UNAVAILABLE');
    if([401,403].includes(userResponse.status))fail(401,'AUTH_REQUIRED');if(!userResponse.ok)fail(502,'AUTH_UNAVAILABLE');
    const user=await readJson(userResponse,256*1024,'AUTH_UNAVAILABLE');if(!UUID.test(user?.id||''))fail(401,'AUTH_REQUIRED');
    const approval=await fetchResponse(`${project}/rest/v1/hq_tour_staff?select=user_id&user_id=eq.${user.id}&active=eq.true&limit=1`,{headers},'AUTH_UNAVAILABLE');
    if([401,403].includes(approval.status))fail(403,'ACCESS_DENIED');if(!approval.ok)fail(502,'AUTH_UNAVAILABLE');
    const rows=await readJson(approval,64*1024,'AUTH_UNAVAILABLE');
    if(!Array.isArray(rows)||!rows.some(row=>row?.user_id===user.id))fail(403,'ACCESS_DENIED');
  }
  async function rpc(name,body) {
    if(!RPCS.has(name))fail(500,'SOURCE_UNAVAILABLE');
    const response=await fetchResponse(`${project}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify(body)},'SOURCE_UNAVAILABLE');
    if(!response.ok)fail(502,'SOURCE_UNAVAILABLE');
    return readJson(response,3*1024*1024,'SOURCE_UNAVAILABLE');
  }
  function sourceConfiguration() {
    if(!key||key.length>4096||/\s/.test(key)||subdomain!=='pawspet'||location!==LOCATION)fail(503,'CONNECTION_REQUIRED');
    reader ||= createGingrReader({key,fetch:request,now});
  }
  function publicSourceFailure(error) {
    if(error instanceof Failure)return error;
    if(providerErrors.has(error?.code))return new Failure(503,'CONNECTION_REQUIRED');
    if(error?.code==='SOURCE_MAPPING_REQUIRED')return new Failure(502,'SOURCE_MAPPING_REQUIRED');
    return new Failure(502,'SOURCE_UNAVAILABLE');
  }
  return async function handler(req) {
    const supplied=req.headers.get('Origin');
    if(supplied&&!allowedOrigin(supplied))return json(req,{error:{code:'ACCESS_DENIED'}},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...Object.fromEntries(json(req,null).headers)}});
    if(req.method!=='POST')return json(req,{error:{code:'METHOD_NOT_ALLOWED'}},405);
    let lease=null;
    try{
      if(new URL(req.url).search)fail(400,'INVALID_REQUEST');
      let body;
      try{body=JSON.parse(await text(req,1024,'INVALID_REQUEST'));}catch{fail(400,'INVALID_REQUEST');}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||body.action!=='refresh')fail(400,'INVALID_REQUEST');
      await authorize(req);
      const claim=await rpc('hq_departure_playtimes_claim_refresh',{p_location_id:LOCATION});
      if(!claim||typeof claim.claimed!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(claim.businessDate||'')||claim.businessDate!==easternDate(now()))fail(502,'SOURCE_UNAVAILABLE');
      if(!claim.claimed)return json(req,{success:true,refreshed:false,refreshing:claim.refreshing===true,businessDate:claim.businessDate});
      if(!UUID.test(claim.leaseToken||''))fail(502,'SOURCE_UNAVAILABLE');lease=claim.leaseToken;
      sourceConfiguration();
      const bundle=await reader.probe();
      // A failed parallel read must retain rate-limit backoff without exposing
      // provider details in the public response or publishing a partial source.
      if(Object.values(bundle.failures||{}).includes('GINGR_RATE_LIMITED'))throw Object.assign(new Error('GINGR_RATE_LIMITED'),{code:'GINGR_RATE_LIMITED'});
      const source=await buildSource(reader,bundle),view=cleanView(source,{now});
      if(view.businessDate!==claim.businessDate||view.businessDate!==easternDate(now()))fail(409,'SOURCE_CHANGED');
      const published=await rpc('hq_departure_playtimes_publish',{p_location_id:LOCATION,p_lease_token:lease,p_view:view});
      if(published?.published!==true)fail(409,'SOURCE_CHANGED');
      return json(req,{success:true,refreshed:true,refreshing:false,businessDate:view.businessDate});
    }catch(error){
      const failure=publicSourceFailure(error),privateCode=error?.code==='GINGR_RATE_LIMITED'?'GINGR_RATE_LIMITED':failure.code;
      if(lease){try{await rpc('hq_departure_playtimes_fail_refresh',{p_location_id:LOCATION,p_lease_token:lease,p_code:privateCode});}catch{/* Lease fencing prevents failures overwriting a newer source. */}}
      diagnose(privateCode);return json(req,{error:{code:failure.code}},failure.status);
    }
  };
}
