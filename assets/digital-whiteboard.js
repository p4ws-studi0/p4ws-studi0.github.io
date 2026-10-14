/* Read-only Gingr board. Credentials and provider requests stay in the Edge Function. */
(() => {
  'use strict';
  const zone = 'America/New_York';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = value => {const n = Number(value); return Number.isFinite(n) && n > 0 && n < 8640000000000 ? n * 1000 : null;};
  const finished = (row, lane) => stamp(lane === 'arrival' ? row.check_in_stamp : row.check_out_stamp) !== null;
  const scheduled = (row, lane) => stamp(row.event_time) || stamp(lane === 'arrival' ? row.start_date : row.end_date);
  const fold = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function matches(row, query, service) {
    const words = fold(query).trim().split(/\s+/).filter(Boolean);
    const haystack = fold([row.a_first,row.o_last,row.type,row.run_name,row.area_name,row.belonging_area].join(' '));
    return (!service || String(row.type_id) === service) && words.every(word => haystack.includes(word));
  }
  function sortRows(rows, lane) {
    return [...rows].sort((a,b) => Number(finished(a,lane))-Number(finished(b,lane)) || (scheduled(a,lane) ?? Infinity)-(scheduled(b,lane) ?? Infinity) || String(a.a_first).localeCompare(String(b.a_first)) || String(a.id).localeCompare(String(b.id)));
  }
  function status(row,lane,now) {
    if (finished(row,lane)) return {kind:'done',text:lane==='arrival'?'Checked in':'Checked out'};
    const time = scheduled(row,lane);
    if (!time) return {kind:'neutral',text:row.status_string || 'Time not provided'};
    if (time < now) return {kind:'past',text:'Past scheduled time'};
    const minutes = Math.ceil((time-now)/60000);
    if (minutes <= 60) return {kind:'soon',text:minutes===0?'Due now':`Due in ${minutes}m`};
    return {kind:'neutral',text:row.status_string || 'Expected'};
  }
  const helpers = {stamp,finished,scheduled,matches,sortRows,status,escape};
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined' || !document.getElementById('wbPage')) return;
  const $ = id => document.getElementById(id);
  const state = {data:null,user:null,epoch:0,request:0,loading:false,controller:null,lastAttempt:0,stale:false,focused:false};
  const time = value => value ? new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value)) : 'No time';
  const fullTime = value => value ? new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)) : 'Not provided';
  const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  function clock() {
    const now = new Date();
    $('wbDate').textContent = new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',month:'long',day:'numeric'}).format(now);
    $('wbClock').textContent = time(now.getTime());
  }
  function notice(text) {$('wbNotice').textContent=text; $('wbNotice').hidden=!text;$('wbNotice').classList.toggle('is-stale',Boolean(text));}
  function connection(text,kind='') {$('wbConnection').textContent=text;$('wbConnection').dataset.state=kind;}
  function controls() {$('wbRefresh').disabled=state.loading;$('wbPage').setAttribute('aria-busy',String(state.loading));}
  function empty(title,text) {
    $('wbEmptyTitle').textContent=title;$('wbEmptyText').textContent=text;
    $('wbEmpty').hidden=false;$('wbBoard').hidden=true;
    $('wbResults').textContent='';
  }
  function clearData() {
    state.data=null;state.stale=false;
    $('wbArrivals').innerHTML='';$('wbDepartures').innerHTML='';
    for(const id of ['wbArrivalCount','wbDepartureCount','wbSoonCount','wbArrivalsCount','wbDeparturesCount']) $(id).textContent='—';
    for(const id of ['wbArrivalNote','wbDepartureNote','wbSoonNote','wbUpdated']) if($(id)) $(id).textContent='';
    if($('wbDialog').open) $('wbDialog').close();
    $('wbDialogBody').innerHTML='';$('wbDialogTitle').textContent='Reservation details';
    $('wbService').innerHTML='<option value="">All services</option>';
  }
  function services() {
    const chosen=$('wbService').value, entries=new Map();
    for(const row of [...state.data.checking_in,...state.data.checking_out]) if(row.type_id) entries.set(String(row.type_id),row.type || 'Other service');
    $('wbService').innerHTML='<option value="">All services</option>'+[...entries].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,label])=>`<option value="${escape(id)}">${escape(label)}</option>`).join('');
    $('wbService').value=entries.has(chosen)?chosen:'';
  }
  function card(row,lane,now) {
    const s=status(row,lane,now), at=scheduled(row,lane), key=`${lane}:${row.id}`;
    const pet=row.a_first || 'Unnamed pet', owner=row.o_last || 'Owner not provided';
    const place=[row.area_name,row.run_name].filter(Boolean).join(' · ');
    const count=Number(row.belonging_count), belongings=Number.isSafeInteger(count)&&count>0?`${count} belonging${count===1?'':'s'}`:'';
    const when=at && dayKey(at)!==dayKey(now)?fullTime(at):time(at);
    return `<button type="button" class="wb-card wb-${lane}${s.kind==='past'?' is-past':''}${s.kind==='done'?' is-complete':''}" data-reservation="${escape(key)}" aria-label="Details for ${escape(pet)} ${escape(owner)}, ${lane}, ${escape(when)}">
      <span class="wb-card-top"><span class="wb-avatar" aria-hidden="true">${escape(Array.from(pet)[0]?.toUpperCase() || '•')}</span><span class="wb-pet"><span class="wb-pet-name">${escape(pet)}</span><span class="wb-owner">${escape(owner)}</span></span><span class="wb-time"><strong>${escape(when)}</strong><span>${lane==='arrival'?'Arrival':'Departure'}</span></span></span>
      <span class="wb-service">${escape(row.type || 'Service not provided')}</span>
      <span class="wb-card-meta"><span class="wb-status wb-status-${s.kind}">${escape(s.text)}</span>${place?`<span class="wb-place">${escape(place)}</span>`:''}${belongings?`<span class="wb-belongings">${escape(belongings)}</span>`:''}<span class="wb-detail-arrow" aria-hidden="true">↗</span></span>
    </button>`;
  }
  function render() {
    clock();if(!state.data)return;
    const now=Date.now(), query=$('wbSearch').value, service=$('wbService').value, completed=$('wbCompleted').checked;
    const focusKey=document.activeElement?.dataset?.reservation;
    const all=[...state.data.checking_in.map(row=>({row,lane:'arrival'})),...state.data.checking_out.map(row=>({row,lane:'departure'}))];
    const pending=all.filter(({row,lane})=>!finished(row,lane));
    const arrivals=pending.filter(item=>item.lane==='arrival').length, departures=pending.filter(item=>item.lane==='departure').length;
    $('wbArrivalCount').textContent=arrivals;$('wbDepartureCount').textContent=departures;
    $('wbSoonCount').textContent=pending.filter(({row,lane})=>{const t=scheduled(row,lane);return t!==null&&t>=now&&t<=now+3600000;}).length;
    $('wbArrivalNote').textContent=`${state.data.checking_in.length-arrivals} already checked in`;
    $('wbDepartureNote').textContent=`${state.data.checking_out.length-departures} already checked out`;
    $('wbSoonNote').textContent='Expected in the next 60 minutes';
    let shown=0;
    for(const [lane,key,id,countId] of [['arrival','checking_in','wbArrivals','wbArrivalsCount'],['departure','checking_out','wbDepartures','wbDeparturesCount']]) {
      const rows=sortRows(state.data[key].filter(row=>matches(row,query,service)&&(completed||!finished(row,lane))),lane);
      shown+=rows.length;$(countId).textContent=rows.length;
      $(id).innerHTML=rows.length?rows.map(row=>card(row,lane,now)).join(''):`<div class="wb-lane-empty"><span aria-hidden="true">✓</span><strong>${query||service?'No matches':`No ${completed?'':'pending '}${lane==='arrival'?'arrivals':'departures'}`}</strong><p>${query||service?'Try a different name or service.':completed?'Nothing scheduled in this view.':'You’re all caught up in this view.'}</p></div>`;
    }
    $('wbEmpty').hidden=true;$('wbBoard').hidden=false;
    $('wbResults').textContent=`${shown} ${shown===1?'reservation':'reservations'} shown · Scheduled time, earliest first${completed?' · Completed last':''}`;
    $('wbClear').hidden=!query&&!service&&!completed;
    if(focusKey) [...$('wbBoard').querySelectorAll('[data-reservation]')].find(el=>el.dataset.reservation===focusKey)?.focus({preventScroll:true});
    const updated=new Date(state.data.updated_at).getTime();
    $('wbUpdated').textContent=`${state.stale?'Last successful update':'Updated'} ${fullTime(Number.isFinite(updated)?updated:null)} ET · Refreshes every minute`;
  }
  function showDetails(key) {
    if(!state.data)return;
    const [lane,id]=key.split(':');const row=state.data[lane==='arrival'?'checking_in':'checking_out'].find(item=>String(item.id)===id);
    if(!row)return;
    $('wbDialogTitle').textContent=[row.a_first,row.o_last].filter(Boolean).join(' ') || 'Reservation details';
    const fields=[['Service',row.type],['Gingr status',row.status_string],['Scheduled arrival',fullTime(stamp(row.start_date))],['Scheduled departure',fullTime(stamp(row.end_date))],['Checked in',stamp(row.check_in_stamp)?fullTime(stamp(row.check_in_stamp)):'Not checked in'],['Checked out',stamp(row.check_out_stamp)?fullTime(stamp(row.check_out_stamp)):'Not checked out'],['Area',row.area_name],['Run',row.run_name],['Belongings',row.belonging_count??'Not provided'],['Belongings location',row.belonging_area],['Reservation',row.id]];
    $('wbDialogBody').innerHTML=`<p class="wb-dialog-note">Times shown in Eastern time. Reservation updates are made in Gingr.</p><dl class="wb-detail-grid">${fields.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value===null||value===undefined||value===''?'Not assigned':value)}</dd></div>`).join('')}</dl><a class="wb-button wb-primary" href="https://pawspet.gingrapp.com" target="_blank" rel="noopener noreferrer">Open Gingr <span aria-hidden="true">↗</span></a>`;
    $('wbDialog').showModal();$('wbDialogClose').focus();
  }
  async function refresh({automatic=false,replace=false}={}) {
    if(automatic&&(document.hidden||Date.now()-state.lastAttempt<10000))return;
    if(state.loading&&!replace)return;
    state.controller?.abort();const controller=new AbortController();state.controller=controller;
    const request=++state.request,epoch=state.epoch,current=()=>request===state.request&&epoch===state.epoch;
    state.loading=true;state.lastAttempt=Date.now();controls();connection('Updating','loading');
    if(replace) {clearData();empty('Loading your board','Getting the latest arrivals and departures from Gingr.');}
    const windowValue=$('wbWindow').value;
    const timeout=setTimeout(()=>controller.abort(),25000);
    try {
      if(typeof supabaseClient==='undefined')throw new Error('UNAVAILABLE');
      const {data,error}=await supabaseClient.auth.getSession();if(!current())return;
      const session=data?.session;
      if(error||!session?.user?.id||!session.access_token)throw new Error('AUTH_REQUIRED');
      if(state.user&&session.user.id!==state.user)throw new Error('AUTH_REQUIRED');
      state.user=session.user.id;
      const response=await fetch('https://dppjgglaeieevsfwsbii.supabase.co/functions/v1/hq-gingr-whiteboard',{
        method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify(windowValue==='today'?{full_day:true}:{mins_future:Number(windowValue)}),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'
      });
      if(!current())return;
      let payload;try{payload=await response.json();}catch{throw new Error('UNAVAILABLE');}
      if(!current())return;
      if(!response.ok)throw new Error(response.status===401?'AUTH_REQUIRED':response.status===403?'ACCESS_DENIED':payload?.error?.code||'UNAVAILABLE');
      if(!Array.isArray(payload?.checking_in)||!Array.isArray(payload?.checking_out)||!Number.isFinite(Date.parse(payload.updated_at)))throw new Error('UNAVAILABLE');
      if([...payload.checking_in,...payload.checking_out].some(row=>!row||typeof row!=='object'||!/^\d+$/.test(String(row.id))))throw new Error('UNAVAILABLE');
      state.data=payload;state.stale=false;services();render();notice('');connection('Live from Gingr','live');
    } catch(error) {
      if(!current())return;
      const code=error.message;
      if(['AUTH_REQUIRED','ACCESS_DENIED','CONNECTION_REQUIRED'].includes(code)) {
        clearData();notice('');
        if(code==='AUTH_REQUIRED') {empty('Sign in to view the whiteboard','Use your Paws HQ sign-in to see today’s reservations.');connection('Sign-in required');}
        else if(code==='ACCESS_DENIED') {empty('This account doesn’t have access','An approved Paws HQ account is required to view reservations.');connection('Access required');}
        else {empty('Connecting your Gingr account','The board is ready. Your Gingr connection needs to be finished before reservations can appear.');connection('Connection needed','error');}
      } else {
        state.stale=true;connection('Update unavailable','error');
        if(state.data) {notice(`Couldn’t refresh Gingr. These are saved results from ${fullTime(Date.parse(state.data.updated_at))} ET and may have changed. Try Refresh.`);render();}
        else {empty('Couldn’t load the whiteboard',code==='RATE_LIMITED'?'Gingr is busy. Wait a moment, then try Refresh.':'Check your connection and try Refresh.');notice('');}
      }
    } finally {clearTimeout(timeout);if(current()){state.loading=false;controls();}}
  }
  $('wbRefresh').addEventListener('click',()=>refresh());
  $('wbSearch').addEventListener('input',render);$('wbService').addEventListener('change',render);$('wbCompleted').addEventListener('change',render);
  $('wbWindow').addEventListener('change',()=>{notice('');void refresh({replace:true});});
  $('wbClear').addEventListener('click',()=>{$('wbSearch').value='';$('wbService').value='';$('wbCompleted').checked=false;render();$('wbSearch').focus();});
  $('wbBoard').addEventListener('click',event=>{const button=event.target.closest('[data-reservation]');if(button)showDetails(button.dataset.reservation);});
  $('wbDialogClose').addEventListener('click',()=>$('wbDialog').close());
  $('wbDialog').addEventListener('click',event=>{if(event.target===$('wbDialog')){const r=$('wbDialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('wbDialog').close();}});
  function focusView(value) {state.focused=value;document.body.classList.toggle('wb-focus',value);$('wbExpand').setAttribute('aria-pressed',String(value));$('wbExpand').textContent=value?'Exit focus view':'Focus view';}
  $('wbExpand').addEventListener('click',()=>focusView(!state.focused));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('wbDialog').open&&state.focused)focusView(false);});
  window.addEventListener('focus',()=>refresh({automatic:true}));window.addEventListener('online',()=>refresh({automatic:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh({automatic:true});});
  window.addEventListener('pagehide',()=>{state.request++;state.controller?.abort();clearData();});
  window.addEventListener('pageshow',event=>{if(event.persisted){state.loading=false;void refresh({replace:true});}});
  if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{
    const id=session?.user?.id||null;
    if(id!==state.user||event==='SIGNED_OUT') {
      state.epoch++;state.request++;state.controller?.abort();state.user=id;state.loading=false;state.lastAttempt=0;clearData();notice('');controls();
      empty(id?'Loading your board':'Sign in to view the whiteboard',id?'Getting the latest arrivals and departures from Gingr.':'Use your Paws HQ sign-in to see today’s reservations.');
      connection(id?'Connecting':'Sign-in required');
      if(id)setTimeout(()=>refresh(),0);
    }
  });
  clock();setInterval(()=>{clock();if(state.data&&!document.hidden)render();},30000);setInterval(()=>refresh({automatic:true}),60000);
  void refresh();
})();
