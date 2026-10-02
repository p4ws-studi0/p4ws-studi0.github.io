/* Paws HQ dog license tracker. Shared, compact, reversible row editing. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const FIELDS = [['pet_name','Pet name',120],['request_type','Renewal or registration?',80],['initials','Initials',120]];
  const KEYS = FIELDS.map(([key]) => key);
  const state = {logs:[],editors:new Map(),ready:false,loading:false,userId:null,epoch:0,request:0,undo:null,undoSaving:false,toastTimer:null,newOrder:0};
  const text = value => String(value ?? '');
  const escape = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nonblank = value => text(value).trim().length > 0;
  const normalized = value => text(value).replace(/\r\n?/g,'\n');
  const current = epoch => epoch === state.epoch;
  const valuesOf = row => Object.fromEntries(KEYS.map(key => [key,text(row?.[key])]));
  const same = (a,b) => Object.keys(a).every(key => a[key] === b[key]);
  const position = row => BigInt(row.position ?? 0);
  const sourceOrder = (a,b) => position(a)<position(b) ? -1 : position(a)>position(b) ? 1 : text(a.id).localeCompare(text(b.id));
  function sortLogs(rows) {return [...rows].sort((a,b)=>-sourceOrder(a,b));}
  function dirty(editor) {return !editor.base || !same(editor.values,valuesOf(editor.base));}
  const unfinished = () => state.undoSaving||[...state.editors.values()].some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error);
  const tableFocused = () => Boolean(document.activeElement?.closest?.('#licenseRows'));
  function errorText(error) {
    if(error?.code==='AUTH') return 'Sign in again to save. Your changes are still here.';
    if(error?.code==='ACCESS'||error?.code==='42501') return 'This account does not have dog license access.';
    if(error?.code==='CONFLICT') return 'This row changed on another device. Your changes are still here. Copy them before reloading this row.';
    if(['42P01','PGRST205'].includes(error?.code)) return 'License records are unavailable. Please try again later.';
    return 'Could not save. Your changes are still here. Check your connection, then retry.';
  }
  function message(value,error=false) {$('pageMessage').textContent=value;$('pageMessage').hidden=!value;$('pageMessage').classList.toggle('is-error',error);}
  function toast(value,undo=null) {
    clearTimeout(state.toastTimer);state.undo=undo;
    $('toastText').textContent=value;$('undoDelete').hidden=!undo;$('toast').hidden=false;
    state.toastTimer=setTimeout(()=>{$('toast').hidden=true;},5000);
    controls();
  }
  function editorFor(row) {
    let editor=state.editors.get(row.id);
    if(!editor) {editor={id:row.id,base:{...row},values:valuesOf(row),saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(row.id,editor);}
    return editor;
  }
  function rowElement(id) {return document.querySelector(`[data-row-id="${id}"]`);}
  function controls() {
    const blocked=!state.ready||state.loading;
    $('addRow').disabled=blocked||state.undoSaving;
    $('refreshLogs').disabled=state.loading||state.undoSaving;
    document.querySelectorAll('[data-restore-row]').forEach(button=>{button.disabled=blocked||state.undoSaving;});
    const editors=[...state.editors.values()];
    $('saveStatus').textContent=state.loading?'Loading…':editors.some(e=>e.saving||e.deleting)||state.undoSaving?'Saving…':editors.some(e=>e.error)?'Some changes are not saved':editors.some(e=>dirty(e))?'Unsaved changes':state.ready?'All changes saved':'';
    for(const editor of editors) updateRowStatus(editor);
  }
  function updateRowStatus(editor) {
    const row=rowElement(editor.id);if(!row)return;
    row.classList.toggle('is-saving',Boolean(editor.saving||editor.deleting));
    row.classList.toggle('is-error',Boolean(editor.error));
    row.querySelectorAll('[data-field]').forEach(input=>{input.disabled=!state.ready||state.loading||editor.deleting||Boolean(editor.deleteAttempt);});
    const button=row.querySelector('[data-action="delete"]');if(button)button.disabled=!state.ready||state.loading||state.undoSaving||Boolean(editor.saving||editor.deleting);
    const errorRow=document.querySelector(`[data-error-id="${editor.id}"]`);
    if(errorRow) {
      errorRow.hidden=!editor.error;
      errorRow.querySelector('[data-row-error]').textContent=editor.error;
      const action=errorRow.querySelector('button');
      action.textContent=editor.conflict?'Reload row':'Retry';action.dataset.action=editor.conflict?'reload':editor.deleteAttempt?'delete':'retry';
      action.disabled=Boolean(editor.saving||editor.deleting)||!state.ready;
    }
  }
  function renderRow(editor) {
    const cells=FIELDS.map(([key,label,limit])=>{
      if(key==='request_type') {
        const choices=['','Renewal','Registration'];if(!choices.includes(editor.values[key]))choices.push(editor.values[key]);
        return `<td class="tr-cell"><select class="dl-type" data-field="${key}" aria-label="${label}">${choices.map(value=>`<option value="${escape(value)}"${value===editor.values[key]?' selected':''}>${escape(value)||'Choose…'}</option>`).join('')}</select></td>`;
      }
      return `<td class="tr-cell"><textarea class="tr-cell-input" data-field="${key}" rows="1" maxlength="${limit}" aria-label="${label}" spellcheck="false">${escape(editor.values[key])}</textarea></td>`;
    }).join('');
    return `<tr class="tr-row" data-row-id="${editor.id}">${cells}<td class="tr-action-cell"><button type="button" class="tr-delete" data-action="delete" aria-label="Delete row">Delete</button></td></tr><tr class="tr-row-error" data-error-id="${editor.id}" hidden><td colspan="4"><span data-row-error role="alert"></span> <button type="button" data-action="retry" data-id="${editor.id}">Retry</button></td></tr>`;
  }
  function renderDeleted() {
    const deleted=sortLogs(state.logs.filter(row=>row.deleted_at));
    $('deletedCount').textContent=deleted.length;
    $('deletedList').innerHTML=deleted.length?deleted.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(row.pet_name)||'Unnamed pet'}</strong><span>${[row.request_type,row.initials].filter(Boolean).map(escape).join(' · ')}</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-row="${escape(row.id)}" aria-label="Restore ${escape(row.pet_name)||'entry'}">Restore</button></div>`).join(''):'<p>No deleted entries.</p>';
  }
  function renderRows() {
    const rows=sortLogs(state.logs.filter(row=>!row.deleted_at)).map(editorFor);
    const fresh=[...state.editors.values()].filter(e=>!e.base).sort((a,b)=>b.order-a.order);
    const editors=[...fresh,...rows];
    $('licenseRows').innerHTML=editors.map(renderRow).join('');
    $('rowCount').textContent=`${editors.length} ${editors.length===1?'entry':'entries'}`;
    $('emptyState').hidden=Boolean(editors.length)||!state.ready;
    $('emptyState').textContent='No license entries yet. Add a row to get started.';
    renderDeleted();
    controls();
  }
  function render() {renderRows();}
  function remember(row) {
    const index=state.logs.findIndex(item=>item.id===row.id);
    if(index<0)state.logs.push(row);else state.logs[index]=row;
  }
  async function requireStaff(epoch) {
    if(typeof supabaseClient==='undefined')throw {code:'AUTH'};
    const {data,error}=await supabaseClient.auth.getSession();
    if(!current(epoch)||error||!data?.session?.user)throw {code:'AUTH'};
    const id=data.session.user.id;
    const result=await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',id).eq('active',true).maybeSingle();
    if(!current(epoch))throw {code:'AUTH'};
    if(result.error)throw result.error;if(!result.data)throw {code:'ACCESS'};
    state.userId=id;
  }
  async function fetchAll(table,valid) {
    let rows=[];
    for(let offset=0;;offset+=500) {
      const {data,error}=await supabaseClient.from(table).select('*').order('id',{ascending:true}).range(offset,offset+499);
      if(!valid())return [];if(error)throw error;rows.push(...(data||[]));if(!data||data.length<500)return rows;
    }
  }
  async function refresh({silent=false}={}) {
    if(state.loading||state.undoSaving)return;
    if(unfinished()||tableFocused()) {if(!silent)message('Your current edits are kept. Finish editing or retry any unsaved rows before refreshing.');return;}
    const epoch=state.epoch,request=++state.request,valid=()=>current(epoch)&&request===state.request;
    state.loading=true;controls();if(!silent)message('Loading license entries…');
    try {
      await requireStaff(epoch);if(!valid())return;
      const logs=await fetchAll('hq_dog_licenses',valid);if(!valid())return;
      state.logs=logs;state.editors.clear();state.ready=true;
      message('');
    } catch(error) {
      if(!valid())return;
      state.ready=false;
      if(['AUTH','ACCESS','42501'].includes(error?.code)){state.logs=[];state.editors.clear();}
      message(errorText(error),true);
    } finally {if(valid()){state.loading=false;render();}}
  }
  function takeInput(input) {
    const row=input.closest('[data-row-id]'),key=input.dataset.field;
    const editor=state.editors.get(row?.dataset.rowId);if(!editor||!KEYS.includes(key)||editor.deleting)return;
    const original=editor.base ? text(editor.base[key]) : '';
    editor.values[key]=input.value===normalized(original)?original:input.value;
    if(!editor.conflict)editor.error='';
    resize(input);controls();
  }
  function resize(input) {
    if(document.activeElement!==input||input.tagName==='SELECT')return;
    input.style.height='auto';input.style.height=`${Math.min(220,Math.max(44,input.scrollHeight))}px`;
  }
  async function fetchRow(id) {
    const result=await supabaseClient.from('hq_dog_licenses').select('*').eq('id',id).maybeSingle();
    if(result.error)throw result.error;return result.data;
  }
  function changedPatch(editor) {
    return Object.fromEntries(KEYS.filter(key=>!editor.base||editor.values[key]!==text(editor.base[key])).map(key=>[key,editor.values[key]]));
  }
  function accept(editor,saved) {editor.base={...saved};editor.attempt=null;editor.error='';editor.conflict=false;remember(saved);}
  async function reconcile(editor,epoch) {
    const attempt=editor.attempt;if(!attempt)return;
    const fresh=await fetchRow(editor.id);if(!current(epoch))return;
    if(!fresh) {if(!attempt.base){editor.attempt=null;return;}throw {code:'CONFLICT'};}
    if(fresh.deleted_at)throw {code:'CONFLICT'};
    if(same(attempt.patch,fresh)) {
      if(attempt.base)for(const key of KEYS)if(!(key in attempt.patch)&&editor.values[key]===text(attempt.base[key]))editor.values[key]=text(fresh[key]);
      accept(editor,fresh);syncUntouchedCells(editor);return;
    }
    if(attempt.base && Object.keys(attempt.patch).every(key=>text(fresh[key])===text(attempt.base[key]))) {
      // A teammate changed other cells. Keep them while retaining this row's local edits.
      for(const key of KEYS)if(editor.values[key]===text(attempt.base[key]))editor.values[key]=text(fresh[key]);
      accept(editor,fresh);syncUntouchedCells(editor);return;
    }
    throw {code:'CONFLICT'};
  }
  function syncUntouchedCells(editor) {
    const row=rowElement(editor.id);if(!row)return;
    row.querySelectorAll('[data-field]').forEach(input=>{if(document.activeElement!==input)input.value=editor.values[input.dataset.field];});
  }
  function saveEditor(editor) {
    if(!editor||editor.deleting||editor.deleteAttempt||editor.conflict||!state.ready)return Promise.resolve();
    if(editor.saving)return editor.saving;
    if(!dirty(editor))return Promise.resolve();
    if(!KEYS.some(key=>nonblank(editor.values[key]))) {
      if(editor.base){editor.error='This row is empty. Enter any detail, or delete the row.';controls();}
      return Promise.resolve();
    }
    const epoch=state.epoch;
    const task=(async()=>{
      try {
        await requireStaff(epoch);if(!current(epoch))return;
        if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
        while(dirty(editor)&&KEYS.some(key=>nonblank(editor.values[key]))) {
          const patch=changedPatch(editor),base=editor.base?{...editor.base}:null;
          editor.attempt={base,patch};
          let result;
          if(base)result=await supabaseClient.from('hq_dog_licenses').update(patch).eq('id',editor.id).eq('revision',base.revision).select('*').maybeSingle();
          else result=await supabaseClient.from('hq_dog_licenses').insert({id:editor.id,...patch}).select('*').single();
          if(!current(epoch))return;
          if(result.error?.code==='23505'||!result.error&&!result.data){await reconcile(editor,epoch);if(!current(epoch))return;continue;}
          if(result.error)throw result.error;
          accept(editor,result.data);
          // Do not replace cells or move a focused row when another save completes.
        }
        if(dirty(editor)&&editor.base&&!KEYS.some(key=>nonblank(editor.values[key])))editor.error='This row is empty. Enter any detail, or delete the row.';
        message('');
      } catch(error) {if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';}}
      finally {if(current(epoch)){editor.saving=null;controls();if(!tableFocused()&&!unfinished())renderRows();}}
    })();
    editor.saving=task;controls();return task;
  }
  function addRow() {
    if(!state.ready||state.loading||state.undoSaving)return;
    const id=crypto.randomUUID(),values=valuesOf(null);
    state.editors.set(id,{id,base:null,values,order:++state.newOrder,saving:null,deleting:false,error:'',conflict:false,attempt:null});
    renderRows();rowElement(id)?.querySelector('[data-field="pet_name"]')?.focus();
    $('tableScroll').scrollTop=0;
  }
  async function deleteRow(editor) {
    if(!editor||!state.ready||state.loading||state.undoSaving||editor.saving||editor.deleting)return;
    if(!editor.base&&!editor.attempt){state.editors.delete(editor.id);renderRows();toast('Row removed.');return;}
    const epoch=state.epoch;editor.deleting=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
      if(!editor.base){state.editors.delete(editor.id);renderRows();return;}
      if(editor.deleteAttempt) {
        const fresh=await fetchRow(editor.id);if(!current(epoch))return;
        if(fresh?.deleted_at){remember(fresh);state.editors.delete(editor.id);renderRows();$('deletedSection').open=true;toast('Entry deleted.',fresh);return;}
        if(!fresh||fresh.revision!==editor.base.revision)throw {code:'CONFLICT'};
      }
      editor.deleteAttempt=true;
      const result=await supabaseClient.from('hq_dog_licenses').update({deleted_at:new Date().toISOString()}).eq('id',editor.id).eq('revision',editor.base.revision).select('*').maybeSingle();
      if(!current(epoch))return;if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};
      remember(result.data);state.editors.delete(editor.id);renderRows();$('deletedSection').open=true;toast('Entry deleted.',result.data);
    } catch(error) {if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';}}
    finally {if(current(epoch)){editor.deleting=false;controls();}}
  }
  async function undoDelete(row=state.undo) {
    if(!row||!state.ready||state.loading||state.undoSaving)return;
    const epoch=state.epoch;state.undoSaving=true;$('undoDelete').disabled=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      const result=await supabaseClient.from('hq_dog_licenses').update({deleted_at:null}).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();
      if(!current(epoch))return;
      let saved=result.data;
      if(result.error||!saved){const fresh=await fetchRow(row.id);if(!current(epoch))return;if(fresh&&!fresh.deleted_at)saved=fresh;else throw result.error||{code:'CONFLICT'};}
      remember(saved);renderDeleted();if(!tableFocused())renderRows();toast('Entry restored.');
    } catch(error){if(current(epoch))message(errorText(error),true);}
    finally{if(current(epoch)){state.undoSaving=false;$('undoDelete').disabled=false;controls();}}
  }
  async function reloadRow(editor) {
    if(!editor||editor.saving||!state.ready)return;
    const epoch=state.epoch;
    try {
      await requireStaff(epoch);const fresh=await fetchRow(editor.id);if(!current(epoch))return;
      if(fresh)remember(fresh);else state.logs=state.logs.filter(row=>row.id!==editor.id);
      state.editors.delete(editor.id);renderRows();message('');
    }catch(error){if(current(epoch)){editor.error=errorText(error);controls();}}
  }
  function resetAuth(userId) {
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;
    state.logs=[];state.editors.clear();state.undo=null;state.undoSaving=false;
    clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';$('undoDelete').disabled=false;
    render();message(userId?'Loading license entries…':'Sign in to Paws HQ to view license entries.');
  }
  function init() {
    if(!$('licensesPage'))return;
    $('addRow').addEventListener('click',addRow);
    $('deletedList').addEventListener('click',event=>{const button=event.target.closest('[data-restore-row]');if(button)undoDelete(state.logs.find(row=>row.id===button.dataset.restoreRow));});
    $('refreshLogs').addEventListener('click',()=>refresh());$('undoDelete').addEventListener('click',()=>undoDelete());
    $('licenseRows').addEventListener('input',event=>{if(event.target.matches('[data-field]'))takeInput(event.target);});
    $('licenseRows').addEventListener('change',event=>{if(event.target.dataset.field==='request_type'){takeInput(event.target);saveEditor(state.editors.get(event.target.closest('[data-row-id]')?.dataset.rowId));}});
    $('licenseRows').addEventListener('focusin',event=>{if(event.target.matches('[data-field]'))resize(event.target);});
    $('licenseRows').addEventListener('pointerdown',event=>{
      const button=event.target.closest('[data-action="delete"]');
      const editor=state.editors.get(button?.closest('[data-row-id]')?.dataset.rowId);
      if(editor)editor.skipBlurSave=true;
    });
    $('licenseRows').addEventListener('focusout',event=>{
      const input=event.target;if(!input.matches('[data-field]'))return;
      const editor=state.editors.get(input.closest('[data-row-id]')?.dataset.rowId);input.style.height='';
      if(editor?.skipBlurSave){editor.skipBlurSave=false;return;}
      // Pointer clicks can delete directly; keyboard Tab still saves the last cell.
      const epoch=state.epoch;
      setTimeout(async()=>{
        if(editor&&state.editors.get(editor.id)===editor&&!editor.deleting)await saveEditor(editor);
        if(current(epoch)&&!tableFocused()&&!unfinished())renderRows();
      },0);
    });
    $('licenseRows').addEventListener('keydown',event=>{
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.target.blur();}
      else if(event.key==='Escape'&&event.target.matches('[data-field]'))event.target.blur();
    });
    $('licenseRows').addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button)return;
      const id=button.dataset.id||button.closest('[data-row-id]')?.dataset.rowId,editor=state.editors.get(id);
      if(button.dataset.action==='delete')deleteRow(editor);
      if(button.dataset.action==='retry')saveEditor(editor);
      if(button.dataset.action==='reload')reloadRow(editor);
    });
    window.addEventListener('beforeunload',event=>{if(unfinished()){event.preventDefault();event.returnValue='';}});
    window.addEventListener('online',()=>refresh({silent:true}));
    window.addEventListener('focus',()=>refresh({silent:true}));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({silent:true});});
    setInterval(()=>{if(!document.hidden)refresh({silent:true});},30000);
    if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{
      const id=session?.user?.id||null,changed=event==='SIGNED_OUT'||id!==state.userId;
      if(changed)resetAuth(id);if(id)setTimeout(()=>refresh({silent:!changed}),0);
    });
    refresh();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
