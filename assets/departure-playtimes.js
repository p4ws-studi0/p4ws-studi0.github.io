/* Paws HQ departures. Read-only Gingr schedules; shared staff-owned exceptions. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=value=>value?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(value)):'Time not provided';
const fullDate=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const easternDay=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
const state={view:null,userId:null,authReady:false,careFilter:'all',noteEditors:new Map(),noteSaving:false,pending:new Map(),loading:false,epoch:0,toast:0,loadError:''};
let identityEpoch=0,historyEpoch=0,skipPointerHeld=false,poll=null,loadingRetry=null;
const noteTimers=new Map();
const errors={AUTH:'Sign in to Paws HQ to view departure playtimes.',ACCESS:'Your workspace access could not be confirmed. Refresh Paws HQ and try again.',AUTH_CHANGED:'Your signed-in account changed. Refresh before continuing.',REVISION_CONFLICT:'A teammate already changed this playtime. The latest status is shown.',SCHEDULE_CONFLICT:'The schedule changed. The latest playtimes are shown; try again on the updated row.',UNKNOWN_SERVICE:'This item is no longer on today’s schedule.',STALE_SOURCE:'The schedule is out of date. Changes are paused until it refreshes.',SOURCE_UNAVAILABLE:'Schedule sync is unavailable. Changes are paused until it reconnects.',SOURCE_INCOMPLETE:'Gingr did not return the complete schedule. Changes are paused.',SOURCE_LOADING:'Loading today’s schedule…',REQUEST_ID_CONFLICT:'That request could not be repeated. Refresh and try again.',NOTE_REVISION_CONFLICT:'Someone updated this note. Your text is kept. Choose “Use latest” to load their saved note.'};
const knownCodes=Object.keys(errors);
function failure(error){
  const symbolic=knownCodes.find(code=>error?.message===code)||[...knownCodes].sort((a,b)=>b.length-a.length).find(code=>String(error?.message||'').includes(code));
  const code=symbolic||(['42501'].includes(error?.code)?'ACCESS':['PGRST301','PGRST302','401'].includes(String(error?.code))?'AUTH':null);
  return Object.assign(new Error(errors[code]||'Couldn’t connect. Your last saved changes and note drafts are kept.'),code?{code}:{});
}
function controls(){
  $('refresh').disabled=state.loading||state.pending.size>0;
  $('historyOpen').disabled=!state.authReady;
}
function toast(message){clearTimeout(state.toast);$('toast').textContent=message;$('toast').hidden=false;state.toast=setTimeout(()=>{$('toast').hidden=true;},5000);}
function setNotice(message){$('notice').hidden=!message;$('notice').textContent=message;}
function resetIdentity(userId,{force=false}={}){
  if(!force&&userId===state.userId)return;
  ++identityEpoch;++state.epoch;++historyEpoch;state.userId=userId;state.authReady=false;state.view=null;state.loading=false;state.noteSaving=false;state.pending=new Map();state.noteEditors.clear();state.loadError='';
  for(const timer of noteTimers.values())clearTimeout(timer);noteTimers.clear();clearTimeout(state.toast);$('toast').hidden=true;$('toast').textContent='';
  clearTimeout(loadingRetry);loadingRetry=null;
  $('historyDialog').close();$('historyList').innerHTML='';$('previousDraftList').innerHTML='';$('previousDrafts').hidden=true;$('search').value='';state.careFilter='all';closeCareFilter();renderLoading();controls();
}
async function requireStaff(){
  const auth=identityEpoch;if(typeof supabaseClient==='undefined')throw failure({message:'AUTH'});
  const sessionResult=await supabaseClient.auth.getSession();if(auth!==identityEpoch)throw failure({message:'AUTH_CHANGED'});
  const session=sessionResult.data?.session,id=session?.user?.id;if(sessionResult.error||!id)throw failure({message:'AUTH'});
  if(state.userId&&state.userId!==id){resetIdentity(id);setTimeout(()=>void refresh({quiet:true}),0);throw failure({message:'AUTH_CHANGED'});}
  if(!state.userId)state.userId=id;
  if(typeof ensureHqWorkspaceAccess==='function')await ensureHqWorkspaceAccess(session);
  if(auth!==identityEpoch)throw failure({message:'AUTH_CHANGED'});
  const approved=await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',id).eq('active',true).maybeSingle();
  if(auth!==identityEpoch)throw failure({message:'AUTH_CHANGED'});
  if(approved.error)throw failure(approved.error);if(!approved.data)throw failure({message:'ACCESS'});
  state.authReady=true;return {auth,id};
}
async function rpc(name,args,auth){
  const result=await supabaseClient.rpc(name,args);if(auth!==identityEpoch)throw failure({message:'AUTH_CHANGED'});
  if(result.error)throw failure(result.error);return result.data;
}
function hydrate(payload){
  if(!payload?.source)throw failure({message:payload?.refreshing?'SOURCE_LOADING':'SOURCE_UNAVAILABLE'});
  const view=JSON.parse(JSON.stringify(payload.source));
  if(view.businessDate!==easternDay()||!Array.isArray(view.departures))throw failure({message:'SOURCE_UNAVAILABLE'});
  const states=new Map((payload.states||[]).map(row=>[row.key,row])),notes=new Map((payload.notes||[]).map(row=>[row.key,row]));
  const noteFor=(target,key)=>Object.assign(target,{note:'',noteRevision:0,noteUpdatedBy:null,noteUpdatedAt:null},notes.get(key)||{});
  for(const pet of view.departures){
    noteFor(pet,pet.noteKey);
    for(const service of pet.services){
      Object.assign(service,{skipped:false,revision:0,skippedBy:null,skippedAt:null},states.get(service.key)||{});
      service.verified=false;service.status=service.skipped?'Skipped':'On today’s plan';noteFor(service,service.key);
    }
  }
  view.stale=payload.stale===true;view.sourceAgeSeconds=payload.sourceAgeSeconds;
  view.summary={...(view.summary||{}),departures:view.departures.length,playtimes:view.departures.reduce((sum,pet)=>sum+pet.services.length,0),skipped:view.departures.reduce((sum,pet)=>sum+pet.services.filter(service=>service.skipped).length,0)};
  return view;
}
async function readDay(auth,{refreshSource=true}={}){
  let payload=await rpc('hq_departure_playtimes_day',{p_location_id:'1'},auth);
  if(refreshSource&&payload?.refreshDue){
    try{
      const refreshed=await supabaseClient.functions.invoke('hq-departure-playtimes',{body:{action:'refresh'}});
      if(auth!==identityEpoch)throw failure({message:'AUTH_CHANGED'});
      if(refreshed.error||refreshed.data?.error)throw failure(refreshed.data?.error||refreshed.error);
    }catch(error){if(auth!==identityEpoch)throw failure({message:'AUTH_CHANGED'});/* The trusted source error is read below; no fixture or client timestamp substitutes. */}
    payload=await rpc('hq_departure_playtimes_day',{p_location_id:'1'},auth);
  }
  return hydrate(payload);
}
function mergeAcknowledgement(view,service){
  if(!view||view.businessDate!==easternDay())throw failure({message:'SOURCE_UNAVAILABLE'});
  const copy=JSON.parse(JSON.stringify(view));
  const target=copy.departures.flatMap(pet=>[...pet.services,...(pet.noteKey?[{...pet,key:pet.noteKey,__pet:pet}]:[])]).find(item=>item.key===service.key);
  if(target){
    const revision='noteRevision' in service?'noteRevision':'revision';
    if((service[revision]||0)>=(target[revision]||0))Object.assign(target.__pet||target,service);
  }
  copy.stale=true;copy.summary.skipped=copy.departures.reduce((sum,pet)=>sum+pet.services.filter(item=>item.skipped).length,0);return copy;
}
async function api(path,{body}={}){
  const identity=identityEpoch;
  try{
    const {auth}=await requireStaff();
    if(path==='/api/day')return {view:await readDay(auth,{refreshSource:body?.refreshSource!==false})};
    if(path==='/api/history')return {events:await rpc('hq_departure_playtimes_history',{p_location_id:'1',p_limit:60},auth)};
    let result;
    if(path==='/api/skip')result=await rpc('hq_departure_playtimes_set_skip',{p_request_id:body.requestId,p_key:body.key,p_skipped:body.skipped,p_expected_revision:body.expectedRevision,p_source_version:body.expectedScheduleVersion},auth);
    else if(path==='/api/note')result=await rpc('hq_departure_playtimes_save_note',{p_request_id:body.requestId,p_key:body.key,p_note:body.note,p_expected_revision:body.expectedNoteRevision},auth);
    else throw new Error('Unsupported departure action.');
    let view;try{view=await readDay(auth,{refreshSource:false});}catch(error){if(auth!==identityEpoch||['AUTH','ACCESS','AUTH_CHANGED'].includes(error.code))throw error;view=mergeAcknowledgement(state.view,result.service);}
    return {...result,view};
  }catch(error){
    if(identity===identityEpoch&&['AUTH','ACCESS'].includes(error.code)){resetIdentity(state.userId,{force:true});state.loadError=error.message;render();}
    throw error;
  }
}
function acceptView(payload){state.view=payload.view;controls();}
const noteScope=key=>`${state.userId||''}:${state.view?.businessDate||easternDay()}:${key}`;
function expireDay(){
  if(!state.view||state.view.businessDate===easternDay())return;
  ++state.epoch;state.view=null;state.loading=false;state.noteSaving=false;state.pending=new Map();
  for(const timer of noteTimers.values())clearTimeout(timer);noteTimers.clear();
  clearTimeout(loadingRetry);loadingRetry=null;
  for(const [scope,editor] of state.noteEditors)if(editor.draft.replace(/\r\n?/g,'\n').trim()===editor.original)state.noteEditors.delete(scope);
  $('historyDialog').close();$('historyList').innerHTML='';++historyEpoch;
  renderLoading();renderRecovery();
}
function renderLoading(){
  $('allBadge').textContent='—';$('dayLabel').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric'}).format(new Date());
  $('skippedNotice').hidden=true;setNotice(state.loadError);
  $('departures').innerHTML=state.loadError?'<div class="empty"><h2>Today’s schedule is unavailable</h2><p>Your saved changes are kept. Press Refresh to try again.</p></div>':'<div class="empty"><span class="loading-dot"></span><p>Loading today’s departures…</p></div>';
  $('departures').setAttribute('aria-busy',String(!state.loadError));$('syncStatus').textContent=state.loadError?'Updates paused':'Loading today’s schedule…';
}
function renderRecovery(){
  const drafts=state.authReady?[...state.noteEditors].filter(([,editor])=>editor.userId===state.userId&&editor.businessDate!==easternDay()&&editor.draft.replace(/\r\n?/g,'\n').trim()!==editor.original):[];
  $('previousDrafts').hidden=!drafts.length;$('previousDraftList').innerHTML=drafts.map(([scope,editor])=>`<div class="previous-draft"><label>${escape(editor.businessDate)} · ${escape(editor.petName)} — ${escape(editor.serviceName)}</label><textarea readonly aria-label="Earlier note draft">${escape(editor.draft)}</textarea><button type="button" data-dismiss-draft="${escape(scope)}">Dismiss draft</button></div>`).join('');
}
const petNote=pet=>({...pet,key:pet.noteKey,serviceName:'Departure note'});
const serviceFor=key=>state.view?.departures.flatMap(pet=>[...pet.services,...(pet.noteKey?[petNote(pet)]:[])]).find(service=>service.key===key);
const focusedNote=()=>document.activeElement?.dataset?.noteInput;
function noteEditor(service,petName){
  const editor=state.noteEditors.get(noteScope(service.key)),pending=state.pending.has(service.key)&&state.noteSaving;
  const value=editor?editor.draft:service.note||'',dirty=editor&&value.replace(/\r\n?/g,'\n').trim()!==editor.original;
  const message=pending?'Saving…':editor?.error?'Not saved':dirty?'Not saved yet':service.noteRevision?'Saved':'Saves automatically';
  return `<div class="note-editor${editor?.error?' has-error':''}" role="group" aria-label="Note for ${escape(petName)} — ${escape(service.serviceName)}"><textarea class="note-input" data-note-input="${escape(service.key)}" rows="1" maxlength="1000" aria-label="Notes for ${escape(petName)} — ${escape(service.serviceName)}" placeholder="Add a note…" ${!state.authReady||state.view.stale?'readonly':''}>${escape(value)}</textarea><div class="note-feedback"><small class="note-meta" data-note-state="${escape(service.key)}" aria-live="polite"${service.noteUpdatedBy?` title="${escape(service.noteUpdatedBy.name)} · ${escape(fullDate(service.noteUpdatedAt))}"`:''}>${message}</small>${editor?.error?`<div class="note-recovery"><button type="button" data-note-save="${escape(service.key)}" ${!state.authReady||state.pending.size||state.view.stale?'disabled':''}>Retry</button><button type="button" data-note-cancel="${escape(service.key)}" ${pending?'disabled':''}>Use latest</button></div>`:''}</div>${editor?.error?`<p class="note-error" role="alert">${escape(editor.error)}</p>`:''}</div>`;
}
function sizeNote(input){if(input.style){input.style.height='auto';input.style.height=`${Math.min(160,Math.max(44,input.scrollHeight+2))}px`;}}
function focusNote(key,selection){
  const input=[...$('departures').querySelectorAll('textarea[data-note-input]')].find(node=>node.dataset.noteInput===key);
  if(input&&!input.disabled){input.focus({preventScroll:true});if(selection&&typeof input.setSelectionRange==='function')input.setSelectionRange(selection.start,selection.end);}
}
function ensureNote(key){
  const service=serviceFor(key);if(!service||!state.authReady)return;
  const scope=noteScope(key),pet=state.view.departures.find(row=>row.noteKey===key||row.services.some(item=>item.key===key));
  if(!state.noteEditors.has(scope))state.noteEditors.set(scope,{draft:service.note||'',original:service.note||'',revision:service.noteRevision||0,error:'',userId:state.userId,businessDate:state.view.businessDate,petName:pet?.dogName||'Pet',serviceName:service.serviceName});
  return state.noteEditors.get(scope);
}
function openNote(key){if(ensureNote(key))focusNote(key);}
function queueNote(key,delay=800,scope=noteScope(key)){
  clearTimeout(noteTimers.get(scope));noteTimers.set(scope,setTimeout(()=>{noteTimers.delete(scope);if(scope===noteScope(key)&&!state.noteEditors.get(scope)?.error)void saveNote(key);},delay));
}
function cancelNote(key){if(state.pending.has(key))return;const scope=noteScope(key);clearTimeout(noteTimers.get(scope));noteTimers.delete(scope);state.noteEditors.delete(scope);render();}
async function saveNote(key){
  const scope=noteScope(key),editor=state.noteEditors.get(scope),service=serviceFor(key);
  if(!editor||!service||!state.authReady||state.view.stale)return;
  if(state.pending.size||state.noteSaving||skipPointerHeld){queueNote(key);return;}
  clearTimeout(noteTimers.get(scope));noteTimers.delete(scope);
  const note=editor.draft.replace(/\r\n?/g,'\n').trim();
  if(note.length>1000){editor.error='Keep notes under 1,000 characters.';render();return;}
  if(note===editor.original){cancelNote(key);return;}
  const command={key,note,expectedNoteRevision:editor.revision,requestId:crypto.randomUUID()};
  const epoch=++state.epoch,auth=identityEpoch,token={};state.loading=false;state.noteSaving=true;state.pending.set(key,token);editor.error='';render();
  const current=()=>epoch===state.epoch&&auth===identityEpoch;
  try{
    let payload;try{payload=await api('/api/note',{body:command});}catch(failure){if(failure.code)throw failure;payload=await api('/api/note',{body:command});}
    if(current()){
      acceptView(payload);
      if(state.noteEditors.get(scope)===editor){
        if(editor.draft.replace(/\r\n?/g,'\n').trim()===note)state.noteEditors.delete(scope);
        else{editor.original=note;editor.revision=payload.service.noteRevision;queueNote(key,0,scope);}
      }
    }
  }catch(failure){if(current()){editor.error=failure.message;toast(editor.error);}}
  finally{if(auth===identityEpoch&&state.pending.get(key)===token){state.pending.delete(key);state.noteSaving=false;render();await refresh({quiet:true,allowWhileEditing:true});}}
}
const careLabels={all:'All types',tlc:'TLC',puppy:'Puppy',bronze:'Bronze',silver:'Silver',gold:'Gold'};
function careTypes(services){
  const names=services.map(service=>service.serviceName).join(' ');
  const categories=['puppy','bronze','silver','gold'].filter(category=>new RegExp(`\\b${category}\\b`,'i').test(names));
  return categories.length?categories:['tlc'];
}
function careBadges(services){
  return careTypes(services).map(category=>`<span class="care-badge" title="${category==='tlc'?'TLC care':careLabels[category]+' activity package'}"><img src="/assets/departure-playtimes/${category}.svg" alt="${careLabels[category]}" width="34" height="34"></span>`).join('');
}
function closeCareFilter(){ $('careFilterMenu').hidden=true;$('careFilterToggle').setAttribute('aria-expanded','false'); }
function render(){
  expireDay();controls();renderRecovery();
  const view=state.view;if(!view){renderLoading();return;}
  const activeNoteKey=focusedNote(),selection=activeNoteKey?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
  const {summary}=view,query=$('search').value.trim().toLocaleLowerCase();
  $('dayLabel').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric'}).format(new Date(`${view.businessDate}T17:00:00Z`));
  const total=summary.departures??summary.pets??summary.dogs;
  $('careFilterLabel').textContent=state.careFilter==='all'?'Filter by':`Filter by: ${careLabels[state.careFilter]}`;
  $('careFilterToggle').classList.toggle('is-filtered',state.careFilter!=='all');
  for(const category of Object.keys(careLabels))$(`careFilter${category[0].toUpperCase()+category.slice(1)}`).setAttribute('aria-checked',String(category===state.careFilter));
  $('skippedNotice').hidden=!summary.skipped;
  $('skippedNoticeText').textContent=summary.skipped===1?'1 playtime marked skipped today':`${summary.skipped} playtimes marked skipped today`;
  setNotice(view.stale?'Schedule sync is unavailable or out of date. Showing the last saved schedule. Changes are paused until it reconnects.':'');
  const clock='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>';
  const departures=view.departures.filter(d=>state.careFilter==='all'||careTypes(d.services).includes(state.careFilter)).filter(d=>!query||`${d.dogName} ${d.ownerLast} ${d.services.map(s=>s.serviceName).join(' ')}`.toLocaleLowerCase().includes(query));
  $('allBadge').textContent=query||state.careFilter!=='all'?`${departures.length} / ${total}`:total;
  const focused=document.activeElement?.dataset?.key;
  $('departures').innerHTML=departures.length?departures.map(d=>`<article class="departure${d.services.some(s=>s.skipped)?' has-skipped':''}" aria-label="${escape(d.dogName)} departure"><div class="pet"><div class="care-badges">${careBadges(d.services)}</div><div class="pet-details"><h2 class="pet-name">${escape(d.dogName)} <span class="pet-owner">${escape(d.ownerLast)}</span></h2><div class="departure-time">${clock}<span>Leaving at ${escape(time(d.departureAt))}</span>${d.checkedOutAt?'<span class="departed">Checked out</span>':''}</div></div></div><div class="services">${d.services.length?d.services.map(s=>`<div class="service${s.skipped?' is-skipped':''}" data-service-key="${escape(s.key)}"><div class="service-main"><div class="service-copy"><p class="service-name">${escape(s.serviceName)}${s.quantity>1?` ×${escape(s.quantity)}`:''}</p></div><div class="service-status"><span class="status" title="${s.skipped?'Marked as skipped':'Scheduled, not independently verified'}">${s.skipped?'Skipped':'On today’s plan'}</span></div></div><div class="service-action"><button type="button" class="skip-button" data-key="${escape(s.key)}" ${!state.authReady||state.noteSaving||state.pending.has(s.key)||view.stale?'disabled':''} aria-label="${s.skipped?'Undo skip':'Mark as skipped'}: ${escape(d.dogName)} — ${escape(s.serviceName)}">${state.pending.has(s.key)?'Saving…':s.skipped?'Undo Skip':'Mark as Skipped'}</button></div>${noteEditor(s,d.dogName)}</div>`).join(''):`<div class="no-services">No additional playtimes listed</div>${d.noteKey?noteEditor(petNote(d),d.dogName):''}`}</div></article>`).join(''):`<div class="empty"><h2>${query||state.careFilter!=='all'?'No matching pets':'No boarding departures today'}</h2><p>${query||state.careFilter!=='all'?'Try another filter or pet name.':'Pets will appear automatically when the schedule updates.'}</p></div>`;
  $('departures').querySelectorAll('textarea[data-note-input]').forEach(sizeNote);
  if(activeNoteKey)focusNote(activeNoteKey,selection);
  if(focused){const button=[...$('departures').querySelectorAll('button[data-key]')].find(b=>b.dataset.key===focused);if(button&&!button.disabled)button.focus({preventScroll:true});}
  $('departures').setAttribute('aria-busy','false');
  $('syncStatus').textContent=view.stale?'Updates paused':'Schedule up to date';
}
async function refresh({quiet=false,allowWhileEditing=false,refreshSource=true,loadingAttempt=0}={}){
  expireDay();
  if(state.loading||state.pending.size||skipPointerHeld||focusedNote()&&!allowWhileEditing)return;
  const epoch=++state.epoch,auth=identityEpoch;state.loading=true;controls();
  const current=()=>epoch===state.epoch&&auth===identityEpoch;
  try{const payload=await api('/api/day',{body:{refreshSource}});if(!current())return;acceptView(payload);state.loadError='';clearTimeout(loadingRetry);loadingRetry=null;render();}
  catch(failure){
    if(!current())return;
    if(['AUTH','ACCESS'].includes(failure.code)){resetIdentity(state.userId,{force:true});state.loadError=failure.message;render();return;}
    if(state.view&&state.view.businessDate===easternDay())state.view={...state.view,stale:true};else state.view=null;
    state.loadError=failure.code==='SOURCE_LOADING'?'':failure.message;render();if(!quiet&&failure.code!=='SOURCE_LOADING')toast(failure.message);
    if(failure.code==='SOURCE_LOADING'&&loadingAttempt<4){clearTimeout(loadingRetry);loadingRetry=setTimeout(()=>{loadingRetry=null;if(current())void refresh({quiet:true,allowWhileEditing:true,refreshSource:false,loadingAttempt:loadingAttempt+1});},1200);}
  }finally{if(current()){state.loading=false;controls();}}
}
async function changeSkip(key){
  const service=state.view?.departures.flatMap(pet=>pet.services).find(item=>item.key===key);
  if(!state.authReady||state.noteSaving||!service||state.view.stale||state.pending.has(key))return;
  const command={key,skipped:!service.skipped,expectedRevision:service.revision,expectedScheduleVersion:state.view.scheduleVersion,requestId:crypto.randomUUID()};
  const epoch=++state.epoch,auth=identityEpoch,token={};state.loading=false;state.pending.set(key,token);render();
  const current=()=>epoch===state.epoch&&auth===identityEpoch;
  try{
    let payload;try{payload=await api('/api/skip',{body:command});}catch(failure){if(failure.code)throw failure;payload=await api('/api/skip',{body:command});}
    if(current()){acceptView(payload);toast(command.skipped?'Playtime marked as skipped.':'Skip undone. It’s back on today’s plan.');}
  }catch(failure){if(current())toast(failure.message);}
  finally{if(auth===identityEpoch&&state.pending.get(key)===token){state.pending.delete(key);render();await refresh({quiet:true});}}
}
$('careFilterToggle').addEventListener('click',()=>{const opening=$('careFilterMenu').hidden;$('careFilterMenu').hidden=!opening;$('careFilterToggle').setAttribute('aria-expanded',String(opening));});
for(const category of Object.keys(careLabels))$(`careFilter${category[0].toUpperCase()+category.slice(1)}`).addEventListener('click',()=>{state.careFilter=category;closeCareFilter();render();});
document.addEventListener('click',event=>{if(!event.target.closest('.type-filter'))closeCareFilter();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('careFilterMenu').hidden){closeCareFilter();$('careFilterToggle').focus();}});
$('departures').addEventListener('click',event=>{
  const save=event.target.closest('button[data-note-save]');if(save){void saveNote(save.dataset.noteSave);return;}
  const cancel=event.target.closest('button[data-note-cancel]');if(cancel){cancelNote(cancel.dataset.noteCancel);return;}
  const button=event.target.closest('button[data-key]');if(button){skipPointerHeld=false;void changeSkip(button.dataset.key);}
});
$('departures').addEventListener('pointerdown',event=>{if(event.target.closest('button[data-key]'))skipPointerHeld=true;});
document.addEventListener('pointerup',()=>{skipPointerHeld=false;});
document.addEventListener('pointercancel',()=>{skipPointerHeld=false;});
window.addEventListener('blur',()=>{skipPointerHeld=false;});
$('departures').addEventListener('focusin',event=>{
  const input=event.target.closest('textarea[data-note-input]');if(input)ensureNote(input.dataset.noteInput);
});
$('departures').addEventListener('input',event=>{
  const input=event.target.closest('textarea[data-note-input]');if(!input)return;
  const key=input.dataset.noteInput,editor=ensureNote(key);if(!editor)return;
  editor.draft=input.value;editor.error='';
  const feedback=[...$('departures').querySelectorAll('[data-note-state]')].find(node=>node.dataset.noteState===key);
  if(feedback)feedback.textContent=state.pending.has(key)&&state.noteSaving?'Saving…':'Not saved yet';
  sizeNote(input);queueNote(key);
});
$('departures').addEventListener('focusout',event=>{
  const input=event.target.closest('textarea[data-note-input]');if(!input)return;
  // Let the clicked control act first, then serialize the note with other writes.
  queueNote(input.dataset.noteInput,0);
});
window.addEventListener('resize',()=>$('departures').querySelectorAll('textarea[data-note-input]').forEach(sizeNote));
$('search').addEventListener('input',render);$('refresh').addEventListener('click',()=>refresh({allowWhileEditing:true}));

async function openHistory(){
  if(!state.authReady)return;
  const epoch=++historyEpoch,auth=identityEpoch;const current=()=>epoch===historyEpoch&&auth===identityEpoch&&$('historyDialog').open;
  $('historyDialog').showModal();$('historyList').innerHTML='<li>Loading changes…</li>';
  try{const {events}=await api('/api/history');if(!current())return;$('historyList').innerHTML=events.length?events.map(event=>`<li><span aria-hidden="true">${event.action==='skip'?'−':event.action==='note'?'✎':'↶'}</span><div><strong>${escape(event.dogName)}</strong> · ${escape(event.serviceName)}<br>${event.action==='note'?(event.note?'Note updated':'Note cleared'):event.action==='skip'?'Marked as skipped':'Skip undone — back on today’s plan'}${event.action==='note'&&event.note?`<p class="audit-note">${escape(event.note)}</p>`:''}<small>${escape(event.actor.name)} · ${escape(fullDate(event.occurredAt))} Eastern</small></div></li>`).join(''):'<li>No changes yet.</li>';}catch(error){if(current())$('historyList').textContent=error.message;}
}
function init(){
  $('historyOpen').addEventListener('click',openHistory);$('historyClose').addEventListener('click',()=>$('historyDialog').close());
  $('historyDialog').addEventListener('click',event=>{if(event.target===$('historyDialog')){const r=$('historyDialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('historyDialog').close();}});
  $('previousDraftList').addEventListener('click',event=>{const button=event.target.closest('[data-dismiss-draft]');if(button){state.noteEditors.delete(button.dataset.dismissDraft);renderRecovery();}});
  if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((_event,session)=>{const id=session?.user?.id||null;if(id!==state.userId)resetIdentity(id);if(id)setTimeout(()=>void refresh({quiet:true}),0);});
  window.addEventListener('paws-access-revoked',()=>resetIdentity(state.userId,{force:true}));
  window.addEventListener('paws-access-restored',()=>void refresh({quiet:true}));
  window.addEventListener('focus',()=>void refresh({quiet:true,allowWhileEditing:true}));window.addEventListener('online',()=>void refresh({quiet:true,allowWhileEditing:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh({quiet:true,allowWhileEditing:true});});
  window.addEventListener('beforeunload',event=>{if([...state.noteEditors.values()].some(editor=>editor.draft.replace(/\r\n?/g,'\n').trim()!==editor.original)){event.preventDefault();event.returnValue='';}});
  const startPolling=()=>{if(poll===null)poll=setInterval(()=>{if(!document.hidden&&!$('historyDialog').open)void refresh({quiet:true,allowWhileEditing:true});},30000);};
  window.addEventListener('pagehide',()=>{++state.epoch;++identityEpoch;clearInterval(poll);poll=null;clearTimeout(state.toast);clearTimeout(loadingRetry);loadingRetry=null;for(const timer of noteTimers.values())clearTimeout(timer);});
  window.addEventListener('pageshow',event=>{if(event.persisted){state.view=null;state.authReady=false;state.loading=false;state.pending=new Map();state.noteSaving=false;$('historyDialog').close();$('historyList').innerHTML='';renderLoading();renderRecovery();startPolling();void refresh({quiet:true,allowWhileEditing:true});}});
  startPolling();
  void refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
