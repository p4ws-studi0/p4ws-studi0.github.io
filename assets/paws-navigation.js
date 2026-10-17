(() => {
  'use strict';

  if (location.pathname === '/login.html') return;
  let root = document.getElementById('pawsDesktopRoot');
  if (!root) { root = document.createElement('div'); root.id = 'pawsDesktopRoot'; document.body.append(root); }
  if (root.dataset.ready) return;
  root.dataset.ready = 'true';
  document.body.classList.add('paws-desktop-navigation');
  const svg = (paths, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    book: '<path d="M12 6c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V5c-4-1-7-1-10 1Z"/><path d="M12 6v15M5 9h3M5 12h3M16 9h3M16 12h3"/>',
    board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M13 13h4M13 16h3"/>',
    runs: '<path d="M4 21V7l8-4 8 4v14M4 11h16M9 21v-6h6v6M2 21h20"/>',
    close: '<rect x="4" y="5" width="16" height="17" rx="2"/><path d="M9 5V2h6v3M8 13l3 3 5-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    training: '<circle cx="12" cy="15" r="5"/><path d="M5 3h4l3 7 3-7h4l-4 9M10 15h4M12 13v4"/>',
    phone: '<path d="M8 3H4a1 1 0 0 0-1 1c0 10 7 17 17 17a1 1 0 0 0 1-1v-4l-5-2-2 3a13 13 0 0 1-7-7l3-2Z"/>',
    grooming: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.1 8.1 12 12M8.1 15.9 20 4M14 10l6-6"/>',
    price: '<path d="M20 13 11 22 2 13V3h10Z"/><circle cx="7" cy="8" r="1"/><path d="m12 12 4 4"/>',
    gift: '<path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12"/><path d="M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
    megaphone: '<path d="m3 9 13-5v16L3 15ZM16 9h3a3 3 0 0 1 0 6h-3M5 16l2 6h4l-3-5"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
    shield: '<path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    vet: '<path d="M7 3v5a5 5 0 0 0 10 0V3M5 3h4M15 3h4M12 13v3a5 5 0 0 0 10 0v-2"/><circle cx="21" cy="11" r="2"/>',
    basket: '<path d="M3 10h18l-2 11H5ZM7 10l5-8 5 8M9 14v3M15 14v3"/>',
    building: '<path d="M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M9 21v-5h3v5"/>',
    idea: '<path d="M9 18h6M9 22h6M9 16c0-2-4-3-4-7a7 7 0 0 1 14 0c0 4-4 5-4 7"/>',
    file: '<path d="M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h6"/>',
    settings: '<path d="m9 3-.5 3-2 .9L4 6l-2 3.5 2.5 2v2L2 15l2 3.5 2.5-.9 2 .9L9 22h4l.5-3.5 2-.9 2.5.9 2-3.5-2.5-1.5v-2l2.5-2L18 6l-2.5.9-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    menu: '<rect x="1.5" y="1.5" width="8.8" height="8.8" rx="2" fill="currentColor" stroke="none"/><rect x="13.4" y="1.5" width="8.8" height="8.8" rx="2" fill="currentColor" stroke="none"/><rect x="1.5" y="13.4" width="8.8" height="8.8" rx="2" fill="currentColor" stroke="none"/><circle cx="17.2" cy="17.2" r="3.8"/><path d="m20 20 2.5 2.5"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
    cross: '<path d="m6 6 12 12M6 18 18 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
    moon: '<path d="M20.8 13.1A9 9 0 0 1 10.9 3.2a9 9 0 1 0 9.9 9.9Z"/>',
    print: '<path d="M6 9V2h12v7M6 18H3v-9h18v9h-3"/><path d="M6 14h12v8H6ZM17 11h1"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
    tools: '<path d="m14 6 4 4M4 20l-1-4L15 4l5-1-1 5L7 20ZM4 16l4 4M15 4l4 4"/>',
  };
  const icon = name => svg(paths[name] || paths.file);
  const palettes = {
    accent: ['#809cec','#eaf0fd','#a9bdf5'], blue: ['#346bc8','#e5edfb','#94b8fa'],
    violet: ['#7b53bc','#eee7f8','#c7a8ed'], green: ['#26815c','#e2f2e9','#8fd4ae'],
    rose: ['#bd4e70','#f8e7ed','#ef9fb6'], amber: ['#ad761f','#f9eedb','#e9c380'],
  };
  const appStyles = {
    '/': ['home','accent'], '/kb/index.html': ['book','blue'],
    '/occupied-runs.html': ['runs','blue'], '/end-of-day.html': ['close','rose'], '/tours.html': ['calendar','violet'],
    '/training.html': ['training','amber'], '/potential-training-clients.html': ['people','amber'],
    '/follow-up-calls.html': ['phone','green'], '/grooming-price-list.html': ['grooming','violet'],
    '/boarding-base-rates.html': ['price','accent'], '/gift-cards.html': ['gift','rose'],
    '/marketing-initiatives.html': ['megaphone','amber'], '/dog-licenses.html': ['shield','blue'],
    '/k9-cough.html': ['heart','rose'], '/vet-cheat-sheet.html': ['vet','green'],
    '/biscuit-baskets.html': ['basket','amber'], '/realtor-info.html': ['building','blue'],
    '/suggestions.html': ['idea','violet'], '/settings.html': ['settings','accent'],
  };
  const knowledgeStyles = {
    'Activity Procedures':['training','green'], 'Administrative Procedures':['file','violet'],
    'Company Policies':['shield','blue'], 'Customer Service Procedures':['people','amber'],
    'Facility Maintenance Procedures':['tools','accent'], 'Gingr Procedures':['board','violet'],
    'Health First Aid':['vet','rose'], 'Other':['idea','amber'], 'Petcare Procedures':['heart','green'],
  };
  const quickStyles = { 'Run Cards':['file','accent'], 'Printables':['print','violet'], 'Price Sheets':['price','green'], 'Info Sheets':['info','amber'] };
  let apps = [], query = '', opened = false, closeTimer, toastTimer;
  let navigationView = 'pages', knowledgeCategory = null;
  let mainMenuSnapshot = null;
  let previousBodyOverflow = '';
  const previouslyInert = new Map();
  const normalize = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const normalizePath = href => href === '/' || href === '/index.html' ? '/' : href.replace(/\/$/,'/index.html');
  const currentPath = normalizePath(location.pathname);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className=className; if (text != null) el.textContent=text; return el; };


  function resultType(app) {
    if(app.href.startsWith('/kb/'))return {key:'knowledge',label:'Knowledge Base'};
    if(app.kind==='resource')return {key:'resource',label:'Document'};
    if(app.kind==='action')return {key:'action',label:'Shortcut'};
    return {key:'app',label:'Page'};
  }

  function coloredSymbol(key,palette) {
    const colors = palettes[palette];
    const el = make('span','desktop-app-symbol');
    el.style.setProperty('--app-ink',colors[0]); el.style.setProperty('--app-tint',colors[1]); el.style.setProperty('--app-light',colors[2]);
    el.innerHTML = icon(key); el.setAttribute('aria-hidden','true'); return el;
  }
  function appStyle(app) { return appStyles[app.href] || (app.quickAccess&&quickStyles[app.section]) || knowledgeStyles[app.section] || ['book','blue']; }
  function tileTone(element,palette) {
    const colors=palettes[palette];
    element.style.setProperty('--tile-ink',colors[0]);element.style.setProperty('--tile-tint',colors[1]);element.style.setProperty('--tile-light',colors[2]);
  }
  function symbol(app) { return coloredSymbol(...appStyle(app)); }
  function appLink(app, mode = 'directory') {
    const link=make('a',mode==='directory'?'desktop-page-link':'desktop-app-row'); link.href=app.href;tileTone(link,appStyle(app)[1]);
    if(app.kind==='resource'){link.target='_blank';link.rel='noopener noreferrer';}
    if(app.kind==='action'&&currentPath==='/')link.addEventListener('click',event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();event.stopPropagation();setOpen(false);openQuickShortcut(new URL(app.href,location.href).hash);});
    const type=resultType(app);
    link.setAttribute('aria-label',mode==='directory'?app.title:`${app.title}, ${type.label}, ${[app.category,app.section].filter(Boolean).join(', ')}`); link.title=app.title;
    link.dataset.resultKind=type.key;
    if(normalizePath(app.href)===currentPath)link.setAttribute('aria-current','page');
    link.append(symbol(app));
    if(mode==='directory'){link.append(make('span','desktop-page-label',app.title));const arrow=make('span','desktop-page-arrow');arrow.innerHTML=svg(paths.arrow,13);arrow.setAttribute('aria-hidden','true');link.append(arrow);}
    else { const label=make('span','desktop-result-text');const meta=make('span','desktop-result-meta');meta.append(make('span',`desktop-type-badge is-${type.key}`,type.label));const context=type.key==='knowledge'||app.quickAccess?app.section:app.category;if(context)meta.append(make('small','',context));label.append(make('strong','',app.title),meta);if(app._searchSnippet)label.append(make('span','desktop-result-excerpt',app._searchSnippet));link.append(label);const arrow=make('span');arrow.innerHTML=svg(paths.arrow,15);arrow.setAttribute('aria-hidden','true');link.append(arrow); }
    return link;
  }
  function knowledgeLink(app) {
    const category=app.href.endsWith('/index.html');
    const link=make('a',`desktop-knowledge-link${category?' is-view-all':''}`);link.href=app.href;
    link.setAttribute('aria-label',category?`View all ${app.section||'Knowledge Base'}`:app.title);
    if(normalizePath(app.href)===currentPath)link.setAttribute('aria-current','page');
    link.append(make('span','',category?'View All':app.title));
    const arrow=make('span');arrow.innerHTML=svg(paths.arrow,13);arrow.setAttribute('aria-hidden','true');link.append(arrow);
    return link;
  }

  root.innerHTML = `
    <div class="desktop-backdrop" id="desktopBackdrop" hidden aria-hidden="true"></div>
    <section class="desktop-launcher" id="desktopLauncher" hidden inert aria-labelledby="desktopLauncherTitle">
      <div class="desktop-launcher-top">
        <div class="desktop-search desktop-menu-search">${svg(paths.search,18)}<input id="desktopAppSearch" type="search" placeholder="Search Paws HQ" aria-label="Find a page or Knowledge Base answer" autocomplete="off" spellcheck="false" maxlength="120" aria-controls="desktopAppContent"><button type="button" class="desktop-search-clear" id="desktopSearchClear" aria-label="Clear search" hidden>${svg(paths.cross,15)}</button></div>
        <div class="desktop-heading-row is-quiet"><h2 id="desktopLauncherTitle" tabindex="-1">Paws HQ</h2></div>
      </div>
      <div class="desktop-launcher-content" id="desktopAppContent"></div>
      <div class="desktop-launcher-footer">
        <a href="/settings.html" id="desktopAccount" class="desktop-team" aria-label="Account settings"><span class="desktop-team-avatar" aria-hidden="true">${svg(paths.person,17)}</span><span><strong>Paws HQ</strong><small>Your account</small></span></a>
        <div class="desktop-footer-actions"><button type="button" id="desktopPrint" class="desktop-footer-button" aria-label="Print current page" title="Print current page">${svg(paths.print,18)}</button><button type="button" id="desktopTheme" class="desktop-footer-button" aria-label="Switch to dark mode" title="Switch theme">${svg(paths.moon,18)}</button><a href="/settings.html" class="desktop-footer-button" aria-label="Settings" title="Settings">${svg(paths.settings,18)}</a></div>
      </div>
    </section>
    <nav class="desktop-taskbar" aria-label="Paws HQ taskbar">
      <a href="/" id="desktopHome" class="desktop-dock-item desktop-start" aria-label="Home"${currentPath==='/'?' aria-current="page"':''}><img src="/paws-crown.png" alt=""><span class="desktop-dock-tooltip" aria-hidden="true">Home</span></a>
      <button type="button" id="desktopSearchOpen" class="desktop-dock-item" aria-label="Open Paws menu" aria-expanded="false" aria-haspopup="dialog" aria-controls="desktopLauncher">${svg(paths.menu,24)}<span class="desktop-dock-tooltip" aria-hidden="true">Menu</span></button>
    </nav>
    <div class="desktop-toast" id="desktopToast" role="status" hidden></div>
    <div class="desktop-sr-only" id="desktopSearchStatus" role="status" aria-live="polite"></div>`;

  const panel=root.querySelector('#desktopLauncher'), backdrop=root.querySelector('#desktopBackdrop'), search=root.querySelector('#desktopAppSearch'), content=root.querySelector('#desktopAppContent'), heading=root.querySelector('#desktopLauncherTitle'), clear=root.querySelector('#desktopSearchClear'), status=root.querySelector('#desktopSearchStatus'), searchOpen=root.querySelector('#desktopSearchOpen');

  function rememberMainMenuSize() {
    if(!panel.hidden&&panel.classList.contains('is-pages-view'))root.style.setProperty('--desktop-main-menu-height',`${panel.getBoundingClientRect().height}px`);
  }
  function updateMenuSizeForViewport() {
    if(panel.hidden)return;
    if(panel.classList.contains('is-pages-view')){rememberMainMenuSize();return;}
    if(!panel.classList.contains('is-knowledge-view')||!mainMenuSnapshot)return;
    // Measure the current main-menu layout without changing the visible Knowledge Base view.
    const probe=make('section','desktop-launcher is-pages-view');probe.inert=true;probe.setAttribute('aria-hidden','true');probe.style.visibility='hidden';probe.style.pointerEvents='none';
    const top=panel.querySelector('.desktop-launcher-top').cloneNode(true);top.querySelector('.desktop-browse-header')?.remove();
    probe.append(top,mainMenuSnapshot.cloneNode(true),panel.querySelector('.desktop-launcher-footer').cloneNode(true));
    for(const element of probe.querySelectorAll('[id]'))element.removeAttribute('id');
    root.append(probe);const height=probe.getBoundingClientRect().height;probe.remove();
    root.style.setProperty('--desktop-main-menu-height',`${height}px`);
  }

  function fitVisibleViewport() {
    const viewport=window.visualViewport;
    root.style.setProperty('--desktop-viewport-height',`${viewport?.height||window.innerHeight}px`);
    root.style.setProperty('--desktop-viewport-top',`${viewport?.offsetTop||0}px`);
  }
  fitVisibleViewport();
  window.addEventListener('resize',fitVisibleViewport);
  window.addEventListener('resize',updateMenuSizeForViewport);
  window.visualViewport?.addEventListener('resize',fitVisibleViewport);
  window.visualViewport?.addEventListener('resize',updateMenuSizeForViewport);
  window.visualViewport?.addEventListener('scroll',fitVisibleViewport);

  function showToast(text) { clearTimeout(toastTimer); const el=root.querySelector('#desktopToast');el.textContent=text;el.hidden=false;toastTimer=setTimeout(()=>{el.hidden=true;},5000); }
  function setTheme(dark) { document.documentElement.classList.toggle('dark',dark); const button=root.querySelector('#desktopTheme');button.innerHTML=icon(dark?'sun':'moon');button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');try{localStorage.setItem('theme',dark?'dark':'light');}catch{} }
  const savedTheme=(()=>{try{return localStorage.getItem('theme');}catch{return null;}})();
  setTheme(savedTheme ? savedTheme==='dark' : false);

  function setOpen(next, returnFocus = false, focusSearch = false) {
    clearTimeout(closeTimer);opened=next;
    searchOpen.setAttribute('aria-expanded',String(next));
    searchOpen.setAttribute('aria-label',next?'Close Paws menu':'Open Paws menu');
    if(next) {
      closeQuickMenu();
      previousBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
      root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','desktopLauncherTitle');
      for(const el of document.body.children)if(el!==root){previouslyInert.set(el,el.inert);el.inert=true;}
      panel.hidden=false;panel.inert=false;backdrop.hidden=false;
      rememberMainMenuSize();
      // Commit the closed transform before starting the first opening transition.
      panel.getBoundingClientRect();
      requestAnimationFrame(()=>{if(!opened)return;panel.classList.add('is-open');backdrop.classList.add('is-open');const touchLayout=window.innerWidth<=540||window.matchMedia('(pointer: coarse)').matches;(focusSearch||!touchLayout?search:heading).focus({preventScroll:true});});
    } else {
      document.body.style.overflow=previousBodyOverflow;
      panel.classList.remove('is-open');backdrop.classList.remove('is-open');panel.inert=true;
      for(const [el,value]of previouslyInert)el.inert=value;previouslyInert.clear();
      root.removeAttribute('role');root.removeAttribute('aria-modal');root.removeAttribute('aria-labelledby');
      closeTimer=setTimeout(()=>{if(!opened){panel.hidden=true;backdrop.hidden=true;}},200);
      if(returnFocus)searchOpen.focus({preventScroll:true});
    }
  }

  function openSearch() {
    if(!opened){navigationView='pages';knowledgeCategory=null;render();content.scrollTop=0;setOpen(true,false,true);}
    else search.focus({preventScroll:true});
  }
  searchOpen.addEventListener('click',()=>{
    if(opened){setOpen(false,true);return;}
    query='';search.value='';navigationView='pages';knowledgeCategory=null;render();content.scrollTop=0;setOpen(true);
  });
  backdrop.addEventListener('click',()=>setOpen(false,true));
  root.querySelector('.desktop-taskbar').addEventListener('click',event=>{
    if(opened&&!event.target.closest('#desktopSearchOpen,#desktopHome'))setOpen(false,true);
  });
  panel.addEventListener('click',event=>{
    if(!opened||!event.target.matches('.desktop-launcher,.desktop-launcher-top,.desktop-heading-row,.desktop-launcher-content,.desktop-launcher-footer,.desktop-page-groups,.desktop-page-group,.desktop-page-grid,.desktop-kb-category-grid,.desktop-knowledge-list,.desktop-browse-header,.desktop-browse-title-row,.desktop-search-group,.desktop-app-list,.desktop-empty'))return;
    const scrollbarWidth=content.offsetWidth-content.clientWidth;
    if(event.target===content&&scrollbarWidth>0&&event.clientX>=content.getBoundingClientRect().right-scrollbarWidth)return;
    setOpen(false,true);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&opened){event.preventDefault();setOpen(false,true);return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();return;}
    if(!opened||event.key!=='Tab')return;
    const focusable=[...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled])')].filter(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });

  function navigate(view,category=null,restoreCategory=null) {
    rememberMainMenuSize();
    navigationView=view;knowledgeCategory=category;query='';search.value='';render();content.scrollTop=0;
    if(view==='pages'){
      content.scrollTop=content.scrollHeight;
      content.querySelector('#desktopKnowledgeOpen')?.focus({preventScroll:true});
    }else if(restoreCategory){
      const button=[...content.querySelectorAll('.desktop-kb-category')].find(el=>el.dataset.category===restoreCategory);
      button?.focus();
    }else panel.querySelector('.desktop-view-title')?.focus({preventScroll:true});
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)content.animate([{opacity:.65},{opacity:1}],{duration:120,easing:'ease-out'});
  }

  function renderPages() {
    const groups=make('div','desktop-page-groups');
    for(const name of ['Front Desk','Pet Care & Training','Marketing & Outreach','Office & Team']){
      const members=apps.filter(app=>app.category===name);
      const group=make('section','desktop-page-group');group.setAttribute('aria-label',name);
      group.append(make('h3','desktop-section-heading',name));
      const links=make('div','desktop-page-grid');for(const app of members)links.append(appLink(app,'directory'));
      group.append(links);groups.append(group);
    }
    content.append(groups);
    const knowledge=make('button','desktop-knowledge-entry');knowledge.type='button';knowledge.id='desktopKnowledgeOpen';tileTone(knowledge,'blue');
    knowledge.append(coloredSymbol('book','blue'));
    const text=make('span','desktop-knowledge-entry-text');text.append(make('strong','','Knowledge Base'),make('small','','Policies, procedures, and answers'));
    const arrow=make('span','desktop-entry-arrow');arrow.innerHTML=svg(paths.arrow,16);arrow.setAttribute('aria-hidden','true');
    knowledge.append(text,arrow);knowledge.addEventListener('click',()=>navigate('knowledge'));content.append(knowledge);
    mainMenuSnapshot=content.cloneNode(true);
  }

  function renderKnowledge() {
    const kb=apps.filter(app=>app.href.startsWith('/kb/'));
    const currentCategory=knowledgeCategory;
    const header=make('div','desktop-browse-header');
    const back=make('button','desktop-back-button');back.type='button';back.innerHTML=svg(paths.back,16);back.append(make('span','',currentCategory?'Knowledge Base':'All Pages'));
    back.setAttribute('aria-label',currentCategory?'Back to Knowledge Base categories':'Back to all pages');
    back.addEventListener('click',()=>currentCategory?navigate('knowledge',null,currentCategory):navigate('pages'));
    const titleRow=make('div','desktop-browse-title-row');
    const title=make('h3','desktop-view-title',currentCategory||'Knowledge Base');title.tabIndex=-1;titleRow.append(title);
    const landing=kb.find(app=>currentCategory?app.section===currentCategory&&app.href.endsWith('/index.html'):app.href==='/kb/index.html');
    if(landing)titleRow.append(knowledgeLink(landing));
    header.append(back,titleRow);panel.querySelector('.desktop-launcher-top').append(header);
    if(currentCategory){
      const list=make('div','desktop-knowledge-list');list.setAttribute('aria-label',currentCategory);
      for(const app of kb.filter(app=>app.section===currentCategory&&!app.href.endsWith('/index.html')))list.append(knowledgeLink(app));
      content.append(list);return;
    }
    const grid=make('div','desktop-kb-category-grid');grid.setAttribute('aria-label','Knowledge Base categories');
    for(const section of [...new Set(kb.map(app=>app.section).filter(Boolean))]){
      const button=make('button','desktop-kb-category');button.type='button';button.dataset.category=section;
      const style=knowledgeStyles[section]||['book','blue'];tileTone(button,style[1]);
      button.setAttribute('aria-label',`Open ${section} Knowledge Base`);button.append(coloredSymbol(...style),make('span','desktop-kb-category-label',section));
      const arrow=make('span','desktop-entry-arrow');arrow.innerHTML=svg(paths.arrow,14);arrow.setAttribute('aria-hidden','true');button.append(arrow);
      button.addEventListener('click',()=>navigate('knowledge',section));grid.append(button);
    }
    content.append(grid);
  }

  function renderSearchGroup(title, matches, className) {
    if(!matches.length)return;
    const section=make('section',`desktop-search-group ${className}`);
    const titleRow=make('h3','desktop-search-group-title',title);titleRow.append(make('span','',String(matches.length)));
    const list=make('div','desktop-app-list');for(const app of matches)list.append(appLink(app,'list'));
    section.append(titleRow,list);content.append(section);
  }

  const searchStopWords=new Set('a an and are at be can could do does find for from get give how i im in is it look looking m me my need of on or please show the this to use want what whats where with you'.split(' '));
  function oneTypo(a,b){
    if(a.length<4||Math.abs(a.length-b.length)>1)return false;
    let i=0,j=0,changes=0;
    while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++changes>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
    return changes+(i<a.length||j<b.length?1:0)<=1;
  }
  function findMatches(value){
    const raw=normalize(value);const words=raw.split(' ').filter(word=>word&&!searchStopWords.has(word));
    if(!words.length)return [];
    const ranked=[];
    for(const app of apps){
      const index=app._searchIndex;
      if(!words.every(word=>index.all.includes(word)))continue;
      const titleHits=words.filter(word=>index.title.includes(word)).length;
      const aliasHits=words.filter(word=>index.aliases.includes(word)).length;
      const score=(index.title===raw?1000:index.title.startsWith(raw)?800:0)+titleHits*80+aliasHits*45+(titleHits===words.length?200:0)+(resultType(app).key==='app'?4:0);
      if(titleHits<words.length&&index.body){const first=words.map(word=>index.body.indexOf(word)).find(pos=>pos>=0);if(first!==undefined){const text=app.searchText||'';const pos=Math.max(0,Math.min(first,text.length)-45);app._searchSnippet=(pos?'…':'')+text.slice(pos,pos+180).trim()+(text.length>pos+180?'…':'');}}
      ranked.push({app,score});
    }
    if(!ranked.length){
      for(const app of apps){const index=app._searchIndex;const compact=raw.replace(/ /g,'');
        if((compact.length>=5&&index.compact.includes(compact))||words.every(word=>index.shortWords.some(candidate=>candidate.includes(word)||oneTypo(word,candidate))))ranked.push({app,score:0});
      }
    }
    return ranked.sort((a,b)=>b.score-a.score||a.app.title.localeCompare(b.app.title)).map(item=>item.app);
  }

  function render() {
    panel.querySelector('.desktop-browse-header')?.remove();
    panel.classList.toggle('is-knowledge-view',!query&&navigationView==='knowledge');panel.classList.toggle('is-pages-view',!query&&navigationView==='pages');content.replaceChildren();clear.hidden=!query;heading.parentElement.classList.toggle('is-quiet',!query);for(const app of apps)app._searchSnippet='';
    if(query){
      const matches=findMatches(query);
      const appMatches=matches.filter(app=>resultType(app).key==='app');
      const quickMatches=matches.filter(app=>app.quickAccess);
      const kbMatches=matches.filter(app=>resultType(app).key==='knowledge');
      heading.textContent='Search results';
      status.textContent=`${matches.length} results: ${appMatches.length} pages, ${quickMatches.length} Quick Access items, and ${kbMatches.length} Knowledge Base results for ${query}`;
      content.append(make('div','desktop-results-count',`${matches.length} ${matches.length===1?'result':'results'}`));
      renderSearchGroup('Pages',appMatches,'is-app-results');renderSearchGroup('Quick Access',quickMatches,'is-quick-results');renderSearchGroup('Knowledge Base',kbMatches,'is-kb-results');
      if(!matches.length){const empty=make('div','desktop-empty');empty.innerHTML=icon('search');empty.append(make('strong','','No matches found'),make('p','','Try another word, like cash, grooming, or medication.'));content.append(empty);}
      return;
    }
    heading.textContent='Paws HQ';status.textContent='';if(navigationView==='knowledge')renderKnowledge();else{renderPages();rememberMainMenuSize();}
  }
  function updateSearch() {
    query=search.value.trim();render();content.scrollTop=0;
    if(query&&!opened)setOpen(true,false,true);
  }
  search.addEventListener('input',updateSearch);
  root.querySelector('.desktop-menu-search').addEventListener('click',event=>{if(!event.target.closest('button'))search.focus();});
  search.addEventListener('keydown',event=>{
    if(!query||event.isComposing)return;
    if(!opened&&(event.key==='ArrowDown'||event.key==='Enter')){event.preventDefault();setOpen(true,false,true);return;}
    if(event.key==='ArrowDown'){const first=content.querySelector('a[href]');if(first){event.preventDefault();first.focus();}}
    if(event.key==='Enter'){const first=content.querySelector('a[href]');if(first){event.preventDefault();first.click();}}
  });
  clear.addEventListener('click',()=>{search.value='';query='';render();content.scrollTop=0;search.focus({preventScroll:true});});
  root.querySelector('#desktopTheme').addEventListener('click',()=>setTheme(!document.documentElement.classList.contains('dark')));
  root.querySelector('#desktopPrint').addEventListener('click',()=>{setOpen(false);window.print();});

  const quickMenus=new Map();
  let activeQuickMenu=null;
  function closeQuickMenu(returnFocus=false) {
    if(!activeQuickMenu)return;
    const entry=activeQuickMenu;entry.menu.hidden=true;entry.button.setAttribute('aria-expanded','false');activeQuickMenu=null;
    if(returnFocus)entry.button.focus({preventScroll:true});
  }
  function positionQuickMenu(entry) {
    const rect=entry.button.getBoundingClientRect(),viewport=window.visualViewport;
    const viewportTop=viewport?.offsetTop||0,viewportLeft=viewport?.offsetLeft||0;
    const viewportWidth=viewport?.width||window.innerWidth,viewportHeight=viewport?.height||window.innerHeight;
    const width=Math.min(entry.key==='runCards'?230:304,viewportWidth-24);
    const below=viewportTop+viewportHeight-rect.bottom-86,above=rect.top-viewportTop-18;
    const upwards=below<220&&above>below;
    const maxHeight=Math.max(100,Math.min(360,upwards?above:below));
    entry.menu.style.width=`${width}px`;entry.menu.style.maxHeight=`${maxHeight}px`;
    entry.menu.style.left=`${Math.max(viewportLeft+12,Math.min(rect.left,viewportLeft+viewportWidth-width-12))}px`;
    entry.menu.style.top=`${upwards?Math.max(viewportTop+12,rect.top-entry.menu.getBoundingClientRect().height-6):rect.bottom+6}px`;
  }
  function openQuickMenu(entry,focus=false) {
    closeQuickMenu();activeQuickMenu=entry;
    if(entry.filter){entry.filter.value='';entry.filter.dispatchEvent(new Event('input'));}
    entry.menu.hidden=false;entry.button.setAttribute('aria-expanded','true');positionQuickMenu(entry);
    if(focus)entry.menu.querySelector('input,a,button')?.focus({preventScroll:true});
  }
  function openQuickShortcut(hash) {
    const day=hash==='#quick-access-run-cards-today'?'today':hash==='#quick-access-run-cards-tomorrow'?'tomorrow':null;
    const entry=quickMenus.get('runCards');if(!day||!entry)return;
    closeQuickMenu();entry.button.scrollIntoView({block:'center',behavior:'instant'});
    // Open after the programmatic scroll event so it cannot dismiss the shortcut.
    requestAnimationFrame(()=>{openQuickMenu(entry);entry.menu.querySelector(`[data-start="${day}"]`)?.focus({preventScroll:true});});
  }
  function setupQuickAccess() {
    const controls=document.getElementById('quickAccessControls');if(!controls)return;
    const section=controls.closest('section');section.classList.add('desktop-quick-access');
    const overlays=make('div','desktop-quick-overlays');document.body.append(overlays);
    const decorate=(control,label,key,palette,expandable)=>{
      control.className='desktop-quick-control';control.replaceChildren(coloredSymbol(key,palette),make('span','desktop-quick-label',label));tileTone(control,palette);
      const chevron=make('span','desktop-quick-chevron');chevron.setAttribute('aria-hidden','true');
      if(expandable)chevron.innerHTML=svg('<path d="m6 9 6 6 6-6"/>',14);
      control.append(chevron);control.disabled=false;
    };
    for(const [id,key,palette] of [['occupiedRunsQuickLink','runs','blue'],['endOfDayQuickLink','close','rose']]){
      const link=document.getElementById(id);if(link)decorate(link,link.textContent.trim(),key,palette,false);
    }
    for(const key of ['runCards','printables','priceSheets','infoSheets']){
      const button=document.getElementById(`${key}Button`),menu=document.getElementById(`${key}Menu`);if(!button||!menu)continue;
      const label=button.textContent.trim(),style=quickStyles[label],oldFilter=menu.querySelector('input');
      const choices=[...menu.querySelectorAll('a[href],button[data-start]')].map(el=>({title:el.textContent.trim(),href:el.getAttribute('href'),day:el.dataset.start}));
      const placeholder=oldFilter?.getAttribute('placeholder');button.parentElement.className='desktop-quick-wrap';
      decorate(button,label,...style,true);button.removeAttribute('aria-haspopup');button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
      menu.className='desktop-quick-menu';menu.hidden=true;menu.replaceChildren();menu.setAttribute('role','region');menu.setAttribute('aria-label',label);overlays.append(menu);
      const entry={key,button,menu,filter:null};quickMenus.set(key,entry);
      if(placeholder){
        const filter=make('input','desktop-quick-filter');filter.type='search';filter.placeholder=placeholder;filter.setAttribute('aria-label',placeholder.replace(/\.\.\.$/,''));filter.autocomplete='off';menu.append(filter);entry.filter=filter;
      }
      const options=make('div','desktop-quick-options');menu.append(options);
      for(const choice of choices){
        const option=make(choice.href?'a':'button','desktop-quick-option');
        if(choice.href){option.href=choice.href;option.target='_blank';option.rel='noopener noreferrer';}
        else{option.type='button';option.dataset.start=choice.day;option.id=`quick-access-run-cards-${choice.day}`;option.addEventListener('click',()=>{closeQuickMenu(true);if(typeof window.pawsGenerateRunCards==='function')window.pawsGenerateRunCards(choice.day);else showToast('Run Cards could not load. Please refresh and try again.');});}
        const symbol=make('span','desktop-quick-option-icon');symbol.innerHTML=icon(choice.href?'file':'calendar');symbol.setAttribute('aria-hidden','true');option.append(symbol,make('span','',choice.title));
        if(choice.href)option.addEventListener('click',()=>closeQuickMenu(true));
        options.append(option);
      }
      if(entry.filter){
        const empty=make('p','desktop-quick-empty',`No ${label.toLowerCase()} found.`);empty.hidden=true;menu.append(empty);
        entry.filter.addEventListener('input',()=>{const value=normalize(entry.filter.value);let count=0;for(const option of options.children){option.hidden=!normalize(option.textContent).includes(value);if(!option.hidden)count++;}empty.hidden=!!count;});
      }
      button.addEventListener('click',()=>activeQuickMenu===entry?closeQuickMenu():openQuickMenu(entry));
      button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();openQuickMenu(entry,true);}else if(event.key==='Tab'&&!event.shiftKey&&activeQuickMenu===entry){event.preventDefault();menu.querySelector('input,a,button')?.focus();}});
      menu.addEventListener('keydown',event=>{
        if(event.isComposing)return;
        if(event.key==='Escape'){event.preventDefault();closeQuickMenu(true);return;}
        const items=[...menu.querySelectorAll('input,a,button')].filter(el=>!el.hidden);const index=items.indexOf(document.activeElement);
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
        if(event.key==='Tab'&&((event.shiftKey&&index===0)||(!event.shiftKey&&index===items.length-1))){event.preventDefault();closeQuickMenu(true);if(!event.shiftKey){const pageStops=[...document.querySelectorAll('main a[href],main button:not([disabled]),main input:not([disabled]),#desktopHome')].filter(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length);pageStops[pageStops.indexOf(button)+1]?.focus();}}
      });
    }
    const syncTileWidth=()=>{const first=controls.querySelector('.desktop-quick-control');if(first)document.body.style.setProperty('--desktop-quick-tile-width',`${first.getBoundingClientRect().width}px`);};
    syncTileWidth();new ResizeObserver(syncTileWidth).observe(controls);
    document.addEventListener('click',event=>{if(activeQuickMenu&&!activeQuickMenu.menu.contains(event.target)&&!activeQuickMenu.button.contains(event.target))closeQuickMenu();});
    window.addEventListener('resize',()=>{if(activeQuickMenu)positionQuickMenu(activeQuickMenu);});
    window.addEventListener('scroll',()=>closeQuickMenu(),{passive:true});
    window.visualViewport?.addEventListener('resize',()=>{if(activeQuickMenu)positionQuickMenu(activeQuickMenu);});
    window.addEventListener('hashchange',()=>openQuickShortcut(location.hash));
    openQuickShortcut(location.hash);
  }

  setupQuickAccess();

  // Use the site's existing theme preference and authenticated account.
  function refreshThemeButton() {
    const dark=document.documentElement.classList.contains('dark'),button=root.querySelector('#desktopTheme');
    button.innerHTML=icon(dark?'sun':'moon');button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
  }
  new MutationObserver(refreshThemeButton).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function renderAccount(session) {
    const account=root.querySelector('#desktopAccount'),name=account.querySelector('strong'),detail=account.querySelector('small'),avatar=account.querySelector('.desktop-team-avatar');
    const user=session?.user;
    if(!user){name.textContent='Sign in';detail.textContent='Paws HQ';account.href='/login.html';avatar.innerHTML=svg(paths.person,17);return;}
    name.textContent=user.user_metadata?.full_name||user.user_metadata?.name||'Account';
    detail.textContent=user.email||'Account settings';account.href='/settings.html';account.title=user.email||'Account settings';
    const avatarUrl=typeof getSlackAvatar==='function'?getSlackAvatar(session):user.user_metadata?.avatar_url||user.user_metadata?.picture;
    avatar.innerHTML=svg(paths.person,17);
    if(avatarUrl){try{const url=new URL(avatarUrl);if(url.protocol==='https:'){const image=document.createElement('img');image.src=url.href;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{avatar.innerHTML=svg(paths.person,17);},{once:true});avatar.replaceChildren(image);}}catch{}}
  }
  if(typeof supabaseClient!=='undefined'){
    supabaseClient.auth.getSession().then(({data})=>renderAccount(data.session)).catch(()=>{});
    supabaseClient.auth.onAuthStateChange((_event,session)=>renderAccount(session));
  }

  fetch('/assets/navigation.json?v=20261017b',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('Navigation unavailable');return response.json();}).then(data=>{
    apps=data.apps.filter(app=>{
      if(typeof app.href!=='string')return false;
      if(app.href.startsWith('/')&&!app.href.startsWith('//'))return app.href!=='/digital-whiteboard.html';
      if(app.quickAccess&&app.kind==='resource'){try{const url=new URL(app.href);return url.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(url.hostname)&&!url.username&&!url.password;}catch{}}
      return false;
    });
    for(const app of apps){const title=normalize(app.title),aliases=normalize((app.aliases||[]).join(' ')),context=normalize([app.category,app.section].filter(Boolean).join(' ')),body=normalize(app.searchText||'');app._searchIndex={title,aliases,body,all:[title,aliases,context,body].join(' '),compact:(title+' '+aliases).replace(/ /g,''),shortWords:[...new Set((title+' '+aliases).split(' ').filter(Boolean))]};}
    render();
  }).catch(()=>{heading.textContent='Navigation unavailable';content.append(make('div','desktop-empty','The local navigation could not load. Refresh to try again.'));});
})();
