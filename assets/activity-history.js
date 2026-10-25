/* Read-only activity history. Every request remains subject to workspace access and RLS. */
(() => {
  'use strict';
  const PAGE_SIZE=50,ZONE='America/New_York',AVATAR_BATCH_SIZE=100,AVATAR_CACHE_SIZE=256,AVATAR_TTL=5*60*1000;
  const ACTIONS={create:'Added',update:'Updated',delete:'Deleted',restore:'Restored',sign_in:'Signed in'};
  const SECTION_NAMES={'knowledge-base':'Knowledge Base','end-of-day':'End Of Day','k9-cough':'K9 Cough','run-cards':'Run Cards','home':'Home','history':'History'};
  const FIELD_NAMES={bills_100:'$100 bills',bills_50:'$50 bills',bills_20:'$20 bills',bills_10:'$10 bills',bills_5:'$5 bills',bills_1:'$1 bills',staff_name:'Staff name',deleted_at:'Deleted status',session_date:'Session date',tour_date:'Tour date',tour_time:'Tour time',is_completed:'Completed',has_file:'Has file',has_booking:'Has booking'};
  const state={rows:[],userId:null,epoch:0,request:0,loading:false,authorized:false,hasMore:false,cursor:null,query:'',action:'all',period:'7',startedAt:null,coverageLoaded:false,error:'',debounce:null,lastAttempt:0,avatarCache:new Map(),avatarPending:new Map(),avatarGeneration:0};
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const current=(epoch,request)=>state.epoch===epoch&&(request===undefined||state.request===request);
  function recordId(value){if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?String(value):null;return typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)?value:null;}
  function actorId(value){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;}
  function avatarUrl(value){
    if(typeof value!=='string'||value.length>2048||/[\s\\#]/.test(value)||!/^https:\/\/(?:avatars\.slack-edge\.com|a\.slack-edge\.com|secure\.gravatar\.com)\//i.test(value))return null;
    try{
      const url=new URL(value);
      if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null;
      if(url.hostname==='secure.gravatar.com'&&!/^\/avatar\/[a-f0-9]{32}$/i.test(url.pathname))return null;
      return url.href;
    }catch{return null;}
  }
  function cachedAvatar(id){const entry=state.avatarCache.get(id);if(!entry)return undefined;if(entry.expires<=Date.now()){state.avatarCache.delete(id);return undefined;}return entry.url;}
  function cacheAvatar(id,url){state.avatarCache.delete(id);state.avatarCache.set(id,{url,expires:Date.now()+AVATAR_TTL});while(state.avatarCache.size>AVATAR_CACHE_SIZE)state.avatarCache.delete(state.avatarCache.keys().next().value);}
  function clearAvatarImages(){
    for(const node of $('historyRows').querySelectorAll('[data-avatar-actor]')){
      const image=node.querySelector('img');if(image){image.removeAttribute('src');image.remove();}
      delete node.dataset.avatarUrl;node.classList.remove('has-photo');
    }
  }
  function clearAvatars(){state.avatarGeneration++;state.avatarCache.clear();state.avatarPending.clear();clearAvatarImages();}
  function paintAvatars(){
    const epoch=state.epoch,generation=state.avatarGeneration;
    for(const node of $('historyRows').querySelectorAll('[data-avatar-actor]')){
      const id=actorId(node.dataset.avatarActor),url=id?cachedAvatar(id):null;
      if(node.dataset.avatarUrl===url)continue;
      const previous=node.querySelector('img');if(previous){previous.removeAttribute('src');previous.remove();}
      delete node.dataset.avatarUrl;node.classList.remove('has-photo');
      if(!state.authorized||!url)continue;
      const image=document.createElement('img');
      image.alt='';image.width=29;image.height=29;image.decoding='async';image.referrerPolicy='no-referrer';
      const relevant=()=>current(epoch)&&state.avatarGeneration===generation&&state.authorized&&node.isConnected&&node.dataset.avatarUrl===url;
      image.addEventListener('load',()=>{if(relevant())node.classList.add('has-photo');});
      image.addEventListener('error',()=>{if(relevant()){cacheAvatar(id,null);paintAvatars();}});
      node.dataset.avatarUrl=url;node.append(image);image.src=url;
    }
  }
  async function loadAvatars(epoch=state.epoch,request=state.request){
    if(!current(epoch,request)||!state.authorized||state.loading)return;
    // Bound both one RPC and the per-account cache, even after many Load more requests.
    const actors=[...new Set(state.rows.map(row=>actorId(row.actor_id)).filter(Boolean))].slice(0,AVATAR_CACHE_SIZE);
    const needed=actors.filter(id=>cachedAvatar(id)===undefined&&!state.avatarPending.has(id)).slice(0,AVATAR_BATCH_SIZE);
    if(!needed.length)return;
    const token={},generation=state.avatarGeneration,userId=state.userId;
    for(const id of needed)state.avatarPending.set(id,token);
    try{
      const result=await supabaseClient.rpc('hq_activity_history_avatars',{p_actor_ids:needed});
      if(!current(epoch,request)||state.avatarGeneration!==generation||state.userId!==userId||!state.authorized)return;
      if(result.error)throw result.error;
      if(!Array.isArray(result.data)||result.data.length>AVATAR_BATCH_SIZE)throw {code:'AVATAR_RESPONSE'};
      const allowed=new Set(needed),urls=new Map();
      for(const row of result.data){const id=actorId(row?.actor_id),url=avatarUrl(row?.avatar_url);if(id&&allowed.has(id)&&url)urls.set(id,url);}
      for(const id of needed)cacheAvatar(id,urls.get(id)||null);
      paintAvatars();
    }catch(error){
      if(!current(epoch,request)||state.avatarGeneration!==generation||state.userId!==userId)return;
      // Photos are optional while the RPC rolls out; permission failures still clear all private content.
      clearAvatars();
      if(['AUTH','ACCESS','42501'].includes(error?.code)){clearPrivate();state.authorized=false;state.error=errorMessage(error);render();}
    }finally{
      for(const id of needed)if(state.avatarPending.get(id)===token)state.avatarPending.delete(id);
      if(current(epoch)&&state.avatarGeneration===generation&&state.userId===userId&&!state.loading)void loadAvatars(state.epoch,state.request);
    }
  }
  function humanize(value){return String(value??'').replace(/[_-]+/g,' ').replace(/\b\w/g,char=>char.toUpperCase());}
  function sectionName(value){return SECTION_NAMES[value]||humanize(value)||'Paws HQ';}
  function searchFilter(value){
    const literal=String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,120).replace(/[\\%_]/g,char=>'\\'+char);
    if(!literal)return '';
    const pattern=('%'+literal+'%').replace(/\\/g,'\\\\').replace(/"/g,'\\"');
    return ['actor_name','record_label','section'].map(field=>`${field}.ilike."${pattern}"`).join(',');
  }
  function zoneParts(value){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));}
  function periodStart(period,now=new Date()){
    if(period==='all')return null;
    const p=zoneParts(now),days=period==='today'?0:period==='30'?29:6;
    const target=Date.UTC(p.year,p.month-1,p.day-days);let guess=target;
    for(let i=0;i<4;i++){const z=zoneParts(new Date(guess)),actual=Date.UTC(z.year,z.month-1,z.day,z.hour,z.minute,z.second);guess+=target-actual;}
    return new Date(guess).toISOString();
  }
  function validDate(value){const date=new Date(value);return value&&Number.isFinite(date.getTime())?date:null;}
  function dateLabel(value){const date=validDate(value);return date?new Intl.DateTimeFormat('en-US',{timeZone:ZONE,month:'short',day:'numeric',year:'numeric'}).format(date):'';}
  function rowHtml(row){
    const name=String(row.actor_name||'Paws HQ member'),id=actorId(row.actor_id);
    const knownAction=Object.hasOwn(ACTIONS,row.action),action=knownAction?ACTIONS[row.action]:'Activity';
    const label=String(row.record_label||row.page_path||sectionName(row.section));
    const fields=Array.isArray(row.changed_fields)?[...new Set(row.changed_fields.filter(field=>typeof field==='string'&&field.length&&field.length<=100))].slice(0,64):[];
    const details=fields.length?`<details class="ah-changes"><summary>Fields changed (${fields.length})</summary><div class="ah-fields">${fields.map(field=>`<span>${escape(FIELD_NAMES[field]||humanize(field))}</span>`).join('')}</div></details>`:'';
    const date=validDate(row.occurred_at),time=date?new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date):'';
    return `<tr><td><div class="ah-who"><span class="ah-avatar"${id?` data-avatar-actor="${id}"`:''} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></span><span>${escape(name)}</span></div></td><td><span class="ah-action${knownAction?' ah-action-'+row.action:''}">${escape(action)}</span></td><td><div class="ah-item">${escape(label)}</div><div class="ah-section">${escape(sectionName(row.section))}</div>${details}</td><td>${date?`<time class="ah-time" datetime="${escape(date.toISOString())}">${escape(dateLabel(row.occurred_at))}<span>${escape(time)}</span></time>`:'—'}</td></tr>`;
  }
  function render(){
    $('historyRows').innerHTML=state.rows.map(rowHtml).join('');
    paintAvatars();
    $('historyTable').hidden=!state.rows.length;
    $('historyMessage').hidden=!state.error;$('historyMessage').textContent=state.error;
    $('historyCount').textContent=state.loading?(state.rows.length?`Loading more… · ${state.rows.length} shown`:'Loading history…'):`${state.rows.length} ${state.rows.length===1?'activity':'activities'} shown`;
    const filtered=Boolean(state.query.trim()||state.action!=='all');
    $('historyEmpty').hidden=state.loading||Boolean(state.rows.length)||Boolean(state.error)||!state.authorized;
    $('historyEmptyTitle').textContent=filtered?'No matching activity.':'No activity in this date range.';
    $('historyEmptyHint').textContent=filtered?'Try a different search, action or date range.':'Try a longer date range, or check back as the team uses Paws HQ.';
    $('loadMoreHistory').hidden=!state.hasMore;$('loadMoreHistory').disabled=state.loading||!state.authorized;
    $('loadMoreHistory').textContent=state.loading?'Loading…':'Load more';
    for(const id of ['historySearch','historyAction','historyPeriod'])$(id).disabled=!state.authorized;
    $('refreshHistory').disabled=state.loading;
    $('historyCoverage').textContent=state.startedAt?`History starts ${dateLabel(state.startedAt)}. Earlier activity isn’t included.`:'Earlier activity isn’t included.';
  }
  function clearPrivate(){clearAvatars();state.rows=[];state.cursor=null;state.hasMore=false;state.startedAt=null;state.coverageLoaded=false;}
  function resetAuth(id=null){
    state.epoch++;state.request++;if(state.debounce)clearTimeout(state.debounce);state.debounce=null;
    clearPrivate();state.userId=id;state.authorized=false;state.loading=false;state.query='';state.action='all';state.period='7';state.error='';
    $('historySearch').value='';$('historyAction').value='all';$('historyPeriod').value='7';render();
  }
  async function requireAccess(epoch,request){
    if(typeof supabaseClient==='undefined')throw {code:'UNAVAILABLE'};
    const result=await supabaseClient.auth.getSession();
    if(!current(epoch,request))throw {code:'STALE'};
    if(result.error||!result.data?.session?.user?.id)throw {code:'AUTH'};
    const session=result.data.session;
    if(state.userId&&state.userId!==session.user.id)throw {code:'AUTH'};
    if(typeof ensureHqWorkspaceAccess!=='function')throw {code:'UNAVAILABLE'};
    await ensureHqWorkspaceAccess(session);
    if(!current(epoch,request))throw {code:'STALE'};
    state.userId=session.user.id;state.authorized=true;
  }
  function errorMessage(error){
    if(error?.code==='AUTH')return 'Sign in to Paws HQ to view history.';
    if(error?.code==='ACCESS'||error?.code==='42501')return 'Your workspace access could not be verified. Refresh to try again.';
    return 'History couldn’t be loaded. Please refresh to try again.';
  }
  async function load({append=false}={}){
    if(append&&(state.loading||!state.hasMore||!state.cursor))return;
    if(state.debounce)clearTimeout(state.debounce);state.debounce=null;
    const epoch=state.epoch,request=++state.request,cursor=append?state.cursor:null;
    state.loading=true;state.error='';state.lastAttempt=Date.now();
    if(!append){state.rows=[];state.cursor=null;state.hasMore=false;}render();
    try{
      await requireAccess(epoch,request);if(!current(epoch,request))return;
      render();
      let query=supabaseClient.from('hq_activity_history').select('id,occurred_at,actor_id,actor_name,action,section,record_label,changed_fields,page_path').neq('action','page_view').order('id',{ascending:false}).limit(PAGE_SIZE);
      if(cursor)query=query.lt('id',cursor);
      if(state.action!=='all')query=query.eq('action',state.action);
      const start=periodStart(state.period);if(start)query=query.gte('occurred_at',start);
      const search=searchFilter(state.query);if(search)query=query.or(search);
      const info=state.coverageLoaded?Promise.resolve(null):Promise.resolve().then(()=>supabaseClient.rpc('hq_activity_history_info')).catch(()=>null);
      const [result,coverage]=await Promise.all([query,info]);if(!current(epoch,request))return;
      if(result.error)throw result.error;
      if(!Array.isArray(result.data)||result.data.some(row=>!row||!recordId(row.id)))throw {code:'INVALID_RESPONSE'};
      const incoming=result.data.filter(row=>row.action!=='page_view').map(row=>({...row,id:recordId(row.id)}));
      const rows=new Map((append?state.rows:[]).map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,row);
      state.rows=[...rows.values()].sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:BigInt(a.id)<BigInt(b.id)?1:0);
      const next=recordId(result.data.at(-1)?.id);state.cursor=next||cursor;
      state.hasMore=result.data.length===PAGE_SIZE&&Boolean(next)&&next!==cursor;
      if(coverage&&!coverage.error){const meta=Array.isArray(coverage.data)?coverage.data[0]:coverage.data;if(meta?.version===1&&validDate(meta.started_at)){state.startedAt=meta.started_at;state.coverageLoaded=true;}}
    }catch(error){
      if(!current(epoch,request))return;
      clearPrivate();state.error=errorMessage(error);
      if(['AUTH','ACCESS','42501'].includes(error?.code))state.authorized=false;
    }finally{if(current(epoch,request)){state.loading=false;render();if(state.authorized&&!state.error)void loadAvatars(epoch,request);}}
  }
  function searchChanged(){
    state.query=$('historySearch').value.slice(0,120);state.request++;
    if(state.debounce)clearTimeout(state.debounce);
    state.rows=[];state.cursor=null;state.hasMore=false;state.error='';state.loading=true;render();
    state.debounce=setTimeout(()=>{state.debounce=null;void load();},220);
  }
  function init(){
    if(!$('activityHistoryPage'))return;
    $('historySearch').addEventListener('input',searchChanged);
    $('historyAction').addEventListener('change',()=>{state.action=Object.hasOwn(ACTIONS,$('historyAction').value)?$('historyAction').value:'all';void load();});
    $('historyPeriod').addEventListener('change',()=>{state.period=['today','7','30','all'].includes($('historyPeriod').value)?$('historyPeriod').value:'7';void load();});
    $('refreshHistory').addEventListener('click',()=>{void load();});
    $('loadMoreHistory').addEventListener('click',()=>{void load({append:true});});
    if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{
      const id=session?.user?.id||null;
      if(event==='SIGNED_OUT'||id!==state.userId){resetAuth(id);if(id)setTimeout(()=>{void load();},0);}
    });
    window.addEventListener('paws-access-revoked',()=>{resetAuth();state.error='Your workspace access could not be verified. Refresh to try again.';render();});
    window.addEventListener('pagehide',()=>resetAuth());
    window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
    const refreshIfDue=()=>{if(!document.hidden&&!state.loading&&Date.now()-state.lastAttempt>30000)void load();};
    window.addEventListener('focus',refreshIfDue);window.addEventListener('online',refreshIfDue);document.addEventListener('visibilitychange',refreshIfDue);
    void load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
