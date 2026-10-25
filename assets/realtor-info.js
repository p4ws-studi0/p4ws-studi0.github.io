/* Paws HQ realtor info: one realtor directory and readable, reversible contact histories and explicit forms. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const TYPES={
    realtor:{table:'hq_realtors',fields:[['realtor_name','Realtor name',500],['phone','Phone',200],['email','Email',500],['location','Location',2000]]},
    contact:{table:'hq_realtor_contacts',fields:[['contacted_date','Date contacted',500],['notes','Notes',20000]]}
  };
  const FORM_FIELDS=[['realtor_name','realtorName'],['phone','realtorPhone'],['email','realtorEmail'],['location','realtorLocation']];
  const CONTACT_INPUTS=[['contacted_date','contactDate'],['notes','contactNotes']];
  const state={realtors:[],contacts:[],editors:new Map(),ready:false,loading:false,userId:null,epoch:0,request:0,expanded:null,dialogEditor:null,contactEditor:null,openingRealtor:false,query:'',undo:null,undoSaving:false,toastTimer:null,newOrder:0};
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
  function dirty(editor) {return !editor.base?Boolean(editor.touched||editor.attempt):!same(editor.values,valuesOf(editor.base,editor.kind));}
  const unfinished=()=>state.undoSaving||[...state.editors.values()].some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error);
  const tableFocused=()=>Boolean(document.activeElement?.closest?.('#contactRows'));
  const dialogOpen=()=>Boolean($('realtorDialog')?.open||$('contactDialog')?.open);
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
  const pendingContact=id=>[...state.editors.values()].find(editor=>editor.kind==='contact'&&editor.realtorId===id&&(!editor.base||dirty(editor)||editor.error||editor.attempt));
  function controls() {
    const blocked=!state.ready||state.loading,editors=[...state.editors.values()];
    $('addRealtor').disabled=blocked||state.undoSaving||state.openingRealtor||dialogOpen();$('addRealtor').textContent=pendingRealtor()?'Resume realtor':'Add realtor';
    $('refreshLogs').disabled=state.loading||state.undoSaving;
    $('backRealtors').disabled=state.loading||state.undoSaving||editors.some(editor=>editor.saving||editor.deleting);
    for(const id of ['searchRealtors','clearSearch'])$(id).disabled=blocked;
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
    const contact=state.contactEditor,contactBusy=Boolean(contact?.saving||contact?.deleting||contact?.deleteAttempt||contact&&parentBusy(contact.realtorId));
    $('saveContact').disabled=blocked||state.undoSaving||contactBusy||Boolean(contact?.conflict||contact?.parentDeleted);
    $('closeContactDialog').disabled=Boolean(contact?.saving||contact?.deleting);
    $('reloadContact').hidden=!contact?.conflict;$('reloadContact').disabled=blocked||contactBusy;
    $('contactFormError').textContent=contact?.error||'';
    for(const [,id]of CONTACT_INPUTS)$(id).disabled=blocked||contactBusy;
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
  function phoneHref(value){
    if(/[\u0000-\u001f\u007f]/.test(text(value)))return '';
    const label=text(value).trim();
    if(!label||/[\r\n\t]/.test(label)||!/^\+?[\d ().-]+$/.test(label))return '';
    if(/[()]/.test(label)&&!/^([^()]*\(\d{2,4}\)[^()]*)$/.test(label))return '';
    const number=label.replace(/[ ().-]/g,'');
    if(label.startsWith('+'))return /^\+[1-9]\d{7,14}$/.test(number)?`tel:${number}`:'';
    return /^(?:1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}$/.test(label)?`tel:${number}`:'';
  }
  function emailHref(value){
    if(/[\u0000-\u001f\u007f]/.test(text(value)))return '';
    const address=text(value).trim();
    if(address.length>254||!/^\w[\w.%+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/i.test(address)||address.split('@')[0].length>64||address.split('@')[0].includes('..')||address.split('@')[1].split('.').some(label=>label.length>63))return '';
    return `mailto:${encodeURIComponent(address)}`;
  }
  function contactValue(value,kind){const href=kind==='phone'?phoneHref(value):kind==='email'?emailHref(value):'';return href?`<a href="${escape(href)}">${escape(value)}</a>`:escape(value)||'—';}
  function renderContact(editor) {
    const value=editor.values,draft=!editor.base?'Unsaved contact':dirty(editor)?'Unsaved changes':'';
    const note=!value.notes?'<p class="ri-contact-empty">No notes recorded.</p>':value.notes.length>320?`<details class="ri-contact-note ri-long-note"><summary><span>Notes</span><span class="ri-note-preview">${escape(Array.from(value.notes.replace(/\s+/g,' ').trim()).slice(0,140).join(''))}…</span><span class="ri-note-more">Show more</span></summary><p>${escape(value.notes)}</p></details>`:`<div class="ri-contact-note"><span>Notes</span><p>${escape(value.notes)}</p></div>`;
    return `<article class="ri-contact-row" data-row-id="${editor.id}"><div class="ri-contact-date"><strong>${escape(value.contacted_date)||'Undated contact'}</strong>${draft?`<span class="ri-contact-state">${draft}</span>`:''}</div><div class="ri-contact-content">${note}</div><div class="ri-contact-actions"><button type="button" class="tr-button tr-button-subtle" data-control data-action="edit-contact" data-kind="contact" data-id="${editor.id}">${draft?'Resume':'Edit'}</button><button type="button" class="tr-button tr-button-subtle tr-delete-dog" data-control data-action="delete" data-kind="contact" data-id="${editor.id}" aria-label="Delete contact">Delete</button></div></article><div class="ri-contact-error" data-error-id="contact:${editor.id}" hidden><span data-row-error role="alert"></span> <button type="button" data-action="retry" data-kind="contact" data-id="${editor.id}">Retry</button></div>`;
  }
  function renderHistory(realtor) {
    const fresh=[...state.editors.values()].filter(editor=>editor.kind==='contact'&&editor.realtorId===realtor.id&&!editor.base&&(dirty(editor)||editor.error||editor.saving)).sort((a,b)=>b.order-a.order);
    const editors=[...fresh,...sortContacts(contactsFor(realtor.id).filter(row=>!row.deleted_at)).map(row=>editorFor(row))];
    const details=[['phone','Phone'],['email','Email'],['location','Location']].map(([key,label])=>`<div><dt>${label}</dt><dd>${contactValue(realtor[key],key)}</dd></div>`).join('');
    return `<section class="ri-detail-header"><div class="ri-detail-heading"><h2>${escape(realtor.realtor_name)||'Unnamed realtor'}</h2><dl class="ri-detail-meta">${details}</dl></div><div class="ri-detail-actions"><button type="button" class="tr-button tr-button-primary" data-control data-action="add-contact" data-id="${realtor.id}">${pendingContact(realtor.id)?'Resume contact':'Log contact'}</button><button type="button" class="tr-button tr-button-subtle" data-control data-action="edit-realtor" data-id="${realtor.id}">Edit realtor</button><button type="button" class="tr-button tr-button-subtle tr-delete-dog" data-control data-action="delete-realtor" data-id="${realtor.id}">Delete realtor</button></div></section><section class="ri-history-panel" aria-label="Contact history for ${escape(realtor.realtor_name)}"><div class="ri-history-heading"><h3>Contact history</h3><span>${editors.length} ${editors.length===1?'contact':'contacts'}</span></div><div id="contactRows" class="ri-contact-list">${editors.length?editors.map(renderContact).join(''):'<p class="ri-no-contacts">No contacts yet. Choose Log contact to add the first one.</p>'}</div><p class="ri-history-caption">New entries appear first. Imported contacts keep their recorded order. Original date text is kept as entered.</p><details id="deletedContactsSection" class="ri-deleted-contacts"><summary>Deleted contacts <span id="deletedContactCount">0</span></summary><div id="deletedContactList" class="tr-deleted-dog-list"></div></details></section>`;
  }
  function renderRealtor(realtor) {
    const active=sortContacts(contactsFor(realtor.id).filter(row=>!row.deleted_at)),last=active[0],draft=[...state.editors.values()].some(editor=>editor.kind==='contact'&&editor.realtorId===realtor.id&&(dirty(editor)||editor.error));
    const editor=state.editors.get(keyOf('realtor',realtor.id));
    return `<tr class="ri-realtor" data-realtor-id="${realtor.id}"><td class="ri-realtor-name"><button type="button" class="ri-realtor-open" data-control data-action="history" data-id="${realtor.id}" aria-label="Open history for ${escape(realtor.realtor_name)||'realtor'}">${escape(realtor.realtor_name)||'Unnamed realtor'}</button>${draft?'<span class="ri-realtor-draft">Unsaved contact</span>':''}</td><td><span class="ri-preview">${escape(realtor.phone)||'—'}</span><span class="ri-preview ri-secondary">${escape(realtor.email)}</span></td><td><span class="ri-preview">${escape(realtor.location)||'—'}</span></td><td><span class="ri-preview">${escape(last?.contacted_date)||'—'}</span><span class="ri-preview ri-secondary">${escape(last?.notes)}</span></td><td><div class="ri-actions"><button type="button" class="tr-button tr-button-subtle" data-control data-action="history" data-id="${realtor.id}" data-count="${active.length}">Open history</button><button type="button" class="tr-button tr-button-primary" data-control data-action="log-contact" data-id="${realtor.id}">${draft?'Resume contact':'Log contact'}</button></div></td></tr><tr class="tr-row-error" data-error-id="realtor:${realtor.id}"${editor?.error?'':' hidden'}><td colspan="5"><span data-row-error role="alert">${escape(editor?.error)}</span> <button type="button" data-action="retry" data-kind="realtor" data-id="${realtor.id}">Retry</button></td></tr>`;
  }
  function renderDetail(){const realtor=state.realtors.find(row=>row.id===state.expanded&&!row.deleted_at);if(!realtor)state.expanded=null;$('directoryView').hidden=Boolean(realtor);$('realtorDetailView').hidden=!realtor;$('realtorDetails').innerHTML=realtor?renderHistory(realtor):'';}
  function renderDeleted() {
    const deleted=sortRealtors(state.realtors.filter(row=>row.deleted_at));$('deletedCount').textContent=deleted.length;
    $('deletedList').innerHTML=deleted.length?deleted.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.realtor_name)||'Unnamed realtor'}</strong><span>${escape(row.location)} · ${contactsFor(row.id).filter(contact=>!contact.deleted_at).length} contacts retained</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${row.id}" data-kind="realtor">Restore</button></div>`).join(''):'<p>No deleted realtors.</p>';
    if($('deletedContactList')){const contacts=sortContacts(contactsFor(state.expanded).filter(row=>row.deleted_at));$('deletedContactCount').textContent=contacts.length;$('deletedContactList').innerHTML=contacts.length?contacts.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.contacted_date)||'Undated contact'}</strong><span>${escape(row.notes)||'No notes recorded'}</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${row.id}" data-kind="contact">Restore</button></div>`).join(''):'<p>No deleted contacts.</p>';}
  }
  function renderDirectory() {
    const rows=visibleRealtors();$('realtorRows').innerHTML=rows.map(renderRealtor).join('');
    const total=state.realtors.filter(row=>!row.deleted_at).length;$('rowCount').textContent=rows.length===total?`${total} ${total===1?'realtor':'realtors'}`:`${rows.length} of ${total} realtors`;
    $('emptyState').hidden=Boolean(rows.length)||!state.ready;$('clearSearch').hidden=!state.query;renderDetail();renderDeleted();controls();
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
  function takeContactInput(input) {
    const editor=state.contactEditor,key=input.dataset.contactField;
    if(!editor||!keys(editor).includes(key)||editor.saving||editor.deleting||editor.deleteAttempt||parentBusy(editor.realtorId))return;
    const original=editor.base?text(editor.base[key]):'';editor.values[key]=input.value===normalized(original)?original:input.value;editor.touched=true;if(!editor.conflict)editor.error='';controls();
  }
  async function fetchRow(id,kind='contact'){const result=await supabaseClient.from(TYPES[kind].table).select('*').eq('id',id).maybeSingle();if(result.error)throw result.error;return result.data;}
  function changedPatch(editor){return Object.fromEntries(keys(editor).filter(key=>!editor.base||editor.values[key]!==text(editor.base[key])).map(key=>[key,editor.values[key]]));}
  function accept(editor,saved){editor.base={...saved};editor.attempt=null;editor.error='';editor.conflict=false;editor.saveFailed=false;remember(saved,editor.kind);}
  function syncUntouchedCells(editor){
    if(editor===state.dialogEditor)for(const [key,id]of FORM_FIELDS)if(document.activeElement!==$(id))$(id).value=editor.values[key];
    if(editor===state.contactEditor)for(const [key,id]of CONTACT_INPUTS)if(document.activeElement!==$(id))$(id).value=editor.values[key];
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
    }catch(error){if(current(epoch)){editor.error=errorText(error);editor.saveFailed=true;editor.conflict=error?.code==='CONFLICT';if(editor.kind==='contact'&&error?.code==='42501')await reconcileParent(editor,epoch);}}
    finally{if(current(epoch)){editor.saving=null;controls();if(!tableFocused()&&!dialogOpen()&&!unfinished())renderDirectory();}}})();editor.saving=task;controls();return task;
  }
  async function reconcileParent(editor,epoch){
    try{const fresh=await fetchRow(editor.realtorId,'realtor');if(!current(epoch))return;if(fresh?.deleted_at){remember(fresh,'realtor');editor.parentDeleted=true;editor.error='This realtor was deleted. Restore it from Deleted realtors to continue. Your contact draft is kept.';renderDirectory();$('deletedSection').open=true;}}
    catch{/* Keep the original error and draft if the parent cannot be checked. */}
  }
  async function flushContacts(ownRealtor=null){return ![...state.editors.values()].some(editor=>editor.kind==='contact'&&editor.realtorId!==ownRealtor&&(dirty(editor)||editor.error||editor.saving||editor.deleting));}
  async function expandRealtor(id,{add=false}={}){
    if(!state.ready||state.loading||state.undoSaving||dialogOpen())return;const epoch=state.epoch;if(!await flushContacts(id)||!current(epoch)){message('Save, cancel or resume the current contact before opening another realtor.');return;}
    const realtor=state.realtors.find(row=>row.id===id&&!row.deleted_at);if(!realtor||parentBusy(id))return;state.expanded=id;renderDirectory();message('');$('realtorsPage').scrollIntoView?.({block:'start'});if(add)addContact(id);else $('backRealtors').focus({preventScroll:true});
  }
  function backToRealtors(){
    if(state.loading||state.undoSaving||dialogOpen()||[...state.editors.values()].some(editor=>editor.saving||editor.deleting))return;
    const id=state.expanded;state.expanded=null;renderDirectory();document.querySelector(`[data-action="history"][data-id="${id}"]`)?.focus({preventScroll:true});
  }
  function addContact(id=state.expanded){
    return openContact(id);
  }
  function fillContactForm(editor){
    $('contactDialogTitle').textContent=editor.base?'Edit contact':'Log contact';
    $('contactRealtorName').textContent=state.realtors.find(row=>row.id===editor.realtorId)?.realtor_name||'Realtor';
    for(const [key,id]of CONTACT_INPUTS)$(id).value=editor.values[key];controls();
  }
  function openContact(id=state.expanded,contactId=null){
    if(!state.ready||state.loading||state.undoSaving)return;
    if($('contactDialog').open)return state.contactEditor;
    if(dialogOpen()||parentBusy(id))return;
    const realtor=state.realtors.find(row=>row.id===id&&!row.deleted_at);if(!realtor)return;
    let editor;
    if(contactId){const row=state.contacts.find(row=>row.id===contactId&&row.realtor_id===id&&!row.deleted_at);editor=state.editors.get(keyOf('contact',contactId))||(row?editorFor(row):null);if(!editor||editor.realtorId!==id)return;}
    else editor=pendingContact(id);
    if(!editor){editor={id:crypto.randomUUID(),kind:'contact',realtorId:id,base:null,values:{...valuesOf(null),contacted_date:today()},touched:false,order:++state.newOrder,saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(editorMapKey(editor),editor);}
    if(editor.saving||editor.deleting||editor.deleteAttempt)return;
    state.expanded=id;renderDirectory();state.contactEditor=editor;fillContactForm(editor);$('contactDialog').showModal();$('contactNotes').focus();controls();return editor;
  }
  function closeContactDialog(){
    const editor=state.contactEditor;if(editor?.saving||editor?.deleting)return;
    if(editor&&!editor.attempt&&!editor.saveFailed)state.editors.delete(editorMapKey(editor));
    state.contactEditor=null;if($('contactDialog').open)$('contactDialog').close();for(const [,id]of CONTACT_INPUTS)$(id).value='';$('contactFormError').textContent='';renderDirectory();
    const target=state.expanded?document.querySelector(`[data-action="add-contact"][data-id="${state.expanded}"]`):$('searchRealtors');target?.focus({preventScroll:true});$('realtorsPage').scrollIntoView?.({block:'start'});
  }
  async function submitContact(event){
    event?.preventDefault();const editor=state.contactEditor;if(!editor||editor.saving||editor.deleting||editor.conflict||editor.parentDeleted)return;
    for(const [,id]of CONTACT_INPUTS)takeContactInput($(id));
    if(!populated(editor)){editor.error='Enter at least one contact detail.';controls();$('contactNotes').focus();return;}
    const epoch=state.epoch;await saveEditor(editor);if(!current(epoch))return;
    if(!editor.error&&!dirty(editor)){closeContactDialog();toast('Contact saved.');}
  }
  async function deleteRow(editor){
    if(!editor||!state.ready||state.loading||state.undoSaving||editor.saving||editor.deleting||editor.kind==='contact'&&parentBusy(editor.realtorId))return;
    if(editor.kind==='realtor'&&(state.contactEditor?.realtorId===editor.id||[...state.editors.values()].some(e=>e.kind==='contact'&&e.realtorId===editor.id&&(dirty(e)||e.saving||e.deleting||e.deleteAttempt||e.error)))){message('Finish the contacts or remove unused drafts before deleting this realtor.');return;}
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
      remember(saved,kind);if(kind==='realtor'){for(const editor of state.editors.values())if(editor.kind==='contact'&&editor.realtorId===saved.id&&editor.parentDeleted){editor.parentDeleted=false;editor.error='The realtor is restored. Retry to save your contact.';if(state.contactEditor?.realtorId===saved.id||!state.expanded&&!dialogOpen())state.expanded=saved.id;}}renderDeleted();if(!tableFocused()&&!dialogOpen())renderDirectory();message('');toast(kind==='realtor'?'Realtor restored.':'Contact restored.');
    }catch(error){if(current(epoch))message(errorText(error),true);}finally{if(current(epoch)){state.undoSaving=false;$('undoDelete').disabled=false;controls();}}
  }
  async function reloadRow(editor){
    if(!editor||editor.saving||!state.ready)return;const epoch=state.epoch;try{await requireStaff(epoch);const fresh=await fetchRow(editor.id,editor.kind);if(!current(epoch))return;if(fresh)remember(fresh,editor.kind);else state[editor.kind==='realtor'?'realtors':'contacts']=collection(editor.kind).filter(row=>row.id!==editor.id);state.editors.delete(editorMapKey(editor));
      if(editor===state.dialogEditor){state.dialogEditor=fresh&&!fresh.deleted_at?editorFor(fresh,'realtor'):null;if(state.dialogEditor)fillRealtorForm(state.dialogEditor);else closeRealtorDialog();}
      if(editor===state.contactEditor){state.contactEditor=fresh&&!fresh.deleted_at?editorFor(fresh):null;if(state.contactEditor)fillContactForm(state.contactEditor);else closeContactDialog();}renderDirectory();message('');
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
    if(editor&&!editor.attempt&&!editor.saveFailed)state.editors.delete(editorMapKey(editor));state.dialogEditor=null;if($('realtorDialog').open)$('realtorDialog').close();for(const [,id] of FORM_FIELDS)$(id).value='';$('realtorFormError').textContent='';controls();
  }
  function takeRealtorInput(input){const editor=state.dialogEditor,key=input.dataset.realtorField;if(!editor||!keys(editor).includes(key)||editor.saving)return;const original=editor.base?text(editor.base[key]):'';editor.values[key]=input.value===normalized(original)?original:input.value;editor.touched=true;if(!editor.conflict)editor.error='';controls();}
  async function submitRealtor(event){
    event?.preventDefault();const editor=state.dialogEditor;if(!editor||editor.saving||editor.conflict)return;
    for(const id of FORM_FIELDS.map(([,id])=>id))takeRealtorInput($(id));
    if(!populated(editor)){editor.error='Enter any realtor detail.';controls();$('realtorName').focus();return;}
    const epoch=state.epoch;await saveEditor(editor);if(!current(epoch))return;if(!editor.error&&!dirty(editor)){closeRealtorDialog();renderDirectory();toast('Realtor saved.');}
  }
  function resetAuth(userId){
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;state.realtors=[];state.contacts=[];state.editors.clear();state.expanded=null;state.dialogEditor=null;state.contactEditor=null;state.openingRealtor=false;state.undo=null;state.undoSaving=false;clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';$('undoDelete').disabled=false;if($('realtorDialog').open)$('realtorDialog').close();if($('contactDialog').open)$('contactDialog').close();for(const [,id]of [...FORM_FIELDS,...CONTACT_INPUTS])$(id).value='';$('contactFormError').textContent='';$('realtorFormError').textContent='';renderDirectory();message(userId?'Loading realtors…':'Sign in to Paws HQ to view realtor info.');
  }
  function clearSearch(){state.query='';$('searchRealtors').value='';renderDirectory();$('searchRealtors').focus();}
  function init(){
    if(!$('realtorsPage'))return;
    $('addRealtor').addEventListener('click',()=>openRealtor());$('refreshLogs').addEventListener('click',()=>refresh());$('undoDelete').addEventListener('click',()=>undoDelete());
    $('backRealtors').addEventListener('click',backToRealtors);$('clearSearch').addEventListener('click',clearSearch);
    $('searchRealtors').addEventListener('input',()=>{state.query=$('searchRealtors').value;renderDirectory();});
    $('realtorForm').addEventListener('submit',submitRealtor);$('realtorForm').addEventListener('input',event=>{if(event.target.dataset.realtorField)takeRealtorInput(event.target);});$('realtorForm').addEventListener('change',event=>{if(event.target.dataset.realtorField)takeRealtorInput(event.target);});$('closeRealtorDialog').addEventListener('click',closeRealtorDialog);$('reloadRealtor').addEventListener('click',()=>reloadRow(state.dialogEditor));$('realtorDialog').addEventListener('cancel',event=>{event.preventDefault();closeRealtorDialog();});
    $('contactForm').addEventListener('submit',submitContact);$('contactForm').addEventListener('input',event=>{if(event.target.dataset.contactField)takeContactInput(event.target);});$('contactForm').addEventListener('change',event=>{if(event.target.dataset.contactField)takeContactInput(event.target);});$('closeContactDialog').addEventListener('click',closeContactDialog);$('reloadContact').addEventListener('click',()=>reloadRow(state.contactEditor));$('contactDialog').addEventListener('cancel',event=>{event.preventDefault();closeContactDialog();});
    $('realtorsPage').addEventListener('click',event=>{const restore=event.target.closest('[data-restore-row]');if(restore){const kind=restore.dataset.kind,row=collection(kind).find(item=>item.id===restore.dataset.restoreRow);if(row)undoDelete({kind,row});return;}const button=event.target.closest('[data-action]');if(!button)return;const {action}=button.dataset,id=button.dataset.id||button.closest('[data-row-id]')?.dataset.rowId,kind=button.dataset.kind||'contact',editor=state.editors.get(keyOf(kind,id));
      if(action==='history')expandRealtor(id);if(action==='log-contact')expandRealtor(id,{add:true});if(action==='add-contact')addContact(id);if(action==='edit-contact'){const row=state.contacts.find(item=>item.id===id),draft=state.editors.get(keyOf('contact',id));openContact(row?.realtor_id||draft?.realtorId,id);}if(action==='edit-realtor')openRealtor(id);if(action==='delete-realtor'){const row=state.realtors.find(item=>item.id===id);if(row)deleteRow(editorFor(row,'realtor'));}if(action==='delete')deleteRow(editor);if(action==='retry')saveEditor(editor);if(action==='reload')reloadRow(editor);if(action==='clear-search')clearSearch();
    });
    window.addEventListener('beforeunload',event=>{if(unfinished()){event.preventDefault();event.returnValue='';}});window.addEventListener('online',()=>refresh({silent:true}));window.addEventListener('focus',()=>refresh({silent:true}));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({silent:true});});setInterval(()=>{if(!document.hidden)refresh({silent:true});},30000);
    window.addEventListener('paws-access-revoked',()=>resetAuth(null));
    if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{const id=session?.user?.id||null,changed=event==='SIGNED_OUT'||id!==state.userId;if(changed)resetAuth(id);if(id)setTimeout(()=>refresh({silent:!changed}),0);});refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
