/* Static-page adaptation of the supplied PageTransition.tsx timeline. */
(function () {
  'use strict';
  const KEY = 'paws.page-transition.v1';
  const MAX_AGE = 8000;
  const clamp = value => Math.max(0, Math.min(1, value));
  // GSAP power1.out: exactly quadratic ease-out, independently per tween.
  const ease = value => 1 - (1 - clamp(value)) ** 2;
  const path = value => value.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';

  function coverFrame(ms) {
    const x = -110 + 60 * ease(ms / 300);
    const rotate = 28 * (1 - ease((ms - 100) / 200));
    let logo = 0;
    if (ms >= 100 && ms < 200) logo = .8 * ease((ms - 100) / 100);
    else if (ms >= 200 && ms < 300) logo = .8 - .6 * ease((ms - 200) / 100);
    else if (ms >= 300 && ms < 400) logo = .2 + .8 * ease((ms - 300) / 100);
    return {x, rotate, logo};
  }

  function revealFrame(ms) {
    return {
      x: 5 + 55 * ease(ms / 400),
      rotate: 6 * (1 - ease((ms - 200) / 300)),
      logo: 0,
      done: ms >= 500,
    };
  }

  function validHandoff(data, currentHref, now, reducedMotion = false) {
    if (reducedMotion || !data || typeof data.target !== 'string' || !Number.isFinite(data.startedAt)) return false;
    const age = now - data.startedAt;
    if (age < 0 || age > MAX_AGE) return false;
    try {
      const target = new URL(data.target), current = new URL(currentHref);
      return ['http:', 'https:'].includes(target.protocol) && target.origin === current.origin && path(target.pathname) === path(current.pathname) && target.search === current.search;
    } catch { return false; }
  }

  function eligibleHref(anchor, event, currentHref) {
    if (!anchor || event.defaultPrevented || (event.button != null && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    if (anchor.hasAttribute('download') || anchor.closest('[data-no-page-transition]')) return null;
    const target = (anchor.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return null;
    if ((anchor.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('external')) return null;
    const href = anchor.getAttribute('href');
    if (!href || href.includes('#')) return null;
    try {
      const url = new URL(href, currentHref), current = new URL(currentHref);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== current.origin) return null;
      // Anchor jumps and Run Cards shortcuts retain their native behavior.
      if (url.hash || path(url.pathname) === path(current.pathname)) return null;
      if (/^\/(?:login(?:\.html)?|auth|oauth|api)(?:\/|$)/i.test(url.pathname)) return null;
      if (/\.[a-z0-9]+$/i.test(url.pathname) && !/\.html$/i.test(url.pathname)) return null;
      return url.href;
    } catch { return null; }
  }

  function install(win) {
    const doc = win.document;
    if (doc.getElementById('pawsPageTransition')) return null;
    const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
    const overlay = doc.createElement('div');
    overlay.id = 'pawsPageTransition';
    overlay.className = 'paws-page-transition';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
    overlay.dataset.phase = 'idle';
    const slab = doc.createElement('div');
    slab.className = 'paws-page-transition-slab';
    const logo = doc.createElement('div');
    logo.className = 'paws-page-transition-logo';
    const image = doc.createElement('img');
    image.src = '/assets/page-transition-crown.png?v=20261017d';
    image.alt = '';
    image.width = 320;
    image.height = 203;
    logo.append(image);
    overlay.append(slab, logo);
    // Outside body so the site's auth-gate opacity cannot hide the cover.
    doc.documentElement.append(overlay);
    let raf = 0, failTimer = 0, outgoing = null;

    function removeHandoff() {
      try { win.sessionStorage.removeItem(KEY); } catch {}
    }
    function clearWork() {
      if (raf) win.cancelAnimationFrame(raf);
      if (failTimer) win.clearTimeout(failTimer);
      raf = 0; failTimer = 0;
    }
    function draw(frame) {
      overlay.style.setProperty('--wipe-x', `${frame.x}%`);
      overlay.style.setProperty('--rotate', `${frame.rotate}deg`);
      logo.style.opacity = String(frame.logo);
    }
    function reset() {
      clearWork(); removeHandoff(); outgoing = null;
      win.clearTimeout(win.__pawsTransitionWatchdog);
      win.__pawsTransitionPending = null;
      doc.documentElement.removeAttribute('data-paws-transition-pending');
      draw({x: -110, rotate: 28, logo: 0});
      overlay.dataset.phase = 'idle'; overlay.hidden = true;
    }
    function nativeNavigate(target) {
      try { win.location.assign(target); }
      catch { reset(); }
    }
    function depart(target) {
      clearWork();
      const pending = {target, startedAt: Date.now()};
      try { win.sessionStorage.setItem(KEY, JSON.stringify(pending)); }
      catch { reset(); nativeNavigate(target); return; }
      outgoing = pending;
      overlay.hidden = false; overlay.dataset.phase = 'cover';
      draw(coverFrame(0));
      const start = win.performance.now();
      function tick(now) {
        const elapsed = now - start;
        draw(coverFrame(elapsed));
        if (elapsed >= 550) {
          overlay.dataset.phase = 'holding';
          // Covers a canceled beforeunload prompt, failed navigation, or a slow response.
          failTimer = win.setTimeout(reset, 4000);
          nativeNavigate(target);
          return;
        }
        raf = win.requestAnimationFrame(tick);
      }
      raf = win.requestAnimationFrame(tick);
    }
    function arrive(pending) {
      clearWork(); outgoing = null;
      overlay.hidden = false; overlay.dataset.phase = 'holding';
      draw({x: -50, rotate: 0, logo: 0});
      const visibilityDeadline = win.performance.now() + 4500;
      function whenReady() {
        // Preserve auth gating and allow the new document's normal initialization.
        const visible = doc.body && Number(win.getComputedStyle(doc.body).opacity) > .99;
        if (doc.readyState === 'loading' || !visible) {
          if (win.performance.now() >= visibilityDeadline) { reset(); return; }
          raf = win.requestAnimationFrame(whenReady); return;
        }
        win.clearTimeout(win.__pawsTransitionWatchdog);
        // A slow document stays covered, then gets the full reveal animation.
        const revealAt = win.performance.now() + Math.max(0, pending.startedAt + 850 - Date.now());
        let began = false;
        function tick(now) {
          if (now < revealAt) { raf = win.requestAnimationFrame(tick); return; }
          if (!began) {
            began = true; overlay.dataset.phase = 'reveal';
            doc.documentElement.removeAttribute('data-paws-transition-pending');
            win.scrollTo({top: 0, left: 0, behavior: 'instant'});
          }
          const frame = revealFrame(now - revealAt); draw(frame);
          if (frame.done) {
            reset();
            doc.dispatchEvent(new win.Event('paws-page-transition-end'));
          } else raf = win.requestAnimationFrame(tick);
        }
        raf = win.requestAnimationFrame(tick);
      }
      raf = win.requestAnimationFrame(whenReady);
    }
    function onClick(event) {
      if (motion.matches) return;
      const target = eligibleHref(event.target?.closest?.('a[href]'), event, win.location.href);
      if (!target) return;
      event.preventDefault(); depart(target);
    }
    function onPageShow(event) { if (event.persisted) reset(); }
    function onPageHide() { clearWork(); }
    function onMotionChange() {
      if (!motion.matches) return;
      const target = outgoing?.target;
      reset(); if (target) nativeNavigate(target);
    }
    function onEscape(event) {
      if (event.key === 'Escape' && outgoing) reset();
    }
    doc.addEventListener('click', onClick);
    doc.addEventListener('keydown', onEscape);
    doc.addEventListener('paws-transition-failopen', reset);
    win.addEventListener('pageshow', onPageShow);
    win.addEventListener('pagehide', onPageHide);
    motion.addEventListener('change', onMotionChange);
    const pending = win.__pawsTransitionPending;
    if (validHandoff(pending, win.location.href, Date.now(), motion.matches)) arrive(pending);
    else reset();
    return {
      cancel: reset,
      destroy() {
        reset(); overlay.remove();
        doc.removeEventListener('click', onClick); doc.removeEventListener('keydown', onEscape);
        doc.removeEventListener('paws-transition-failopen', reset);
        win.removeEventListener('pageshow', onPageShow); win.removeEventListener('pagehide', onPageHide);
        motion.removeEventListener('change', onMotionChange);
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = {coverFrame, revealFrame, eligibleHref, validHandoff, install};
  if (typeof window !== 'undefined' && window.document) install(window);
})();
