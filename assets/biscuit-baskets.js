/* Paws HQ biscuit baskets: one location directory and compact, reversible visit histories. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const TYPES={
    location:{table:'hq_biscuit_locations',fields:[['location_name','Location name',500],['town','Town',200],['status','Status',20],['status_notes','Status notes',20000]]},
    visit:{table:'hq_biscuit_visits',fields:[['visited_on','Date',120],['items_given','Items given',20000],['spoke_to','Spoke to',500],['town','Town',200],['notes','Notes',20000]]}
  };
  const STATUS={active:'Active',closed:'Closed',do_not_visit:'Not returning'};
  const state={locations:[],visits:[],editors:new Map(),ready:false,loading:false,userId:null,epoch:0,request:0,expanded:null,dialogEditor:null,openingLocation:false,query:'',town:'',status:'',undo:null,undoSaving:false,toastTimer:null,newOrder:0};
  const text=value=>String(value??'');
  const escape=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nonblank=value=>text(value).trim().length>0;
  const normalized=value=>text(value).replace(/\r\n?/g,'\n');
  const current=epoch=>epoch===state.epoch;
  const fields=editor=>TYPES[editor.kind].fields;
  const keys=editor=>fields(editor).map(([key])=>key);
  const valuesOf=(row,kind='visit')=>Object.fromEntries(TYPES[kind].fields.map(([key])=>[key,text(row?.[key])]));
  const keyOf=(kind,id)=>`${kind}:${id}`;
  const editorMapKey=editor=>keyOf(editor.kind,editor.id);
  const collection=kind=>state[kind==='location'?'locations':'visits'];
  const same=(a,b)=>Object.keys(a).every(key=>a[key]===b[key]);
  const position=row=>BigInt(row.position??0);
  const sourceOrder=(a,b)=>position(a)<position(b)?-1:position(a)>position(b)?1:text(a.id).localeCompare(text(b.id));
  function visitDate(value,sourceYear=null) {
    const iso=text(value).match(/^\s*(\d{4})-(\d{2})-(\d{2})(?=$|[^\d/.\-])/);
    const us=text(value).match(/^\s*(\d{1,2})([/.\-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?=$|[^\d/.\-])/);
    if(!iso&&!us)return null;
    const month=Number(iso?iso[2]:us[1]),day=Number(iso?iso[3]:us[3]);
    const context=Number.isInteger(sourceYear)&&sourceYear>=1900&&sourceYear<=2100?sourceYear:null;
    const year=iso?Number(iso[1]):us[4]?(us[4].length===2?2000+Number(us[4]):Number(us[4])):context;
    if(year===null||year<1000||month<1||month>12||day<1||day>31)return null;
    const stamp=Date.UTC(year,month-1,day),date=new Date(stamp);
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?stamp:null;
  }
  const rowDate=row=>visitDate(row.visited_on,row.visited_on===row.source_values?.[0]?row.source_year:null);
  function dateOrder(a,b) {
    const aDate=rowDate(a),bDate=rowDate(b);
    if(aDate!==null&&bDate!==null)return bDate-aDate||-sourceOrder(a,b);
    if(aDate!==null)return -1;if(bDate!==null)return 1;
    return -sourceOrder(a,b);
  }
  function sortVisits(rows) {
    const imports=rows.filter(row=>row.source_file);
    const unknown=imports.some(row=>rowDate(row)===null);
    if(!unknown)return [...rows].sort(dateOrder);
    const added=rows.filter(row=>!row.source_file).sort(dateOrder);
    imports.sort((a,b)=>Number(b.source_column??0)-Number(a.source_column??0)||-sourceOrder(a,b));
    return [...added,...imports];
  }
  function sortLocations(rows) {return [...rows].sort((a,b)=>text(a.location_name).trim().localeCompare(text(b.location_name).trim(),undefined,{sensitivity:'base'})||sourceOrder(a,b));}
  const today=()=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'numeric',day:'numeric',year:'numeric'}).format(new Date());
  function dirty(editor) {return !editor.base||!same(editor.values,valuesOf(editor.base,editor.kind));}
  const unfinished=()=>state.undoSaving||[...state.editors.values()].some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error);
  const tableFocused=()=>Boolean(document.activeElement?.closest?.('#visitRows'));
  const dialogOpen=()=>Boolean($('locationDialog')?.open);
  function errorText(error) {
    if(error?.code==='AUTH')return 'Sign in again to save. Your changes are still here.';
    if(error?.code==='ACCESS'||error?.code==='42501')return 'This account cannot change this record. Check that the location is still available and your Paws HQ access is active.';
    if(error?.code==='CONFLICT')return 'This record changed on another device. Your changes are still here. Copy them before reloading.';
    if(['42P01','PGRST205'].includes(error?.code))return 'Biscuit basket records are unavailable. Please try again later.';
    return 'Could not save. Your changes are still here. Check your connection, then retry.';
  }
  function message(value,error=false) {$('pageMessage').textContent=value;$('pageMessage').hidden=!value;$('pageMessage').classList.toggle('is-error',error);}
  function toast(value,undo=null) {
    clearTimeout(state.toastTimer);state.undo=undo;
    $('toastText').textContent=value;$('undoDelete').hidden=!undo;$('toast').hidden=false;
    state.toastTimer=setTimeout(()=>{$('toast').hidden=true;},5000);controls();
  }
  function editorFor(row,kind='visit') {
    const key=keyOf(kind,row.id);let editor=state.editors.get(key);
    if(!editor){editor={id:row.id,kind,locationId:row.location_id,base:{...row},values:valuesOf(row,kind),touched:true,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(key,editor);}
    return editor;
  }
  function rowElement(editor) {return document.querySelector(`[data-${editor.kind==='visit'?'row':'location'}-id="${editor.id}"]`);}
  const parentBusy=id=>{const editor=state.editors.get(keyOf('location',id));return Boolean(editor?.saving||editor?.deleting||editor?.deleteAttempt);};
  const pendingLocation=()=>[...state.editors.values()].find(editor=>editor.kind==='location'&&!editor.base);
  function controls() {
    const blocked=!state.ready||state.loading,editors=[...state.editors.values()];
    $('addLocation').disabled=blocked||state.undoSaving||state.openingLocation||dialogOpen();$('addLocation').textContent=pendingLocation()?'Resume location':'Add location';
    $('refreshLogs').disabled=state.loading||state.undoSaving;
    for(const id of ['searchLocations','townFilter','statusFilter'])$(id).disabled=blocked;
    document.querySelectorAll('[data-control]').forEach(button=>{button.disabled=blocked||state.undoSaving||parentBusy(button.dataset.id);});
    document.querySelectorAll('[data-restore-row]').forEach(button=>{const visit=button.dataset.kind==='visit'?state.visits.find(row=>row.id===button.dataset.restoreRow):null;button.disabled=blocked||state.undoSaving||Boolean(visit&&parentBusy(visit.location_id));});$('undoDelete').disabled=blocked||state.undoSaving||Boolean(state.undo?.kind==='visit'&&parentBusy(state.undo.row.location_id));
    $('saveStatus').textContent=state.loading?'Loading…':editors.some(e=>e.saving||e.deleting)||state.undoSaving?'Saving…':editors.some(e=>e.error)?'Some changes are not saved':editors.some(e=>dirty(e))?'Unsaved changes':state.ready?'All changes saved':'';
    for(const editor of editors)updateRowStatus(editor);
    const formEditor=state.dialogEditor;
    $('saveLocation').disabled=blocked||state.undoSaving||Boolean(formEditor?.saving||formEditor?.deleting||formEditor?.conflict);
    $('closeLocationDialog').disabled=Boolean(formEditor?.saving||formEditor?.deleting);
    $('reloadLocation').hidden=!formEditor?.conflict;
    $('reloadLocation').disabled=blocked||Boolean(formEditor?.saving);
    $('locationFormError').textContent=formEditor?.error||'';
    for(const id of ['locationName','locationTown','locationStatus','locationStatusNotes'])$(id).disabled=blocked||Boolean(formEditor?.saving||formEditor?.deleting);
  }
  function updateRowStatus(editor) {
    const row=rowElement(editor);if(!row)return;
    const parentLocked=editor.kind==='visit'&&parentBusy(editor.locationId);row.classList.toggle('is-saving',Boolean(editor.saving||editor.deleting));row.classList.toggle('is-error',Boolean(editor.error));
    row.querySelectorAll('[data-field]').forEach(input=>{input.disabled=!state.ready||state.loading||editor.deleting||Boolean(editor.deleteAttempt)||parentLocked;});
    row.querySelectorAll('[data-control]').forEach(button=>{button.disabled=!state.ready||state.loading||state.undoSaving||Boolean(editor.saving||editor.deleting||editor.deleteAttempt);});
    const button=row.querySelector('[data-action="delete"]');if(button)button.disabled=!state.ready||state.loading||state.undoSaving||Boolean(editor.saving||editor.deleting)||parentLocked;
    const errorRow=document.querySelector(`[data-error-id="${editorMapKey(editor)}"]`);
    if(errorRow){errorRow.hidden=!editor.error;errorRow.querySelector('[data-row-error]').textContent=editor.error;const action=errorRow.querySelector('button');action.textContent=editor.conflict?'Reload record':'Retry';action.dataset.action=editor.conflict?'reload':editor.deleteAttempt?'delete':'retry';action.disabled=Boolean(editor.saving||editor.deleting)||!state.ready||parentLocked;}
  }
  const visitsFor=id=>state.visits.filter(row=>row.location_id===id);
  function visibleLocations() {
    const query=state.query.trim().toLocaleLowerCase();
    return sortLocations(state.locations.filter(row=>!row.deleted_at&&(!state.town||row.town===state.town)&&(!state.status||row.status===state.status)&&(!query||`${row.location_name} ${row.town}`.toLocaleLowerCase().includes(query))));
  }
  function renderVisit(editor) {
    const cells=fields(editor).map(([key,label,limit])=>`<td class="tr-cell"><textarea class="tr-cell-input" data-field="${key}" rows="1" maxlength="${limit}" aria-label="${label}" spellcheck="false">${escape(editor.values[key])}</textarea></td>`).join('');
    return `<tr class="tr-row" data-row-id="${editor.id}">${cells}<td class="tr-action-cell"><button type="button" class="tr-delete" data-action="delete" aria-label="Delete visit">Delete</button></td></tr><tr class="tr-row-error" data-error-id="visit:${editor.id}" hidden><td colspan="6"><span data-row-error role="alert"></span> <button type="button" data-action="retry" data-kind="visit" data-id="${editor.id}">Retry</button></td></tr>`;
  }
  function renderHistory(location) {
    const fresh=[...state.editors.values()].filter(e=>e.kind==='visit'&&e.locationId===location.id&&!e.base).sort((a,b)=>b.order-a.order);
    const editors=[...fresh,...sortVisits(visitsFor(location.id).filter(row=>!row.deleted_at)).map(row=>editorFor(row))];
    return `<tr class="bb-history"><td class="bb-history-cell" colspan="6"><section aria-label="Visit history for ${escape(location.location_name)}"><div class="bb-history-header"><div><h2>${escape(location.location_name)}</h2><p>${STATUS[location.status]||'Active'}${location.town?` · ${escape(location.town)}`:''}</p></div><div class="bb-history-tools"><button type="button" class="tr-button tr-button-subtle" data-control data-action="edit-location" data-id="${location.id}">Edit location</button><button type="button" class="tr-button tr-button-subtle tr-delete-dog" data-control data-action="delete-location" data-id="${location.id}">Delete location</button><button type="button" class="tr-button tr-button-primary" data-control data-action="add-visit" data-id="${location.id}">Add visit</button></div></div>${location.status_notes?`<p class="bb-location-note">${escape(location.status_notes)}</p>`:''}<div class="bb-visit-scroll"><table class="tr-table bb-visits"><caption class="tr-sr-only">Editable visit history. Changes save when leaving a cell.</caption><colgroup><col class="bb-visit-date" /><col class="bb-visit-items" /><col class="bb-visit-contact" /><col class="bb-visit-town" /><col class="bb-visit-notes" /><col class="tr-col-action" /></colgroup><thead><tr><th scope="col">Date</th><th scope="col">Items given</th><th scope="col">Spoke to</th><th scope="col">Town</th><th scope="col">Notes</th><th scope="col"><span class="tr-sr-only">Delete</span></th></tr></thead><tbody id="visitRows">${editors.length?editors.map(renderVisit).join(''):'<tr><td colspan="6"><p class="bb-no-visits">No visits yet. Add a visit to get started.</p></td></tr>'}</tbody></table></div><p class="bb-history-caption">Newest added visits first. Imported visits keep their recorded order. Dates without a year stay unknown.</p><details id="deletedVisitsSection" class="bb-deleted-visits"><summary>Deleted visits <span id="deletedVisitCount">0</span></summary><div id="deletedVisitList" class="tr-deleted-dog-list"></div></details></section></td></tr>`;
  }
  function renderLocation(location) {
    const active=sortVisits(visitsFor(location.id).filter(row=>!row.deleted_at));
    const expanded=state.expanded===location.id;
    const editor=state.editors.get(keyOf('location',location.id));
    return `<tr class="bb-location" data-location-id="${location.id}"><td class="bb-location-name">${escape(location.location_name)||'Unnamed location'}</td><td class="bb-location-town">${escape(location.town)}</td><td>${escape(active[0]?.visited_on)||'—'}</td><td>${active.length}</td><td><span class="bb-status bb-status-${STATUS[location.status]?location.status:'active'}">${STATUS[location.status]||'Active'}</span></td><td><div class="bb-actions"><button type="button" class="tr-button tr-button-subtle" data-control data-action="history" data-id="${location.id}" aria-expanded="${expanded}">${expanded?'Hide history':'View history'}</button><button type="button" class="tr-button tr-button-primary" data-control data-action="log-visit" data-id="${location.id}">Log visit</button></div></td></tr><tr class="tr-row-error" data-error-id="location:${location.id}"${editor?.error?'':' hidden'}><td colspan="6"><span data-row-error role="alert">${escape(editor?.error)}</span> <button type="button" data-action="retry" data-kind="location" data-id="${location.id}">Retry</button></td></tr>${expanded?renderHistory(location):''}`;
  }
  function renderDeleted() {
    const deleted=sortLocations(state.locations.filter(row=>row.deleted_at));$('deletedCount').textContent=deleted.length;
    $('deletedList').innerHTML=deleted.length?deleted.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.location_name)||'Unnamed location'}</strong><span>${escape(row.town)} · ${visitsFor(row.id).filter(visit=>!visit.deleted_at).length} visits retained</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${row.id}" data-kind="location">Restore</button></div>`).join(''):'<p>No deleted locations.</p>';
    if($('deletedVisitList')){const visits=sortVisits(visitsFor(state.expanded).filter(row=>row.deleted_at));$('deletedVisitCount').textContent=visits.length;$('deletedVisitList').innerHTML=visits.length?visits.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.visited_on)||'Undated visit'}</strong><span>${escape(row.items_given)||'No items recorded'}</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${row.id}" data-kind="visit">Restore</button></div>`).join(''):'<p>No deleted visits.</p>';}
  }
  function renderDirectory() {
    const towns=[...new Set(state.locations.filter(row=>!row.deleted_at&&nonblank(row.town)).map(row=>row.town))].sort((a,b)=>a.localeCompare(b));
    $('townFilter').innerHTML='<option value="">All towns</option>'+towns.map(town=>`<option value="${escape(town)}">${escape(town)}</option>`).join('');
    if(state.town&&!towns.includes(state.town))state.town='';$('townFilter').value=state.town;
    const rows=visibleLocations();$('locationRows').innerHTML=rows.map(renderLocation).join('');
    const total=state.locations.filter(row=>!row.deleted_at).length;$('rowCount').textContent=rows.length===total?`${total} ${total===1?'location':'locations'}`:`${rows.length} of ${total} locations`;
    $('emptyState').hidden=Boolean(rows.length)||!state.ready;renderDeleted();controls();
  }
  function remember(row,kind='visit') {const rows=collection(kind),index=rows.findIndex(item=>item.id===row.id);if(index<0)rows.push(row);else rows[index]=row;}
  async function requireStaff(epoch) {
    if(typeof supabaseClient==='undefined')throw {code:'AUTH'};
    const {data,error}=await supabaseClient.auth.getSession();if(!current(epoch)||error||!data?.session?.user)throw {code:'AUTH'};
    if(typeof ensureHqWorkspaceAccess==='function')await ensureHqWorkspaceAccess(data.session);
    const id=data.session.user.id,result=await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',id).eq('active',true).maybeSingle();
    if(!current(epoch))throw {code:'AUTH'};if(result.error)throw result.error;if(!result.data)throw {code:'ACCESS'};state.userId=id;
  }
  async function fetchAll(table,valid) {
    const rows=[];for(let offset=0;;offset+=500){const {data,error}=await supabaseClient.from(table).select('*').order('id',{ascending:true}).range(offset,offset+499);if(!valid())return [];if(error)throw error;rows.push(...(data||[]));if(!data||data.length<500)return rows;}
  }
  async function refresh({silent=false}={}) {
    if(state.loading||state.undoSaving)return;
    if(unfinished()||tableFocused()||dialogOpen()){if(!silent)message('Your current edits are kept. Finish editing or remove an unused draft before refreshing.');return;}
    const epoch=state.epoch,request=++state.request,valid=()=>current(epoch)&&request===state.request;state.loading=true;controls();if(!silent)message('Loading biscuit basket locations…');
    try{await requireStaff(epoch);if(!valid())return;const locations=await fetchAll(TYPES.location.table,valid);if(!valid())return;const visits=await fetchAll(TYPES.visit.table,valid);if(!valid())return;state.locations=locations;state.visits=visits;state.editors.clear();state.ready=true;if(!locations.some(row=>row.id===state.expanded&&!row.deleted_at))state.expanded=null;message('');}
    catch(error){if(!valid())return;state.ready=false;if(['AUTH','ACCESS','42501'].includes(error?.code)){state.locations=[];state.visits=[];state.editors.clear();state.expanded=null;}message(errorText(error),true);}
    finally{if(valid()){state.loading=false;renderDirectory();}}
  }
  function takeInput(input) {
    const row=input.closest('[data-row-id]'),editor=state.editors.get(keyOf('visit',row?.dataset.rowId)),key=input.dataset.field;
    if(!editor||!keys(editor).includes(key)||editor.deleting||parentBusy(editor.locationId))return;
    const original=editor.base?text(editor.base[key]):'';editor.values[key]=input.value===normalized(original)?original:input.value;editor.touched=true;if(!editor.conflict)editor.error='';resize(input);controls();
  }
  function resize(input){if(document.activeElement!==input)return;input.style.height='auto';input.style.height=`${Math.min(220,Math.max(44,input.scrollHeight))}px`;}
  async function fetchRow(id,kind='visit'){const result=await supabaseClient.from(TYPES[kind].table).select('*').eq('id',id).maybeSingle();if(result.error)throw result.error;return result.data;}
  function changedPatch(editor){return Object.fromEntries(keys(editor).filter(key=>!editor.base||editor.values[key]!==text(editor.base[key])).map(key=>[key,editor.values[key]]));}
  function accept(editor,saved){editor.base={...saved};editor.attempt=null;editor.error='';editor.conflict=false;remember(saved,editor.kind);}
  function syncUntouchedCells(editor){
    const row=rowElement(editor);row?.querySelectorAll('[data-field]').forEach(input=>{if(document.activeElement!==input)input.value=editor.values[input.dataset.field];});
    if(editor===state.dialogEditor)for(const [key,id] of [['location_name','locationName'],['town','locationTown'],['status','locationStatus'],['status_notes','locationStatusNotes']])if(document.activeElement!==$(id))$(id).value=editor.values[key];
  }
  async function reconcile(editor,epoch){
    const attempt=editor.attempt;if(!attempt)return;const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;
    if(!fresh){if(!attempt.base){editor.attempt=null;return;}throw {code:'CONFLICT'};}if(fresh.deleted_at)throw {code:'CONFLICT'};
    if(same(attempt.patch,fresh)){if(attempt.base)for(const key of keys(editor))if(!(key in attempt.patch)&&editor.values[key]===text(attempt.base[key]))editor.values[key]=text(fresh[key]);accept(editor,fresh);syncUntouchedCells(editor);return;}
    if(attempt.base&&Object.keys(attempt.patch).every(key=>text(fresh[key])===text(attempt.base[key]))){for(const key of keys(editor))if(editor.values[key]===text(attempt.base[key]))editor.values[key]=text(fresh[key]);accept(editor,fresh);syncUntouchedCells(editor);return;}
    throw {code:'CONFLICT'};
  }
  function populated(editor){return keys(editor).some(key=>key!=='status'&&nonblank(editor.values[key]));}
  function saveEditor(editor){
    if(!editor||editor.deleting||editor.deleteAttempt||editor.conflict||!state.ready||editor.kind==='visit'&&parentBusy(editor.locationId))return Promise.resolve();if(editor.saving)return editor.saving;if(!dirty(editor)||!editor.base&&!editor.touched)return Promise.resolve();
    if(editor.kind==='location'&&!nonblank(editor.values.location_name)){editor.error='Enter a location name.';controls();return Promise.resolve();}
    if(!populated(editor)){if(editor.base){editor.error='This record is empty. Enter any detail, or delete it.';controls();}return Promise.resolve();}
    const epoch=state.epoch;
    const task=(async()=>{try{await requireStaff(epoch);if(!current(epoch))return;if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
      while(dirty(editor)&&populated(editor)){
        const patch=changedPatch(editor),base=editor.base?{...editor.base}:null;editor.attempt={base,patch};let result;
        if(base)result=await supabaseClient.from(TYPES[editor.kind].table).update(patch).eq('id',editor.id).eq('revision',base.revision).select('*').maybeSingle();
        else result=await supabaseClient.from(TYPES[editor.kind].table).insert({id:editor.id,...(editor.kind==='visit'?{location_id:editor.locationId}:{}),...patch}).select('*').single();
        if(!current(epoch))return;if(result.error?.code==='23505'||!result.error&&!result.data){await reconcile(editor,epoch);if(!current(epoch))return;continue;}if(result.error)throw result.error;accept(editor,result.data);
      }
      if(dirty(editor)&&editor.base&&!populated(editor))editor.error='This record is empty. Enter any detail, or delete it.';message('');
    }catch(error){if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';if(editor.kind==='visit'&&error?.code==='42501')await reconcileParent(editor,epoch);}}
    finally{if(current(epoch)){editor.saving=null;controls();if(!tableFocused()&&!dialogOpen()&&!unfinished())renderDirectory();}}})();editor.saving=task;controls();return task;
  }
  async function reconcileParent(editor,epoch){
    try{const fresh=await fetchRow(editor.locationId,'location');if(!current(epoch))return;if(fresh?.deleted_at){remember(fresh,'location');editor.parentDeleted=true;editor.error='This location was deleted. Restore it from Deleted locations to continue. Your visit draft is kept.';renderDirectory();$('deletedSection').open=true;}}
    catch{/* Keep the original error and draft if the parent cannot be checked. */}
  }
  async function flushVisits(){for(const editor of state.editors.values())if(editor.kind==='visit'&&editor.touched&&dirty(editor))await saveEditor(editor);return ![...state.editors.values()].some(e=>e.kind==='visit'&&e.touched&&(dirty(e)||e.error||e.saving));}
  async function expandLocation(id,{add=false}={}){
    if(!state.ready||state.loading||state.undoSaving)return;const epoch=state.epoch;if(!await flushVisits()||!current(epoch)){message('Finish or retry the current visit before opening another location.');return;}
    const location=state.locations.find(row=>row.id===id&&!row.deleted_at);if(!location||parentBusy(id))return;state.expanded=state.expanded===id&&!add?null:id;renderDirectory();if(add)addVisit(id);
  }
  function addVisit(id=state.expanded){
    if(!state.ready||state.loading||state.undoSaving)return;const location=state.locations.find(row=>row.id===id&&!row.deleted_at);if(!location||parentBusy(id))return;
    state.expanded=id;const editor={id:crypto.randomUUID(),kind:'visit',locationId:id,base:null,values:{...valuesOf(null),visited_on:today(),town:text(location.town)},touched:false,order:++state.newOrder,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(editorMapKey(editor),editor);renderDirectory();rowElement(editor)?.querySelector('[data-field="items_given"]')?.focus();
  }
  async function deleteRow(editor){
    if(!editor||!state.ready||state.loading||state.undoSaving||editor.saving||editor.deleting||editor.kind==='visit'&&parentBusy(editor.locationId))return;
    if(editor.kind==='location'&&[...state.editors.values()].some(e=>e.kind==='visit'&&e.locationId===editor.id&&(dirty(e)||e.saving||e.error))){message('Finish the visits or remove unused drafts before deleting this location.');return;}
    if(!editor.base&&!editor.attempt){state.editors.delete(editorMapKey(editor));renderDirectory();toast('Draft removed.');return;}
    const epoch=state.epoch;editor.deleting=true;controls();
    try{await requireStaff(epoch);if(!current(epoch))return;if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;if(!editor.base){state.editors.delete(editorMapKey(editor));renderDirectory();return;}
      if(editor.deleteAttempt){const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;if(fresh?.deleted_at){completeDeletion(editor,fresh);return;}if(!fresh||fresh.revision!==editor.base.revision)throw {code:'CONFLICT'};}
      editor.deleteAttempt=true;const result=await supabaseClient.from(TYPES[editor.kind].table).update({deleted_at:new Date().toISOString()}).eq('id',editor.id).eq('revision',editor.base.revision).select('*').maybeSingle();if(!current(epoch))return;if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};completeDeletion(editor,result.data);
    }catch(error){if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';if(editor.kind==='visit'&&error?.code==='42501')await reconcileParent(editor,epoch);}}
    finally{if(current(epoch)){editor.deleting=false;controls();}}
  }
  function completeDeletion(editor,row){remember(row,editor.kind);state.editors.delete(editorMapKey(editor));if(editor.kind==='location'&&state.expanded===row.id)state.expanded=null;renderDirectory();const section=$(editor.kind==='location'?'deletedSection':'deletedVisitsSection');if(section)section.open=true;toast(editor.kind==='location'?'Location deleted. Visit history is kept.':'Visit deleted.',{kind:editor.kind,row});}
  async function undoDelete(value=state.undo){
    if(!value||!state.ready||state.loading||state.undoSaving)return;const {kind,row}=value;if(kind==='visit'&&parentBusy(row.location_id))return;if(kind==='visit'&&!state.locations.some(location=>location.id===row.location_id&&!location.deleted_at)){message('Restore the location before restoring its visit.');return;}
    const epoch=state.epoch;state.undoSaving=true;$('undoDelete').disabled=true;controls();
    try{await requireStaff(epoch);if(!current(epoch))return;const result=await supabaseClient.from(TYPES[kind].table).update({deleted_at:null}).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();if(!current(epoch))return;let saved=result.data;
      if(result.error||!saved){const fresh=await fetchRow(row.id,kind);if(!current(epoch))return;if(fresh&&!fresh.deleted_at)saved=fresh;else throw result.error||{code:'CONFLICT'};}
      remember(saved,kind);if(kind==='location'){for(const editor of state.editors.values())if(editor.kind==='visit'&&editor.locationId===saved.id&&editor.parentDeleted){editor.parentDeleted=false;editor.error='The location is restored. Retry to save your visit.';state.expanded=saved.id;}}renderDeleted();if(!tableFocused()&&!dialogOpen())renderDirectory();message('');toast(kind==='location'?'Location restored.':'Visit restored.');
    }catch(error){if(current(epoch))message(errorText(error),true);}finally{if(current(epoch)){state.undoSaving=false;$('undoDelete').disabled=false;controls();}}
  }
  async function reloadRow(editor){
    if(!editor||editor.saving||!state.ready)return;const epoch=state.epoch;try{await requireStaff(epoch);const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;if(fresh)remember(fresh,editor.kind);else state[editor.kind==='location'?'locations':'visits']=collection(editor.kind).filter(row=>row.id!==editor.id);state.editors.delete(editorMapKey(editor));
      if(editor===state.dialogEditor){state.dialogEditor=fresh&&!fresh.deleted_at?editorFor(fresh,'location'):null;if(state.dialogEditor)fillLocationForm(state.dialogEditor);else closeLocationDialog();}renderDirectory();message('');
    }catch(error){if(current(epoch)){editor.error=errorText(error);controls();}}
  }
  function fillLocationForm(editor){$('locationDialogTitle').textContent=editor.base?'Edit location':'Add location';for(const [key,id] of [['location_name','locationName'],['town','locationTown'],['status','locationStatus'],['status_notes','locationStatusNotes']])$(id).value=editor.values[key];controls();}
  async function openLocation(id=null){
    if(!state.ready||state.loading||state.undoSaving||dialogOpen()||state.openingLocation||id&&parentBusy(id))return;
    state.openingLocation=true;controls();const epoch=state.epoch;
    try{if(!await flushVisits()||!current(epoch)){if(current(epoch))message('Finish or retry the current visit before editing a location.');return;}
      if(dialogOpen()||state.dialogEditor||id&&parentBusy(id))return;
      let editor;if(id){const row=state.locations.find(location=>location.id===id&&!location.deleted_at);if(!row)return;editor=editorFor(row,'location');}
      else{editor=pendingLocation();if(!editor){editor={id:crypto.randomUUID(),kind:'location',base:null,values:{...valuesOf(null,'location'),status:'active'},touched:false,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(editorMapKey(editor),editor);}}
      state.dialogEditor=editor;fillLocationForm(editor);$('locationDialog').showModal();$('locationName').focus();
    }finally{if(current(epoch)){state.openingLocation=false;controls();}}
  }
  function closeLocationDialog(){
    const editor=state.dialogEditor;if(editor?.saving||editor?.deleting)return;
    if(editor&&!editor.attempt)state.editors.delete(editorMapKey(editor));state.dialogEditor=null;if($('locationDialog').open)$('locationDialog').close();for(const id of ['locationName','locationTown','locationStatusNotes'])$(id).value='';$('locationStatus').value='active';$('locationFormError').textContent='';controls();
  }
  function takeLocationInput(input){const editor=state.dialogEditor,key=input.dataset.locationField;if(!editor||!keys(editor).includes(key)||editor.saving)return;const original=editor.base?text(editor.base[key]):'';editor.values[key]=input.value===normalized(original)?original:input.value;editor.touched=true;if(!editor.conflict)editor.error='';controls();}
  async function submitLocation(event){
    event?.preventDefault();const editor=state.dialogEditor;if(!editor||editor.saving||editor.conflict)return;
    for(const id of ['locationName','locationTown','locationStatus','locationStatusNotes'])takeLocationInput($(id));
    if(!nonblank(editor.values.location_name)){editor.error='Enter a location name.';controls();$('locationName').focus();return;}
    const epoch=state.epoch;await saveEditor(editor);if(!current(epoch))return;if(!editor.error&&!dirty(editor)){closeLocationDialog();renderDirectory();toast('Location saved.');}
  }
  function resetAuth(userId){
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;state.locations=[];state.visits=[];state.editors.clear();state.expanded=null;state.dialogEditor=null;state.openingLocation=false;state.undo=null;state.undoSaving=false;clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';$('undoDelete').disabled=false;if($('locationDialog').open)$('locationDialog').close();for(const id of ['locationName','locationTown','locationStatusNotes'])$(id).value='';$('locationStatus').value='active';renderDirectory();message(userId?'Loading biscuit basket locations…':'Sign in to Paws HQ to view biscuit baskets.');
  }
  function init(){
    if(!$('basketsPage'))return;
    $('addLocation').addEventListener('click',()=>openLocation());$('refreshLogs').addEventListener('click',()=>refresh());$('undoDelete').addEventListener('click',()=>undoDelete());
    $('searchLocations').addEventListener('input',()=>{state.query=$('searchLocations').value;renderDirectory();});$('townFilter').addEventListener('change',()=>{state.town=$('townFilter').value;renderDirectory();});$('statusFilter').addEventListener('change',()=>{state.status=$('statusFilter').value;renderDirectory();});
    $('locationForm').addEventListener('submit',submitLocation);$('locationForm').addEventListener('input',event=>{if(event.target.dataset.locationField)takeLocationInput(event.target);});$('locationForm').addEventListener('change',event=>{if(event.target.dataset.locationField)takeLocationInput(event.target);});$('closeLocationDialog').addEventListener('click',closeLocationDialog);$('reloadLocation').addEventListener('click',()=>reloadRow(state.dialogEditor));$('locationDialog').addEventListener('cancel',event=>{event.preventDefault();closeLocationDialog();});
    $('basketsPage').addEventListener('input',event=>{if(event.target.matches('[data-field]'))takeInput(event.target);});
    $('basketsPage').addEventListener('focusin',event=>{if(event.target.matches('[data-field]'))resize(event.target);});
    $('basketsPage').addEventListener('pointerdown',event=>{const button=event.target.closest('[data-action="delete"]'),editor=state.editors.get(keyOf('visit',button?.closest('[data-row-id]')?.dataset.rowId));if(editor)editor.skipBlurSave=true;});
    $('basketsPage').addEventListener('focusout',event=>{const input=event.target;if(!input.matches('[data-field]'))return;const editor=state.editors.get(keyOf('visit',input.closest('[data-row-id]')?.dataset.rowId));input.style.height='';input.scrollTop=0;input.scrollLeft=0;if(editor?.skipBlurSave){editor.skipBlurSave=false;return;}const epoch=state.epoch;setTimeout(async()=>{if(editor&&state.editors.get(editorMapKey(editor))===editor&&!editor.deleting)await saveEditor(editor);if(current(epoch)&&!tableFocused()&&!dialogOpen()&&!unfinished())renderDirectory();},0);});
    $('basketsPage').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.target.blur();}else if(event.key==='Escape'&&event.target.matches('[data-field]'))event.target.blur();});
    $('basketsPage').addEventListener('click',event=>{const restore=event.target.closest('[data-restore-row]');if(restore){const kind=restore.dataset.kind,row=collection(kind).find(item=>item.id===restore.dataset.restoreRow);if(row)undoDelete({kind,row});return;}const button=event.target.closest('[data-action]');if(!button)return;const {action}=button.dataset,id=button.dataset.id||button.closest('[data-row-id]')?.dataset.rowId,kind=button.dataset.kind||'visit',editor=state.editors.get(keyOf(kind,id));
      if(action==='history')expandLocation(id);if(action==='log-visit')expandLocation(id,{add:true});if(action==='add-visit')addVisit(id);if(action==='edit-location')openLocation(id);if(action==='delete-location'){const row=state.locations.find(item=>item.id===id);if(row)deleteRow(editorFor(row,'location'));}if(action==='delete')deleteRow(editor);if(action==='retry')saveEditor(editor);if(action==='reload')reloadRow(editor);
    });
    window.addEventListener('beforeunload',event=>{if(unfinished()){event.preventDefault();event.returnValue='';}});window.addEventListener('online',()=>refresh({silent:true}));window.addEventListener('focus',()=>refresh({silent:true}));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({silent:true});});setInterval(()=>{if(!document.hidden)refresh({silent:true});},30000);
    if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{const id=session?.user?.id||null,changed=event==='SIGNED_OUT'||id!==state.userId;if(changed)resetAuth(id);if(id)setTimeout(()=>refresh({silent:!changed}),0);});refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
