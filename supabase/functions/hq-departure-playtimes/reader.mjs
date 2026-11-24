// Documented legacy READ operations only. The key and provider payload stay in memory.
import {easternDate} from './domain.mjs';
const BASE='https://pawspet.gingrapp.com/api/v1/';
const ENDPOINTS=new Map([['reservation_types','GET'],['get_species','GET'],['back_of_house','GET'],['reservations','POST'],['get_services_by_type','GET']]);
const READ_ERROR_STATUSES=new Map([['GINGR_DISCONNECTED',409],['GINGR_CONNECTION_FAILED',503],['GINGR_KEY_REJECTED',401],['GINGR_RATE_LIMITED',429],['GINGR_READ_FAILED',502],['GINGR_RESPONSE_TOO_LARGE',502],['GINGR_RESPONSE_INVALID',502],['GINGR_KEY_OR_PERMISSION_REQUIRED',403]]);
const fail=(code,status=502)=>{throw Object.assign(new Error(code),{code,status});};
const numericId=value=>/^[1-9]\d{0,19}$/.test(String(value))?String(value):null;
export function createGingrReader({key,fetch:request=fetch,now=Date.now}){
  if(typeof key!=='string'||!key.trim()||key.trim().length>4096||/\s/.test(key.trim()))fail('GINGR_KEY_REQUIRED',400);
  let secret=key.trim(),closed=false,pending=null;
  const controllers=new Set(),lookups=new Map(),lookupPending=new Map();
  async function read(name,params={}){
    if(closed)fail('GINGR_DISCONNECTED',409);
    if(!ENDPOINTS.has(name))fail('READ_ENDPOINT_ONLY',400);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);controllers.add(controller);
    try{
      const method=ENDPOINTS.get(name),encoded=new URLSearchParams({key:secret});
      for(const [field,value] of Object.entries(params))for(const entry of Array.isArray(value)?value:[value])encoded.append(field,String(entry));
      const url=new URL(name,BASE);if(method==='GET')url.search=encoded;
      let response;try{response=await request(url.href,{method,redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:encoded}:{})});}catch{fail(closed?'GINGR_DISCONNECTED':'GINGR_CONNECTION_FAILED',503);}
      if(closed)fail('GINGR_DISCONNECTED',409);
      if(response.status===401||response.status===403)fail('GINGR_KEY_REJECTED',401);
      if(response.status===429)fail('GINGR_RATE_LIMITED',429);
      if(!response.ok)fail('GINGR_READ_FAILED');
      if(Number(response.headers.get('content-length')||0)>4*1024*1024){try{await response.body?.cancel();}catch{}fail('GINGR_RESPONSE_TOO_LARGE');}
      const reader=response.body?.getReader();if(!reader)fail('GINGR_RESPONSE_INVALID');
      const chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024)fail('GINGR_RESPONSE_TOO_LARGE');chunks.push(value);}}finally{try{await reader.cancel();}catch{}}
      if(closed)fail('GINGR_DISCONNECTED',409);
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('GINGR_RESPONSE_INVALID');}
      if(!body||typeof body!=='object'||body.success===false||body.error&&body.error!==false||typeof body.status==='string'&&/error|fail|unauthor/i.test(body.status))fail('GINGR_KEY_OR_PERMISSION_REQUIRED',403);
      return body.data===undefined?body:body.data;
    }catch(error){
      // Stream and response errors can contain the secret-bearing request URL.
      // Recreate every error using only a fixed code and its canonical status.
      const code=closed?'GINGR_DISCONNECTED':READ_ERROR_STATUSES.has(error?.code)?error.code:'GINGR_READ_FAILED';
      fail(code,READ_ERROR_STATUSES.get(code));
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  function probe(){
    if(closed)return Promise.reject(Object.assign(new Error('GINGR_DISCONNECTED'),{code:'GINGR_DISCONNECTED',status:409}));
    if(pending)return pending;
    pending=(async()=>{
      const date=easternDate(now()),types=await read('reservation_types');
      const rows=Array.isArray(types)?types:Object.values(types||{});
      if(!rows.length||rows.length>200||!rows.every(row=>row&&numericId(row.id)))fail('GINGR_RESERVATION_TYPES_UNSUPPORTED');
      const typeIds=[...new Set(rows.map(row=>String(row.id)))];
      const inputs=[['species','get_species',{}],['whiteboard','back_of_house',{location_id:'1','type_ids[]':typeIds,full_day:true}],['checked_in','reservations',{location_id:'1',checked_in:true}],['date_range','reservations',{location_id:'1',checked_in:false,start_date:date,end_date:date}]];
      const payload={businessDate:date,fetchedAt:null,types,failures:{}};
      // Only documented reads; each failure remains distinguishable from an empty list.
      const results=await Promise.allSettled(inputs.map(async([field,name,params])=>({field,value:await read(name,params)})));
      results.forEach((result,index)=>{const field=inputs[index][0];if(result.status==='fulfilled')payload[field]=result.value.value;else payload.failures[field]=result.reason.code||'GINGR_READ_FAILED';});
      if(closed)fail('GINGR_DISCONNECTED',409);
      payload.fetchedAt=new Date(now()).toISOString();return payload;
    })().finally(()=>{pending=null;});return pending;
  }
  async function lookup(name,id){
    if(closed)fail('GINGR_DISCONNECTED',409);
    let params;
    if(name==='get_services_by_type'&&numericId(id))params={type_id:String(id),location_id:'1'};
    else fail('READ_ENDPOINT_ONLY',400);
    const cacheKey=`${name}:${id??''}`,cached=lookups.get(cacheKey);
    if(cached&&cached.until>now())return cached.value;
    if(lookupPending.has(cacheKey))return lookupPending.get(cacheKey);
    const work=read(name,params).then(value=>{if(closed)fail('GINGR_DISCONNECTED',409);if(lookups.size>1000)lookups.clear();lookups.set(cacheKey,{value,until:now()+300000});return value;}).finally(()=>lookupPending.delete(cacheKey));
    lookupPending.set(cacheKey,work);return work;
  }
  return {probe,lookup,close(){closed=true;secret='';lookups.clear();lookupPending.clear();for(const controller of controllers)controller.abort();}};
}
