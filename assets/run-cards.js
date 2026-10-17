/* Preserve the existing Apps Script PDF workflow behind the shared navigation. */
(() => {
  'use strict';
  const endpoint = 'https://script.google.com/macros/s/AKfycbweMX75_fwIwBlYhBqC1tK43xSksK8abrI5tRo3vVQgrlsC0jbvEBY4CwqayxIs4_FAAg/exec';
  let busy = false;
  window.pawsGenerateRunCards = function(startMode) {
    if (busy || !['today','tomorrow'].includes(startMode)) return;
    const button = document.getElementById('runCardsButton');
    const label = button?.querySelector('.desktop-quick-label');
    const reportWindow = window.open('/report-loading.html', '_blank');
    if (!reportWindow) { alert('Please allow pop-ups for Paws HQ.'); return; }
    busy = true;
    if (button) { button.disabled = true; button.setAttribute('aria-busy','true'); }
    if (label) label.textContent = 'Preparing…';
    const callbackName = 'runCardsCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const requestScript = document.createElement('script');
    let finished = false;
    const cleanup = () => {
      finished = true; clearTimeout(timeout); delete window[callbackName]; requestScript.remove(); busy = false;
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
      if (label) label.textContent = 'Run Cards';
    };
    const fail = () => { if(finished)return; cleanup(); reportWindow.close(); alert('Unable to generate Run Cards. Please try again.'); };
    const timeout = setTimeout(fail, 120000);
    window[callbackName] = function(pdfUrl) {
      if(finished)return;
      try {
        const url = new URL(pdfUrl);
        if(url.protocol !== 'https:') { fail(); return; }
        reportWindow.location.replace(url.href); cleanup();
      } catch { fail(); }
    };
    requestScript.onerror = fail;
    const url = new URL(endpoint);
    url.searchParams.set('start',startMode); url.searchParams.set('callback',callbackName); url.searchParams.set('t',String(Date.now()));
    requestScript.src = url.href;
    document.head.appendChild(requestScript);
  };
})();
