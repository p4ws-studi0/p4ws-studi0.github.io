/* Paws HQ Tours. Load after the existing Supabase SDK and /script.js. */
(() => {
  'use strict';
  const TIME_ZONE = 'America/New_York';
  const TABLE = 'hq_tours';
  const $ = id => document.getElementById(id);
  const state = { rows: [], view: 'upcoming', ready: false, loading: false, busy: false,
    editing: null, deleting: null, undo: null, user: null, refreshTimer: null, toastTimer: null, authEpoch: 0 };
  const labels = {
    file: { yes: 'File on record', no: 'No file', unknown: 'File unknown' },
    booking: { confirmed: 'Booking confirmed', tentative: 'Tentative booking', none: 'No booking', unknown: 'Booking unknown' }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const sortTours = rows => [...rows].sort((a,b) =>
    `${a.tour_date}T${a.tour_time}`.localeCompare(`${b.tour_date}T${b.tour_time}`) || a.customer_name.localeCompare(b.customer_name));
  function localNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type,p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  function timeLabel(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2,'0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  }
  function dateLabel(date, options = {weekday:'short', month:'short', day:'numeric', year:'numeric'}) {
    return new Intl.DateTimeFormat('en-US', {timeZone:'UTC', ...options}).format(new Date(`${date}T12:00:00Z`));
  }
  const outsideHours = time => time < '10:30' || time > '15:00';
  function category(row, now = localNow()) {
    if (row.deleted_at) return 'deleted';
    return `${row.tour_date}T${row.tour_time.slice(0,5)}` < `${now.date}T${now.time}` ? 'past' : 'upcoming';
  }
  function friendlyError(error) {
    if (error?.code === 'CONFLICT') return 'Someone else changed this tour. Your edits are still here. Close this form, refresh the list, and reopen the tour before saving again.';
    if (['42P01','PGRST205','PGRST202'].includes(error?.code)) return 'Tours is not set up yet. Ask your Paws HQ administrator to complete the one-time Tours database setup.';
    if (error?.code === '42501' || error?.code === 'ACCESS') return 'Your account does not have Tours access. Ask your Paws HQ administrator to add you to the tour staff list.';
    if (error?.code === 'AUTH') return 'Your session has expired. Sign in to Paws HQ again before saving.';
    return 'Could not reach the tour schedule. Check your connection and try again. Your changes have not been discarded.';
  }
  function message(text, error = false) {
    $('pageMessage').textContent = text;
    $('pageMessage').hidden = !text;
    $('pageMessage').classList.toggle('is-error', error);
  }
  function dismissToast() {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
    state.undo = null;
    $('toast').hidden = true;
    $('undoDelete').hidden = true;
  }
  function toast(text, undo = null) {
    clearTimeout(state.toastTimer);
    state.undo = undo;
    $('toastText').textContent = text;
    $('undoDelete').hidden = !undo;
    $('toast').hidden = false;
    state.toastTimer = setTimeout(dismissToast, 5000);
  }
  function enableControls() {
    $('addTour').disabled = !state.ready || state.busy || state.loading;
    $('refreshTours').disabled = state.loading || state.busy;
    $('saveTour').disabled = state.busy || state.loading;
    $('confirmDelete').disabled = state.busy || state.loading;
    $('cancelTour').disabled = state.busy;
    $('cancelDelete').disabled = state.busy;
    $('undoDelete').disabled = state.busy || state.loading;
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = !state.ready || state.busy || state.loading; });
  }
  function render() {
    const now = localNow();
    const counts = {upcoming:0, past:0, deleted:0};
    state.rows.forEach(row => { counts[category(row, now)]++; });
    for (const view of Object.keys(counts)) $(view+'Count').textContent = counts[view];
    document.querySelectorAll('[data-view]').forEach(button => {
      const selected = button.dataset.view === state.view;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
    });
    const query = $('tourSearch').value.trim().toLocaleLowerCase();
    const rows = sortTours(state.rows.filter(row => category(row, now) === state.view &&
      [row.customer_name, row.customer_info, row.staff_initials, row.tour_date].some(value => String(value).toLocaleLowerCase().includes(query))));
    if (!state.ready && !state.rows.length) {
      $('tourList').innerHTML = '<div class="empty-state"><p>The schedule will appear here when connected.</p></div>';
      enableControls(); return;
    }
    if (!rows.length) {
      const title = query ? 'No matching tours' : {upcoming:'No upcoming tours',past:'No past tours',deleted:'No deleted tours'}[state.view];
      const detail = query ? 'Try another customer name, note, date, or staff initial.' : {upcoming:'Schedule a tour to welcome someone new to Paws.',past:'Tours move here once their scheduled time has passed.',deleted:'Deleted tours can be restored here.'}[state.view];
      $('tourList').innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">↗</div><h3>${title}</h3><p>${detail}</p></div>`;
    } else {
      $('tourList').innerHTML = rows.map(row => {
        const fileClass = {yes:'yes',no:'no',unknown:'unknown'}[row.has_file];
        const bookingClass = {confirmed:'yes',tentative:'tentative',none:'no',unknown:'unknown'}[row.booking_status];
        const day = dateLabel(row.tour_date, {day:'numeric'});
        const month = dateLabel(row.tour_date, {month:'short'});
        const today = row.tour_date === now.date;
        return `<article class="tour-card${today ? ' is-today':''}" aria-label="${escape(row.customer_name)}, ${dateLabel(row.tour_date)}, ${timeLabel(row.tour_time)}">
          <div class="tour-date" aria-hidden="true"><span class="tour-date-month">${month}</span><span class="tour-date-day">${day}</span><span class="tour-date-time">${timeLabel(row.tour_time)}</span></div>
          <div class="tour-details"><div class="tour-name-row"><h3 class="tour-name">${escape(row.customer_name)}</h3>${today ? '<span class="badge badge-today">Today</span>':''}</div>
            <p class="tour-schedule">${dateLabel(row.tour_date)} · ${timeLabel(row.tour_time)}</p>
            ${row.customer_info ? `<p class="tour-notes">${escape(row.customer_info)}</p>` : ''}
            <div class="tour-meta"><span class="badge badge-${fileClass}">${labels.file[row.has_file]}</span><span class="badge badge-${bookingClass}">${labels.booking[row.booking_status]}</span><span class="tour-meta-item"><span class="meta-label">Staff</span> <strong>${escape(row.staff_initials)}</strong></span>${outsideHours(row.tour_time.slice(0,5)) ? '<span class="badge badge-tentative">Staff-led outside hours</span>':''}</div>
          </div><div class="tour-actions">${row.deleted_at
            ? `<button class="icon-button tour-edit" data-action="restore" data-id="${row.id}" aria-label="Restore tour for ${escape(row.customer_name)}">Restore</button>`
            : `<button class="icon-button tour-edit" data-action="edit" data-id="${row.id}" aria-label="Edit tour for ${escape(row.customer_name)}">Edit <span aria-hidden="true">↗</span></button><button class="icon-button tour-delete" data-action="delete" data-id="${row.id}" aria-label="Delete tour for ${escape(row.customer_name)}" title="Delete tour"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>`}</div></article>`;
      }).join('');
    }
    enableControls();
  }
  async function requireStaff() {
    const epoch = state.authEpoch;
    const {data: auth, error: authError} = await supabaseClient.auth.getSession();
    if (authError || !auth?.session) throw {code:'AUTH'};
    const user = auth.session.user;
    const {data, error} = await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',user.id).eq('active',true).maybeSingle();
    if (error) throw error;
    if (epoch !== state.authEpoch) throw {code:'AUTH'};
    if (!data) throw {code:'ACCESS'};
    state.user = user;
  }
  async function refresh({silent = false} = {}) {
    if (state.loading || state.busy || $('tourDialog').open || $('deleteDialog').open) return;
    const epoch = state.authEpoch;
    state.loading = true;
    enableControls();
    if (!silent) message('Loading tours…');
    try {
      await requireStaff();
      // Paginate to avoid silently dropping records at Supabase's default 1,000-row cap.
      let all = [], offset = 0;
      while (true) {
        const {data,error} = await supabaseClient.from(TABLE).select('*').order('id').range(offset,offset+499);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < 500) break;
        offset += 500;
      }
      if (epoch !== state.authEpoch) return;
      state.rows = all;
      state.ready = true;
      message('');
      $('lastSynced').textContent = `Updated ${new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:TIME_ZONE}).format(new Date())} · Eastern time`;
    } catch (error) {
      if (epoch !== state.authEpoch) return;
      state.ready = false;
      if (['AUTH','ACCESS','42501'].includes(error?.code)) state.rows = [];
      message(friendlyError(error), true);
      $('lastSynced').textContent = state.rows.length ? 'Showing the last loaded schedule' : 'Schedule unavailable';
    } finally {
      state.loading = false;
      render();
    }
  }
  function setFieldBusy(busy) {
    state.busy = busy;
    $('tourForm').querySelectorAll('input,textarea,select').forEach(el => {el.disabled=busy;});
    $('saveTour').textContent = busy ? 'Saving…' : state.editing ? 'Save changes' : 'Schedule tour';
    enableControls();
  }
  function hoursHint() {
    const outside = $('tourTime').value && outsideHours($('tourTime').value);
    $('outsideHoursField').hidden = !outside;
    $('outsideHoursConfirmed').required = Boolean(outside);
    if (!outside) $('outsideHoursConfirmed').checked = false;
  }
  function openForm(row = null) {
    state.editing = row ? {...row} : null;
    $('tourForm').reset();
    $('tourId').value = row?.id || crypto.randomUUID();
    $('customerName').value = row?.customer_name || '';
    $('customerInfo').value = row?.customer_info || '';
    $('tourDate').value = row?.tour_date || localNow().date;
    $('tourTime').value = row?.tour_time.slice(0,5) || '10:30';
    $('hasFile').value = row?.has_file || 'unknown';
    $('bookingStatus').value = row?.booking_status || 'unknown';
    $('staffInitials').value = row?.staff_initials || '';
    $('outsideHoursConfirmed').checked = row?.outside_hours_confirmed || false;
    $('formError').textContent = '';
    $('formError').hidden = true;
    $('tourDialogTitle').textContent = row ? 'Edit tour' : 'Schedule a tour';
    $('saveTour').textContent = row ? 'Save changes' : 'Schedule tour';
    hoursHint();
    $('tourDialog').showModal();
    $('customerName').focus();
  }
  function formData() {
    const payload = {
      customer_name:$('customerName').value.trim(), customer_info:$('customerInfo').value.trim(),
      tour_date:$('tourDate').value, tour_time:$('tourTime').value,
      has_file:$('hasFile').value, booking_status:$('bookingStatus').value,
      staff_initials:$('staffInitials').value.trim().toUpperCase(),
      outside_hours_confirmed:outsideHours($('tourTime').value) && $('outsideHoursConfirmed').checked
    };
    if (!payload.customer_name || !payload.staff_initials) throw new Error('Enter a customer name and your staff initials.');
    if (outsideHours(payload.tour_time) && !payload.outside_hours_confirmed) throw new Error('Confirm that you will personally lead this tour outside regular hours.');
    return payload;
  }
  async function updateRow(row, patch) {
    const {data,error} = await supabaseClient.from(TABLE).update(patch).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();
    if (error) throw error;
    if (!data) throw {code:'CONFLICT'};
    return data;
  }
  function applyRow(row) {
    const index = state.rows.findIndex(item => item.id === row.id);
    if (index < 0) state.rows.push(row); else state.rows[index] = row;
    render();
  }
  async function save(event) {
    event.preventDefault();
    if (state.busy || state.loading || !state.ready) return;
    const epoch = state.authEpoch;
    let payload;
    try { payload = formData(); } catch(error) {
      if (epoch !== state.authEpoch) return;
      $('formError').textContent=error.message; $('formError').hidden=false; return;
    }
    $('formError').hidden=true;
    setFieldBusy(true);
    try {
      await requireStaff();
      let saved;
      if (state.editing) saved = await updateRow(state.editing,payload);
      else {
        const id = $('tourId').value;
        const {data,error} = await supabaseClient.from(TABLE).insert({id,...payload}).select('*').single();
        if (error?.code === '23505') {
          // A retry may follow a successful insert whose response was lost. Never create a duplicate.
          const recovered = await supabaseClient.from(TABLE).select('*').eq('id',id).single();
          if (recovered.error) throw recovered.error;
          saved = recovered.data;
          if (epoch !== state.authEpoch) return;
          applyRow(saved);
          state.editing = {...saved};
          $('tourDialogTitle').textContent = 'Edit tour';
          $('formError').textContent = 'Your earlier save succeeded. Your current edits are still here; review them and choose Save changes.';
          $('formError').hidden = false;
          return;
        } else if (error) throw error;
        else saved = data;
      }
      if (epoch !== state.authEpoch) return;
      applyRow(saved);
      state.view = category(saved);
      $('tourSearch').value = '';
      $('tourDialog').close();
      toast(state.editing ? 'Tour updated.' : 'Tour scheduled.');
      message('');
    } catch(error) {
      if (epoch !== state.authEpoch) return;
      $('formError').textContent = friendlyError(error);
      $('formError').hidden = false;
    } finally { setFieldBusy(false); render(); }
  }
  async function remove() {
    if (!state.deleting || state.busy || state.loading) return;
    const epoch = state.authEpoch;
    setFieldBusy(true);
    $('confirmDelete').textContent = 'Deleting…';
    try {
      await requireStaff();
      const deleted = await updateRow(state.deleting,{deleted_at:new Date().toISOString()});
      if (epoch !== state.authEpoch) return;
      applyRow(deleted);
      $('deleteDialog').close();
      toast(`Tour for ${deleted.customer_name} deleted.`,deleted);
      message('');
    } catch(error) {
      if (epoch !== state.authEpoch) return;
      $('deleteDescription').textContent = friendlyError(error);
    } finally { setFieldBusy(false); $('confirmDelete').textContent = 'Delete tour'; }
  }
  async function restore(row) {
    if (state.busy || state.loading) return;
    const epoch = state.authEpoch;
    setFieldBusy(true);
    try {
      await requireStaff();
      const restored = await updateRow(row,{deleted_at:null});
      if (epoch !== state.authEpoch) return;
      applyRow(restored);
      toast(`Tour for ${restored.customer_name} restored.`);
      message('');
    } catch(error) { if (epoch === state.authEpoch) message(friendlyError(error),true); }
    finally {setFieldBusy(false);}
  }
  function init() {
    $('addTour').addEventListener('click',() => openForm());
    $('tourForm').addEventListener('submit',save);
    $('cancelTour').addEventListener('click',() => {if (!state.busy) $('tourDialog').close();});
    $('tourTime').addEventListener('input',hoursHint);
    $('tourSearch').addEventListener('input',render);
    $('refreshTours').addEventListener('click',() => refresh());
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => {state.view=button.dataset.view; render();}));
    $('tourList').addEventListener('click',event => {
      const button=event.target.closest('[data-action]');
      if (!button || state.busy || state.loading || !state.ready) return;
      const row=state.rows.find(item=>item.id===button.dataset.id);
      if (!row) return;
      if (button.dataset.action==='edit') openForm(row);
      if (button.dataset.action==='restore') restore(row);
      if (button.dataset.action==='delete') {
        state.deleting={...row};
        $('deleteDescription').textContent=`Delete the tour for ${row.customer_name} on ${dateLabel(row.tour_date)} at ${timeLabel(row.tour_time)}? You can restore it from Deleted tours.`;
        $('deleteDialog').showModal();
        $('cancelDelete').focus();
      }
    });
    $('cancelDelete').addEventListener('click',() => {if (!state.busy) $('deleteDialog').close();});
    $('confirmDelete').addEventListener('click',remove);
    $('undoDelete').addEventListener('click',()=> {if (state.undo) restore(state.undo);});
    [$('tourDialog'),$('deleteDialog')].forEach(dialog=>dialog.addEventListener('cancel',event=> {if(state.busy)event.preventDefault();}));
    window.addEventListener('beforeunload',event=> {if ($('tourDialog').open || state.busy) {event.preventDefault();event.returnValue='';}});
    window.addEventListener('online',()=>refresh({silent:true}));
    document.addEventListener('visibilitychange',()=> {if (!document.hidden) refresh({silent:true});});
    state.refreshTimer=setInterval(()=> {if (!document.hidden) refresh({silent:true});},30000);
    if (typeof supabaseClient === 'undefined') {
      message('Paws HQ could not load. Check your connection and reload the page.',true); render(); return;
    }
    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        state.authEpoch++; state.ready=false; state.rows=[]; state.user=null;
        state.editing=null; state.deleting=null; dismissToast();
        $('tourDialog').close(); $('deleteDialog').close(); $('tourForm').reset();
        render(); message('Sign in to Paws HQ to view tours.');
      }
    });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
