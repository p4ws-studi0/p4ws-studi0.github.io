/* Read-only homepage view of every tour scheduled today. Load after /script.js. */
(() => {
  'use strict';
  const widget = document.getElementById('homeToursWidget');
  if (!widget) return;
  const $ = id => document.getElementById(id);
  const TIME_ZONE = 'America/New_York';
  const PAGE_SIZE = 500;
  const FIELDS = 'id,customer_name,customer_info,tour_date,tour_time,has_file,booking_status,staff_initials';
  const state = {rows: [], loadedDate: null, loading: false, userId: null, authEpoch: 0, requestId: 0};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const fileLabels = {yes:'File on record', no:'No file', unknown:'File unknown'};
  const bookingLabels = {confirmed:'Booking confirmed', tentative:'Tentative booking', none:'No booking', unknown:'Booking unknown'};
  function today() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
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
    state.loadedDate = null;
    $('homeToursCount').textContent = '—';
    $('homeToursCount').setAttribute('aria-label','Tour count unavailable');
    $('homeToursList').innerHTML = `<li class="home-tours-empty"><p>${escape(message)}</p></li>`;
  }
  function render() {
    updateDate();
    $('homeToursCount').textContent = String(state.rows.length);
    $('homeToursCount').setAttribute('aria-label',`${state.rows.length} ${state.rows.length === 1 ? 'tour' : 'tours'} scheduled today`);
    if (!state.rows.length) {
      $('homeToursList').innerHTML = '<li class="home-tours-empty"><svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-7 6 2 2 4-4"/></svg><strong>No Tours Scheduled for Today</strong><p>Open the full schedule to plan the next warm welcome.</p></li>';
      return;
    }
    $('homeToursList').innerHTML = state.rows.map(row => {
      const fileKey = Object.hasOwn(fileLabels,row.has_file) ? row.has_file : 'unknown';
      const bookingKey = Object.hasOwn(bookingLabels,row.booking_status) ? row.booking_status : 'unknown';
      const fileClass = fileKey === 'yes' ? 'yes' : 'neutral';
      const bookingClass = {confirmed:'yes',tentative:'tentative',none:'neutral',unknown:'neutral'}[bookingKey];
      return `<li class="home-tours-row"><time class="home-tour-time" datetime="${escape(row.tour_date)}T${escape(row.tour_time)}">${escape(timeLabel(row.tour_time))}</time><div class="home-tour-customer"><h3 class="home-tour-name">${escape(row.customer_name)}</h3>${row.customer_info ? `<p class="home-tour-notes">${escape(row.customer_info)}</p>` : ''}</div><div class="home-tour-badges"><span class="home-tour-badge home-tour-badge-${fileClass}">${fileLabels[fileKey]}</span><span class="home-tour-badge home-tour-badge-${bookingClass}">${bookingLabels[bookingKey]}</span></div><div class="home-tour-staff"><span class="home-tour-staff-label">Staff</span><span class="home-tour-initials" aria-label="Staff initials: ${escape(row.staff_initials)}">${escape(row.staff_initials)}</span></div></li>`;
    }).join('');
  }
  function errorMessage(error) {
    if (error?.code === 'AUTH') return 'Sign in to Paws HQ to see today’s tours.';
    if (error?.code === 'ACCESS' || error?.code === '42501') return 'Tours are unavailable for this account. Ask your Paws HQ administrator for access.';
    return 'Could not load today’s tours. Check your connection and try Refresh.';
  }
  async function refresh({silent = false} = {}) {
    if (state.loading) return;
    updateDate();
    const requestedDate = today();
    if (state.loadedDate && state.loadedDate !== requestedDate) unavailable('Loading today’s tours…');
    const epoch = state.authEpoch;
    const requestId = ++state.requestId;
    const current = () => epoch === state.authEpoch && requestId === state.requestId;
    state.loading = true;
    $('homeToursRefresh').disabled = true;
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
      render();
      setStatus(`All of today’s tours · Updated ${new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(new Date())}`);
    } catch(error) {
      if (!current()) return;
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
        $('homeToursRefresh').disabled = false;
        widget.setAttribute('aria-busy','false');
        if (dateChanged) setTimeout(() => refresh(),0);
      }
    }
  }
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
        $('homeToursRefresh').disabled = false;
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
