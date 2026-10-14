/* Read-only Gingr Digital Whiteboard for approved HQ members. */
export function createHandler({env, fetch:request=fetch, now=Date.now, log=(_entry)=>{}}) {
  const clean=value=>typeof value==='string'?value.trim():'';
  const origin=clean(env.HQ_ORIGIN)||'https://hq.pawspet.com';
  const project=clean(env.SUPABASE_URL).replace(/\/$/,''),anonKey=clean(env.SUPABASE_ANON_KEY);
  const key=clean(env.GINGR_API_KEY),subdomain=clean(env.GINGR_SUBDOMAIN)||'pawspet',location=clean(env.GINGR_LOCATION_ID)||'1';
  const id=value=>(typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value))&&/^[1-9]\d{0,19}$/.test(String(value))?String(value):null;
  let typeIds=[];
  try {
    const raw=clean(env.GINGR_TYPE_IDS);
    const parsed=raw.startsWith('[')?JSON.parse(raw):raw.split(',').map(value=>value.trim());
    if(Array.isArray(parsed)&&parsed.length&&parsed.length<=200&&parsed.every(value=>id(value)))typeIds=[...new Set(parsed.map(value=>id(value)))];
  }catch{/* A malformed setting fails closed after staff authorization. */}
  const cache=new Map(),pending=new Map();
  let cooldown=0,discoveredTypes=null,discoveryPending=null;
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json',...extra}});
  class Failure extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
  const fail=(status,code)=>{throw new Failure(status,code);};
  const diagnostics=new Set(['SUPABASE_CONFIGURATION','GINGR_CONFIGURATION','GINGR_CREDENTIALS','GINGR_HTTP','GINGR_PAYLOAD','GINGR_TRANSPORT','GINGR_RATE_LIMIT']);
  const diagnose=reason=>{if(diagnostics.has(reason))try{log({reason});}catch{/* Logs never affect results. */}};
  async function boundedText(response,max,status,code) {
    if(Number(response.headers.get('Content-Length')||0)>max){await response.body?.cancel();fail(status,code);}
    if(!response.body)return '';
    const reader=response.body.getReader(),chunks=[];let total=0;
    try {
      while(true) {
        const {done,value}=await reader.read();if(done)break;
        total+=value.byteLength;if(total>max)fail(status,code);chunks.push(value);
      }
    }finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder().decode(bytes);
  }
  async function readJson(response,max=256*1024,code='AUTH_UNAVAILABLE') {
    const raw=await boundedText(response,max,502,code);
    try{return JSON.parse(raw);}catch{fail(502,code);}
  }
  async function authorize(req) {
    const bearer=req.headers.get('Authorization');if(!/^Bearer\s+\S+$/i.test(bearer||''))fail(401,'AUTH_REQUIRED');
    try {
      const url=new URL(project);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!anonKey||/\s/.test(anonKey))throw new Error();
    }catch{diagnose('SUPABASE_CONFIGURATION');fail(503,'CONNECTION_REQUIRED');}
    const authHeaders={apikey:anonKey,Authorization:bearer};
    let res;
    try {res=await request(`${project}/auth/v1/user`,{headers:authHeaders,signal:AbortSignal.timeout(10000),redirect:'error'});}
    catch{fail(502,'AUTH_UNAVAILABLE');}
    if(res.status===401||res.status===403)fail(401,'AUTH_REQUIRED');if(!res.ok)fail(502,'AUTH_UNAVAILABLE');
    const user=await readJson(res);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id||''))fail(401,'AUTH_REQUIRED');
    let staff;
    try {staff=await request(`${project}/rest/v1/hq_tour_staff?select=user_id&user_id=eq.${user.id}&active=eq.true&limit=1`,{headers:authHeaders,signal:AbortSignal.timeout(10000),redirect:'error'});}
    catch{fail(502,'AUTH_UNAVAILABLE');}
    if(staff.status===401||staff.status===403)fail(403,'ACCESS_DENIED');if(!staff.ok)fail(502,'AUTH_UNAVAILABLE');
    const approvals=await readJson(staff);
    if(!Array.isArray(approvals)||!approvals.some(row=>row?.user_id===user.id))fail(403,'ACCESS_DENIED');
  }
  function configuration() {
    if(!key||key.length>4096||/\s/.test(key)||!subdomain||subdomain.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)||!id(location)||clean(env.GINGR_TYPE_IDS)&&!typeIds.length) {
      diagnose('GINGR_CONFIGURATION');fail(503,'CONNECTION_REQUIRED');
    }
  }
  async function query(req) {
    let body;
    if(req.method==='GET') {
      const params=new URL(req.url).searchParams;
      if([...params.keys()].some(name=>!['full_day','mins_future'].includes(name))||params.getAll('full_day').length>1||params.getAll('mins_future').length>1)fail(400,'INVALID_REQUEST');
      body={};
      if(params.has('full_day')){if(!['true','false'].includes(params.get('full_day')))fail(400,'INVALID_REQUEST');body.full_day=params.get('full_day')==='true';}
      if(params.has('mins_future')){if(!/^\d{1,4}$/.test(params.get('mins_future')))fail(400,'INVALID_REQUEST');body.mins_future=Number(params.get('mins_future'));}
    } else {
      const raw=await boundedText(req,4096,400,'INVALID_REQUEST');
      try{body=raw?JSON.parse(raw):{};}catch{fail(400,'INVALID_REQUEST');}
    }
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(name=>!['full_day','mins_future'].includes(name)))fail(400,'INVALID_REQUEST');
    if(body.full_day!==undefined&&typeof body.full_day!=='boolean')fail(400,'INVALID_REQUEST');
    if(body.mins_future!==undefined&&(!Number.isInteger(body.mins_future)||body.mins_future<1||body.mins_future>1440))fail(400,'INVALID_REQUEST');
    if(body.full_day===false&&body.mins_future===undefined)fail(400,'INVALID_REQUEST');
    const fullDay=body.full_day===true||body.full_day===undefined&&body.mins_future===undefined;
    return {full_day:fullDay,mins_future:fullDay?null:body.mins_future};
  }
  const text=(value,max=200)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
  const nullableText=(value,max=200)=>value===null||value===undefined?null:text(value,max);
  const integer=(value,max)=>((typeof value==='number'||typeof value==='string')&&/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)<=max)?Number(value):null;
  const timestamp=value=>{const stamp=integer(value,253402300799);return stamp>0?stamp:null;};
  function normalize(rows,allowedTypes) {
    if(!Array.isArray(rows)||rows.length>5000)fail(502,'GINGR_UNAVAILABLE');
    const seen=new Set();
    return rows.map(row=>{
      if(!row||typeof row!=='object'||Array.isArray(row)||!id(row.id)||!id(row.type_id)||!allowedTypes.has(id(row.type_id))||seen.has(id(row.id)))fail(502,'GINGR_UNAVAILABLE');
      seen.add(id(row.id));
      return {
        id:id(row.id),owner_id:id(row.owner_id),animal_id:id(row.animal_id),
        o_last:text(row.o_last),a_first:text(row.a_first),type_id:id(row.type_id),type:text(row.type),
        check_in_stamp:timestamp(row.check_in_stamp),check_out_stamp:timestamp(row.check_out_stamp),
        start_date:timestamp(row.start_date),end_date:timestamp(row.end_date),
        run_name:nullableText(row.run_name),area_name:nullableText(row.area_name),
        belonging_count:integer(row.belonging_count,1000000),belonging_area:nullableText(row.belonging_area),
        status_id:integer(row.status_id,1000000),status_string:text(row.status_string),event_time:timestamp(row.event_time)
      };
    });
  }
  async function gingrResponse(url) {
    if(cooldown>now())fail(429,'RATE_LIMITED');
    let res;
    try {res=await request(url.href,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{diagnose('GINGR_TRANSPORT');fail(502,'GINGR_UNAVAILABLE');}
    if(res.status===429) {
      const raw=res.headers.get('Retry-After'),numeric=Number(raw),date=Date.parse(raw||'');
      const seconds=raw&&Number.isFinite(numeric)?numeric:Number.isFinite(date)?(date-now())/1000:60;
      cooldown=now()+Math.max(1,Math.min(300,Math.ceil(seconds)))*1000;
      diagnose('GINGR_RATE_LIMIT');fail(429,'RATE_LIMITED');
    }
    if(res.status===401||res.status===403){cache.clear();discoveredTypes=null;diagnose('GINGR_CREDENTIALS');fail(503,'CONNECTION_REQUIRED');}
    if(!res.ok){diagnose('GINGR_HTTP');fail(502,'GINGR_UNAVAILABLE');}
    return res;
  }
  async function reservationTypes() {
    if(typeIds.length)return typeIds;
    if(discoveredTypes&&discoveredTypes.until>now())return discoveredTypes.ids;
    if(discoveryPending)return discoveryPending;
    discoveryPending=(async()=>{
      const url=new URL(`https://${subdomain}.gingrapp.com/api/v1/reservation_types`);url.searchParams.set('key',key);
      const response=await gingrResponse(url);
      try {
        const body=await readJson(response,1024*1024,'GINGR_UNAVAILABLE');
        if(!body||typeof body!=='object'||body.success===false||body.error&&body.error!==false)fail(502,'GINGR_UNAVAILABLE');
        const data=body.data===undefined?body:body.data;
        const entries=Array.isArray(data)?data:Object.values(data||{});
        if(!entries.length||entries.length>200||!entries.every(row=>row&&typeof row==='object'&&id(row.id)))fail(502,'GINGR_UNAVAILABLE');
        const ids=[...new Set(entries.map(row=>id(row.id)))];
        discoveredTypes={until:now()+300000,ids};return ids;
      }catch{diagnose('GINGR_PAYLOAD');fail(502,'GINGR_UNAVAILABLE');}
    })().finally(()=>{discoveryPending=null;});
    return discoveryPending;
  }
  async function board(options,types) {
    const cacheKey=`${options.full_day?'day':`minutes:${options.mins_future}`}:${types.join(',')}`;
    const hit=cache.get(cacheKey);if(hit&&hit.until>now())return hit.data;
    if(pending.has(cacheKey))return pending.get(cacheKey);
    if(cooldown>now())fail(429,'RATE_LIMITED');
    const work=(async()=>{
      const url=new URL(`https://${subdomain}.gingrapp.com/api/v1/back_of_house`);
      url.searchParams.set('key',key);url.searchParams.set('location_id',location);
      for(const type of types)url.searchParams.append('type_ids[]',type);
      if(options.full_day)url.searchParams.set('full_day','true');else url.searchParams.set('mins_future',String(options.mins_future));
      const res=await gingrResponse(url);
      let payload,data;
      try {
        payload=await readJson(res,4*1024*1024,'GINGR_UNAVAILABLE');
        if(payload?.success!==true||payload.error!==false||!payload.data||typeof payload.data!=='object')fail(502,'GINGR_UNAVAILABLE');
        const allowedTypes=new Set(types);
        data={checking_in:normalize(payload.data.checking_in,allowedTypes),checking_out:normalize(payload.data.checking_out,allowedTypes),updated_at:new Date(now()).toISOString(),...options,timezone:'America/New_York',gingr_url:`https://${subdomain}.gingrapp.com`};
      }catch{diagnose('GINGR_PAYLOAD');fail(502,'GINGR_UNAVAILABLE');}
      if(cache.size>=32)cache.clear();cache.set(cacheKey,{until:now()+15000,data});return data;
    })().finally(()=>pending.delete(cacheKey));
    pending.set(cacheKey,work);return work;
  }
  return async function handler(req) {
    if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:{code:'ACCESS_DENIED'}},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!['GET','POST'].includes(req.method))return json({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'GET, POST, OPTIONS'});
    try {
      const options=await query(req);
      await authorize(req);configuration();
      return json(await board(options,await reservationTypes()));
    }catch(error){
      const status=error instanceof Failure?error.status:502,code=error instanceof Failure?error.code:'GINGR_UNAVAILABLE';
      return json({error:{code}},status,status===429?{'Retry-After':String(Math.max(1,Math.ceil((cooldown-now())/1000)))}:{});
    }
  };
}
if(typeof Deno!=='undefined') {
  const keys=['HQ_ORIGIN','SUPABASE_URL','SUPABASE_ANON_KEY','GINGR_API_KEY','GINGR_SUBDOMAIN','GINGR_LOCATION_ID','GINGR_TYPE_IDS'];
  Deno.serve(createHandler({env:Object.fromEntries(keys.map(key=>[key,Deno.env.get(key)])),log:entry=>console.warn('hq-gingr-whiteboard',JSON.stringify(entry))}));
}
