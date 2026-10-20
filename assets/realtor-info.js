/* Paws HQ realtor info: one realtor directory and compact, reversible contact histories. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const TYPES={
    realtor:{table:'hq_realtors',fields:[['realtor_name','Realtor name',500],['phone','Phone',200],['email','Email',500],['location','Location',2000]]},
    contact:{table:'hq_realtor_contacts',fields:[['contacted_date','Date contacted',500],['notes','Notes',20000]]}
  };
  const FORM_FIELDS=[['realtor_name','realtorName'],['phone','realtorPhone'],['email','realtorEmail'],['location','realtorLocation']];
  const state={realtors:[],contacts:[],editors:new Map(),ready:false,loading:false,userId:null,epoch:0,request:0,expanded:null,dialogEditor:null,openingRealtor:false,query:'',undo:null,undoSaving:false,toastTimer:null,newOrder:0};
  const text=value=>String(value??'');
  const escape=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nonblank=value=>text(value).trim().length>0;
  const normalized=value=>text(value).replace(/\r\n?/g,'\n');
  const current=epoch=>epoch===state.epoch;
  const fields=editor=>TYPES[editor.kind].fields;
  const keys=editor=>fields(editor).map(([key])=>key);
  const valuesOf=(row,kind='contact')=>Object.fromEntries(TYPES[kind].fields.map(([key])=>[key,text(row?.[key])]));
  const keyOf=(kind,id)=>`${kind}:${id}`;
  const editorMapKey=editor=>keyOf(editor.kind,editor.id);
  const collection=kind=>state[kind==='realtor'?'realtors':'contacts'];
  const same=(a,b)=>Object.keys(a).every(key=>a[key]===b[key]);
  const position=row=>BigInt(row.position??0);
  const sourceOrder=(a,b)=>position(a)<position(b)?-1:position(a)>position(b)?1:text(a.id).localeCompare(text(b.id));
  function sortContacts(rows) {
    // A recorded pair is one literal entry, even when its date cell names several dates.
    const added=rows.filter(row=>!row.source_file).sort((a,b)=>-sourceOrder(a,b));
    const imports=rows.filter(row=>row.source_file).sort((a,b)=>Number(b.source_column??0)-Number(a.source_column??0)||Number(a.source_row??0)-Number(b.source_row??0)||sourceOrder(a,b));
    return [...added,...imports];
  }
  function sortRealtors(rows) {return [...rows].sort((a,b)=>text(a.realtor_name).trim().localeCompare(text(b.realtor_name).trim(),undefined,{sensitivity:'base'})||sourceOrder(a,b));}
  const today=()=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'numeric',day:'numeric',year:'numeric'}).format(new Date());
  function dirty(editor) {return !editor.base||!same(editor.values,valuesOf(editor.base,editor.kind));}
  const unfinished=()=>state.undoSaving||[...state.editors.values()].some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error);
  const tableFocused=()=>Boolean(document.activeElement?.closest?.('#contactRows'));
  const dialogOpen=()=>Boolean($('realtorDialog')?.open);
  function errorText(error) {
    if(error?.code==='AUTH')return 'Sign in again to save. Your changes are still here.';
    if(error?.code==='ACCESS'||error?.code==='42501')return 'This account cannot change this record. Check that the realtor is still available and your Paws HQ access is active.';
    if(error?.code==='CONFLICT')return 'This record changed on another device. Your changes are still here. Copy them before reloading.';
    if(['42P01','PGRST205'].includes(error?.code))return 'Realtor records are unavailable. Please try again later.';
    return 'Could not save. Your changes are still here. Check your connection, then retry.';
  }
  function message(value,error=false) {$('pageMessage').textContent=value;$('pageMessage').hidden=!value;$('pageMessage').classList.toggle('is-error',error);}
  function toast(value,undo=null) {
    clearTimeout(state.toastTimer);state.undo=undo;
    $('toastText').textContent=value;$('undoDelete').hidden=!undo;$('toast').hidden=false;
    state.toastTimer=setTimeout(()=>{$('toast').hidden=true;},5000);controls();
  }
  function editorFor(row,kind='contact') {
    const key=keyOf(kind,row.id);let editor=state.editors.get(key);
    if(!editor){editor={id:row.id,kind,realtorId:row.realtor_id,base:{...row},values:valuesOf(row,kind),touched:true,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(key,editor);}
    return editor;
  }
  function rowElement(editor) {return document.querySelector(`[data-${editor.kind==='contact'?'row':'realtor'}-id="${editor.id}"]`);}
  const parentBusy=id=>{const editor=state.editors.get(keyOf('realtor',id));return Boolean(editor?.saving||editor?.deleting||editor?.deleteAttempt);};
  const pendingRealtor=()=>[...state.editors.values()].find(editor=>editor.kind==='realtor'&&!editor.base);
  function controls() {
    const blocked=!state.ready||state.loading,editors=[...state.editors.values()];
    $('addRealtor').disabled=blocked||state.undoSaving||state.openingRealtor||dialogOpen();$('addRealtor').textContent=pendingRealtor()?'Resume realtor':'Add realtor';
    $('refreshLogs').disabled=state.loading||state.undoSaving;
    for(const id of ['searchRealtors'])$(id).disabled=blocked;
    document.querySelectorAll('[data-control]').forEach(button=>{button.disabled=blocked||state.undoSaving||parentBusy(button.dataset.id);});
    document.querySelectorAll('[data-restore-row]').forEach(button=>{const contact=button.dataset.kind==='contact'?state.contacts.find(row=>row.id===button.dataset.restoreRow):null;button.disabled=blocked||state.undoSaving||Boolean(contact&&parentBusy(contact.realtor_id));});$('undoDelete').disabled=blocked||state.undoSaving||Boolean(state.undo?.kind==='contact'&&parentBusy(state.undo.row.realtor_id));
    $('saveStatus').textContent=state.loading?'Loading…':editors.some(e=>e.saving||e.deleting)||state.undoSaving?'Saving…':editors.some(e=>e.error)?'Some changes are not saved':editors.some(e=>dirty(e))?'Unsaved changes':state.ready?'All changes saved':'';
    for(const editor of editors)updateRowStatus(editor);
    const formEditor=state.dialogEditor;
    $('saveRealtor').disabled=blocked||state.undoSaving||Boolean(formEditor?.saving||formEditor?.deleting||formEditor?.conflict);
    $('closeRealtorDialog').disabled=Boolean(formEditor?.saving||formEditor?.deleting);
    $('reloadRealtor').hidden=!formEditor?.conflict;
    $('reloadRealtor').disabled=blocked||Boolean(formEditor?.saving);
    $('realtorFormError').textContent=formEditor?.error||'';
    for(const id of FORM_FIELDS.map(([,id])=>id))$(id).disabled=blocked||Boolean(formEditor?.saving||formEditor?.deleting);
  }
  function updateRowStatus(editor) {
    const row=rowElement(editor);if(!row)return;
    const parentLocked=editor.kind==='contact'&&parentBusy(editor.realtorId);row.classList.toggle('is-saving',Boolean(editor.saving||editor.deleting));row.classList.toggle('is-error',Boolean(editor.error));
    row.querySelectorAll('[data-field]').forEach(input=>{input.disabled=!state.ready||state.loading||editor.deleting||Boolean(editor.deleteAttempt)||parentLocked;});
    row.querySelectorAll('[data-control]').forEach(button=>{button.disabled=!state.ready||state.loading||state.undoSaving||Boolean(editor.saving||editor.deleting||editor.deleteAttempt)||parentLocked;});
    const button=row.querySelector('[data-action="delete"]');if(button)button.disabled=!state.ready||state.loading||state.undoSaving||Boolean(editor.saving||editor.deleting)||parentLocked;
    const errorRow=document.querySelector(`[data-error-id="${editorMapKey(editor)}"]`);
    if(errorRow){errorRow.hidden=!editor.error;errorRow.querySelector('[data-row-error]').textContent=editor.error;const action=errorRow.querySelector('button');action.textContent=editor.conflict?'Reload record':'Retry';action.dataset.action=editor.conflict?'reload':editor.deleteAttempt?'delete':'retry';action.disabled=Boolean(editor.saving||editor.deleting)||!state.ready||parentLocked;}
  }
  const contactsFor=id=>state.contacts.filter(row=>row.realtor_id===id);
  const needsAttention=editor=>dirty(editor)||editor.saving||editor.deleting||editor.error;
  function visibleRealtors() {
    const query=state.query.trim().toLocaleLowerCase();
    return sortRealtors(state.realtors.filter(row=>{
      if(row.deleted_at)return false;
      const parent=state.editors.get(keyOf('realtor',row.id));
      const local=[...state.editors.values()].filter(editor=>editor.kind==='contact'&&editor.realtorId===row.id);
      if(parent&&needsAttention(parent)||local.some(needsAttention))return true;
      const values=parent?.values||row;
      const history=contactsFor(row.id).filter(contact=>!contact.deleted_at).map(contact=>state.editors.get(keyOf('contact',contact.id))?.values||contact);
      return !query||[...TYPES.realtor.fields.map(([key])=>values[key]),...history.flatMap(contact=>[contact.contacted_date,contact.notes])].some(value=>text(value).toLocaleLowerCase().includes(query));
    }));
  }
  function renderContact(editor) {
    const cells=fields(editor).map(([key,label,limit])=>`<td class="tr-cell"><textarea class="tr-cell-input" data-field="${key}" rows="1" maxlength="${limit}" aria-label="${label}" spellcheck="false">${escape(editor.values[key])}</textarea></td>`).join('');
    const save=!editor.base?`<button type="button" class="ri-draft-save" data-control data-action="save-contact" data-id="${editor.id}">Save</button>`:'';
    return `<tr class="tr-row" data-row-id="${editor.id}">${cells}<td class="tr-action-cell"><div class="ri-row-actions">${save}<button type="button" class="tr-delete" data-action="delete" aria-label="Delete contact">Delete</button></div></td></tr><tr class="tr-row-error" data-error-id="contact:${editor.id}" hidden><td colspan="3"><span data-row-error role="alert"></span> <button type="button" data-action="retry" data-kind="contact" data-id="${editor.id}">Retry</button></td></tr>`;
  }
  function renderHistory(realtor) {
    const fresh=[...state.editors.values()].filter(e=>e.kind==='contact'&&e.realtorId===realtor.id&&!e.base).sort((a,b)=>b.order-a.order);
    const editors=[...fresh,...sortContacts(contactsFor(realtor.id).filter(row=>!row.deleted_at)).map(row=>editorFor(row))];
    return `<tr class="ri-history"><td class="ri-history-cell" colspan="5"><section aria-label="Contact history for ${escape(realtor.realtor_name)}"><div class="ri-history-header"><div><h2>${escape(realtor.realtor_name)||'Unnamed realtor'}</h2><p>${escape(realtor.location)}</p></div><div class="ri-history-tools"><button type="button" class="tr-button tr-button-subtle" data-control data-action="edit-realtor" data-id="${realtor.id}">Edit realtor</button><button type="button" class="tr-button tr-button-subtle tr-delete-dog" data-control data-action="delete-realtor" data-id="${realtor.id}">Delete realtor</button><button type="button" class="tr-button tr-button-primary" data-control data-action="add-contact" data-id="${realtor.id}">Add contact</button></div></div><div class="ri-contact-scroll"><table class="tr-table ri-contacts"><caption class="tr-sr-only">Editable contact history. Changes save when leaving a cell.</caption><colgroup><col class="ri-contact-date" /><col class="ri-contact-notes" /><col class="ri-contact-actions" /></colgroup><thead><tr><th scope="col">Date contacted</th><th scope="col">Notes</th><th scope="col"><span class="tr-sr-only">Actions</span></th></tr></thead><tbody id="contactRows">${editors.length?editors.map(renderContact).join(''):'<tr><td colspan="3"><p class="ri-no-contacts">No contacts yet. Add a contact to get started.</p></td></tr>'}</tbody></table></div><p class="ri-history-caption">Most recently recorded contacts first. Type in a cell to update it.</p><details id="deletedContactsSection" class="ri-deleted-contacts"><summary>Deleted contacts <span id="deletedContactCount">0</span></summary><div id="deletedContactList" class="tr-deleted-dog-list"></div></details></section></td></tr>`;
  }
  function renderRealtor(realtor) {
    const active=sortContacts(contactsFor(realtor.id).filter(row=>!row.deleted_at));
    const expanded=state.expanded===realtor.id,last=active[0];
    const editor=state.editors.get(keyOf('realtor',realtor.id));
    return `<tr class="ri-realtor" data-realtor-id="${realtor.id}"><td class="ri-realtor-name"><button type="button" class="ri-edit-name" data-control data-action="edit-realtor" data-id="${realtor.id}" aria-label="Edit ${escape(realtor.realtor_name)||'realtor'}"><span class="ri-preview" title="${escape(realtor.realtor_name)}">${escape(realtor.realtor_name)||'Unnamed realtor'}</span></button></td><td><span class="ri-preview" title="${escape(realtor.phone)}">${escape(realtor.phone)}</span><span class="ri-preview ri-secondary" title="${escape(realtor.email)}">${escape(realtor.email)}</span></td><td><span class="ri-preview" title="${escape(realtor.location)}">${escape(realtor.location)}</span></td><td><span class="ri-preview" title="${escape(last?.contacted_date)}">${escape(last?.contacted_date)||'—'}</span><span class="ri-preview ri-secondary" title="${escape(last?.notes)}">${escape(last?.notes)}</span></td><td><div class="ri-actions"><button type="button" class="tr-button tr-button-subtle" data-control data-action="history" data-id="${realtor.id}" aria-expanded="${expanded}">${expanded?'Hide history':'History'} (${active.length})</button><button type="button" class="tr-button tr-button-primary" data-control data-action="log-contact" data-id="${realtor.id}">Log contact</button></div></td></tr><tr class="tr-row-error" data-error-id="realtor:${realtor.id}"${editor?.error?'':' hidden'}><td colspan="5"><span data-row-error role="alert">${escape(editor?.error)}</span> <button type="button" data-action="retry" data-kind="realtor" data-id="${realtor.id}">Retry</button></td></tr>${expanded?renderHistory(realtor):''}`;
  }
  function renderDeleted() {
    const deleted=sortRealtors(state.realtors.filter(row=>row.deleted_at));$('deletedCount').textContent=deleted.length;
    $('deletedList').innerHTML=deleted.length?deleted.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.realtor_name)||'Unnamed realtor'}</strong><span>${escape(row.location)} · ${contactsFor(row.id).filter(contact=>!contact.deleted_at).length} contacts retained</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${row.id}" data-kind="realtor">Restore</button></div>`).join(''):'<p>No deleted realtors.</p>';
    if($('deletedContactList')){const contacts=sortContacts(contactsFor(state.expanded).filter(row=>row.deleted_at));$('deletedContactCount').textContent=contacts.length;$('deletedContactList').innerHTML=contacts.length?contacts.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.contacted_date)||'Undated contact'}</strong><span>${escape(row.notes)||'No notes recorded'}</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${row.id}" data-kind="contact">Restore</button></div>`).join(''):'<p>No deleted contacts.</p>';}
  }
  function renderDirectory() {
    const rows=visibleRealtors();$('realtorRows').innerHTML=rows.map(renderRealtor).join('');
    const total=state.realtors.filter(row=>!row.deleted_at).length;$('rowCount').textContent=rows.length===total?`${total} ${total===1?'realtor':'realtors'}`:`${rows.length} of ${total} realtors`;
    $('emptyState').hidden=Boolean(rows.length)||!state.ready;renderDeleted();controls();
  }
  function remember(row,kind='contact') {const rows=collection(kind),index=rows.findIndex(item=>item.id===row.id);if(index<0)rows.push(row);else rows[index]=row;}
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
    const epoch=state.epoch,request=++state.request,valid=()=>current(epoch)&&request===state.request;state.loading=true;controls();if(!silent)message('Loading realtors…');
    try{await requireStaff(epoch);if(!valid())return;const realtors=await fetchAll(TYPES.realtor.table,valid);if(!valid())return;const contacts=await fetchAll(TYPES.contact.table,valid);if(!valid())return;state.realtors=realtors;state.contacts=contacts;state.editors.clear();state.ready=true;if(!realtors.some(row=>row.id===state.expanded&&!row.deleted_at))state.expanded=null;message('');}
    catch(error){if(!valid())return;state.ready=false;if(['AUTH','ACCESS','42501'].includes(error?.code)){state.realtors=[];state.contacts=[];state.editors.clear();state.expanded=null;}message(errorText(error),true);}
    finally{if(valid()){state.loading=false;renderDirectory();}}
  }
  function takeInput(input) {
    const row=input.closest('[data-row-id]'),editor=state.editors.get(keyOf('contact',row?.dataset.rowId)),key=input.dataset.field;
    if(!editor||!keys(editor).includes(key)||editor.deleting||parentBusy(editor.realtorId))return;
    const original=editor.base?text(editor.base[key]):'';editor.values[key]=input.value===normalized(original)?original:input.value;editor.touched=true;if(!editor.conflict)editor.error='';resize(input);controls();
  }
  function resize(input){if(document.activeElement!==input)return;input.style.height='auto';input.style.height=`${Math.min(220,Math.max(44,input.scrollHeight))}px`;}
  async function fetchRow(id,kind='contact'){const result=await supabaseClient.from(TYPES[kind].table).select('*').eq('id',id).maybeSingle();if(result.error)throw result.error;return result.data;}
  function changedPatch(editor){return Object.fromEntries(keys(editor).filter(key=>!editor.base||editor.values[key]!==text(editor.base[key])).map(key=>[key,editor.values[key]]));}
  function accept(editor,saved){editor.base={...saved};editor.attempt=null;editor.error='';editor.conflict=false;remember(saved,editor.kind);}
  function syncUntouchedCells(editor){
    const row=rowElement(editor);row?.querySelectorAll('[data-field]').forEach(input=>{if(document.activeElement!==input)input.value=editor.values[input.dataset.field];});
    if(editor===state.dialogEditor)for(const [key,id] of FORM_FIELDS)if(document.activeElement!==$(id))$(id).value=editor.values[key];
  }
  async function reconcile(editor,epoch){
    const attempt=editor.attempt;if(!attempt)return;const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;
    if(!fresh){if(!attempt.base){editor.attempt=null;return;}throw {code:'CONFLICT'};}if(fresh.deleted_at)throw {code:'CONFLICT'};
    if(same(attempt.patch,fresh)){if(attempt.base)for(const key of keys(editor))if(!(key in attempt.patch)&&editor.values[key]===text(attempt.base[key]))editor.values[key]=text(fresh[key]);accept(editor,fresh);syncUntouchedCells(editor);return;}
    if(attempt.base&&Object.keys(attempt.patch).every(key=>text(fresh[key])===text(attempt.base[key]))){for(const key of keys(editor))if(editor.values[key]===text(attempt.base[key]))editor.values[key]=text(fresh[key]);accept(editor,fresh);syncUntouchedCells(editor);return;}
    throw {code:'CONFLICT'};
  }
  function populated(editor){return keys(editor).some(key=>nonblank(editor.values[key]));}
  function saveEditor(editor){
    if(!editor||editor.deleting||editor.deleteAttempt||editor.conflict||!state.ready||editor.kind==='contact'&&parentBusy(editor.realtorId))return Promise.resolve();if(editor.saving)return editor.saving;if(!dirty(editor)||!editor.base&&!editor.touched)return Promise.resolve();
    if(!populated(editor)){if(editor.base){editor.error='This record is empty. Enter any detail, or delete it.';controls();}return Promise.resolve();}
    const epoch=state.epoch;
    const task=(async()=>{try{await requireStaff(epoch);if(!current(epoch))return;if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
      while(dirty(editor)&&populated(editor)){
        const patch=changedPatch(editor),base=editor.base?{...editor.base}:null;editor.attempt={base,patch};let result;
        if(base)result=await supabaseClient.from(TYPES[editor.kind].table).update(patch).eq('id',editor.id).eq('revision',base.revision).select('*').maybeSingle();
        else result=await supabaseClient.from(TYPES[editor.kind].table).insert({id:editor.id,...(editor.kind==='contact'?{realtor_id:editor.realtorId}:{}),...patch}).select('*').single();
        if(!current(epoch))return;if(result.error?.code==='23505'||!result.error&&!result.data){await reconcile(editor,epoch);if(!current(epoch))return;continue;}if(result.error)throw result.error;accept(editor,result.data);
      }
      if(dirty(editor)&&editor.base&&!populated(editor))editor.error='This record is empty. Enter any detail, or delete it.';message('');
    }catch(error){if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';if(editor.kind==='contact'&&error?.code==='42501')await reconcileParent(editor,epoch);}}
    finally{if(current(epoch)){editor.saving=null;controls();if(!tableFocused()&&!dialogOpen()&&!unfinished())renderDirectory();}}})();editor.saving=task;controls();return task;
  }
  async function reconcileParent(editor,epoch){
    try{const fresh=await fetchRow(editor.realtorId,'realtor');if(!current(epoch))return;if(fresh?.deleted_at){remember(fresh,'realtor');editor.parentDeleted=true;editor.error='This realtor was deleted. Restore it from Deleted realtors to continue. Your contact draft is kept.';renderDirectory();$('deletedSection').open=true;}}
    catch{/* Keep the original error and draft if the parent cannot be checked. */}
  }
  async function flushContacts(){for(const editor of state.editors.values())if(editor.kind==='contact'&&editor.touched&&dirty(editor))await saveEditor(editor);return ![...state.editors.values()].some(e=>e.kind==='contact'&&(e.deleting||e.deleteAttempt||e.touched&&(dirty(e)||e.error||e.saving)));}
  async function expandRealtor(id,{add=false}={}){
    if(!state.ready||state.loading||state.undoSaving)return;const epoch=state.epoch;if(!await flushContacts()||!current(epoch)){message('Finish or retry the current contact before opening another realtor.');return;}
    const realtor=state.realtors.find(row=>row.id===id&&!row.deleted_at);if(!realtor||parentBusy(id))return;state.expanded=state.expanded===id&&!add?null:id;renderDirectory();if(add)addContact(id);
  }
  function addContact(id=state.expanded){
    if(!state.ready||state.loading||state.undoSaving)return;const realtor=state.realtors.find(row=>row.id===id&&!row.deleted_at);if(!realtor||parentBusy(id))return;
    state.expanded=id;const editor={id:crypto.randomUUID(),kind:'contact',realtorId:id,base:null,values:{...valuesOf(null),contacted_date:today()},touched:false,order:++state.newOrder,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(editorMapKey(editor),editor);renderDirectory();rowElement(editor)?.querySelector('[data-field="notes"]')?.focus();
  }
  async function deleteRow(editor){
    if(!editor||!state.ready||state.loading||state.undoSaving||editor.saving||editor.deleting||editor.kind==='contact'&&parentBusy(editor.realtorId))return;
    if(editor.kind==='realtor'&&[...state.editors.values()].some(e=>e.kind==='contact'&&e.realtorId===editor.id&&(dirty(e)||e.saving||e.deleting||e.deleteAttempt||e.error))){message('Finish the contacts or remove unused drafts before deleting this realtor.');return;}
    if(!editor.base&&!editor.attempt){state.editors.delete(editorMapKey(editor));renderDirectory();toast('Draft removed.');return;}
    const epoch=state.epoch;editor.deleting=true;controls();
    try{await requireStaff(epoch);if(!current(epoch))return;if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;if(!editor.base){state.editors.delete(editorMapKey(editor));renderDirectory();return;}
      if(editor.deleteAttempt){const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;if(fresh?.deleted_at){completeDeletion(editor,fresh);return;}if(!fresh||fresh.revision!==editor.base.revision)throw {code:'CONFLICT'};}
      editor.deleteAttempt=true;const result=await supabaseClient.from(TYPES[editor.kind].table).update({deleted_at:new Date().toISOString()}).eq('id',editor.id).eq('revision',editor.base.revision).select('*').maybeSingle();if(!current(epoch))return;if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};completeDeletion(editor,result.data);
    }catch(error){if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';if(editor.kind==='contact'&&error?.code==='42501')await reconcileParent(editor,epoch);}}
    finally{if(current(epoch)){editor.deleting=false;controls();}}
  }
  function completeDeletion(editor,row){remember(row,editor.kind);state.editors.delete(editorMapKey(editor));if(editor.kind==='realtor'&&state.expanded===row.id)state.expanded=null;renderDirectory();const section=$(editor.kind==='realtor'?'deletedSection':'deletedContactsSection');if(section)section.open=true;toast(editor.kind==='realtor'?'Realtor deleted. Contact history is kept.':'Contact deleted.',{kind:editor.kind,row});}
  async function undoDelete(value=state.undo){
    if(!value||!state.ready||state.loading||state.undoSaving)return;const {kind,row}=value;if(kind==='contact'&&parentBusy(row.realtor_id))return;if(kind==='contact'&&!state.realtors.some(realtor=>realtor.id===row.realtor_id&&!realtor.deleted_at)){message('Restore the realtor before restoring its contact.');return;}
    const epoch=state.epoch;state.undoSaving=true;$('undoDelete').disabled=true;controls();
    try{await requireStaff(epoch);if(!current(epoch))return;const result=await supabaseClient.from(TYPES[kind].table).update({deleted_at:null}).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();if(!current(epoch))return;let saved=result.data;
      if(result.error||!saved){const fresh=await fetchRow(row.id,kind);if(!current(epoch))return;if(fresh&&!fresh.deleted_at)saved=fresh;else throw result.error||{code:'CONFLICT'};}
      remember(saved,kind);if(kind==='realtor'){for(const editor of state.editors.values())if(editor.kind==='contact'&&editor.realtorId===saved.id&&editor.parentDeleted){editor.parentDeleted=false;editor.error='The realtor is restored. Retry to save your contact.';state.expanded=saved.id;}}renderDeleted();if(!tableFocused()&&!dialogOpen())renderDirectory();message('');toast(kind==='realtor'?'Realtor restored.':'Contact restored.');
    }catch(error){if(current(epoch))message(errorText(error),true);}finally{if(current(epoch)){state.undoSaving=false;$('undoDelete').disabled=false;controls();}}
  }
  async function reloadRow(editor){
    if(!editor||editor.saving||!state.ready)return;const epoch=state.epoch;try{await requireStaff(epoch);const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;if(fresh)remember(fresh,editor.kind);else state[editor.kind==='realtor'?'realtors':'contacts']=collection(editor.kind).filter(row=>row.id!==editor.id);state.editors.delete(editorMapKey(editor));
      if(editor===state.dialogEditor){state.dialogEditor=fresh&&!fresh.deleted_at?editorFor(fresh,'realtor'):null;if(state.dialogEditor)fillRealtorForm(state.dialogEditor);else closeRealtorDialog();}renderDirectory();message('');
    }catch(error){if(current(epoch)){editor.error=errorText(error);controls();}}
  }
  function fillRealtorForm(editor){$('realtorDialogTitle').textContent=editor.base?'Edit realtor':'Add realtor';for(const [key,id] of FORM_FIELDS)$(id).value=editor.values[key];controls();}
  async function openRealtor(id=null){
    if(!state.ready||state.loading||state.undoSaving||dialogOpen()||state.openingRealtor||id&&parentBusy(id))return;
    state.openingRealtor=true;controls();const epoch=state.epoch;
    try{if(!await flushContacts()||!current(epoch)){if(current(epoch))message('Finish or retry the current contact before editing a realtor.');return;}
      if(dialogOpen()||state.dialogEditor||id&&parentBusy(id))return;
      let editor;if(id){const row=state.realtors.find(realtor=>realtor.id===id&&!realtor.deleted_at);if(!row)return;editor=editorFor(row,'realtor');}
      else{editor=pendingRealtor();if(!editor){editor={id:crypto.randomUUID(),kind:'realtor',base:null,values:valuesOf(null,'realtor'),touched:false,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(editorMapKey(editor),editor);}}
      state.dialogEditor=editor;fillRealtorForm(editor);$('realtorDialog').showModal();$('realtorName').focus();
    }finally{if(current(epoch)){state.openingRealtor=false;controls();}}
  }
  function closeRealtorDialog(){
    const editor=state.dialogEditor;if(editor?.saving||editor?.deleting)return;
    if(editor&&!editor.attempt)state.editors.delete(editorMapKey(editor));state.dialogEditor=null;if($('realtorDialog').open)$('realtorDialog').close();for(const [,id] of FORM_FIELDS)$(id).value='';$('realtorFormError').textContent='';controls();
  }
  function takeRealtorInput(input){const editor=state.dialogEditor,key=input.dataset.realtorField;if(!editor||!keys(editor).includes(key)||editor.saving)return;const original=editor.base?text(editor.base[key]):'';editor.values[key]=input.value===normalized(original)?original:input.value;editor.touched=true;if(!editor.conflict)editor.error='';controls();}
  async function submitRealtor(event){
    event?.preventDefault();const editor=state.dialogEditor;if(!editor||editor.saving||editor.conflict)return;
    for(const id of FORM_FIELDS.map(([,id])=>id))takeRealtorInput($(id));
    if(!populated(editor)){editor.error='Enter any realtor detail.';controls();$('realtorName').focus();return;}
    const epoch=state.epoch;await saveEditor(editor);if(!current(epoch))return;if(!editor.error&&!dirty(editor)){closeRealtorDialog();renderDirectory();toast('Realtor saved.');}
  }
  function resetAuth(userId){
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;state.realtors=[];state.contacts=[];state.editors.clear();state.expanded=null;state.dialogEditor=null;state.openingRealtor=false;state.undo=null;state.undoSaving=false;clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';$('undoDelete').disabled=false;if($('realtorDialog').open)$('realtorDialog').close();for(const [,id] of FORM_FIELDS)$(id).value='';renderDirectory();message(userId?'Loading realtors…':'Sign in to Paws HQ to view realtor info.');
  }
  function init(){
    if(!$('realtorsPage'))return;
    $('addRealtor').addEventListener('click',()=>openRealtor());$('refreshLogs').addEventListener('click',()=>refresh());$('undoDelete').addEventListener('click',()=>undoDelete());
    $('searchRealtors').addEventListener('input',()=>{state.query=$('searchRealtors').value;renderDirectory();});
    $('realtorForm').addEventListener('submit',submitRealtor);$('realtorForm').addEventListener('input',event=>{if(event.target.dataset.realtorField)takeRealtorInput(event.target);});$('realtorForm').addEventListener('change',event=>{if(event.target.dataset.realtorField)takeRealtorInput(event.target);});$('closeRealtorDialog').addEventListener('click',closeRealtorDialog);$('reloadRealtor').addEventListener('click',()=>reloadRow(state.dialogEditor));$('realtorDialog').addEventListener('cancel',event=>{event.preventDefault();closeRealtorDialog();});
    $('realtorsPage').addEventListener('input',event=>{if(event.target.matches('[data-field]'))takeInput(event.target);});
    $('realtorsPage').addEventListener('focusin',event=>{if(event.target.matches('[data-field]'))resize(event.target);});
    $('realtorsPage').addEventListener('pointerdown',event=>{const button=event.target.closest('[data-action="delete"]'),editor=state.editors.get(keyOf('contact',button?.closest('[data-row-id]')?.dataset.rowId));if(editor)editor.skipBlurSave=true;});
    $('realtorsPage').addEventListener('focusout',event=>{const input=event.target;if(!input.matches('[data-field]'))return;const editor=state.editors.get(keyOf('contact',input.closest('[data-row-id]')?.dataset.rowId));input.style.height='';input.scrollTop=0;input.scrollLeft=0;if(editor?.skipBlurSave){editor.skipBlurSave=false;return;}const epoch=state.epoch;setTimeout(async()=>{if(editor&&state.editors.get(editorMapKey(editor))===editor&&!editor.deleting)await saveEditor(editor);if(current(epoch)&&!tableFocused()&&!dialogOpen()&&!unfinished())renderDirectory();},0);});
    $('realtorsPage').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.target.blur();}else if(event.key==='Escape'&&event.target.matches('[data-field]'))event.target.blur();});
    $('realtorsPage').addEventListener('click',event=>{const restore=event.target.closest('[data-restore-row]');if(restore){const kind=restore.dataset.kind,row=collection(kind).find(item=>item.id===restore.dataset.restoreRow);if(row)undoDelete({kind,row});return;}const button=event.target.closest('[data-action]');if(!button)return;const {action}=button.dataset,id=button.dataset.id||button.closest('[data-row-id]')?.dataset.rowId,kind=button.dataset.kind||'contact',editor=state.editors.get(keyOf(kind,id));
      if(action==='history')expandRealtor(id);if(action==='log-contact')expandRealtor(id,{add:true});if(action==='add-contact')addContact(id);if(action==='edit-realtor')openRealtor(id);if(action==='delete-realtor'){const row=state.realtors.find(item=>item.id===id);if(row)deleteRow(editorFor(row,'realtor'));}if(action==='save-contact'&&editor&&!parentBusy(editor.realtorId)){editor.touched=true;saveEditor(editor);}if(action==='delete')deleteRow(editor);if(action==='retry')saveEditor(editor);if(action==='reload')reloadRow(editor);
    });
    window.addEventListener('beforeunload',event=>{if(unfinished()){event.preventDefault();event.returnValue='';}});window.addEventListener('online',()=>refresh({silent:true}));window.addEventListener('focus',()=>refresh({silent:true}));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({silent:true});});setInterval(()=>{if(!document.hidden)refresh({silent:true});},30000);
    if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{const id=session?.user?.id||null,changed=event==='SIGNED_OUT'||id!==state.userId;if(changed)resetAuth(id);if(id)setTimeout(()=>refresh({silent:!changed}),0);});refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
