/* Paws HQ Tours. Load after the existing Supabase SDK and /script.js. */
(() => {
  'use strict';
  const TIME_ZONE = 'America/New_York';
  const TABLE = 'hq_tours';
  const $ = id => document.getElementById(id);
  const state = {rows:[], view:'upcoming', ready:false, loading:false, user:null, refreshTimer:null, authEpoch:0, requestId:0};
  let editor = null;
  const labels = {
    file: { yes: 'File on record', no: 'No file', unknown: 'File unknown' },
    booking: { confirmed: 'Booking confirmed', none: 'No booking', unknown: 'Booking unknown' }
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
  function enableControls() {
    const busy = editor?.isBusy() || false;
    $('addTour').disabled = !state.ready || busy || state.loading;
    $('refreshTours').disabled = state.loading || busy;
    document.querySelectorAll('[data-action]').forEach(button => {button.disabled = !state.ready || busy || state.loading;});
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
        const file = Object.hasOwn(labels.file,row.has_file) ? row.has_file : 'unknown';
        const booking = Object.hasOwn(labels.booking,row.booking_status) ? row.booking_status : 'unknown';
        const fileClass = {yes:'yes',no:'no',unknown:'unknown'}[file];
        const bookingClass = {confirmed:'yes',none:'no',unknown:'unknown'}[booking];
        const day = dateLabel(row.tour_date, {day:'numeric'});
        const month = dateLabel(row.tour_date, {month:'short'});
        const today = row.tour_date === now.date;
        return `<article class="tour-card${today ? ' is-today':''}" aria-label="${escape(row.customer_name)}, ${dateLabel(row.tour_date)}, ${timeLabel(row.tour_time)}">
          <div class="tour-date" aria-hidden="true"><span class="tour-date-month">${month}</span><span class="tour-date-day">${day}</span><span class="tour-date-time">${timeLabel(row.tour_time)}</span></div>
          <div class="tour-details"><div class="tour-name-row"><h3 class="tour-name">${escape(row.customer_name)}</h3>${today ? '<span class="badge badge-today">Today</span>':''}</div>
            <p class="tour-schedule">${dateLabel(row.tour_date)} · ${timeLabel(row.tour_time)}</p>
            ${row.customer_info ? `<p class="tour-notes">${escape(row.customer_info)}</p>` : ''}
            <div class="tour-meta"><span class="badge badge-${fileClass}">${labels.file[file]}</span><span class="badge badge-${bookingClass}">${labels.booking[booking]}</span><span class="tour-meta-item"><span class="meta-label">Staff</span> <strong>${escape(row.staff_initials)}</strong></span>${outsideHours(row.tour_time.slice(0,5)) ? '<span class="badge badge-warning">Staff-led outside hours</span>':''}</div>
          </div><div class="tour-actions">${row.deleted_at
            ? `<button class="icon-button tour-edit" data-action="restore" data-id="${escape(row.id)}" aria-label="Restore tour for ${escape(row.customer_name)}">Restore</button>`
            : `<button class="icon-button tour-edit" data-action="edit" data-id="${escape(row.id)}" aria-label="Edit tour for ${escape(row.customer_name)}">Edit <span aria-hidden="true">↗</span></button><button class="icon-button tour-delete" data-action="delete" data-id="${escape(row.id)}" aria-label="Delete tour for ${escape(row.customer_name)}" title="Delete tour"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>`}</div></article>`;
      }).join('');
    }
    enableControls();
  }
  async function requireStaff(epoch) {
    const {data:auth,error:authError} = await supabaseClient.auth.getSession();
    if (epoch !== state.authEpoch || authError || !auth?.session?.user) throw {code:'AUTH'};
    const user = auth.session.user;
    const {data,error} = await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',user.id).eq('active',true).maybeSingle();
    if (epoch !== state.authEpoch) throw {code:'AUTH'};
    if (error) throw error;
    if (!data) throw {code:'ACCESS'};
    state.user = user;
  }
  async function refresh({silent = false} = {}) {
    if (state.loading || editor?.isBusy() || editor?.isOpen()) return;
    const epoch = state.authEpoch;
    const requestId = ++state.requestId;
    const current = () => epoch === state.authEpoch && requestId === state.requestId;
    state.loading = true;
    enableControls();
    if (!silent) message('Loading tours…');
    try {
      await requireStaff(epoch);
      if (!current()) return;
      // Paginate to avoid silently dropping records at Supabase's default 1,000-row cap.
      let all = [], offset = 0;
      while (true) {
        const {data,error} = await supabaseClient.from(TABLE).select('*').order('id').range(offset,offset+499);
        if (!current()) return;
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < 500) break;
        offset += 500;
      }
      state.rows = all;
      state.ready = true;
      message('');
      $('lastSynced').textContent = `Updated ${new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:TIME_ZONE}).format(new Date())} · Eastern time`;
    } catch(error) {
      if (!current()) return;
      state.ready = false;
      if (['AUTH','ACCESS','42501'].includes(error?.code)) state.rows = [];
      message(friendlyError(error),true);
      $('lastSynced').textContent = state.rows.length ? 'Showing the last loaded schedule' : 'Schedule unavailable';
    } finally {
      if (current()) {state.loading=false;render();}
    }
  }
  function applyRow(row) {
    const index = state.rows.findIndex(item => item.id === row.id);
    if (index < 0) state.rows.push(row); else state.rows[index] = row;
    message('');
    render();
  }
  function init() {
    if (typeof window.createTourEditor !== 'function') {
      message('The tour editor could not load. Check your connection and reload the page.',true);
      render();
      return;
    }
    editor = window.createTourEditor({
      isReady:() => state.ready,
      isLoading:() => state.loading,
      onChange:applyRow,
      onError:text => message(text,true),
      onBusyChange:enableControls,
      onSaved:row => {state.view=category(row);$('tourSearch').value='';render();}
    });
    $('addTour').addEventListener('click',() => editor.open());
    $('tourSearch').addEventListener('input',render);
    $('refreshTours').addEventListener('click',() => refresh());
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => {state.view=button.dataset.view;render();}));
    $('tourList').addEventListener('click',event => {
      const button = event.target.closest('[data-action]');
      if (!button || editor.isBusy() || state.loading || !state.ready) return;
      const row = state.rows.find(item => item.id === button.dataset.id);
      if (!row) return;
      if (button.dataset.action === 'edit') editor.open(row);
      if (button.dataset.action === 'restore') editor.restore(row);
      if (button.dataset.action === 'delete') editor.confirmDelete(row);
    });
    window.addEventListener('online',() => refresh({silent:true}));
    window.addEventListener('focus',() => refresh({silent:true}));
    document.addEventListener('visibilitychange',() => {if (!document.hidden) refresh({silent:true});});
    state.refreshTimer = setInterval(() => {if (!document.hidden) refresh({silent:true});},30000);
    if (typeof supabaseClient === 'undefined') {
      message('Paws HQ could not load. Check your connection and reload the page.',true);render();return;
    }
    supabaseClient.auth.onAuthStateChange((event,session) => {
      const user = session?.user || null;
      const changed = event === 'SIGNED_OUT' || user?.id !== state.user?.id;
      if (changed) {
        state.authEpoch++;
        state.requestId++;
        state.ready = false;
        state.loading = false;
        state.rows = [];
        state.user = user;
        editor.reset();
        render();
        message(user ? 'Loading tours…' : 'Sign in to Paws HQ to view tours.');
        $('lastSynced').textContent = user ? 'Connecting…' : 'Signed out';
      }
      // Leave the auth callback before starting another Supabase request.
      if (user) setTimeout(() => refresh({silent:!changed}),0);
    });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
