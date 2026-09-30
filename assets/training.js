/* Paws HQ dog training records. Load after the existing Supabase SDK and /script.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TIME_ZONE = 'America/New_York';
  const PAGE_SIZE = 500;
  const FIELDS = {
    day_label:'dayLabel', date_label:'dateLabel', session_label:'sessionLabel',
    time_label:'timeLabel', trainer:'trainer', work_detail:'workDetail', notes:'sessionNotes'
  };
  const state = {
    dogs:[], logs:[], selectedDog:null, view:'active', ready:false, loading:false, busy:false,
    userId:null, authEpoch:0, requestId:0, editingLog:null, editingDog:null, deletingLog:null,
    logBaseline:{}, undo:null, toastTimer:null
  };
  const text = value => String(value ?? '');
  const escape = value => text(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const nonblank = value => text(value).trim().length > 0;
  const current = epoch => epoch === state.authEpoch;
  const dialogsOpen = () => ['sessionDialog','dogDialog','deleteDialog'].some(id => $(id).open);
  const available = () => state.ready && !state.loading && !state.busy;
  function todayLabel() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type,part.value]));
    return `${parts.month}/${parts.day}/${parts.year}`;
  }
  function compareLogs(a,b) {
    // PostgreSQL may encode bigint positions as either strings or numbers.
    const left = BigInt(a.position ?? 0), right = BigInt(b.position ?? 0);
    return (left < right ? -1 : left > right ? 1 : 0) || text(a.id).localeCompare(text(b.id));
  }
  const sortLogs = rows => [...rows].sort(compareLogs);
  const sortDogs = rows => [...rows].sort((a,b) => a.name.localeCompare(b.name,undefined,{sensitivity:'base'}) || a.id.localeCompare(b.id));
  function friendlyError(error) {
    if (error?.code === 'CONFLICT') return 'Someone else changed this record. Your edits are still here. Close this form, refresh, and reopen the record before saving again.';
    if (error?.code === 'AUTH') return 'Your session has expired. Sign in to Paws HQ again.';
    if (error?.code === 'ACCESS' || error?.code === '42501') return 'Your account does not have training access. Ask your Paws HQ administrator to approve your account.';
    if (['42P01','PGRST205'].includes(error?.code)) return 'Training records are not set up yet. Ask your Paws HQ administrator to finish the database setup.';
    if (error?.code === '23505') return 'This record already exists. Refresh the page and try again.';
    return 'Could not reach the training records. Check your connection and try again. Your edits have not been discarded.';
  }
  function message(value,error = false) {
    $('pageMessage').textContent = value;
    $('pageMessage').hidden = !value;
    $('pageMessage').classList.toggle('is-error',error);
  }
  function formError(id,value) {$(id).textContent=value;$(id).hidden=!value;}
  function dismissToast() {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
    state.undo = null;
    $('toast').hidden = true;
    $('undoDelete').hidden = true;
  }
  function toast(value,undo = null) {
    clearTimeout(state.toastTimer);
    state.undo = undo;
    $('toastText').textContent = value;
    $('undoDelete').hidden = !undo;
    $('toast').hidden = false;
    state.toastTimer = setTimeout(dismissToast,5000);
  }
  function enableControls() {
    const blocked = !available();
    $('addDog').disabled = blocked;
    $('addSession').disabled = blocked || !state.selectedDog;
    $('renameDog').disabled = blocked || !state.selectedDog;
    $('refreshLogs').disabled = state.loading || state.busy;
    ['saveSession','saveDog','confirmDelete','undoDelete'].forEach(id => {$(id).disabled=blocked;});
    ['cancelSession','cancelDog','cancelDelete'].forEach(id => {$(id).disabled=state.busy;});
    document.querySelectorAll('[data-dog-id],[data-log-action]').forEach(button => {button.disabled=blocked;});
    $('saveSession').textContent = state.busy ? 'Saving…' : state.editingLog ? 'Save changes' : 'Add session';
    $('saveDog').textContent = state.busy ? 'Saving…' : state.editingDog ? 'Save name' : 'Add dog';
    $('confirmDelete').textContent = state.busy && state.deletingLog ? 'Deleting…' : 'Delete entry';
  }
  function setBusy(value) {
    state.busy=value;
    ['sessionForm','dogForm'].forEach(id => $(id).querySelectorAll('input,textarea,select').forEach(input => {input.disabled=value;}));
    enableControls();
  }
  function trainerValues(rows) {
    return [...new Set(rows.map(row => text(row.trainer)).filter(nonblank))].sort((a,b) => a.localeCompare(b));
  }
  function renderFilters() {
    const previous = $('trainerFilter').value;
    const names = trainerValues(state.logs.filter(row => row.dog_id === state.selectedDog));
    $('trainerFilter').innerHTML = '<option value="">All trainers</option>' + names.map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    $('trainerFilter').value = names.includes(previous) ? previous : '';
    $('trainerOptions').innerHTML = trainerValues(state.logs).map(name => `<option value="${escape(name)}"></option>`).join('');
  }
  function renderDogs() {
    $('dogList').innerHTML = state.dogs.map(dog => {
      const count = state.logs.filter(row => row.dog_id === dog.id && !row.deleted_at).length;
      const selected = dog.id === state.selectedDog;
      return `<button type="button" class="tr-dog-card${selected ? ' is-selected':''}" data-dog-id="${escape(dog.id)}" aria-pressed="${selected}"><span class="tr-dog-name">${escape(dog.name)}</span><span class="tr-dog-count">${count}</span><span class="tr-dog-caption">${count === 1 ? 'training entry':'training entries'}</span></button>`;
    }).join('');
    const dog = state.dogs.find(item => item.id === state.selectedDog);
    $('dogTitle').textContent = dog ? dog.name : 'Training records';
    const active = state.logs.filter(row => row.dog_id === state.selectedDog && !row.deleted_at).length;
    const deleted = state.logs.filter(row => row.dog_id === state.selectedDog && row.deleted_at).length;
    $('activeCount').textContent = active;
    $('deletedCount').textContent = deleted;
    $('dogSummary').textContent = dog ? `${active} ${active === 1 ? 'entry':'entries'} · Original session order` : 'Select a dog to view their training history.';
  }
  function field(label,value,extraClass = '') {
    return `<div class="tl-field ${extraClass}"><span class="tl-field-label">${label}</span><div class="tl-field-value">${nonblank(value) ? escape(value) : '—'}</div></div>`;
  }
  function renderEntry(row) {
    const actions = row.deleted_at
      ? `<button type="button" class="tr-icon-button" data-log-action="restore" data-id="${escape(row.id)}" aria-label="Restore training entry">Restore</button>`
      : `<button type="button" class="tr-icon-button" data-log-action="edit" data-id="${escape(row.id)}" aria-label="Edit training entry">Edit</button><button type="button" class="tr-icon-button tr-delete" data-log-action="delete" data-id="${escape(row.id)}" aria-label="Delete training entry">Delete</button>`;
    const heading = nonblank(row.session_label) ? text(row.session_label) : 'Training entry';
    return `<article class="tl-entry${row.deleted_at ? ' is-deleted':''}"><div class="tl-entry-header"><div class="tl-entry-heading"><span class="tl-badge">Session</span><h4>${escape(heading)}</h4></div><div class="tl-entry-actions">${actions}</div></div><div class="tl-entry-meta">${field('Day',row.day_label)}${field('Date',row.date_label)}${field('Time',row.time_label)}${field('Trainer',row.trainer)}</div><div class="tl-entry-body">${field('Training / work',row.work_detail,'tl-detail')}${field('Notes',row.notes,'tl-notes')}</div></article>`;
  }
  function groupLogs(rows,query = '',trainer = '',view = null) {
    const groups=[];
    let group=null;
    // Carry blank day labels forward in the view; never write this inferred value to a record.
    for (const row of sortLogs(rows)) {
      if (!group || (nonblank(row.day_label) && text(row.day_label).trim() !== group.dayKey)) {
        group={label:nonblank(row.day_label) ? text(row.day_label) : 'Training entries',dayKey:text(row.day_label).trim(),hasDay:nonblank(row.day_label),rows:[]};
        groups.push(group);
      }
      const matchesText = !query || Object.keys(FIELDS).some(key => text(row[key]).toLocaleLowerCase().includes(query));
      const matchesView = view === null || Boolean(row.deleted_at) === (view === 'deleted');
      if (matchesText && matchesView && (!trainer || text(row.trainer) === trainer)) group.rows.push(row);
    }
    return groups.filter(item => item.rows.length);
  }
  function renderLogs() {
    document.querySelectorAll('[data-log-view]').forEach(button => {
      const selected = button.dataset.logView === state.view;
      button.setAttribute('aria-pressed',String(selected));
      button.classList.toggle('is-active',selected);
    });
    if (!state.ready && !state.dogs.length) {
      $('logList').innerHTML = '<div class="tr-empty-state"><p>Your training records will appear here when connected.</p></div>';
      return;
    }
    if (!state.selectedDog) {
      $('logList').innerHTML = '<div class="tr-empty-state"><h3>Add your first dog</h3><p>Create a dog profile to begin keeping their training sessions together.</p></div>';
      return;
    }
    const rows = state.logs.filter(row => row.dog_id === state.selectedDog);
    const query = $('logSearch').value.trim().toLocaleLowerCase();
    const trainer = $('trainerFilter').value;
    const groups = groupLogs(rows,query,trainer,state.view);
    if (!groups.length) {
      const filtered = query || trainer;
      $('logList').innerHTML = `<div class="tr-empty-state"><h3>${filtered ? 'No matching entries' : state.view === 'deleted' ? 'No deleted entries' : 'No training entries yet'}</h3><p>${filtered ? 'Try a different search or trainer.' : state.view === 'deleted' ? 'Deleted entries can be restored here.' : 'Add a session to start this dog’s training history.'}</p></div>`;
      return;
    }
    $('logList').innerHTML = groups.map(group => `<section class="tl-day-group"><div class="tl-day-heading"><h3>${group.hasDay ? 'Day ' : ''}${escape(group.label)}</h3><span class="tl-day-subtitle">${group.rows.length} ${group.rows.length === 1 ? 'entry':'entries'}</span></div>${group.rows.map(renderEntry).join('')}</section>`).join('');
  }
  function render() {renderDogs();renderFilters();renderLogs();enableControls();}
  async function requireStaff(epoch) {
    if (typeof supabaseClient === 'undefined') throw {code:'AUTH'};
    const {data:auth,error:authError} = await supabaseClient.auth.getSession();
    if (!current(epoch) || authError || !auth?.session?.user) throw {code:'AUTH'};
    const user = auth.session.user;
    const {data,error} = await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',user.id).eq('active',true).maybeSingle();
    if (!current(epoch)) throw {code:'AUTH'};
    if (error) throw error;
    if (!data) throw {code:'ACCESS'};
    state.userId=user.id;
  }
  async function fetchAll(table,valid) {
    let rows=[],offset=0;
    while (true) {
      const {data,error} = await supabaseClient.from(table).select('*').order('id',{ascending:true}).range(offset,offset+PAGE_SIZE-1);
      if (!valid()) return [];
      if (error) throw error;
      rows=rows.concat(data || []);
      if (!data || data.length<PAGE_SIZE) return rows;
      offset+=PAGE_SIZE;
    }
  }
  async function refresh({silent=false} = {}) {
    if (state.loading || state.busy || dialogsOpen()) return;
    const epoch=state.authEpoch,requestId=++state.requestId;
    const valid=()=>current(epoch)&&requestId===state.requestId;
    state.loading=true;enableControls();
    $('trainingPage').setAttribute('aria-busy','true');
    if (!silent) message('Loading training records…');
    try {
      await requireStaff(epoch);
      if (!valid()) return;
      const [dogs,logs]=await Promise.all([fetchAll('hq_training_dogs',valid),fetchAll('hq_training_logs',valid)]);
      if (!valid()) return;
      state.dogs=sortDogs(dogs);state.logs=sortLogs(logs);state.ready=true;
      if (!state.dogs.some(dog=>dog.id===state.selectedDog)) state.selectedDog=state.dogs[0]?.id || null;
      message('');
      $('lastSynced').textContent=`Updated ${new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(new Date())} · Eastern time`;
    } catch(error) {
      if (!valid()) return;
      state.ready=false;
      if (['AUTH','ACCESS','42501'].includes(error?.code)) {state.dogs=[];state.logs=[];state.selectedDog=null;}
      message(friendlyError(error),true);
      $('lastSynced').textContent=state.dogs.length ? 'Showing the last loaded records' : 'Records unavailable';
    } finally {
      if (valid()) {state.loading=false;$('trainingPage').setAttribute('aria-busy','false');render();}
    }
  }
  function applyLog(row) {
    const index=state.logs.findIndex(item=>item.id===row.id);
    if (index<0) state.logs.push(row); else state.logs[index]=row;
    state.logs=sortLogs(state.logs);
    render();
  }
  function applyDog(row) {
    const index=state.dogs.findIndex(item=>item.id===row.id);
    if (index<0) state.dogs.push(row); else state.dogs[index]=row;
    state.dogs=sortDogs(state.dogs);
    render();
  }
  async function updateRow(table,row,patch) {
    const {data,error}=await supabaseClient.from(table).update(patch).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();
    if (error) throw error;
    if (!data) throw {code:'CONFLICT'};
    return data;
  }
  function selectDog(id) {
    if (!state.dogs.some(dog=>dog.id===id)) return;
    state.selectedDog=id;state.view='active';$('logSearch').value='';$('trainerFilter').value='';render();
  }
  function openSession(row=null) {
    if (!available() || dialogsOpen() || !state.dogs.length) return;
    state.editingLog=row ? {...row} : null;state.deletingLog=null;state.logBaseline={};
    $('sessionForm').reset();
    $('sessionId').value=row?.id || crypto.randomUUID();
    $('sessionDog').innerHTML=state.dogs.map(dog=>`<option value="${escape(dog.id)}">${escape(dog.name)}</option>`).join('');
    $('sessionDog').value=row?.dog_id || state.selectedDog || state.dogs[0].id;
    for (const [key,id] of Object.entries(FIELDS)) {
      const original=row ? text(row[key]) : key==='date_label' ? todayLabel() : '';
      $(id).value=original;
      // Keep untouched imported whitespace even if an input normalizes its displayed value.
      state.logBaseline[key]={original,display:$(id).value};
    }
    formError('sessionError','');
    $('sessionDialogTitle').textContent=row ? 'Edit training entry' : 'Add training session';
    enableControls();$('sessionDialog').showModal();$('dayLabel').focus();
  }
  function sessionPayload() {
    const payload={dog_id:$('sessionDog').value};
    if (!state.dogs.some(dog=>dog.id===payload.dog_id)) throw new Error('Choose a dog for this training entry.');
    for (const [key,id] of Object.entries(FIELDS)) {
      const value=$(id).value,baseline=state.logBaseline[key];
      payload[key]=baseline && value===baseline.display ? baseline.original : value;
    }
    if (!Object.keys(FIELDS).some(key=>nonblank(payload[key]))) throw new Error('Enter at least one training detail before saving.');
    return payload;
  }
  async function saveSession(event) {
    event.preventDefault();if (!available()) return;
    const epoch=state.authEpoch,editing=state.editingLog,id=$('sessionId').value;
    let payload;
    try {payload=sessionPayload();} catch(error) {formError('sessionError',error.message);return;}
    formError('sessionError','');setBusy(true);
    try {
      await requireStaff(epoch);if (!current(epoch)) return;
      let saved;
      if (editing) saved=await updateRow('hq_training_logs',editing,payload);
      else {
        const {data,error}=await supabaseClient.from('hq_training_logs').insert({id,...payload}).select('*').single();
        if (!current(epoch)) return;
        if (error?.code==='23505') {
          const recovered=await supabaseClient.from('hq_training_logs').select('*').eq('id',id).single();
          if (!current(epoch)) return;
          if (recovered.error) throw recovered.error;
          if (!recovered.data) throw error;
          state.editingLog={...recovered.data};applyLog(recovered.data);
          $('sessionDialogTitle').textContent='Edit training entry';
          formError('sessionError','Your earlier save succeeded. Your current edits are still here; review them and choose Save changes.');
          return;
        }
        if (error) throw error;saved=data;
      }
      if (!current(epoch)) return;
      state.selectedDog=saved.dog_id;state.view='active';$('logSearch').value='';$('trainerFilter').value='';
      applyLog(saved);$('sessionDialog').close();toast(editing ? 'Training entry updated.' : 'Training session added.');message('');
    } catch(error) {if (current(epoch)) formError('sessionError',friendlyError(error));}
    finally {if (current(epoch)) setBusy(false);}
  }
  function openDog(dog=null) {
    if (!available() || dialogsOpen()) return;
    state.editingDog=dog ? {...dog} : null;state.deletingLog=null;
    $('dogForm').reset();$('dogId').value=dog?.id || crypto.randomUUID();$('dogName').value=dog?.name || '';
    $('dogDialogTitle').textContent=dog ? 'Rename dog' : 'Add a dog';formError('dogError','');
    enableControls();$('dogDialog').showModal();$('dogName').focus();
  }
  async function saveDog(event) {
    event.preventDefault();if (!available()) return;
    const epoch=state.authEpoch,editing=state.editingDog,id=$('dogId').value,name=$('dogName').value.trim();
    if (!name) {formError('dogError','Enter a dog’s name.');return;}
    formError('dogError','');setBusy(true);
    try {
      await requireStaff(epoch);if (!current(epoch)) return;
      let saved;
      if (editing) saved=await updateRow('hq_training_dogs',editing,{name});
      else {
        const {data,error}=await supabaseClient.from('hq_training_dogs').insert({id,name}).select('*').single();
        if (!current(epoch)) return;
        if (error?.code==='23505') {
          const recovered=await supabaseClient.from('hq_training_dogs').select('*').eq('id',id).single();
          if (!current(epoch)) return;
          if (recovered.error) throw recovered.error;
          if (!recovered.data) throw error;
          state.editingDog={...recovered.data};applyDog(recovered.data);$('dogDialogTitle').textContent='Rename dog';
          formError('dogError','Your earlier save succeeded. Your current name is still here; review it and choose Save name.');return;
        }
        if (error) throw error;saved=data;
      }
      if (!current(epoch)) return;
      state.selectedDog=saved.id;state.view='active';$('logSearch').value='';$('trainerFilter').value='';
      applyDog(saved);$('dogDialog').close();toast(editing ? 'Dog name updated.' : 'Dog added.');message('');
    } catch(error) {if (current(epoch)) formError('dogError',friendlyError(error));}
    finally {if (current(epoch)) setBusy(false);}
  }
  function confirmDelete(row) {
    if (!row || !available() || dialogsOpen()) return;
    state.deletingLog={...row};
    const dog=state.dogs.find(item=>item.id===row.dog_id);
    $('deleteDescription').textContent=`Delete this training entry${dog ? ` for ${dog.name}` : ''}? It will move to Deleted and can be restored.`;
    enableControls();$('deleteDialog').showModal();$('cancelDelete').focus();
  }
  async function removeLog() {
    if (!state.deletingLog || !available()) return;
    const epoch=state.authEpoch,row=state.deletingLog;setBusy(true);
    try {
      await requireStaff(epoch);if (!current(epoch)) return;
      const deleted=await updateRow('hq_training_logs',row,{deleted_at:new Date().toISOString()});
      if (!current(epoch)) return;
      applyLog(deleted);$('deleteDialog').close();state.deletingLog=null;toast('Training entry deleted.',deleted);message('');
    } catch(error) {if (current(epoch)) $('deleteDescription').textContent=friendlyError(error);}
    finally {if (current(epoch)) setBusy(false);}
  }
  async function restoreLog(row) {
    if (!row || !available()) return;
    const epoch=state.authEpoch;setBusy(true);
    try {
      await requireStaff(epoch);if (!current(epoch)) return;
      const restored=await updateRow('hq_training_logs',row,{deleted_at:null});
      if (!current(epoch)) return;
      applyLog(restored);toast('Training entry restored.');message('');
    } catch(error) {if (current(epoch)) message(friendlyError(error),true);}
    finally {if (current(epoch)) setBusy(false);}
  }
  function resetAuth(userId) {
    state.authEpoch++;state.requestId++;state.userId=userId;state.ready=false;state.loading=false;
    state.dogs=[];state.logs=[];state.selectedDog=null;state.editingLog=null;state.editingDog=null;state.deletingLog=null;state.logBaseline={};
    dismissToast();$('toastText').textContent='';
    ['sessionDialog','dogDialog','deleteDialog'].forEach(id=>$(id).close());
    $('sessionForm').reset();$('dogForm').reset();formError('sessionError','');formError('dogError','');
    $('deleteDescription').textContent='This entry will move to Deleted and can be restored.';
    $('logSearch').value='';$('trainerFilter').value='';setBusy(false);render();
    $('trainingPage').setAttribute('aria-busy','false');
    message(userId ? 'Loading training records…' : 'Sign in to Paws HQ to view training records.');
    $('lastSynced').textContent=userId ? 'Connecting…' : 'Signed out';
  }
  function init() {
    if (!$('trainingPage')) return;
    $('addSession').addEventListener('click',()=>openSession());
    $('addDog').addEventListener('click',()=>openDog());
    $('renameDog').addEventListener('click',()=>openDog(state.dogs.find(dog=>dog.id===state.selectedDog)));
    $('sessionForm').addEventListener('submit',saveSession);$('dogForm').addEventListener('submit',saveDog);
    $('cancelSession').addEventListener('click',()=>{if (!state.busy) $('sessionDialog').close();});
    $('cancelDog').addEventListener('click',()=>{if (!state.busy) $('dogDialog').close();});
    $('cancelDelete').addEventListener('click',()=>{if (!state.busy) $('deleteDialog').close();});
    $('confirmDelete').addEventListener('click',removeLog);
    $('undoDelete').addEventListener('click',()=>{if (state.undo) restoreLog(state.undo);});
    $('logSearch').addEventListener('input',()=>{renderLogs();enableControls();});
    $('trainerFilter').addEventListener('change',()=>{renderLogs();enableControls();});
    $('refreshLogs').addEventListener('click',()=>refresh());
    $('dogList').addEventListener('click',event=>{
      const button=event.target.closest('[data-dog-id]');if (button && available()) selectDog(button.dataset.dogId);
    });
    document.querySelectorAll('[data-log-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.logView;renderLogs();enableControls();}));
    $('logList').addEventListener('click',event=>{
      const button=event.target.closest('[data-log-action]');if (!button || !available()) return;
      const row=state.logs.find(item=>item.id===button.dataset.id);if (!row) return;
      if (button.dataset.logAction==='edit') openSession(row);
      if (button.dataset.logAction==='delete') confirmDelete(row);
      if (button.dataset.logAction==='restore') restoreLog(row);
    });
    ['sessionDialog','dogDialog','deleteDialog'].forEach(id=>{
      $(id).addEventListener('cancel',event=>{if (state.busy) event.preventDefault();});
      $(id).addEventListener('close',()=>setTimeout(()=>refresh({silent:true}),0));
    });
    window.addEventListener('beforeunload',event=>{if (dialogsOpen() || state.busy) {event.preventDefault();event.returnValue='';}});
    window.addEventListener('online',()=>refresh({silent:true}));window.addEventListener('focus',()=>refresh({silent:true}));
    document.addEventListener('visibilitychange',()=>{if (!document.hidden) refresh({silent:true});});
    setInterval(()=>{if (!document.hidden) refresh({silent:true});},30000);
    if (typeof supabaseClient !== 'undefined') supabaseClient.auth.onAuthStateChange((event,session)=>{
      const userId=session?.user?.id || null;
      const changed=event==='SIGNED_OUT' || userId!==state.userId;
      if (changed) resetAuth(userId);
      if (userId) setTimeout(()=>refresh({silent:!changed}),0);
    });
    refresh();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
