/* Homepage view of every tour scheduled today. Load after /script.js and tour-editor.js. */
(() => {
  'use strict';
  const widget = document.getElementById('homeToursWidget');
  if (!widget) return;
  const $ = id => document.getElementById(id);
  const TIME_ZONE = 'America/New_York';
  const PAGE_SIZE = 500;
  const FIELDS = 'id,customer_name,customer_info,tour_date,tour_time,has_file,booking_status,staff_initials,outside_hours_confirmed,revision,deleted_at';
  const state = {rows: [], loadedDate: null, ready: false, loading: false, userId: null, authEpoch: 0, requestId: 0};
  let editor;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const fileLabels = {yes:'File on record', no:'No file', unknown:'File unknown'};
  const bookingLabels = {confirmed:'Booking confirmed', none:'No booking', unknown:'Booking unknown'};
  function localNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type,part.value]));
    return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
  }
  function today() {
    return localNow().date;
  }
  function enableControls() {
    const blocked = state.loading || editor?.isBusy();
    $('homeToursAdd').disabled = !state.ready || !editor || blocked;
    $('homeToursRefresh').disabled = Boolean(blocked);
    widget.querySelectorAll('[data-tour-action]').forEach(button => {button.disabled = !state.ready || !editor || blocked;});
  }
  function applyRow(row) {
    state.rows = state.rows.filter(item => item.id !== row.id);
    if (!row.deleted_at && row.tour_date === today()) state.rows.push(row);
    state.rows = state.rows.filter(item => item.tour_date === today()).sort((a,b) => a.tour_time.localeCompare(b.tour_time) || a.id.localeCompare(b.id));
    render();
    setStatus('Tour schedule updated.');
  }
  function updateDate() {
    $('homeToursDate').textContent = `${new Intl.DateTimeFormat('en-US', {timeZone:TIME_ZONE,weekday:'long',month:'short',day:'numeric'}).format(new Date())} · Eastern time`;
  }
  function timeLabel(time) {
    const [hour,minute] = String(time).split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2,'0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  function setStatus(message, error = false) {
    $('homeToursStatus').textContent = message;
    $('homeToursStatus').classList.toggle('is-error', error);
  }
  function unavailable(message) {
    state.rows = [];
    state.ready = false;
    state.loadedDate = null;
    widget.classList.remove('is-empty');
    $('homeToursCount').textContent = '—';
    $('homeToursCount').setAttribute('aria-label','Tour count unavailable');
    $('homeToursList').innerHTML = `<li class="home-tours-empty"><p>${escape(message)}</p></li>`;
    enableControls();
  }
  function render() {
    updateDate();
    const now = localNow();
    widget.classList.toggle('is-empty',state.rows.length === 0);
    $('homeToursCount').textContent = String(state.rows.length);
    $('homeToursCount').setAttribute('aria-label',`${state.rows.length} ${state.rows.length === 1 ? 'tour' : 'tours'} scheduled today`);
    if (!state.rows.length) {
      $('homeToursList').innerHTML = '<li class="home-tours-empty"><strong>No Tours Scheduled for Today</strong></li>';
      enableControls();
      return;
    }
    $('homeToursList').innerHTML = state.rows.map(row => {
      const fileKey = Object.hasOwn(fileLabels,row.has_file) ? row.has_file : 'unknown';
      const bookingKey = Object.hasOwn(bookingLabels,row.booking_status) ? row.booking_status : 'unknown';
      const fileClass = fileKey === 'yes' ? 'yes' : 'neutral';
      const bookingClass = bookingKey === 'confirmed' ? 'yes' : 'neutral';
      const passed = row.tour_date === now.date && row.tour_time.slice(0,5) < now.time;
      return `<li class="home-tours-row"><div class="home-tour-when"><time class="home-tour-time" datetime="${escape(row.tour_date)}T${escape(row.tour_time)}">${escape(timeLabel(row.tour_time))}</time>${passed ? '<span class="home-tour-passed">Time passed</span>' : ''}</div><div class="home-tour-customer"><h3 class="home-tour-name">${escape(row.customer_name)}</h3>${row.customer_info ? `<p class="home-tour-notes">${escape(row.customer_info)}</p>` : ''}</div><div class="home-tour-badges"><span class="home-tour-badge home-tour-badge-${fileClass}">${fileLabels[fileKey]}</span><span class="home-tour-badge home-tour-badge-${bookingClass}">${bookingLabels[bookingKey]}</span></div><div class="home-tour-staff"><span class="home-tour-staff-label">Staff</span><span class="home-tour-initials" aria-label="Staff initials: ${escape(row.staff_initials)}">${escape(row.staff_initials)}</span></div><div class="home-tour-actions"><button type="button" data-tour-action="edit" data-id="${escape(row.id)}" aria-label="Edit tour for ${escape(row.customer_name)}">Edit</button><button type="button" class="home-tour-delete" data-tour-action="delete" data-id="${escape(row.id)}" aria-label="Delete tour for ${escape(row.customer_name)}" title="Delete tour"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button></div></li>`;
    }).join('');
    enableControls();
  }
  function errorMessage(error) {
    if (error?.code === 'AUTH') return 'Sign in to Paws HQ to see today’s tours.';
    if (error?.code === 'ACCESS' || error?.code === '42501') return 'Tours are unavailable for this account. Ask your Paws HQ administrator for access.';
    return 'Could not load today’s tours. Check your connection and try Refresh.';
  }
  async function refresh({silent = false} = {}) {
    if (state.loading || editor?.isBusy() || editor?.isOpen()) return;
    updateDate();
    const requestedDate = today();
    if (state.loadedDate && state.loadedDate !== requestedDate) unavailable('Loading today’s tours…');
    const epoch = state.authEpoch;
    const requestId = ++state.requestId;
    const current = () => epoch === state.authEpoch && requestId === state.requestId;
    state.loading = true;
    enableControls();
    widget.setAttribute('aria-busy','true');
    if (!silent || !state.loadedDate) setStatus('Loading today’s tours…');
    let dateChanged = false;
    try {
      if (typeof supabaseClient === 'undefined') throw new Error('Client unavailable');
      const {data:auth,error:authError} = await supabaseClient.auth.getSession();
      if (!current()) return;
      if (authError || !auth?.session?.user) throw {code:'AUTH'};
      const userId = auth.session.user.id;
      const {data:staff,error:staffError} = await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',userId).eq('active',true).maybeSingle();
      if (!current()) return;
      if (staffError) throw staffError;
      if (!staff) throw {code:'ACCESS'};
      state.userId = userId;
      let rows = [], offset = 0;
      while (true) {
        // Filter only by date, so tours earlier today remain in this daily overview.
        const {data,error} = await supabaseClient.from('hq_tours').select(FIELDS).eq('tour_date',requestedDate).is('deleted_at',null).order('tour_time',{ascending:true}).order('id',{ascending:true}).range(offset,offset+PAGE_SIZE-1);
        if (!current()) return;
        if (error) throw error;
        rows = rows.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      if (today() !== requestedDate) { dateChanged = true; unavailable('Loading today’s tours…'); return; }
      state.rows = rows;
      state.loadedDate = requestedDate;
      state.ready = true;
      render();
      setStatus(`All of today’s tours · Updated ${new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(new Date())}`);
    } catch(error) {
      if (!current()) return;
      state.ready = false;
      const denied = ['AUTH','ACCESS','42501'].includes(error?.code);
      if (denied || !state.loadedDate || state.loadedDate !== today()) {
        unavailable('Today’s tour schedule is unavailable.');
        setStatus(errorMessage(error),true);
      } else {
        setStatus('Could not refresh tours. Showing the last loaded schedule; try Refresh.',true);
      }
    } finally {
      if (current()) {
        state.loading = false;
        enableControls();
        widget.setAttribute('aria-busy','false');
        if (dateChanged) setTimeout(() => refresh(),0);
      }
    }
  }
  if (typeof window.createTourEditor === 'function') {
    editor = window.createTourEditor({
      isReady:() => state.ready,
      isLoading:() => state.loading,
      onChange:applyRow,
      onError:message => setStatus(message,true),
      onBusyChange:enableControls,
      onSaved:row => {
        if (row.tour_date !== today()) setStatus('Tour saved. View all tours to see its scheduled date.');
      }
    });
  }
  $('homeToursAdd').addEventListener('click',() => { if (state.ready && !state.loading) editor?.open(); });
  $('homeToursList').addEventListener('click',event => {
    const button = event.target.closest('[data-tour-action]');
    if (!button || !state.ready || state.loading || editor?.isBusy()) return;
    const row = state.rows.find(item => item.id === button.dataset.id);
    if (!row) return;
    if (button.dataset.tourAction === 'edit') editor?.open(row);
    if (button.dataset.tourAction === 'delete') editor?.confirmDelete(row);
  });
  // Refresh promptly after a dialog closes, including tours scheduled for another day.
  ['tourDialog','deleteDialog'].forEach(id => $(id).addEventListener('close',() => setTimeout(() => refresh({silent:true}),0)));
  $('homeToursRefresh').addEventListener('click',() => refresh());
  window.addEventListener('focus',() => refresh({silent:true}));
  window.addEventListener('online',() => refresh({silent:true}));
  document.addEventListener('visibilitychange',() => { if (!document.hidden) refresh({silent:true}); });
  setInterval(() => { if (!document.hidden) refresh({silent:true}); },30000);
  if (typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.onAuthStateChange((event,session) => {
      const userId = session?.user?.id || null;
      const changed = event === 'SIGNED_OUT' || userId !== state.userId;
      if (changed) {
        state.authEpoch++;
        state.requestId++;
        state.userId = userId;
        state.loading = false;
        editor?.reset();
        widget.setAttribute('aria-busy','false');
        unavailable(userId ? 'Loading today’s tours…' : 'Sign in to see today’s tours.');
        setStatus(userId ? 'Loading today’s tours…' : 'Sign in to Paws HQ to see today’s tours.');
      }
      // Supabase auth callbacks must finish before another Supabase call starts.
      if (userId) setTimeout(() => refresh({silent:!changed}),0);
    });
  }
  updateDate();
  refresh();
})();
