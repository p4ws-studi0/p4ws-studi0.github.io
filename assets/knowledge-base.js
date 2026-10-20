/* Private knowledgebase. Reuses the existing Supabase session without changing it. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PawsKnowledgeBase = api; api.install(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TABLE = 'hq_knowledge_pages';
  const BUCKET = 'hq-knowledge-media';
  const IMAGE_PATH = /^(?:images\/)?[a-f0-9]{64}\.(?:png|jpe?g|gif|webp|avif|ico)$/;
  const TAGS = new Set('h1 h2 h3 h4 h5 h6 p span strong em b i u s strike a li ul ol br hr table tbody thead tfoot tr td th col colgroup section div font blockquote label samp big small code pre sup sub dl dt dd img details summary'.split(' '));
  const DROP = new Set('script style template iframe object embed svg math noscript base link meta'.split(' '));
  const ATTRS = new Set('class id title lang dir width height rowspan colspan start type align valign scope face color size alt'.split(' '));
  const STYLE_PROPERTIES = new Set('font-size font-family font-style font-weight line-height letter-spacing text-align text-decoration text-indent color background-color vertical-align list-style-position list-style-image list-style-type margin margin-left margin-right margin-top margin-bottom padding padding-left padding-right padding-top padding-bottom border border-style border-width border-color border-radius outline box-sizing width min-width max-width height min-height max-height display opacity float clear left top cursor white-space word-break overflow-wrap'.split(' '));
  let runtime = null;

  class KnowledgeError extends Error {
    constructor(code, message, confirmed = false) { super(message); this.name = 'KnowledgeError'; this.code = code; this.confirmed = confirmed; }
  }

  function cleanPath(value) {
    let path;
    try { path = decodeURIComponent(new URL(value, 'https://hq.pawspet.com').pathname); }
    catch { throw new KnowledgeError('INVALID_PATH', 'This knowledgebase address is invalid.'); }
    if (!path.startsWith('/') || /[\\\x00-\x1f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw new KnowledgeError('INVALID_PATH', 'This knowledgebase address is invalid.');
    if (path.endsWith('/index.html')) path = path.slice(0, -10);
    else if (path.endsWith('.html')) path = path.slice(0, -5);
    if (!path.startsWith('/kb/') && !path.startsWith('/kb copy/') && !path.startsWith('/not_in_use 10.39.45 PM/')) throw new KnowledgeError('INVALID_PATH', 'This is not a knowledgebase address.');
    return path;
  }

  function safeStyle(value) {
    if (/url\s*\(|(?:-webkit-)?image-set\s*\(|expression\s*\(|@import|javascript|behavior|binding|[\\<>]/i.test(value)) return '';
    return value.split(';').map(declaration => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return '';
      const name = declaration.slice(0, colon).trim().toLowerCase(), setting = declaration.slice(colon + 1).trim();
      return STYLE_PROPERTIES.has(name) && setting && !/[{}]/.test(setting) ? name + ': ' + setting : '';
    }).filter(Boolean).join('; ');
  }

  function safeLink(value, currentHref) {
    if (/[\x00-\x1f]/.test(value)) return null;
    try {
      const current = new URL(currentHref), url = new URL(value, current);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) return null;
      if (url.protocol === 'mailto:' || url.protocol === 'tel:') return url.href;
      if (url.origin === current.origin) {
        if (url.pathname.endsWith('/index.html')) url.pathname = url.pathname.slice(0, -10);
        else if (url.pathname.endsWith('.html')) url.pathname = url.pathname.slice(0, -5);
        return url.pathname + url.search + url.hash;
      }
      return url.href;
    } catch { return null; }
  }

  function searchRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => row && typeof row.path === 'string' && row.path.startsWith('/kb/') && !row.is_archive && typeof row.search_text === 'string').map(row => ({path: row.path, search_text: row.search_text, title: String(row.title || ''), category: String(row.category || ''), page_kind: row.page_kind === 'index' ? 'index' : 'article'}));
  }

  function createService(client) {
    if (!client?.auth || typeof client.from !== 'function') throw new KnowledgeError('UNAVAILABLE', 'Knowledgebase could not connect. Please try again.');
    async function approved() {
      let sessionResult;
      try { sessionResult = await client.auth.getSession(); }
      catch { throw new KnowledgeError('UNAVAILABLE', 'Your connection could not be checked. Please try again.'); }
      if (sessionResult.error) throw new KnowledgeError('UNAVAILABLE', 'Your connection could not be checked. Please try again.');
      const session = sessionResult.data?.session;
      if (!session?.user?.id) throw new KnowledgeError('SIGN_IN_REQUIRED', 'Sign in to Paws HQ to view the knowledgebase.', true);
      if (typeof ensureHqWorkspaceAccess === 'function') {
        try { await ensureHqWorkspaceAccess(session); }
        catch (error) { throw new KnowledgeError(error?.code === 'ACCESS' ? 'ACCESS_DENIED' : 'UNAVAILABLE', error?.code === 'ACCESS' ? 'Knowledgebase access is not available for this account.' : 'Your workspace access could not be checked. Please try again.', error?.code === 'ACCESS'); }
      }
      let approval;
      try { approval = await client.from('hq_tour_staff').select('user_id,active').eq('user_id', session.user.id).maybeSingle(); }
      catch { throw new KnowledgeError('UNAVAILABLE', 'Your access could not be checked. Please try again.'); }
      if (approval.error) throw new KnowledgeError('UNAVAILABLE', 'Your access could not be checked. Please try again.');
      if (!approval.data || approval.data.user_id !== session.user.id || approval.data.active !== true) throw new KnowledgeError('ACCESS_DENIED', 'Knowledgebase access is not available for this account.', true);
      return session;
    }
    async function readPage(path) {
      const route = cleanPath(path);
      await approved();
      let result;
      try { result = await client.from(TABLE).select('path,title,html_content').eq('path', route).maybeSingle(); }
      catch { throw new KnowledgeError('UNAVAILABLE', 'The knowledgebase could not load. Please try again.'); }
      if (result.error) throw new KnowledgeError('UNAVAILABLE', 'The knowledgebase could not load. Please try again.');
      if (!result.data) {
        // A deactivation can land between the approval check and the page read.
        await approved();
        throw new KnowledgeError('NOT_FOUND', 'This knowledgebase page could not be found.');
      }
      if (result.data.path !== route || typeof result.data.html_content !== 'string') throw new KnowledgeError('UNAVAILABLE', 'The knowledgebase response was incomplete. Please try again.');
      return result.data;
    }
    async function readSearchIndex() {
      await approved();
      let result;
      try { result = await client.from(TABLE).select('path,title,category,page_kind,search_text,is_archive').eq('is_archive', false).order('path'); }
      catch { throw new KnowledgeError('UNAVAILABLE', 'Knowledgebase search could not load. Please try again.'); }
      if (result.error || !Array.isArray(result.data)) throw new KnowledgeError('UNAVAILABLE', 'Knowledgebase search could not load. Please try again.');
      if (!result.data.length) await approved();
      return searchRows(result.data);
    }
    async function readImage(path) {
      if (!IMAGE_PATH.test(path)) throw new KnowledgeError('INVALID_IMAGE', 'This knowledgebase image is invalid.');
      let result;
      try { result = await client.storage.from(BUCKET).download(path); }
      catch { throw new KnowledgeError('UNAVAILABLE', 'A knowledgebase image could not load. Please try again.'); }
      if (result.error || !result.data) {
        await approved();
        throw new KnowledgeError('UNAVAILABLE', 'A knowledgebase image could not load. Please try again.');
      }
      return result.data;
    }
    return {approved, readPage, readSearchIndex, readImage};
  }

  function sanitizeFragment(document, content, href) {
    const template = document.createElement('template');
    template.innerHTML = content;
    for (const element of Array.from(template.content.querySelectorAll('*'))) {
      const tag = element.localName;
      if (DROP.has(tag)) { element.remove(); continue; }
      if (!TAGS.has(tag)) { element.replaceWith(...element.childNodes); continue; }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name, value = attribute.value;
        if (ATTRS.has(name)) continue;
        if (name === 'style') { const safe = safeStyle(value); if (safe) element.setAttribute('style', safe); else element.removeAttribute(name); continue; }
        if (tag === 'a' && name === 'href') { const safe = safeLink(value, href); if (safe) element.setAttribute(name, safe); else element.removeAttribute(name); continue; }
        if (tag === 'a' && name === 'target' && value === '_blank') continue;
        if (tag === 'img' && name === 'data-knowledge-image' && IMAGE_PATH.test(value)) continue;
        if (tag === 'img' && name === 'src') {
          try { const source = new URL(value); if (source.protocol === 'https:' && !source.username && !source.password) { element.referrerPolicy = 'no-referrer'; continue; } } catch {}
        }
        element.removeAttribute(name);
      }
      if (tag === 'a' && element.target === '_blank') element.rel = 'noopener noreferrer';
      if (tag === 'img' && element.hasAttribute('data-knowledge-image')) element.removeAttribute('src');
    }
    return template.content;
  }

  function existingClient() {
    // This is the same lexical client declared by /script.js. Creating another
    // auth client could race refresh-token rotation, so it is never recreated.
    return typeof supabaseClient !== 'undefined' ? supabaseClient : null;
  }

  async function loadSearchIndex() {
    try { return await createService(existingClient()).readSearchIndex(); }
    catch (error) { if (error.confirmed && runtime) runtime.clear(error); throw error; }
  }

  function install(win) {
    if (!win?.document || runtime) return;
    const document = win.document;
    let generation = 0, host = null, poll = null, destroyed = false;
    const urls = new Set();
    function releaseImages() { for (const url of urls) win.URL.revokeObjectURL(url); urls.clear(); }
    function notice(error, retry = true) {
      if (!host) return;
      const box = document.createElement('div'); box.className = 'paws-knowledge-notice';
      const message = document.createElement('p'); message.setAttribute('role', error ? 'alert' : 'status');
      message.textContent = error?.message || 'Loading knowledgebase…'; box.append(message);
      if (error && retry) { const button = document.createElement('button'); button.type = 'button'; button.className = 'paws-knowledge-retry'; button.textContent = 'Try again'; button.addEventListener('click', render); box.append(button); }
      host.replaceChildren(box); host.removeAttribute('aria-busy');
    }
    function clear(error) {
      generation++; releaseImages(); notice(error, !error?.confirmed);
      if (error?.confirmed) win.dispatchEvent(new win.CustomEvent('paws-knowledge-access-denied', {detail: {code: error.code}}));
    }
    async function render() {
      if (!host || destroyed) return;
      const current = ++generation; releaseImages(); notice(null); host.setAttribute('aria-busy', 'true');
      try {
        const service = createService(existingClient());
        const page = await service.readPage(host.dataset.knowledgePage || win.location.href);
        if (generation !== current || destroyed) return;
        host.replaceChildren(sanitizeFragment(document, page.html_content, win.location.href)); host.removeAttribute('aria-busy');
        const images = Array.from(host.querySelectorAll('img[data-knowledge-image]')), downloads = new Map();
        let next = 0;
        async function worker() {
          while (next < images.length && generation === current && !destroyed) {
            const image = images[next++], path = image.getAttribute('data-knowledge-image');
            try {
              if (!downloads.has(path)) downloads.set(path, service.readImage(path).then(blob => {
                if (generation !== current || destroyed) return null;
                const url = win.URL.createObjectURL(blob); urls.add(url); return url;
              }));
              const url = await downloads.get(path);
              if (url && generation === current && !destroyed) image.src = url;
            } catch (error) {
              if (generation !== current || destroyed) return;
              if (error.confirmed) { clear(error); return; }
              image.classList.add('paws-knowledge-image-error'); image.alt = image.alt || 'Image unavailable. Refresh to try again.';
            }
          }
        }
        await Promise.all(Array.from({length: Math.min(4, images.length)}, worker));
      } catch (error) { if (generation === current && !destroyed) clear(error instanceof KnowledgeError ? error : new KnowledgeError('UNAVAILABLE', 'The knowledgebase could not load. Please try again.')); }
    }
    async function verify() {
      if (destroyed || document.visibilityState === 'hidden') return;
      try { await createService(existingClient()).approved(); }
      catch (error) { if (error.confirmed) clear(error); }
    }
    function start() {
      host = document.querySelector('[data-knowledge-page]');
      if (!host) return;
      render(); poll = win.setInterval(verify, 60000);
      document.addEventListener('visibilitychange', verify);
      win.addEventListener('focus', verify);
      if (existingClient()?.auth.onAuthStateChange) existingClient().auth.onAuthStateChange((event, session) => {
        // Never await another auth call inside this callback's auth lock.
        if (!session && event === 'SIGNED_OUT') clear(new KnowledgeError('SIGN_IN_REQUIRED', 'Sign in to Paws HQ to view the knowledgebase.', true));
      });
    }
    function revoked() { clear(new KnowledgeError('ACCESS_DENIED', 'Knowledgebase access is not available for this account.', true)); }
    win.addEventListener('paws-access-revoked', revoked);
    win.addEventListener('paws:access-revoked', revoked);
    win.addEventListener('paws-access-restored', () => { if (host && !destroyed) render(); });
    win.addEventListener('pagehide', () => { generation++; releaseImages(); if (host) notice(null); });
    win.addEventListener('pageshow', event => { if (event.persisted && host) render(); });
    runtime = {clear, render, verify, destroy() { destroyed = true; generation++; releaseImages(); if (poll) win.clearInterval(poll); }};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
  }

  return {TABLE, BUCKET, KnowledgeError, cleanPath, safeStyle, safeLink, searchRows, createService, sanitizeFragment, loadSearchIndex, install};
});
