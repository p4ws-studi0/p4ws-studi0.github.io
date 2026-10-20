/* Shared staff-access checks. Never changes the existing Supabase session. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PawsHqAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const POLL_MS = 60000;
  const ENROLLMENT_RETRY_MS = 30000;
  const membershipManagers = new WeakMap();

  function createMembershipManager(options) {
    const client = options?.client;
    if (!client?.auth || typeof client.from !== 'function') throw new TypeError('A Supabase client is required.');
    if (membershipManagers.has(client)) return membershipManagers.get(client);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const flights = new Map(), negative = new Map();
    const result = (userId, status, reason, approval = 'unknown', extra = {}) => ({userId, status, reason, approval, confirmed: ['allowed', 'revoked', 'unapproved', 'session-missing'].includes(status), allowed: status === 'allowed', ...extra});
    async function readApproval(userId) {
      let response;
      try { response = await client.from('hq_tour_staff').select('user_id,active').eq('user_id', userId).maybeSingle(); }
      catch (_) { return {error: 'staff-unavailable', approval: 'unknown'}; }
      if (!response || response.error) return {error: 'staff-unavailable', approval: 'unknown'};
      if (!response.data) return {approval: 'missing'};
      if (response.data.user_id !== userId) return {error: 'staff-identity-mismatch', approval: 'unknown'};
      if (response.data.active === true) return {approval: 'active'};
      if (response.data.active === false) return {approval: 'inactive'};
      return {error: 'staff-response-incomplete', approval: 'unknown'};
    }
    async function verify(userId, approval) {
      const cached = negative.get(userId);
      if (cached && cached.retryAt > now()) return {...cached};
      let response;
      try {
        if (typeof client.functions?.invoke !== 'function') throw new Error('Workspace verification is unavailable.');
        // The server derives identity from this client's existing JWT; no user ID,
        // Slack ID, email, role, or guest flag is accepted from the browser.
        response = await client.functions.invoke('hq-workspace-access', {body: {}});
      } catch (_) { response = null; }
      let data = response?.data;
      if (response?.error && !data) {
        try { data = await response.error.context?.clone()?.json(); } catch (_) { /* A transport error has no response body. */ }
      }
      let checked;
      const code = data?.error?.code;
      if (data?.success === true && data.active === true && data.user_id === userId && !response?.error) {
        const fresh = await readApproval(userId);
        checked = fresh.approval === 'active'
          ? result(userId, 'allowed', 'active-workspace-member', 'active', {enrolled: true})
          : result(userId, 'unavailable', fresh.error || 'enrollment-not-visible', fresh.approval);
      } else if (data?.success === false && code === 'SLACK_DEACTIVATED') {
        checked = result(userId, 'revoked', 'slack-account-deactivated', approval);
      } else if (data?.success === false && code === 'WORKSPACE_ACCESS_DENIED') {
        checked = result(userId, 'unapproved', 'workspace-access-denied', approval);
      } else {
        checked = result(userId, 'unavailable', data?.success === true ? 'workspace-identity-mismatch' : 'workspace-unavailable', approval);
      }
      if (checked.allowed) { negative.delete(userId); return checked; }
      checked = {...checked, retryAt: now() + ENROLLMENT_RETRY_MS};
      negative.set(userId, checked);
      return {...checked};
    }
    function ensure(session) {
      const userId = typeof session?.user?.id === 'string' && session.user.id ? session.user.id : null;
      if (!userId) return Promise.resolve(result(null, 'session-missing', 'session-missing'));
      if (flights.has(userId)) return flights.get(userId);
      const pending = (async () => {
        const existing = await readApproval(userId);
        if (existing.error) return result(userId, 'unavailable', existing.error, existing.approval);
        if (existing.approval === 'active') {
          negative.delete(userId);
          return result(userId, 'allowed', 'active-staff', 'active');
        }
        return verify(userId, existing.approval);
      })().finally(() => { if (flights.get(userId) === pending) flights.delete(userId); });
      flights.set(userId, pending);
      return pending;
    }
    const manager = {ensure};
    membershipManagers.set(client, manager);
    return manager;
  }

  function createController(options) {
    const client = options?.client;
    if (!client?.auth || typeof client.from !== 'function') throw new TypeError('A Supabase client is required.');
    const win = options.window || root;
    const doc = options.document || win.document;
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    const membership = options.membershipManager || createMembershipManager({client});
    let state = {status: 'idle', userId: null, confirmed: false, allowed: false, lastConfirmedStatus: null, reason: 'not-checked', checkedAt: null};
    let identityKnown = false, userId = null, identityEpoch = 0, authEpoch = 0, lookupEpoch = 0;
    let lookupFlight = null, staffFlight = null, started = false, disposed = false;
    let interval = null, authTimer = null, latestAuthSession = null, subscription = null;
    let lastConfirmedEvent = null;
    const snapshot = () => ({...state});
    const visible = () => !doc || doc.visibilityState !== 'hidden';

    function publish(next) {
      if (disposed) return snapshot();
      const changed = ['status', 'userId', 'confirmed', 'allowed', 'lastConfirmedStatus', 'reason'].some(key => state[key] !== next[key]);
      state = {...next, checkedAt: Date.now()};
      if (changed) {
        // A view callback must not turn a successful permission check into an error.
        try { onChange(snapshot()); } catch (_) { /* The caller owns its rendering. */ }
      }
      if (state.confirmed) {
        const key = state.userId + ':' + state.status;
        if (key !== lastConfirmedEvent) {
          lastConfirmedEvent = key;
          if (doc?.dispatchEvent && typeof win.CustomEvent === 'function') {
            doc.dispatchEvent(new win.CustomEvent('paws-access-change', {detail: snapshot()}));
          }
        }
      }
      return snapshot();
    }

    function identify(nextUserId) {
      if (!identityKnown || userId !== nextUserId) {
        const changedUser = identityKnown && userId !== nextUserId;
        identityKnown = true;
        userId = nextUserId;
        identityEpoch++;
        staffFlight = null;
        lastConfirmedEvent = null;
        state = {status: 'idle', userId, confirmed: false, allowed: false, lastConfirmedStatus: null, reason: changedUser ? 'identity-changed' : 'checking-access', checkedAt: null};
        // Clear the old identity's private view before awaiting the new identity's check.
        try { onChange(snapshot()); } catch (_) { /* The caller owns its rendering. */ }
      }
    }

    function unavailable(reason) {
      return publish({...state, status: 'unavailable', confirmed: false, reason});
    }

    function checkSession(session) {
      if (disposed) return Promise.resolve(snapshot());
      const nextUserId = typeof session?.user?.id === 'string' && session.user.id ? session.user.id : null;
      identify(nextUserId);
      if (!userId) {
        return Promise.resolve(publish({status: 'session-missing', userId: null, confirmed: true, allowed: false, lastConfirmedStatus: 'session-missing', reason: 'session-missing'}));
      }
      const epoch = identityEpoch, auth = authEpoch, checkedUserId = userId;
      if (staffFlight?.identityEpoch === epoch && staffFlight.authEpoch === auth) return staffFlight.promise;
      const flight = {identityEpoch: epoch, authEpoch: auth, promise: null};
      const current = () => !disposed && identityEpoch === epoch && authEpoch === auth && userId === checkedUserId;
      flight.promise = (async () => {
        let checked;
        try { checked = await membership.ensure(session); }
        catch (_) { return current() ? unavailable('workspace-unavailable') : snapshot(); }
        if (!current()) return snapshot();
        if (!checked || checked.userId !== checkedUserId) return unavailable('staff-identity-mismatch');
        if (checked.status === 'unavailable') {
          const retainsAllowed = checked.approval === 'unknown' && state.allowed;
          return publish({...state, status: 'unavailable', confirmed: false, allowed: Boolean(retainsAllowed), approval:checked.approval, reason: checked.reason, retryAt: checked.retryAt});
        }
        const status = checked.status;
        if (!['allowed', 'revoked', 'unapproved'].includes(status)) return unavailable('staff-response-incomplete');
        return publish({status, userId: checkedUserId, confirmed: true, allowed: status === 'allowed', lastConfirmedStatus: status, reason: checked.reason, enrolled: checked.enrolled === true});
      })().finally(() => { if (staffFlight === flight) staffFlight = null; });
      staffFlight = flight;
      return flight.promise;
    }

    function check(session) {
      if (disposed) return Promise.resolve(snapshot());
      if (session !== undefined) {
        // Supplied auth events supersede any pending getSession result.
        lookupEpoch++;
        lookupFlight = null;
        return checkSession(session);
      }
      if (lookupFlight) return lookupFlight;
      const lookup = lookupEpoch, auth = authEpoch;
      const promise = (async () => {
        let result;
        try { result = await client.auth.getSession(); }
        catch (_) {
          return !disposed && lookup === lookupEpoch && auth === authEpoch ? unavailable('session-unavailable') : snapshot();
        }
        if (disposed || lookup !== lookupEpoch || auth !== authEpoch) return snapshot();
        if (!result || result.error) return unavailable('session-unavailable');
        return checkSession(result.data?.session || null);
      })().finally(() => { if (lookupFlight === promise) lookupFlight = null; });
      lookupFlight = promise;
      return promise;
    }

    function refreshIfVisible() { if (!disposed && visible()) void check(); }
    function start() {
      if (disposed || started) return controller;
      started = true;
      doc?.addEventListener?.('visibilitychange', refreshIfVisible);
      win.addEventListener?.('focus', refreshIfVisible);
      win.addEventListener?.('online', refreshIfVisible);
      interval = win.setInterval(refreshIfVisible, POLL_MS);
      if (typeof client.auth.onAuthStateChange === 'function') {
        const result = client.auth.onAuthStateChange((_event, session) => {
          if (disposed) return;
          // Supabase forbids awaiting its own client inside this callback's lock.
          authEpoch++;
          lookupEpoch++;
          lookupFlight = null;
          latestAuthSession = session;
          if (authTimer !== null) win.clearTimeout(authTimer);
          authTimer = win.setTimeout(() => {
            authTimer = null;
            if (!disposed) void check(latestAuthSession);
          }, 0);
        });
        subscription = result?.data?.subscription || result?.subscription || null;
      }
      refreshIfVisible();
      return controller;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      identityEpoch++;
      lookupEpoch++;
      if (interval !== null) win.clearInterval(interval);
      if (authTimer !== null) win.clearTimeout(authTimer);
      doc?.removeEventListener?.('visibilitychange', refreshIfVisible);
      win.removeEventListener?.('focus', refreshIfVisible);
      win.removeEventListener?.('online', refreshIfVisible);
      subscription?.unsubscribe?.();
    }
    const controller = {check, start, dispose, getState: snapshot};
    return controller;
  }

  function createNotice(options) {
    const controller = options?.controller;
    const doc = options?.document || root.document;
    if (!controller?.check || !doc?.createElement) throw new TypeError('An access controller and document are required.');
    const dialog = doc.createElement('dialog');
    dialog.className = 'hq-access-notice';
    dialog.setAttribute('aria-labelledby', 'hqAccessNoticeTitle');
    dialog.setAttribute('aria-describedby', 'hqAccessNoticeMessage');
    const title = doc.createElement('h2');
    title.id = 'hqAccessNoticeTitle';
    const message = doc.createElement('p');
    message.id = 'hqAccessNoticeMessage';
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Check access';
    dialog.append(title, message, retry);
    doc.body.append(dialog);
    let disposed = false, checking = false;
    function render(next) {
      if (disposed) return;
      const state = next || controller.getState();
      if (state.status === 'allowed' || state.allowed) {
        if (dialog.open) dialog.close();
        return;
      }
      if (!['revoked', 'unapproved', 'session-missing', 'unavailable'].includes(state.status)) return;
      const confirmed = state.status === 'unavailable' ? state.lastConfirmedStatus : state.status;
      title.textContent = confirmed === 'revoked' ? 'Paws HQ access paused' : confirmed === 'unapproved' ? 'Paws HQ access needed' : confirmed === 'session-missing' ? 'Sign-in unavailable' : 'Connection unavailable';
      message.textContent = confirmed === 'revoked' ? 'This account no longer has access to Paws HQ. Your work on this page has been kept. If access is restored, choose Check access.' : confirmed === 'unapproved' ? 'Paws HQ could not verify this account as an active member of the Paws Slack workspace. Your work on this page has been kept. Choose Check access to try again.' : confirmed === 'session-missing' ? 'Your sign-in could not be found. Your work on this page has been kept. Choose Check access to try again.' : 'Paws HQ could not check your access. Your work on this page has been kept. Check your connection and try again.';
      if (state.status === 'unavailable' && confirmed) message.textContent += ' The latest access check could not connect.';
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
    }
    async function retryAccess() {
      if (disposed || checking) return;
      checking = true;
      retry.disabled = true;
      retry.textContent = 'Checking…';
      try { render(await controller.check()); }
      finally { checking = false; retry.disabled = false; retry.textContent = 'Check access'; }
    }
    function cancel(event) { event.preventDefault(); }
    retry.addEventListener('click', retryAccess);
    dialog.addEventListener('cancel', cancel);
    return {render, element: dialog, dispose() {
      if (disposed) return;
      disposed = true;
      retry.removeEventListener('click', retryAccess);
      dialog.removeEventListener('cancel', cancel);
      if (dialog.open) dialog.close();
      dialog.remove();
    }};
  }

  return {createMembershipManager, createController, createNotice, POLL_MS, ENROLLMENT_RETRY_MS};
});
