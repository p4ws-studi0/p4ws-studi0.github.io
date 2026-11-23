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
  const ALL_DOGS = 'all';
  const state = {dogs:[],logs:[],trainers:[],editors:new Map(),selectedDog:null,ready:false,loading:false,
    filters:{from:'',through:'',trainer:''},trainerEditor:null,trainerRosterSaving:false,exportLoading:false,exportRequest:0,exportSnapshot:null,exportUrls:new Set(),
    userId:null,epoch:0,request:0,dogSaving:false,dogDraftId:null,editingDog:null,undo:null,undoSaving:false,toastTimer:null,newOrder:0};
  const text = value => String(value ?? '');
  const escape = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nonblank = value => text(value).trim().length > 0;
  const normalized = value => text(value).replace(/\r\n?/g,'\n');
  const current = epoch => epoch === state.epoch;
  const valuesOf = row => Object.fromEntries(KEYS.map(key => [key,text(row?.[key])]));
  const same = (a,b) => Object.keys(a).every(key => a[key] === b[key]);
  const position = row => BigInt(row.position ?? 0);
  const sourceOrder = (a,b) => position(a)<position(b) ? -1 : position(a)>position(b) ? 1 : text(a.id).localeCompare(text(b.id));
  const activeDogs = () => state.dogs.filter(dog=>!dog.deleted_at);
  const editableDog = id => activeDogs().some(dog=>dog.id===id);
  const normalizeTrainer = value => text(value).trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
  const trainerNames = value => text(value).split(/\s+and\s+|\s*[&+/;]\s*/i).map(name=>name.trim().replace(/\s+/g,' ')).filter(Boolean);
  function matchesTrainer(value,selected) {
    if(!selected)return true;
    if(selected==='unassigned')return !nonblank(value);
    return trainerNames(value).some(name=>`name:${normalizeTrainer(name)}`===selected);
  }
  const hasFilters = () => Object.values(state.filters).some(Boolean);
  const invalidRange = () => Boolean(state.filters.from&&state.filters.through&&state.filters.from>state.filters.through);
  function fullDateKey(value) {
    const date=parseDateLabel(value);
    return date?.year?`${String(date.year).padStart(4,'0')}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`:null;
  }
  function renderTrainerOptions() {
    const names=new Map();
    for(const trainer of state.trainers)names.set(`name:${normalizeTrainer(trainer.name)}`,trainer.name);
    for(const row of state.logs){
      if(row.deleted_at||!state.dogs.some(dog=>dog.id===row.dog_id))continue;
      const value=state.editors.get(row.id)?.values.trainer??row.trainer,people=trainerNames(value);
      if(!people.length)names.set('unassigned','No trainer entered');
      for(const name of people){const key=`name:${normalizeTrainer(name)}`;if(!names.has(key))names.set(key,name);}
    }
    const selected=state.filters.trainer;
    if(selected&&!names.has(selected))names.set(selected,selected==='unassigned'?'No trainer entered':selected.slice(5));
    $('filterTrainer').innerHTML='<option value="">All trainers</option>'+[...names].sort((a,b)=>a[1].localeCompare(b[1])).map(([key,name])=>`<option value="${escape(key)}">${escape(name)}</option>`).join('');
    $('filterTrainer').value=selected;
  }
  function applyFilters() {
    state.filters={from:$('filterFrom').value,through:$('filterThrough').value,trainer:$('filterTrainer').value};
    state.exportSnapshot=null;$('exportMessage').dataset.error='';renderExport();
  }
  function exportModel({dogs=state.dogs,logs=state.logs,filters=state.filters}={}) {
    const selectedDogs=new Map(dogs.map(dog=>[dog.id,dog])),candidates=sortLogs(logs.filter(row=>!row.deleted_at&&selectedDogs.has(row.dog_id)));
    const error=filters.from&&filters.through&&filters.from>filters.through?'From date must be on or before Through date.':'';
    const matchingTrainer=candidates.filter(row=>matchesTrainer(row.trainer,filters.trainer));
    const withoutDate=filters.from||filters.through?matchingTrainer.filter(row=>!fullDateKey(row.date_label)).length:0;
    const rows=error?[]:matchingTrainer.filter(row=>{
      if(!filters.from&&!filters.through)return true;
      const date=fullDateKey(row.date_label);return date&&(!filters.from||date>=filters.from)&&(!filters.through||date<=filters.through);
    }).map(row=>({dogName:selectedDogs.get(row.dog_id).name,archived:Boolean(selectedDogs.get(row.dog_id).deleted_at),...valuesOf(row)}));
    return {rows,withoutDate,error};
  }
  function exportCsv(model) {
    const cell=value=>{let raw=text(value);if(/^[\s\u0000-\u001f]*[=+@-]/.test(raw))raw="'"+raw;return `"${raw.replace(/"/g,'""')}"`;};
    return '\ufeff'+[['Dog',...FIELDS.map(([,label])=>label)],...model.rows.map(row=>[row.dogName,...KEYS.map(key=>row[key])])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  function renderExport() {
    const model=exportModel(state.exportSnapshot||{}),blocked=!state.ready||state.loading||state.dogSaving||state.exportLoading;
    $('exportCount').textContent=`${model.rows.length} ${model.rows.length===1?'row':'rows'} · All pets · Newest first`;
    $('exportRows').innerHTML=model.rows.map(row=>`<tr><td><strong>${escape(row.dogName)}</strong>${row.archived?'<small>Deleted dog</small>':''}</td>${KEYS.map(key=>`<td>${['work_detail','notes'].includes(key)?`<div class="tr-export-long" tabindex="0">${escape(row[key])}</div>`:escape(row[key])}</td>`).join('')}</tr>`).join('');
    $('exportEmpty').hidden=Boolean(model.rows.length);$('exportEmpty').textContent=model.error?'Choose a valid date range.':'No saved rows match these dates and trainer.';
    $('filterHint').textContent=model.withoutDate?`${model.withoutDate} ${model.withoutDate===1?'row has':'rows have'} no full, valid date and cannot be matched to this date range. Clear the dates to include ${model.withoutDate===1?'it':'them'}.`:'';
    $('filterHint').hidden=!model.withoutDate;
    $('filterError').textContent=model.error;$('filterError').hidden=!model.error;
    for(const id of ['filterFrom','filterThrough'])$(id).setAttribute('aria-invalid',String(Boolean(model.error)));
    for(const id of ['filterFrom','filterThrough','filterTrainer'])$(id).disabled=blocked;
    $('clearFilters').disabled=blocked||!hasFilters();
    $('downloadTrainingCsv').disabled=blocked||unfinished()||Boolean(model.error)||!model.rows.length;
    $('downloadTrainingCsv').textContent=state.exportLoading?'Preparing…':'Download CSV';
    if(unfinished())$('exportMessage').textContent='Finish saving or retry any unsaved rows before downloading. The preview shows saved data.';
    else if(state.exportLoading)$('exportMessage').textContent='Loading the latest saved rows…';
    else if(!$('exportMessage').dataset.error)$('exportMessage').textContent='';
    $('exportMessage').classList.toggle('is-error',$('exportMessage').dataset.error==='true');
  }
  function openExport() {
    if(!state.ready||state.dogSaving)return;
    $('exportMessage').textContent='';$('exportMessage').dataset.error='';state.exportSnapshot=null;
    renderTrainerOptions();renderExport();$('trainingExport').showModal();
  }
  function closeExport() {
    ++state.exportRequest;state.exportLoading=false;state.exportSnapshot=null;$('trainingExport').close();controls();
  }
  async function downloadCsv() {
    if(!state.ready||state.exportLoading||unfinished()||invalidRange())return;
    const epoch=state.epoch,request=++state.exportRequest,filters={...state.filters};
    const valid=()=>current(epoch)&&request===state.exportRequest&&$('trainingExport').open;
    state.exportLoading=true;$('exportMessage').dataset.error='';renderExport();
    try {
      await requireStaff(epoch);if(!valid())return;
      const [dogs,logs]=await Promise.all([fetchAll('hq_training_dogs',valid),fetchAll('hq_training_logs',valid)]);
      if(!valid())return;if(unfinished())throw {code:'UNSAVED'};
      if(!same(filters,state.filters))throw {code:'FILTER_CHANGED'};
      state.exportSnapshot={dogs,logs,filters};const model=exportModel(state.exportSnapshot);
      if(model.error||!model.rows.length)throw {code:'NO_EXPORT_ROWS'};
      const blob=new Blob([exportCsv(model)],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),link=document.createElement('a');state.exportUrls.add(url);
      link.href=url;link.download=`paws-training_${filters.from||'all'}_to_${filters.through||'all'}.csv`;document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>{URL.revokeObjectURL(url);state.exportUrls.delete(url);},1000);
      $('exportMessage').textContent=`Downloaded ${model.rows.length} ${model.rows.length===1?'row':'rows'} from all pets.`;$('exportMessage').dataset.error='done';
    }catch(error){if(valid()){$('exportMessage').textContent=error?.code==='UNSAVED'?'Finish saving your changes, then download again.':error?.code==='NO_EXPORT_ROWS'?'No saved rows match these dates and trainer.':error?.code==='FILTER_CHANGED'?'The filters changed. Choose Download CSV again.':error?.code==='AUTH'?'Sign in to Paws HQ to export training data.':error?.code==='ACCESS'||error?.code==='42501'?'Workspace access could not be confirmed. Refresh and try again.':'Could not load the export. Check your connection and try again.';$('exportMessage').dataset.error='true';}}
    finally{if(valid()){state.exportLoading=false;renderExport();}}
  }
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
    if(error?.code==='55000') return 'This dog is in Deleted dogs. Restore the dog before changing its training rows.';
    if(error?.code==='TRAINER'||error?.code==='23514'&&/trainer/i.test(error?.message||''))return 'Choose trainers from the shared list. Add a new trainer under Manage trainer names.';
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
  function trainerCellContent(value) {
    return `<span${nonblank(value)?'':' class="tr-trainer-placeholder"'}>${escape(nonblank(value)?value:'Choose trainer')}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  }
  function canonicalTrainer(value) {
    if(!nonblank(value))return '';
    const parts=trainerNames(value),people=parts.map(name=>state.trainers.find(person=>person.active&&normalizeTrainer(person.name)===normalizeTrainer(name)));
    if(!parts.length||people.some(person=>!person)||new Set(people.map(person=>person.id)).size!==people.length)return null;
    const joined=people.sort((a,b)=>a.name.localeCompare(b.name)).map(person=>person.name).join(' and ');
    return joined.length<=120?joined:null;
  }
  function renderTrainerPicker() {
    const selected=state.trainerEditor?.selected||new Set();
    $('trainerChoices').innerHTML=state.trainers.filter(person=>person.active).sort((a,b)=>a.name.localeCompare(b.name)).map(person=>`<label class="tr-trainer-choice"><input type="checkbox" data-trainer-choice="${escape(person.id)}" value="${escape(person.id)}" ${selected.has(person.id)?'checked':''} ${state.trainerRosterSaving?'disabled':''}/><span>${escape(person.name)}</span></label>`).join('')||'<p>No trainers yet. Add one under Manage trainer names.</p>';
    $('trainerRoster').innerHTML=[...state.trainers].sort((a,b)=>a.name.localeCompare(b.name)).map(person=>`<div class="tr-roster-row"><span>${escape(person.name)}${person.active?'':' <small>Inactive</small>'}</span><button type="button" data-trainer-active="${escape(person.id)}" data-active="${person.active?'false':'true'}" ${state.trainerRosterSaving?'disabled':''}>${person.active?'Remove':'Restore'}</button></div>`).join('');
    controls();
  }
  function openTrainer(id) {
    const editor=state.editors.get(id);if(!editor||!editableDog(editor.dog_id)||!state.ready||editor.deleting||state.dogSaving)return;
    const names=trainerNames(editor.values.trainer).map(normalizeTrainer);
    state.trainerEditor={id,epoch:state.epoch,changed:false,selected:new Set(state.trainers.filter(person=>person.active&&names.includes(normalizeTrainer(person.name))).map(person=>person.id))};
    $('trainerError').textContent='';$('trainerRosterError').textContent='';$('newTrainerName').value='';
    renderTrainerPicker();$('trainerDialog').showModal();
  }
  function closeTrainer() {if(state.trainerRosterSaving)return;state.trainerEditor=null;$('trainerDialog').close();controls();}
  async function applyTrainerSelection() {
    const picker=state.trainerEditor;if(!picker||picker.epoch!==state.epoch||state.trainerRosterSaving)return;
    if(!picker.changed){closeTrainer();return;}
    const ids=[...$('trainerChoices').querySelectorAll('[data-trainer-choice]')].filter(input=>input.checked).map(input=>input.dataset.trainerChoice);
    const people=ids.map(id=>state.trainers.find(person=>person.id===id&&person.active));
    if(people.some(person=>!person)){$('trainerError').textContent='The trainer list changed. Close this window and choose again.';return;}
    const value=people.sort((a,b)=>a.name.localeCompare(b.name)).map(person=>person.name).join(' and ');
    if(value.length>120){$('trainerError').textContent='Choose fewer trainers for this session.';return;}
    const editor=state.editors.get(picker.id);if(!editor||!editableDog(editor.dog_id))return;
    editor.values.trainer=value;if(!editor.conflict)editor.error='';
    const button=rowElement(editor.id)?.querySelector('[data-trainer-open]');if(button)button.innerHTML=trainerCellContent(value);
    closeTrainer();await saveEditor(editor);
  }
  function rememberTrainer(trainer) {
    const index=state.trainers.findIndex(person=>person.id===trainer.id);
    if(index<0)state.trainers.push(trainer);else state.trainers[index]=trainer;
  }
  async function saveTrainerName(event) {
    event.preventDefault();if(!state.ready||state.trainerRosterSaving)return;
    const name=$('newTrainerName').value.trim().replace(/\s+/g,' ');
    if(!name||name.length>120||/[\u0000-\u001f&+/;]|\band\b/i.test(name)){$('trainerRosterError').textContent='Enter one trainer’s name. Shared sessions use multiple selections.';return;}
    const existing=state.trainers.find(person=>normalizeTrainer(person.name)===normalizeTrainer(name));
    if(existing){$('trainerRosterError').textContent=existing.active?'This trainer is already in the list.':'This trainer is already listed. Choose Restore.';return;}
    const epoch=state.epoch;state.trainerRosterSaving=true;$('trainerRosterError').textContent='';renderTrainerPicker();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      const result=await supabaseClient.from('hq_training_trainers').insert({name}).select('*').single();if(!current(epoch))return;
      if(result.error){
        const people=await fetchAll('hq_training_trainers',()=>current(epoch));if(!current(epoch))return;
        const recovered=people.find(person=>normalizeTrainer(person.name)===normalizeTrainer(name));
        if(!recovered)throw result.error;state.trainers=people;
      }else rememberTrainer(result.data);
      $('newTrainerName').value='';renderTrainerOptions();toast('Trainer added to the shared list.');
    }catch(error){if(current(epoch))$('trainerRosterError').textContent=error?.code==='23505'?'This trainer is already in the list.':errorText(error);}
    finally{if(current(epoch)){state.trainerRosterSaving=false;renderTrainerPicker();}}
  }
  async function setTrainerActive(trainer,active) {
    if(!trainer||!state.ready||state.trainerRosterSaving)return;
    const epoch=state.epoch;state.trainerRosterSaving=true;$('trainerRosterError').textContent='';renderTrainerPicker();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      const result=await supabaseClient.from('hq_training_trainers').update({active}).eq('id',trainer.id).eq('revision',trainer.revision).select('*').maybeSingle();if(!current(epoch))return;
      if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};
      rememberTrainer(result.data);
      if(!active)state.trainerEditor?.selected.delete(trainer.id);
      renderTrainerOptions();toast(active?'Trainer restored.':'Trainer removed from new selections. Saved sessions are kept.');
    }catch(error){if(current(epoch))$('trainerRosterError').textContent=error?.code==='CONFLICT'?'The trainer list changed elsewhere. Close this window and refresh.':errorText(error);}
    finally{if(current(epoch)){state.trainerRosterSaving=false;renderTrainerPicker();}}
  }
  function controls() {
    const blocked=!state.ready||state.loading;
    const selected=state.dogs.find(dog=>dog.id===state.selectedDog&&!dog.deleted_at);
    $('addRow').disabled=blocked||state.dogSaving||!selected;
    $('addDog').disabled=blocked||state.dogSaving;
    $('renameDog').disabled=blocked||state.dogSaving||!selected;
    $('deleteDog').disabled=blocked||state.dogSaving||!selected||unfinished();
    $('deleteDog').title=unfinished()?'Finish saving or remove unfinished rows first.':'Move this dog to Deleted dogs. Training rows are kept.';
    $('dogSelect').disabled=blocked||state.dogSaving||!state.dogs.length||!$('dogForm').hidden;
    $('addRow').title=state.selectedDog===ALL_DOGS?'Choose a dog before adding a row.':'';
    $('exportData').disabled=blocked||state.dogSaving;
    $('saveTrainer').disabled=blocked||state.trainerRosterSaving||!state.trainerEditor?.changed;
    $('cancelTrainer').disabled=state.trainerRosterSaving;$('clearTrainer').disabled=state.trainerRosterSaving;
    $('addTrainer').disabled=blocked||state.trainerRosterSaving;
    $('addTrainer').textContent=state.trainerRosterSaving?'Saving…':'Add trainer';
    $('newTrainerName').disabled=state.trainerRosterSaving;
    $('refreshLogs').disabled=state.loading||state.dogSaving;
    $('saveDog').disabled=blocked||state.dogSaving;
    $('cancelDog').disabled=state.dogSaving;
    $('dogName').disabled=state.dogSaving;
    $('saveDog').textContent=state.dogSaving?'Saving…':state.editingDog?'Save name':'Add dog';
    document.querySelectorAll('[data-restore-dog]').forEach(button=>{button.disabled=blocked||state.dogSaving||state.undoSaving;});
    const editors=[...state.editors.values()];
    $('saveStatus').textContent=state.loading?'Loading…':editors.some(e=>e.saving||e.deleting)||state.dogSaving||state.undoSaving?'Saving…':editors.some(e=>e.error)?'Some changes are not saved':editors.some(e=>dirty(e))?'Unsaved changes':state.ready?'All changes saved':'';
    for(const editor of editors) updateRowStatus(editor);
    if($('trainingExport').open)renderExport();
  }
  function updateRowStatus(editor) {
    const row=rowElement(editor.id);if(!row)return;
    row.classList.toggle('is-saving',Boolean(editor.saving||editor.deleting));
    row.classList.toggle('is-error',Boolean(editor.error));
    row.querySelectorAll('textarea').forEach(input=>{input.disabled=!state.ready||state.loading||state.dogSaving||editor.deleting||Boolean(editor.deleteAttempt);input.readOnly=!editableDog(editor.dog_id);});
    const trainer=row.querySelector('[data-trainer-open]');if(trainer)trainer.disabled=!state.ready||state.loading||state.dogSaving||editor.deleting||Boolean(editor.deleteAttempt)||!editableDog(editor.dog_id);
    const button=row.querySelector('[data-action="delete"]');if(button)button.disabled=!state.ready||state.dogSaving||state.undoSaving||!editableDog(editor.dog_id)||Boolean(editor.saving||editor.deleting);
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
    const dog=state.dogs.find(item=>item.id===editor.dog_id),archived=Boolean(dog?.deleted_at),all=state.selectedDog===ALL_DOGS;
    const dogCell=all?`<td class="tr-dog-cell"><strong>${escape(dog?.name)}</strong>${archived?'<span>Deleted dog · read only</span>':''}</td>`:'';
    const cells=FIELDS.map(([key,label,limit])=>key==='trainer'?`<td class="tr-cell"><button type="button" class="tr-trainer-cell" data-trainer-open="${escape(editor.id)}" aria-label="Choose trainers" ${archived?'disabled':''}>${trainerCellContent(editor.values.trainer)}</button></td>`:`<td class="tr-cell"><textarea class="tr-cell-input tr-cell-textarea${['work_detail','notes'].includes(key)?' tr-cell-long':''}" data-field="${key}" rows="2" maxlength="${limit}" aria-label="${label}" spellcheck="${['work_detail','notes'].includes(key)}" ${archived?'readonly':''}>${escape(editor.values[key])}</textarea></td>`).join('');
    return `<tr class="tr-row" data-row-id="${editor.id}">${dogCell}${cells}<td class="tr-action-cell"><button type="button" class="tr-delete" data-action="delete" aria-label="Delete row" ${archived?'disabled title="Restore this dog before editing its training rows."':''}>Delete</button></td></tr><tr class="tr-row-error" data-error-id="${editor.id}" hidden><td colspan="${all?9:8}"><span data-row-error role="alert"></span> <button type="button" data-action="retry" data-id="${editor.id}">Retry</button></td></tr>`;
  }
  function renderDogs() {
    const active=activeDogs();
    $('dogSelect').innerHTML=(active.length?'':'<option value="">No active dogs</option>')+(state.dogs.length?'<option value="all">All dogs</option>':'')+active.map(dog=>`<option value="${escape(dog.id)}">${escape(dog.name)}</option>`).join('');
    $('dogSelect').value=state.selectedDog||'';
    const deleted=state.dogs.filter(dog=>dog.deleted_at);
    $('deletedDogCount').textContent=deleted.length;
    $('deletedDogList').innerHTML=deleted.length?deleted.map(dog=>{
      const count=state.logs.filter(row=>row.dog_id===dog.id&&!row.deleted_at).length;
      return `<div class="tr-deleted-dog"><div><strong>${escape(dog.name)}</strong><span>${count} training ${count===1?'row':'rows'} kept</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-dog="${escape(dog.id)}" aria-label="Restore ${escape(dog.name)}">Restore</button></div>`;
    }).join(''):'<p>No deleted dogs.</p>';
  }
  function renderRows() {
    const inScope=id=>state.selectedDog===ALL_DOGS?state.dogs.some(dog=>dog.id===id):id===state.selectedDog;
    const rows=sortLogs(state.logs.filter(row=>inScope(row.dog_id)&&!row.deleted_at)).map(editorFor);
    const fresh=[...state.editors.values()].filter(e=>!e.base&&inScope(e.dog_id)).sort((a,b)=>b.order-a.order);
    const editors=[...fresh,...rows];
    const all=state.selectedDog===ALL_DOGS;
    $('dogColumn').hidden=!all;$('dogHeading').hidden=!all;$('trainingTable').classList.toggle('tr-all-dogs',all);
    $('trainingRows').innerHTML=editors.map(renderRow).join('');
    $('rowCount').textContent=state.selectedDog?`${editors.length} ${editors.length===1?'row':'rows'} · Newest first`:'';
    $('emptyState').hidden=Boolean(editors.length)||!state.ready;
    $('emptyState').textContent=state.selectedDog===ALL_DOGS?'No training rows yet.':activeDogs().length?'No entries yet. Add a row to get started.':state.dogs.length?'No active dogs. Add a dog or restore one from Deleted dogs.':'Add a dog to start a training log.';
    renderTrainerOptions();
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
    if(typeof ensureHqWorkspaceAccess==='function')await ensureHqWorkspaceAccess(data.session);
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
    if(state.loading||state.dogSaving||state.trainerRosterSaving||state.trainerEditor||!$('dogForm').hidden)return;
    if(unfinished()||tableFocused()) {if(!silent)message('Your current edits are kept. Finish editing or retry any unsaved rows before refreshing.');return;}
    const epoch=state.epoch,request=++state.request,valid=()=>current(epoch)&&request===state.request;
    state.loading=true;controls();if(!silent)message('Loading training rows…');
    try {
      await requireStaff(epoch);if(!valid())return;
      const [dogs,logs,trainers]=await Promise.all([fetchAll('hq_training_dogs',valid),fetchAll('hq_training_logs',valid),fetchAll('hq_training_trainers',valid)]);if(!valid())return;
      state.dogs=dogs.sort((a,b)=>a.name.localeCompare(b.name));state.logs=logs;state.trainers=trainers;state.editors.clear();state.ready=true;
      if(state.selectedDog!==ALL_DOGS&&!activeDogs().some(dog=>dog.id===state.selectedDog))state.selectedDog=activeDogs()[0]?.id||null;
      message('');
    } catch(error) {
      if(!valid())return;
      state.ready=false;
      if(['AUTH','ACCESS','42501'].includes(error?.code)){state.dogs=[];state.logs=[];state.trainers=[];state.editors.clear();state.selectedDog=null;}
      message(errorText(error),true);
    } finally {if(valid()){state.loading=false;render();}}
  }
  function takeInput(input) {
    const row=input.closest('[data-row-id]'),key=input.dataset.field;
    const editor=state.editors.get(row?.dataset.rowId);if(!editor||!KEYS.includes(key)||key==='trainer'||editor.deleting||!editableDog(editor.dog_id))return;
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
    const trainer=row.querySelector('[data-trainer-open]');if(trainer)trainer.innerHTML=trainerCellContent(editor.values.trainer);
  }
  function saveEditor(editor) {
    if(!editor||editor.deleting||editor.deleteAttempt||editor.conflict||!state.ready||!editableDog(editor.dog_id))return Promise.resolve();
    if(editor.saving)return editor.saving;
    if(!dirty(editor))return Promise.resolve();
    if(Object.hasOwn(changedPatch(editor),'trainer')&&canonicalTrainer(editor.values.trainer)===null){editor.error='Choose trainers from the shared list. Add a new trainer under Manage trainer names.';controls();return Promise.resolve();}
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
          if(Object.hasOwn(patch,'trainer')&&canonicalTrainer(patch.trainer)===null)throw {code:'TRAINER'};
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
    if(!state.ready||state.loading||state.dogSaving||!activeDogs().some(dog=>dog.id===state.selectedDog))return;
    const id=crypto.randomUUID(),values=valuesOf(null);values.date_label=todayLabel();
    state.editors.set(id,{id,dog_id:state.selectedDog,base:null,values,order:++state.newOrder,saving:null,deleting:false,error:'',conflict:false,attempt:null});
    renderRows();rowElement(id)?.querySelector('[data-field="day_label"]')?.focus();
    $('tableScroll').scrollTop=0;
  }
  async function deleteRow(editor) {
    if(!editor||!state.ready||state.undoSaving||editor.saving||editor.deleting||!editableDog(editor.dog_id))return;
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
  function selectDog(id) {if(id===ALL_DOGS?!state.dogs.length:!editableDog(id))return;state.selectedDog=id;$('dogSelect').value=id;renderRows();}
  function rememberDog(dog) {
    const index=state.dogs.findIndex(item=>item.id===dog.id);
    if(index<0)state.dogs.push(dog);else state.dogs[index]=dog;
    state.dogs.sort((a,b)=>a.name.localeCompare(b.name));
  }
  function dogErrorText(error) {
    if(error?.code==='CONFLICT')return 'This dog changed elsewhere. Your entered name is kept. Cancel, refresh, and try again.';
    return errorText(error);
  }
  function openDog(dog=null) {
    if(!state.ready||state.loading||state.dogSaving)return;
    state.editingDog=dog?{...dog}:null;state.dogDraftId=dog?.id||crypto.randomUUID();
    $('dogName').value=dog?.name||'';$('dogNameLabel').textContent=dog?'Dog name':'New dog';
    $('dogError').textContent='';$('dogForm').hidden=false;controls();$('dogName').focus();
  }
  async function updateDog(dog,patch,epoch) {
    const result=await supabaseClient.from('hq_training_dogs').update(patch).eq('id',dog.id).eq('revision',dog.revision).select('*').maybeSingle();
    if(!current(epoch))return null;
    if(!result.error&&result.data)return result.data;
    // Recover an already-applied request without overwriting a later name or deletion.
    const fresh=await supabaseClient.from('hq_training_dogs').select('*').eq('id',dog.id).maybeSingle();
    if(!current(epoch))return null;
    const row=fresh.data;
    if(!fresh.error&&row&&Object.keys(patch).every(key=>key==='deleted_at'?Boolean(row.deleted_at)===Boolean(patch.deleted_at):row[key]===patch[key])
      &&('deleted_at' in patch||Boolean(row.deleted_at)===Boolean(dog.deleted_at)))return row;
    if(result.error)throw result.error;throw {code:'CONFLICT'};
  }
  async function setDogDeleted(dog,deleted) {
    if(!dog||!state.ready||state.loading||state.dogSaving||state.undoSaving)return;
    if(deleted&&unfinished()){message('Finish saving or remove unfinished rows before deleting a dog.',true);return;}
    const epoch=state.epoch;state.dogSaving=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      const saved=await updateDog(dog,{deleted_at:deleted?new Date().toISOString():null},epoch);if(!current(epoch))return;
      rememberDog(saved);
      if(deleted){
        for(const [id,editor] of state.editors)if(editor.dog_id===dog.id)state.editors.delete(id);
        if(state.selectedDog===dog.id)state.selectedDog=activeDogs()[0]?.id||null;
        if(state.editingDog?.id===dog.id){$('dogForm').hidden=true;state.editingDog=null;}
        $('deletedDogsSection').open=true;
      }else state.selectedDog=saved.id;
      render();message('');toast(deleted?'Dog moved to Deleted dogs. Training rows kept.':'Dog restored.');
    }catch(error){if(current(epoch))message(error?.code==='CONFLICT'?'This dog changed elsewhere. Refresh before trying again.':errorText(error),true);}
    finally{if(current(epoch)){state.dogSaving=false;controls();}}
  }
  async function saveDog(event) {
    event.preventDefault();if(state.dogSaving||!state.ready)return;
    const name=$('dogName').value.trim();if(!name)return;
    const epoch=state.epoch,id=state.dogDraftId,editing=state.editingDog;state.dogSaving=true;$('dogError').textContent='';controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;
      let saved;
      if(editing)saved=await updateDog(editing,{name},epoch);
      else {
        let result=await supabaseClient.from('hq_training_dogs').insert({id,name}).select('*').single();if(!current(epoch))return;
        if(result.error?.code==='23505')result=await supabaseClient.from('hq_training_dogs').select('*').eq('id',id).single();
        if(!current(epoch))return;if(result.error)throw result.error;
        saved=result.data;
        if(saved.name!==name){rememberDog(saved);state.editingDog={...saved};$('dogNameLabel').textContent='Dog name';$('dogError').textContent='Your earlier save succeeded. Review the name and choose Save name.';renderDogs();return;}
      }
      if(!current(epoch))return;
      rememberDog(saved);state.selectedDog=saved.deleted_at?activeDogs()[0]?.id||null:id;
      $('dogForm').hidden=true;state.editingDog=null;render();toast(editing?'Dog name updated.':'Dog added.');
    }catch(error){if(current(epoch))$('dogError').textContent=dogErrorText(error);}
    finally{if(current(epoch)){state.dogSaving=false;controls();}}
  }
  function resetAuth(userId) {
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;state.dogSaving=false;
    state.dogs=[];state.logs=[];state.trainers=[];state.editors.clear();state.selectedDog=null;state.undo=null;state.undoSaving=false;
    state.trainerEditor=null;state.trainerRosterSaving=false;state.exportLoading=false;state.exportSnapshot=null;++state.exportRequest;
    $('trainerDialog').close();$('trainingExport').close();$('trainerChoices').innerHTML='';$('trainerRoster').innerHTML='';$('trainerError').textContent='';$('trainerRosterError').textContent='';$('newTrainerName').value='';
    for(const url of state.exportUrls)URL.revokeObjectURL(url);state.exportUrls.clear();
    state.filters={from:'',through:'',trainer:''};for(const id of ['filterFrom','filterThrough','filterTrainer'])$(id).value='';
    clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';$('undoDelete').disabled=false;
    $('dogForm').hidden=true;$('dogName').value='';$('dogError').textContent='';state.dogDraftId=null;state.editingDog=null;
    render();renderExport();message(userId?'Loading training rows…':'Sign in to Paws HQ to view training rows.');
  }
  function init() {
    if(!$('trainingPage'))return;
    $('addRow').addEventListener('click',addRow);
    $('dogSelect').addEventListener('change',event=>selectDog(event.target.value));
    for(const id of ['filterFrom','filterThrough','filterTrainer'])$(id).addEventListener('change',applyFilters);
    $('clearFilters').addEventListener('click',()=>{for(const id of ['filterFrom','filterThrough','filterTrainer'])$(id).value='';applyFilters();});
    $('exportData').addEventListener('click',openExport);$('closeTrainingExport').addEventListener('click',closeExport);$('downloadTrainingCsv').addEventListener('click',downloadCsv);
    $('trainingExport').addEventListener('cancel',event=>{event.preventDefault();closeExport();});
    $('saveTrainer').addEventListener('click',applyTrainerSelection);$('cancelTrainer').addEventListener('click',closeTrainer);
    $('trainerDialog').addEventListener('cancel',event=>{event.preventDefault();closeTrainer();});
    $('trainerChoices').addEventListener('change',()=>{if(!state.trainerEditor)return;state.trainerEditor.selected=new Set([...$('trainerChoices').querySelectorAll('[data-trainer-choice]')].filter(input=>input.checked).map(input=>input.dataset.trainerChoice));state.trainerEditor.changed=true;controls();});
    $('clearTrainer').addEventListener('click',()=>{if(!state.trainerEditor)return;state.trainerEditor.selected.clear();state.trainerEditor.changed=true;renderTrainerPicker();});
    $('trainerForm').addEventListener('submit',saveTrainerName);
    $('trainerRoster').addEventListener('click',event=>{const button=event.target.closest('[data-trainer-active]');if(button)setTrainerActive(state.trainers.find(person=>person.id===button.dataset.trainerActive),button.dataset.active==='true');});
    $('addDog').addEventListener('click',()=>openDog());
    $('renameDog').addEventListener('click',()=>openDog(state.dogs.find(dog=>dog.id===state.selectedDog)));
    $('deleteDog').addEventListener('click',()=>setDogDeleted(state.dogs.find(dog=>dog.id===state.selectedDog),true));
    $('deletedDogList').addEventListener('click',event=>{const button=event.target.closest('[data-restore-dog]');if(button)setDogDeleted(state.dogs.find(dog=>dog.id===button.dataset.restoreDog),false);});
    $('cancelDog').addEventListener('click',()=>{if(!state.dogSaving){$('dogForm').hidden=true;state.editingDog=null;controls();}});
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
      const trainer=event.target.closest('[data-trainer-open]');if(trainer){openTrainer(trainer.dataset.trainerOpen);return;}
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
