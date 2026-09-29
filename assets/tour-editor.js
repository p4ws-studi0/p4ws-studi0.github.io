/* Shared Paws HQ tour dialogs. Load after /script.js, before a Tours view. */
(() => {
  'use strict';
  const TABLE = 'hq_tours';
  const TIME_ZONE = 'America/New_York';
  const $ = id => document.getElementById(id);
  const outsideHours = time => time < '10:30' || time > '15:00';
  const bookingValue = value => ['confirmed','none','unknown'].includes(value) ? value : 'unknown';
  function today() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function timeLabel(time) {
    const [hour,minute] = String(time).split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2,'0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  function dateLabel(date) {
    return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(`${date}T12:00:00Z`));
  }
  function friendlyError(error) {
    if (error?.code === 'CONFLICT') return 'Someone else changed this tour. Your edits are still here. Close this form, refresh the list, and reopen the tour before saving again.';
    if (['42P01','PGRST205','PGRST202'].includes(error?.code)) return 'Tours is not set up yet. Ask your Paws HQ administrator to complete the one-time Tours database setup.';
    if (error?.code === '42501' || error?.code === 'ACCESS') return 'Your account does not have Tours access. Ask your Paws HQ administrator to add you to the tour staff list.';
    if (error?.code === 'AUTH') return 'Your session has expired. Sign in to Paws HQ again before saving.';
    return 'Could not reach the tour schedule. Check your connection and try again. Your changes have not been discarded.';
  }
  window.createTourEditor = function createTourEditor({isReady, isLoading, onChange, onError, onBusyChange, onSaved}) {
    const state = {busy:false, editing:null, deleting:null, undo:null, toastTimer:null, epoch:0};
    const available = () => !state.busy && !isLoading() && isReady();
    const current = epoch => epoch === state.epoch;
    function updateControls() {
      $('tourForm').querySelectorAll('input,textarea,select').forEach(element => {element.disabled=state.busy;});
      $('saveTour').disabled = state.busy || isLoading() || !isReady();
      $('confirmDelete').disabled = state.busy || isLoading() || !isReady();
      $('undoDelete').disabled = state.busy || isLoading() || !isReady();
      $('cancelTour').disabled = state.busy;
      $('cancelDelete').disabled = state.busy;
      $('saveTour').textContent = state.busy ? 'Saving…' : state.editing ? 'Save changes' : 'Schedule tour';
      $('confirmDelete').textContent = state.busy && state.deleting ? 'Deleting…' : 'Delete tour';
    }
    function setBusy(busy) {
      state.busy = busy;
      updateControls();
      onBusyChange();
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
      state.toastTimer = setTimeout(dismissToast,5000);
    }
    function hoursHint() {
      const outside = Boolean($('tourTime').value && outsideHours($('tourTime').value));
      $('outsideHoursField').hidden = !outside;
      $('outsideHoursConfirmed').required = outside;
      if (!outside) $('outsideHoursConfirmed').checked = false;
    }
    function formError(text) {
      $('formError').textContent = text;
      $('formError').hidden = !text;
    }
    async function requireStaff(epoch) {
      if (typeof supabaseClient === 'undefined') throw {code:'AUTH'};
      const {data:auth,error:authError} = await supabaseClient.auth.getSession();
      if (!current(epoch) || authError || !auth?.session?.user) throw {code:'AUTH'};
      const {data,error} = await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',auth.session.user.id).eq('active',true).maybeSingle();
      if (!current(epoch)) throw {code:'AUTH'};
      if (error) throw error;
      if (!data) throw {code:'ACCESS'};
    }
    async function updateRow(row,patch) {
      const {data,error} = await supabaseClient.from(TABLE).update(patch).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();
      if (error) throw error;
      if (!data) throw {code:'CONFLICT'};
      return data;
    }
    function open(row = null) {
      if (!available() || isOpen()) return;
      state.editing = row ? {...row} : null;
      state.deleting = null;
      $('tourForm').reset();
      $('tourId').value = row?.id || crypto.randomUUID();
      $('customerName').value = row?.customer_name || '';
      $('customerInfo').value = row?.customer_info || '';
      $('tourDate').value = row?.tour_date || today();
      $('tourTime').value = row?.tour_time.slice(0,5) || '10:30';
      $('hasFile').value = ['yes','no','unknown'].includes(row?.has_file) ? row.has_file : 'unknown';
      $('bookingStatus').value = bookingValue(row?.booking_status);
      $('staffInitials').value = row?.staff_initials || '';
      $('outsideHoursConfirmed').checked = row?.outside_hours_confirmed || false;
      formError('');
      $('tourDialogTitle').textContent = row ? 'Edit tour' : 'Schedule a tour';
      hoursHint();
      updateControls();
      $('tourDialog').showModal();
      $('customerName').focus();
    }
    function formData() {
      const payload = {
        customer_name:$('customerName').value.trim(),customer_info:$('customerInfo').value.trim(),
        tour_date:$('tourDate').value,tour_time:$('tourTime').value,
        has_file:$('hasFile').value,booking_status:bookingValue($('bookingStatus').value),
        staff_initials:$('staffInitials').value.trim().toUpperCase(),
        outside_hours_confirmed:outsideHours($('tourTime').value) && $('outsideHoursConfirmed').checked
      };
      if (!payload.customer_name || !payload.staff_initials) throw new Error('Enter a customer name and your staff initials.');
      if (outsideHours(payload.tour_time) && !payload.outside_hours_confirmed) throw new Error('Confirm that you will personally lead this tour outside regular hours.');
      return payload;
    }
    async function save(event) {
      event.preventDefault();
      if (!available()) return;
      const epoch = state.epoch;
      const editing = state.editing;
      const id = $('tourId').value;
      let payload;
      try {payload=formData();} catch(error) {formError(error.message);return;}
      formError('');
      setBusy(true);
      try {
        await requireStaff(epoch);
        if (!current(epoch)) return;
        let saved;
        if (editing) saved = await updateRow(editing,payload);
        else {
          const {data,error} = await supabaseClient.from(TABLE).insert({id,...payload}).select('*').single();
          if (!current(epoch)) return;
          if (error?.code === '23505') {
            // Retry with the same UUID after a lost response; preserve any newer draft edits.
            const recovered = await supabaseClient.from(TABLE).select('*').eq('id',id).single();
            if (!current(epoch)) return;
            if (recovered.error) throw recovered.error;
            saved = recovered.data;
            if (!saved) throw {code:'CONFLICT'};
            state.editing = {...saved};
            onChange(saved);
            $('tourDialogTitle').textContent = 'Edit tour';
            formError('Your earlier save succeeded. Your current edits are still here; review them and choose Save changes.');
            return;
          }
          if (error) throw error;
          saved = data;
        }
        if (!current(epoch)) return;
        onChange(saved);
        $('tourDialog').close();
        toast(editing ? 'Tour updated.' : 'Tour scheduled.');
        onSaved(saved);
      } catch(error) {
        if (current(epoch)) formError(friendlyError(error));
      } finally {
        if (current(epoch)) setBusy(false);
      }
    }
    function confirmDelete(row) {
      if (!row || !available() || isOpen()) return;
      state.deleting = {...row};
      $('deleteDescription').textContent = `Delete the tour for ${row.customer_name} on ${dateLabel(row.tour_date)} at ${timeLabel(row.tour_time)}? You can restore it from Deleted tours.`;
      updateControls();
      $('deleteDialog').showModal();
      $('cancelDelete').focus();
    }
    async function remove() {
      if (!state.deleting || !available()) return;
      const epoch = state.epoch;
      const deleting = state.deleting;
      setBusy(true);
      try {
        await requireStaff(epoch);
        if (!current(epoch)) return;
        const deleted = await updateRow(deleting,{deleted_at:new Date().toISOString()});
        if (!current(epoch)) return;
        onChange(deleted);
        $('deleteDialog').close();
        state.deleting = null;
        toast(`Tour for ${deleted.customer_name} deleted.`,deleted);
      } catch(error) {
        if (current(epoch)) $('deleteDescription').textContent = friendlyError(error);
      } finally {
        if (current(epoch)) setBusy(false);
      }
    }
    async function restore(row) {
      if (!row || !available()) return;
      const epoch = state.epoch;
      setBusy(true);
      try {
        await requireStaff(epoch);
        if (!current(epoch)) return;
        const restored = await updateRow(row,{deleted_at:null});
        if (!current(epoch)) return;
        onChange(restored);
        toast(`Tour for ${restored.customer_name} restored.`);
      } catch(error) {
        if (current(epoch)) onError(friendlyError(error));
      } finally {
        if (current(epoch)) setBusy(false);
      }
    }
    function isOpen() {return $('tourDialog').open || $('deleteDialog').open;}
    function reset() {
      state.epoch++;
      state.editing = null;
      state.deleting = null;
      dismissToast();
      $('toastText').textContent = '';
      $('tourDialog').close();
      $('deleteDialog').close();
      $('tourForm').reset();
      formError('');
      $('deleteDescription').textContent = 'This tour will move to Deleted. You can restore it if you change your mind.';
      $('tourDialogTitle').textContent = 'Schedule a tour';
      hoursHint();
      setBusy(false);
    }
    $('tourForm').addEventListener('submit',save);
    $('cancelTour').addEventListener('click',() => {if (!state.busy) $('tourDialog').close();});
    $('tourTime').addEventListener('input',hoursHint);
    $('cancelDelete').addEventListener('click',() => {if (!state.busy) $('deleteDialog').close();});
    $('confirmDelete').addEventListener('click',remove);
    $('undoDelete').addEventListener('click',() => {if (state.undo) restore(state.undo);});
    [$('tourDialog'),$('deleteDialog')].forEach(dialog => dialog.addEventListener('cancel',event => {if (state.busy) event.preventDefault();}));
    window.addEventListener('beforeunload',event => {if ($('tourDialog').open || state.busy) {event.preventDefault();event.returnValue='';}});
    return {open,confirmDelete,restore,isBusy:() => state.busy,isOpen,reset};
  };
})();
