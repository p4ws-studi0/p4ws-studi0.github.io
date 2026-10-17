/* Keep legacy HTML links usable while presenting the same page at its clean URL. */
(function () {
  'use strict';

  function cleanPath(pathname) {
    return pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
  }

  function canonicalize(win, onlyAt) {
    const url = new URL(win.location.href);
    if (onlyAt && url.pathname !== onlyAt) return false;
    const pathname = cleanPath(url.pathname);
    if (pathname === url.pathname) return false;
    // Preserve OAuth/report parameters, section links, and the current history entry.
    win.history.replaceState(win.history.state, '', pathname + url.search + url.hash);
    return true;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = {cleanPath, canonicalize};
  if (typeof window !== 'undefined' && window.document) {
    try { canonicalize(window, document.currentScript?.getAttribute('data-canonical-source')); } catch { /* A blocked History API keeps the original working link. */ }
  }
})();
