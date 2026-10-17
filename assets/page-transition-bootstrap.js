/* Runs in the head before first paint; the transition driver consumes this once. */
(() => {
  'use strict';
  const key = 'paws.page-transition.v1';
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pending = JSON.parse(raw);
    if (!pending || typeof pending.target !== 'string' || !Number.isFinite(pending.startedAt)) return;
    const target = new URL(pending.target), current = new URL(location.href);
    const path = value => value.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    const age = Date.now() - pending.startedAt;
    if (age < 0 || age > 8000 || target.origin !== current.origin || path(target.pathname) !== path(current.pathname) || target.search !== current.search) return;
    document.documentElement.setAttribute('data-paws-transition-pending', '');
    window.__pawsTransitionPending = pending;
    // Fail open even if the deferred driver fails to load or throws.
    window.__pawsTransitionWatchdog = setTimeout(() => {
      document.documentElement.removeAttribute('data-paws-transition-pending');
      window.__pawsTransitionPending = null;
      document.dispatchEvent(new Event('paws-transition-failopen'));
    }, 5000);
  } catch {
    document.documentElement.removeAttribute('data-paws-transition-pending');
  }
})();
