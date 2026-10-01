/* Compact Paws HQ training sheet. All original cell values remain literal text. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const FIELDS = [
    ['day_label','Day',40], ['date_label','Date',40], ['session_label','Session',40],
    ['time_label','Time',100], ['trainer','Trainer',120],
    ['work_detail','Work detail',6000], ['notes','Notes',10000]
  ];
  const KEYS = FIELDS.map(([key]) => key);
  const state = {dogs:[],logs:[],editors:new Map(),selectedDog:null,ready:false,loading:false,
    userId:null,epoch:0,request:0,dogSaving:false,dogDraftId:null,undo:null,undoSaving:false,toastTimer:null,newOrder:0};
  const text = value => String(value ?? '');
  const escape = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nonblank = value => text(value).trim().length > 0;
  const normalized = value => text(value).replace(/\r\n?/g,'\n');
  const current = epoch => epoch === state.epoch;
  const valuesOf = row => Object.fromEntries(KEYS.map(key => [key,text(row?.[key])]));
  const same = (a,b) => Object.keys(a).every(key => a[key] === b[key]);
  const position = row => BigInt(row.position ?? 0);
  const sourceOrder = (a,b) => position(a)<position(b) ? -1 : position(a)>position(b) ? 1 : text(a.id).localeCompare(text(b.id));
  function todayLabel() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    return `${parts.month}/${parts.day}/${parts.year}`;
  }
  function parseDateLabel(label) {
    const raw=text(label).trim(); let year,month,day,match;
    if ((match=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [,year,month,day]=match;
    else if ((match=raw.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{2}|\d{4}))?$/))) [,month,day,year]=match;
    else if ((match=raw.match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i))) {
      month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0,3).toLowerCase())+1;
      day=match[2];year=match[3];
    } else return null;
    const hasYear=year!==undefined;
    year=hasYear ? Number(year)+(String(year).length===2 ? 2000 : 0) : null;
    month=Number(month);day=Number(day);
    const checkYear=year ?? 2000;
    const days=[31,(checkYear%4===0&&(checkYear%100!==0||checkYear%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
    if(month<1||month>12||day<1||day>days[month-1]||hasYear&&(year<1000||year>9999)) return null;
    return {year,month,day};
  }
  function sortLogs(rows) {
    const ordered=[...rows].sort(sourceOrder);
    // Yearless dates stay literal. Their immutable creation year anchors display sorting,
    // so adding a future date never changes historical sort keys. Undated rows retain
    // their place beside their source neighbors; this never fills in stored date cells.
    const parsed=ordered.map(row=>parseDateLabel(row.date_label));
    const keys=parsed.map((date,index)=>{
      const year=date?.year ?? Number(text(ordered[index].created_at).match(/^(\d{4})-/)?.[1]);
      return date&&year ? year*372+date.month*31+date.day : null;
    });
    let previous=keys.find(key=>key!==null) ?? 0;
    const keyed=ordered.map((row,index)=>{if(keys[index]!==null) previous=keys[index];return {row,key:previous};});
    return keyed.sort((a,b)=>b.key-a.key || -sourceOrder(a.row,b.row)).map(item=>item.row);
  }
  function dirty(editor) {return !editor.base || !same(editor.values,valuesOf(editor.base));}
  const unfinished = () => state.undoSaving||[...state.editors.values()].some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error);
  const tableFocused = () => Boolean(document.activeElement?.closest?.('#trainingRows'));
  function errorText(error) {
    if(error?.code==='AUTH') return 'Sign in again to save. Your changes are still here.';
    if(error?.code==='ACCESS'||error?.code==='42501') return 'This account does not have training access.';
    if(error?.code==='CONFLICT') return 'This row changed on another device. Your changes are still here. Copy them before reloading this row.';
    if(['42P01','PGRST205'].includes(error?.code)) return 'Training records are unavailable. Please try again later.';
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
    if(!editor) {editor={id:row.id,dog_id:row.dog_id,base:{...row},values:valuesOf(row),saving:null,deleting:false,error:'',conflict:false,attempt:null};state.editors.set(row.id,editor);}
    return editor;
  }
  function rowElement(id) {return document.querySelector(`[data-row-id="${id}"]`);}
  function controls() {
    const blocked=!state.ready||state.loading;
    $('addRow').disabled=blocked||!state.selectedDog;
    $('addDog').disabled=blocked||state.dogSaving;
    $('dogSelect').disabled=blocked||!state.dogs.length;
    $('refreshLogs').disabled=state.loading||state.dogSaving;
    $('saveDog').disabled=blocked||state.dogSaving;
    $('cancelDog').disabled=state.dogSaving;
    $('dogName').disabled=state.dogSaving;
    const editors=[...state.editors.values()];
    $('saveStatus').textContent=state.loading?'Loading…':editors.some(e=>e.saving||e.deleting)||state.dogSaving||state.undoSaving?'Saving…':editors.some(e=>e.error)?'Some changes are not saved':editors.some(e=>dirty(e))?'Unsaved changes':state.ready?'All changes saved':'';
    for(const editor of editors) updateRowStatus(editor);
  }
  function updateRowStatus(editor) {
    const row=rowElement(editor.id);if(!row)return;
    row.classList.toggle('is-saving',Boolean(editor.saving||editor.deleting));
    row.classList.toggle('is-error',Boolean(editor.error));
    row.querySelectorAll('textarea').forEach(input=>{input.disabled=!state.ready||state.loading||editor.deleting||Boolean(editor.deleteAttempt);});
    const button=row.querySelector('[data-action="delete"]');if(button)button.disabled=!state.ready||state.undoSaving||Boolean(editor.saving||editor.deleting);
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
    const cells=FIELDS.map(([key,label,limit])=>`<td class="tr-cell"><textarea class="tr-cell-input tr-cell-textarea${['work_detail','notes'].includes(key)?' tr-cell-long':''}" data-field="${key}" rows="2" maxlength="${limit}" aria-label="${label}" spellcheck="${['work_detail','notes'].includes(key)}">${escape(editor.values[key])}</textarea></td>`).join('');
    return `<tr class="tr-row" data-row-id="${editor.id}">${cells}<td class="tr-action-cell"><button type="button" class="tr-delete" data-action="delete" aria-label="Delete row">Delete</button></td></tr><tr class="tr-row-error" data-error-id="${editor.id}" hidden><td colspan="8"><span data-row-error role="alert"></span> <button type="button" data-action="retry" data-id="${editor.id}">Retry</button></td></tr>`;
  }
  function renderDogs() {
    $('dogSelect').innerHTML=state.dogs.map(dog=>`<option value="${escape(dog.id)}">${escape(dog.name)}</option>`).join('');
    $('dogSelect').value=state.selectedDog||'';
  }
  function renderRows() {
    const rows=sortLogs(state.logs.filter(row=>row.dog_id===state.selectedDog&&!row.deleted_at)).map(editorFor);
    const fresh=[...state.editors.values()].filter(e=>!e.base&&e.dog_id===state.selectedDog).sort((a,b)=>b.order-a.order);
    const editors=[...fresh,...rows];
    $('trainingRows').innerHTML=editors.map(renderRow).join('');
    $('rowCount').textContent=state.selectedDog?`${editors.length} ${editors.length===1?'row':'rows'} · Newest first`:'';
    $('emptyState').hidden=Boolean(editors.length)||!state.ready;
    $('emptyState').textContent=state.dogs.length?'No entries yet. Add a row to get started.':'Add a dog to start a training log.';
    controls();
  }
  function render() {renderDogs();renderRows();}
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
    if(state.loading||state.dogSaving||!$('dogForm').hidden)return;
    if(unfinished()||tableFocused()) {if(!silent)message('Your current edits are kept. Finish editing or retry any unsaved rows before refreshing.');return;}
    const epoch=state.epoch,request=++state.request,valid=()=>current(epoch)&&request===state.request;
    state.loading=true;controls();if(!silent)message('Loading training rows…');
    try {
      await requireStaff(epoch);if(!valid())return;
      const [dogs,logs]=await Promise.all([fetchAll('hq_training_dogs',valid),fetchAll('hq_training_logs',valid)]);if(!valid())return;
      state.dogs=dogs.sort((a,b)=>a.name.localeCompare(b.name));state.logs=logs;state.editors.clear();state.ready=true;
      if(!dogs.some(dog=>dog.id===state.selectedDog))state.selectedDog=dogs[0]?.id||null;
      message('');
    } catch(error) {
      if(!valid())return;
      state.ready=false;
      if(['AUTH','ACCESS','42501'].includes(error?.code)){state.dogs=[];state.logs=[];state.editors.clear();state.selectedDog=null;}
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
    if(document.activeElement!==input)return;
    input.style.height='auto';input.style.height=`${Math.min(220,Math.max(52,input.scrollHeight))}px`;
  }
  async function fetchRow(id) {
    const result=await supabaseClient.from('hq_training_logs').select('*').eq('id',id).maybeSingle();
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
    if(fresh.deleted_at||fresh.dog_id!==editor.dog_id)throw {code:'CONFLICT'};
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
          if(base)result=await supabaseClient.from('hq_training_logs').update(patch).eq('id',editor.id).eq('revision',base.revision).select('*').maybeSingle();
          else result=await supabaseClient.from('hq_training_logs').insert({id:editor.id,dog_id:editor.dog_id,...patch}).select('*').single();
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
    if(!state.ready||state.loading||!state.selectedDog)return;
    const id=crypto.randomUUID(),values=valuesOf(null);values.date_label=todayLabel();
    state.editors.set(id,{id,dog_id:state.selectedDog,base:null,values,order:++state.newOrder,saving:null,deleting:false,error:'',conflict:false,attempt:null});
    renderRows();rowElement(id)?.querySelector('[data-field="day_label"]')?.focus();
    $('tableScroll').scrollTop=0;
  }
  async function deleteRow(editor) {
    if(!editor||!state.ready||state.undoSaving||editor.saving||editor.deleting)return;
    if(!editor.base&&!editor.attempt){state.editors.delete(editor.id);renderRows();toast('Row removed.');return;}
    const epoch=state.epoch;editor.deleting=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
      if(!editor.base){state.editors.delete(editor.id);renderRows();return;}
      if(editor.deleteAttempt) {
        const fresh=await fetchRow(editor.id);if(!current(epoch))return;
        if(fresh?.deleted_at){remember(fresh);state.editors.delete(editor.id);renderRows();toast('Row deleted.',fresh);return;}
        if(!fresh||fresh.revision!==editor.base.revision)throw {code:'CONFLICT'};
      }
      editor.deleteAttempt=true;
      const result=await supabaseClient.from('hq_training_logs').update({deleted_at:new Date().toISOString()}).eq('id',editor.id).eq('revision',editor.base.revision).select('*').maybeSingle();
      if(!current(epoch))return;if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};
      remember(result.data);state.editors.delete(editor.id);renderRows();toast('Row deleted.',result.data);
    } catch(error) {if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';}}
    finally {if(current(epoch)){editor.deleting=false;controls();}}
  }
  async function undoDelete() {
    const row=state.undo;if(!row||!state.ready||state.undoSaving)return;
    const epoch=state.epoch;state.undoSaving=true;$('undoDelete').disabled=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      const result=await supabaseClient.from('hq_training_logs').update({deleted_at:null}).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();
      if(!current(epoch))return;if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};
      remember(result.data);if(!tableFocused())renderRows();toast('Row restored.');
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
  function selectDog(id) {if(!state.dogs.some(dog=>dog.id===id))return;state.selectedDog=id;renderRows();}
  async function saveDog(event) {
    event.preventDefault();if(state.dogSaving||!state.ready)return;
    const name=$('dogName').value.trim();if(!name)return;
    const epoch=state.epoch,id=state.dogDraftId;state.dogSaving=true;$('dogError').textContent='';controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      let result=await supabaseClient.from('hq_training_dogs').insert({id,name}).select('*').single();if(!current(epoch))return;
      if(result.error?.code==='23505')result=await supabaseClient.from('hq_training_dogs').select('*').eq('id',id).single();
      if(!current(epoch))return;if(result.error)throw result.error;
      if(result.data.name!==name)throw {code:'CONFLICT'};
      if(!state.dogs.some(dog=>dog.id===id))state.dogs.push(result.data);state.dogs.sort((a,b)=>a.name.localeCompare(b.name));
      state.selectedDog=id;$('dogForm').hidden=true;render();toast('Dog added.');
    }catch(error){if(current(epoch))$('dogError').textContent=errorText(error);}
    finally{if(current(epoch)){state.dogSaving=false;controls();}}
  }
  function resetAuth(userId) {
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;state.dogSaving=false;
    state.dogs=[];state.logs=[];state.editors.clear();state.selectedDog=null;state.undo=null;state.undoSaving=false;
    clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';$('undoDelete').disabled=false;
    $('dogForm').hidden=true;$('dogName').value='';$('dogError').textContent='';state.dogDraftId=null;
    render();message(userId?'Loading training rows…':'Sign in to Paws HQ to view training rows.');
  }
  function init() {
    if(!$('trainingPage'))return;
    $('addRow').addEventListener('click',addRow);
    $('dogSelect').addEventListener('change',event=>selectDog(event.target.value));
    $('addDog').addEventListener('click',()=>{state.dogDraftId=crypto.randomUUID();$('dogName').value='';$('dogError').textContent='';$('dogForm').hidden=false;$('dogName').focus();});
    $('cancelDog').addEventListener('click',()=>{if(!state.dogSaving)$('dogForm').hidden=true;});
    $('dogForm').addEventListener('submit',saveDog);
    $('refreshLogs').addEventListener('click',()=>refresh());$('undoDelete').addEventListener('click',undoDelete);
    $('trainingRows').addEventListener('input',event=>{if(event.target.matches('[data-field]'))takeInput(event.target);});
    $('trainingRows').addEventListener('focusin',event=>{if(event.target.matches('[data-field]'))resize(event.target);});
    $('trainingRows').addEventListener('focusout',event=>{
      const input=event.target;if(!input.matches('[data-field]'))return;
      const editor=state.editors.get(input.closest('[data-row-id]')?.dataset.rowId);input.style.height='';
      if(event.relatedTarget?.closest?.('[data-action]')?.dataset.action==='delete')return;
      // Let clicks on Delete run before blur saves, and preserve focus when tabbing across cells.
      const epoch=state.epoch;
      setTimeout(async()=>{
        if(editor&&state.editors.get(editor.id)===editor&&!editor.deleting)await saveEditor(editor);
        if(current(epoch)&&!tableFocused()&&!unfinished())renderRows();
      },0);
    });
    $('trainingRows').addEventListener('keydown',event=>{
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.target.blur();}
      else if(event.key==='Escape'&&event.target.matches('[data-field]'))event.target.blur();
    });
    $('trainingRows').addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button)return;
      const id=button.dataset.id||button.closest('[data-row-id]')?.dataset.rowId,editor=state.editors.get(id);
      if(button.dataset.action==='delete')deleteRow(editor);
      if(button.dataset.action==='retry')saveEditor(editor);
      if(button.dataset.action==='reload')reloadRow(editor);
    });
    window.addEventListener('beforeunload',event=>{if(unfinished()||state.dogSaving){event.preventDefault();event.returnValue='';}});
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
