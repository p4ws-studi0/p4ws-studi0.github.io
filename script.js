







// Capture only whether this page is an OAuth return, never its code/token values.
const HQ_ACTIVITY_SIGN_IN_RETURN = /^\/(?:index\.html)?$|^\/auth\/callback(?:\/index\.html|\/)?$/.test(window.location.pathname) && /(?:[?&]code=|[#&]access_token=)/.test(window.location.search + window.location.hash)

/*************************************************
 * SUPABASE
 *************************************************/
const supabaseClient = supabase.createClient(
  'https://dppjgglaeieevsfwsbii.supabase.co',
  'sb_publishable_PtLQ22zTKhRlWiAX1lQ1Ew_Z5HHnKYy',
  {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}}
)

function signInWithSlack() {
  supabaseClient.auth.signInWithOAuth({
    provider: 'slack_oidc',

  })
}

/*************************************************
 * AUTH UI (RUN ONLY AFTER HEADER LOAD)
 *************************************************/
function getSlackAvatar(session) {
  if (!session?.user) return null

  const slackIdentity = session.user.identities?.find(
    i => i.provider === 'slack_oidc'
  )

  return (
    session.user.user_metadata?.avatar_url ||
    session.user.user_metadata?.picture ||
    slackIdentity?.identity_data?.image_192 ||
    slackIdentity?.identity_data?.image_512 ||
    null
  )
}

async function updateHeaderAuthUI() {
  const headerRight = document.getElementById('headerRight')
  const loginBtn = document.getElementById('slackLoginBtn')

  if (!headerRight) {
    console.warn('headerRight not found')
    return
  }

  const { data } = await supabaseClient.auth.getSession()
  const session = data.session

  // login button
  if (loginBtn) {
    loginBtn.style.display = session ? 'none' : 'inline-flex'
  }

  // avatar
  if (!session) return

  // Wait for avatarWrapper to exist
  const avatarWrapper = await waitForElement('avatarWrapper', 3000)
  if (!avatarWrapper) {
    console.warn('avatarWrapper not found after waiting')
    return
  }

  if (avatarWrapper.querySelector('.user-avatar')) return

  const avatarUrl = getSlackAvatar(session)
  if (!avatarUrl) {
    console.warn('No Slack avatar found')
    return
  }

  avatarWrapper.innerHTML = `
    <div class="relative">
      <img
        src="${avatarUrl}"
        class="user-avatar w-9 h-9 rounded-full object-cover border border-white/30 cursor-pointer hover:scale-105 transition"
        id="avatarBtn"
      />

      <!-- DROPDOWN -->
      <div
        id="avatarMenu"
        class="
          hidden absolute right-0 mt-3 w-48
          rounded-xl overflow-hidden
          bg-white/80 dark:bg-[#0b0d12]/90
          backdrop-blur-xl
          border border-white/20
          shadow-xl
          text-sm
        "
      >
        <div class="px-4 py-3 border-b border-white/10">
          <p class="font-medium">
            ${session.user.user_metadata?.full_name || 'Account'}
          </p>
          <p class="opacity-60 text-xs truncate">
            ${session.user.email || ''}
          </p>
        </div>

        <button
          id="logoutBtn"
          class="w-full text-left px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition"
        >
          Log out
        </button>
      </div>
    </div>
  `

  console.log('✅ Avatar injected')
}

// Helper function to wait for an element
function waitForElement(id, timeout = 5000) {
  return new Promise((resolve) => {
    const element = document.getElementById(id)
    if (element) {
      resolve(element)
      return
    }

    const observer = new MutationObserver(() => {
      const element = document.getElementById(id)
      if (element) {
        observer.disconnect()
        clearTimeout(timeoutId)
        resolve(element)
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true
    })

    const timeoutId = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeout)
  })
}





/*************************************************
 * AUTH GATE
 *************************************************/

const PROTECTED_PATHS = [
  '/',              // homepage
  '/settings',
  '/kb/',            // if you later add folders
]

function isProtectedPage() {
  return PROTECTED_PATHS.some(path =>
    sidebarPath(window.location.href).startsWith(path)
  )
}
let hqWorkspaceMembership = null
let hqAccessController = null
let hqAccessNotice = null
let hqPreviousAccess = null
let hqAccessInvalidated = false
let hqConnectionPanel = null

function clearPrivateKnowledgeSearch() {
  SEARCH_INDEX = []
  SEARCH_READY = false
  SEARCH_GENERATION++
  SEARCH_FLIGHT = null
  clearTimeout(DEBOUNCE_TIMER)
  document.getElementById('searchResults')?.replaceChildren()
  document.getElementById('searchResults')?.classList.add('hidden')
}

function accessConnectionPanel(show, retry = false) {
  // Routine session checks stay invisible; the existing page transition handles loading.
  if (!show || !retry) {
    hqConnectionPanel?.remove()
    hqConnectionPanel = null
    return
  }
  if (!hqConnectionPanel) {
    hqConnectionPanel = document.createElement('section')
    hqConnectionPanel.className = 'hq-access-connection'
    hqConnectionPanel.setAttribute('role', 'status')
    const title = document.createElement('h2')
    title.textContent = 'Unable to connect'
    const message = document.createElement('p')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Try again'
    button.addEventListener('click', () => { void enforceAuthGate() })
    hqConnectionPanel.append(title, message, button)
    // Separate from the body opacity gate; existing forms are never replaced.
    document.documentElement.append(hqConnectionPanel)
  }
  hqConnectionPanel.querySelector('p').textContent = 'Your connection could not be checked. Your sign-in and work on this page are kept. Please try again.'
}

function receiveHqAccess(state) {
  const previous = hqPreviousAccess
  const changedIdentity = state.reason === 'identity-changed'
  if (changedIdentity) document.body.style.opacity = '0'
  const missingMembership = state.status === 'unavailable' && ['missing', 'inactive'].includes(state.approval)
  const confirmedDenied = state.confirmed && ['revoked', 'unapproved', 'session-missing'].includes(state.status)
  if (changedIdentity || ((confirmedDenied || missingMembership) && (!previous || previous.status !== state.status || previous.userId !== state.userId || previous.approval !== state.approval))) {
    clearPrivateKnowledgeSearch()
    hqAccessInvalidated = true
    window.dispatchEvent(new CustomEvent('paws-access-revoked', {detail: state}))
  }
  hqPreviousAccess = state
  if (state.status === 'allowed' || state.allowed) {
    prepareHqActivityLogging()
    accessConnectionPanel(false)
    hqAccessNotice?.render(state)
    document.body.style.opacity = '1'
    document.body.dataset.auth = 'ok'
    if (state.status === 'allowed' && hqAccessInvalidated) {
      hqAccessInvalidated = false
      window.dispatchEvent(new CustomEvent('paws-access-restored', {detail: state}))
    }
  } else if (confirmedDenied || ['revoked', 'unapproved', 'session-missing'].includes(state.lastConfirmedStatus)) {
    accessConnectionPanel(false)
    document.body.style.opacity = '1'
    document.body.dataset.auth = 'restricted'
    hqAccessNotice?.render(state)
  } else {
    if (hqAccessNotice?.element.open) hqAccessNotice.element.close()
    accessConnectionPanel(true, state.status === 'unavailable')
  }
}

async function enforceAuthGate() {
  const isLoginPage = sidebarPath(window.location.href) === '/login'
  if (isLoginPage) {
    document.body.style.opacity = '1'
    document.body.dataset.auth = 'login'
    return
  }
  try {
    const controller = await ensureHqAccessController()
    const state = await controller.check()
    // A truly absent session keeps the existing login flow. Connection failures
    // never navigate away, clear credentials, or change session duration.
    if (state.confirmed && state.status === 'session-missing') window.location.replace('/login')
  } catch (error) {
    console.warn('Paws HQ access check could not connect', error)
    accessConnectionPanel(true, true)
  }
}

window.addEventListener('load', enforceAuthGate)



/*************************************************
 * EVENTS
 *************************************************/

// run once header is injected
document.addEventListener('header:ready', updateHeaderAuthUI)

// react to login/logout
supabaseClient.auth.onAuthStateChange(() => {
  // Run outside Supabase's auth callback lock; getSession must not be awaited here.
  setTimeout(() => { void updateHeaderAuthUI() }, 0)
})


/*************************************************
 * SHARED NAVIGATION (PARTIALS CAN LOAD IN ANY ORDER)
 *************************************************/
let preparedSidebarNav = null
let preparedMenuToggle = null
let sidebarSearchEntries = []

function sidebarText(node) {
  if (!node) return ''
  const copy = node.cloneNode(true)
  for (const icon of copy.querySelectorAll('[aria-hidden="true"]')) icon.remove()
  return copy.textContent.replace(/\s+/g, ' ').trim()
}

function sidebarFold(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function indexSidebarSearch(sideMenu) {
  sidebarSearchEntries = [...sideMenu.querySelectorAll('.hq-nav a[href], .hq-nav-footer a[href]')].map(link => {
    const sections = []
    let group = link.closest('details')
    while (group) {
      sections.unshift(sidebarText(group.querySelector('summary')))
      group = group.parentElement?.closest('details')
    }
    let label = sidebarText(link)
    if (label === 'View all') label = `${sections.at(-1)} overview`
    if (sidebarPath(link.getAttribute('href')) === '/kb') label = 'Knowledge Base'
    const context = sections.join(' · ') || (link.closest('.hq-nav-footer') ? 'Account' : 'Quick access')
    return {href:link.getAttribute('href'), label, context, current:link.getAttribute('aria-current') === 'page', kb:link.getAttribute('href').startsWith('/kb/'), search:sidebarFold(`${label} ${context}`)}
  })
}

function searchSidebar(value) {
  const nav = document.querySelector('#sideMenu .hq-nav')
  const results = document.getElementById('sidebarSearchResults')
  const list = document.getElementById('sidebarSearchList')
  if (!nav || !results || !list) return
  const query = sidebarFold(value).trim().slice(0,120)
  nav.hidden = Boolean(query)
  results.hidden = !query
  document.getElementById('sidebarSearchClear').hidden = !query
  list.replaceChildren()
  results.scrollTop = 0
  if (!query) {
    document.getElementById('sidebarSearchStatus').textContent = ''
    return
  }
  const words = query.split(/\s+/)
  const rank = entry => {
    const title = sidebarFold(entry.label)
    return title === query ? 0 : title.startsWith(query) ? 1 : words.every(word => title.includes(word)) ? 2 : 3
  }
  const matches = sidebarSearchEntries.filter(entry => words.every(word => entry.search.includes(word)))
    .sort((a,b) => rank(a)-rank(b) || Number(a.kb)-Number(b.kb) || a.label.localeCompare(b.label))
  document.getElementById('sidebarSearchStatus').textContent = `${matches.length} ${matches.length === 1 ? 'page' : 'pages'} found`
  for (const entry of matches) {
    const link = document.createElement('a')
    link.href = entry.href
    if (entry.current) link.setAttribute('aria-current', 'page')
    const title = document.createElement('strong')
    title.textContent = entry.label
    const context = document.createElement('span')
    context.textContent = entry.context
    link.append(title, context)
    list.append(link)
  }
  if (!matches.length) {
    const empty = document.createElement('p')
    empty.className = 'hq-nav-search-empty'
    empty.textContent = 'No pages found. Try another name.'
    list.append(empty)
  }
}

function clearSidebarSearch() {
  const input = document.getElementById('sidebarSearchInput')
  if (!input) return
  input.value = ''
  searchSidebar('')
  input.focus()
}

function sidebarPath(value) {
  try {
    const path = new URL(value, window.location.origin).pathname
    return path.replace(/\/+$/, '').replace(/\/index(?:\.html)?$/, '').replace(/\.html$/, '') || '/'
  } catch { return '' }
}

function prepareSidebar() {
  const sideMenu = document.getElementById('sideMenu')
  if (!sideMenu) return
  const isOpen = !sideMenu.classList.contains('-translate-x-full')
  sideMenu.inert = !isOpen
  sideMenu.setAttribute('aria-hidden', String(!isOpen))
  const toggle = document.getElementById('menuToggle')
  if (toggle && toggle !== preparedMenuToggle) {
    toggle.setAttribute('aria-controls', 'sideMenu')
    toggle.setAttribute('aria-expanded', String(isOpen))
    toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu')
    preparedMenuToggle = toggle
  }
  const nav = sideMenu.querySelector('.hq-nav')
  if (!nav || nav === preparedSidebarNav) return
  preparedSidebarNav = nav
  const currentPath = sidebarPath(window.location.href)
  let activeLink = null
  for (const link of sideMenu.querySelectorAll('a[href]')) {
    if (sidebarPath(link.getAttribute('href')) === currentPath) {
      link.setAttribute('aria-current', 'page')
      activeLink = link
    }
  }
  if (activeLink) {
    let group = activeLink.closest('details')
    while (group) {
      group.open = true
      if (group.classList.contains('hq-nav-group')) group.classList.add('is-current-section')
      group = group.parentElement?.closest('details')
    }
  } else if (currentPath.startsWith('/kb/')) {
    const knowledgeBase = nav.querySelector('.hq-nav-kb')
    if (knowledgeBase) {
      knowledgeBase.open = true
      knowledgeBase.classList.add('is-current-section')
    }
  }
  indexSidebarSearch(sideMenu)
  searchSidebar(document.getElementById('sidebarSearchInput')?.value || '')
}

function setSidebarOpen(open, restoreFocus = false) {
  const sideMenu = document.getElementById('sideMenu')
  if (!sideMenu) return
  const toggle = document.getElementById('menuToggle')
  sideMenu.classList.toggle('-translate-x-full', !open)
  sideMenu.inert = !open
  sideMenu.setAttribute('aria-hidden', String(!open))
  toggle?.classList.toggle('open', open)
  toggle?.setAttribute('aria-expanded', String(open))
  toggle?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
  if (open) {
    const input = document.getElementById('sidebarSearchInput')
    let target = input?.value.trim() ? input : sideMenu.querySelector('a[aria-current="page"]') || sideMenu.querySelector('a[href]')
    let group = target?.closest('details')
    while (group) {
      if (!group.open) target = group.querySelector('summary')
      group = group.parentElement?.closest('details')
    }
    // Finish the menu button's activation before moving keyboard focus.
    requestAnimationFrame(() => {
      if (!sideMenu.classList.contains('-translate-x-full') && target?.isConnected) target.focus()
    })
  } else if (restoreFocus) toggle?.focus({preventScroll:true})
}

document.addEventListener('click', e => {
  const sideMenu = document.getElementById('sideMenu')
  if (!sideMenu) return
  if (e.target.closest('#sidebarSearchClear')) {
    clearSidebarSearch()
    return
  }
  const toggle = e.target.closest('#menuToggle')
  const isOpen = !sideMenu.classList.contains('-translate-x-full')
  if (toggle) {
    setSidebarOpen(!isOpen)
    return
  }
  if (isOpen && !e.target.closest('#sideMenu')) {
    setSidebarOpen(false, sideMenu.contains(document.activeElement))
  } else if (isOpen && e.target.closest('#sideMenu a[href]') && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    setSidebarOpen(false)
  }
})

document.addEventListener('keydown', e => {
  const sideMenu = document.getElementById('sideMenu')
  if (!sideMenu || sideMenu.classList.contains('-translate-x-full')) return
  const input = document.getElementById('sidebarSearchInput')
  if (e.key === 'Escape') {
    e.preventDefault()
    if (input?.value.trim()) clearSidebarSearch()
    else setSidebarOpen(false, true)
  } else if (e.target === input && input.value.trim() && ['ArrowDown','Enter'].includes(e.key)) {
    const first = document.querySelector('#sidebarSearchList a')
    if (!first) return
    e.preventDefault()
    if (e.key === 'Enter') first.click()
    else first.focus()
  }
})

document.addEventListener('input', e => {
  if (e.target.id === 'sidebarSearchInput') searchSidebar(e.target.value)
})

// Native disclosures provide keyboard interaction and announce their state.
// Keep one top-level section open, including in browsers without details[name].
document.addEventListener('toggle', e => {
  const group = e.target
  if (!group.matches?.('#sideMenu .hq-nav-group') || !group.open) return
  for (const other of document.querySelectorAll('#sideMenu .hq-nav-group')) {
    if (other !== group && other.open) other.open = false
  }
}, true)

document.addEventListener('focusin', e => {
  const sideMenu = document.getElementById('sideMenu')
  if (!sideMenu || sideMenu.classList.contains('-translate-x-full')) return
  if (!sideMenu.contains(e.target) && !e.target.closest('#menuToggle')) setSidebarOpen(false)
})

prepareSidebar()
document.addEventListener('header:ready', prepareSidebar)
if (document.body) {
  new MutationObserver(records => {
    if (records.some(record => record.target.id === 'sideMenu' || [...record.addedNodes].some(node =>
      node.nodeType === 1 && (node.id === 'sideMenu' || node.id === 'menuToggle' || node.querySelector?.('.hq-nav, #menuToggle'))
    ))) prepareSidebar()
  }).observe(document.body, {childList:true, subtree:true})
} else document.addEventListener('DOMContentLoaded', prepareSidebar, {once:true})


/*************************************************
 * THEME TOGGLE (INJECTED-SAFE)
 *************************************************/
document.addEventListener('click', e => {
  if (e.target.id !== 'themeToggle') return

  document.documentElement.classList.toggle('dark')

  localStorage.setItem(
    'theme',
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
})

// restore theme on load (DEFAULT = LIGHT)
const savedTheme = localStorage.getItem('theme')

if (savedTheme === 'dark') {
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.remove('dark')
}





/*************************************************
 * AVATAR DROPDOWN BEHAVIOR
 *************************************************/
document.addEventListener('click', e => {
  const avatarBtn = e.target.closest('#avatarBtn')
  const menu = document.getElementById('avatarMenu')

  // Toggle menu on avatar click
  if (avatarBtn && menu) {
    menu.classList.toggle('hidden')
    e.stopPropagation()
    return
  }

  // Logout click
  if (e.target.id === 'logoutBtn') {
    supabaseClient.auth.signOut().then(() => location.reload())
    return
  }

  // Click outside closes menu
  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden')
  }
})

/*************************************************
 * CLAUDE-STYLE WELCOME MESSAGE (SAFE VERSION)
 *************************************************/

function getFirstNameFromSession(session) {
  const fullName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    ''
  return fullName.split(' ')[0] || null
}

function getTimeGreeting() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 21) return 'Good evening'
  return 'Welcome back'
}

function getClaudeLine() {
  const lines = [
    'Hope your day’s going smoothly',
    'Let’s get you set up',
    'Ready when you are',
    'Let’s pick up where you left off'
  ]
  return lines[Math.floor(Math.random() * lines.length)]
}

async function injectWelcomeMessageOnce() {
  const el = document.getElementById('welcomeMessage')
  if (!el) return

  const { data } = await supabaseClient.auth.getSession()
  const session = data.session

  if (!session) {
    el.textContent = 'Find answers, share notes, and keep everything in one place.'
    return
  }
  

  const name = getFirstNameFromSession(session)
  const greeting = getTimeGreeting()
  const line = getClaudeLine()

  el.textContent = name
    ? `${greeting}, ${name}. ${line}.`
    : `${greeting}. ${line}.`
}

/* Run ONLY when DOM + header are ready */
document.addEventListener('header:ready', injectWelcomeMessageOnce)
window.addEventListener('load', injectWelcomeMessageOnce)




/*************************************************
 * STRICT CLIENT-SIDE KB SEARCH
 *************************************************/

let SEARCH_INDEX = []
let SEARCH_READY = false
let DEBOUNCE_TIMER = null
let SEARCH_GENERATION = 0
let SEARCH_FLIGHT = null

/* -----------------------------
   LOAD INDEX
----------------------------- */

async function loadSearchIndex() {
  if (SEARCH_READY) return
  if (SEARCH_FLIGHT) return SEARCH_FLIGHT
  const generation = SEARCH_GENERATION
  const pending = (async () => {
    try {
      await loadHqSecurityAssets()
      const rows = await window.PawsKnowledgeBase.loadSearchIndex()
      if (generation !== SEARCH_GENERATION) return
      SEARCH_INDEX = rows.map(row => ({url: row.path, title: row.title, content: row.search_text}))
      SEARCH_READY = true
    } catch (err) {
      if (generation === SEARCH_GENERATION) {
        SEARCH_INDEX = []
        SEARCH_READY = false
      }
      console.warn('Knowledgebase search could not load', err)
    }
  })().finally(() => { if (SEARCH_FLIGHT === pending) SEARCH_FLIGHT = null })
  SEARCH_FLIGHT = pending
  return pending
}

/* -----------------------------
   MATCHING + SCORING
----------------------------- */

function matchesAllWords(text, words) {
  return words.every(w => text.includes(w))
}

function scoreItem(item, query, words) {
  let score = 0

  const title = item.title.toLowerCase()
  const content = item.content.toLowerCase()
  const fullText = `${title} ${content}`

  // hard gate
  if (!fullText.includes(query) && !matchesAllWords(fullText, words)) {
    return 0
  }

  // phrase boost
  if (title.includes(query)) score += 100
  if (content.includes(query)) score += 60

  // word boosts
  for (const w of words) {
    if (title.includes(w)) score += 25
    else if (content.includes(w)) score += 10
  }

  return score
}

function searchKB(query) {
  if (!query || query.length < 2) return []

  const q = query.toLowerCase().trim()
  const words = q.split(/\s+/)

  return SEARCH_INDEX
    .map(item => ({
      ...item,
      _score: scoreItem(item, q, words)
    }))
    .filter(item => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 20)
}

/* -----------------------------
   HIGHLIGHTING
----------------------------- */

function highlight(text, words) {
  let out = String(text).replace(/[&<>"\']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]))

  words.forEach(w => {
    if (w.length < 3) return
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    out = out.replace(
      regex,
      `<span class="font-semibold bg-blue-200/50 dark:bg-blue-500/25 rounded px-1">$1</span>`
    )
  })

  return out
}

/* -----------------------------
   RENDER
----------------------------- */

function renderResults(results, query) {
  const container = document.getElementById('searchResults')
  if (!container) return

  container.innerHTML = ''

  if (!results.length) {
    container.innerHTML = `
      <div class="px-6 py-4 text-sm opacity-60">
        No results found
      </div>
    `
    container.classList.remove('hidden')
    return
  }

  const words = query.toLowerCase().split(/\s+/)

  results.forEach((r, idx) => {
    const el = document.createElement('a')
    el.href = r.url
    el.className = `
      block px-6 py-4
      hover:bg-black/5 dark:hover:bg-white/10
      transition
      ${idx !== results.length - 1 ? 'border-b border-black/5 dark:border-white/10' : ''}
    `

    el.innerHTML = `
      <p class="font-medium mb-1">
        ${highlight(r.title, words)}
      </p>
      <p class="text-sm opacity-60 line-clamp-2">
        ${highlight(r.content.slice(0, 160), words)}…
      </p>
    `
    container.appendChild(el)
  })

  container.classList.remove('hidden')
}

/* -----------------------------
   INIT
----------------------------- */

async function initSearch() {
  const input = document.getElementById('searchInput')
  const results = document.getElementById('searchResults')
  if (!input || !results) return

  await loadSearchIndex()

  input.addEventListener('input', e => {
    clearTimeout(DEBOUNCE_TIMER)

    const query = e.target.value.trim()
    if (query.length < 2) {
      results.classList.add('hidden')
      return
    }

    DEBOUNCE_TIMER = setTimeout(async () => {
      await loadSearchIndex()
      if (input.value.trim() === query && SEARCH_READY) renderResults(searchKB(query), query)
    }, 120)
  })
}

document.addEventListener('DOMContentLoaded', initSearch)

/* close on outside click */
document.addEventListener('click', e => {
  if (!e.target.closest('#searchInput') &&
      !e.target.closest('#searchResults')) {
    document.getElementById('searchResults')?.classList.add('hidden')
  }
})

// Shared security code reuses this exact Supabase client and loads before navigation.
const HQ_ASSET_VERSION = '20261025b'
let hqSecurityAssets = null

function loadHqSharedScript(path, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName])
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${path}?v=${HQ_ASSET_VERSION}`
    script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error('Paws HQ feature did not initialize'))
    script.onerror = () => { script.remove(); reject(new Error('Paws HQ feature could not load')) }
    document.body.append(script)
  })
}

function loadHqSharedStyle(path) {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.getAttribute('href') === `${path}?v=${HQ_ASSET_VERSION}`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `${path}?v=${HQ_ASSET_VERSION}`
  document.head.append(link)
}

function loadHqSecurityAssets() {
  if (hqSecurityAssets) return hqSecurityAssets
  loadHqSharedStyle('/assets/hq-access.css')
  loadHqSharedStyle('/assets/knowledge-base.css')
  hqSecurityAssets = loadHqSharedScript('/assets/hq-access.js', 'PawsHqAccess')
    .then(() => loadHqSharedScript('/assets/knowledge-base.js', 'PawsKnowledgeBase'))
    .catch(error => { hqSecurityAssets = null; throw error })
  return hqSecurityAssets
}

async function ensureHqWorkspaceAccess(session) {
  await loadHqSecurityAssets()
  if (!hqWorkspaceMembership) hqWorkspaceMembership = window.PawsHqAccess.createMembershipManager({client: supabaseClient})
  const checked = await hqWorkspaceMembership.ensure(session)
  if (!checked.allowed) {
    const error = new Error(checked.confirmed ? 'This account is not an active Paws Slack workspace member.' : 'Workspace access could not be checked. Please try again.')
    error.code = checked.confirmed ? 'ACCESS' : 'UNAVAILABLE'
    error.access = checked
    throw error
  }
  return checked
}

async function ensureHqAccessController() {
  await loadHqSecurityAssets()
  if (!hqAccessController) {
    if (!hqWorkspaceMembership) hqWorkspaceMembership = window.PawsHqAccess.createMembershipManager({client: supabaseClient})
    hqAccessController = window.PawsHqAccess.createController({client: supabaseClient, membershipManager: hqWorkspaceMembership, onChange: receiveHqAccess})
    hqAccessNotice = window.PawsHqAccess.createNotice({controller: hqAccessController})
    hqAccessController.start()
  }
  prepareHqNavigation()
  return hqAccessController
}

let hqNavigationScript = null
let hqActivityScript = null
function prepareHqActivityLogging() {
  if (!HQ_ACTIVITY_SIGN_IN_RETURN || hqActivityScript) return
  hqActivityScript = loadHqSharedScript('/assets/activity-logger.js', 'PawsActivityLogger')
    .then(api => api.start({client: supabaseClient, ensureAccess: ensureHqWorkspaceAccess, win: window, doc: document, signIn: HQ_ACTIVITY_SIGN_IN_RETURN}))
    .catch(() => { hqActivityScript = null })
}

function prepareHqNavigation() {
  if (hqNavigationScript) return
  hqNavigationScript = document.createElement('script')
  hqNavigationScript.src = `/assets/paws-navigation.js?v=${HQ_ASSET_VERSION}`
  hqNavigationScript.onerror = () => { hqNavigationScript.remove(); hqNavigationScript = null }
  document.body.append(hqNavigationScript)
}

window.addEventListener('paws-knowledge-access-denied', () => {
  clearPrivateKnowledgeSearch()
  if (hqAccessController) void hqAccessController.check()
})

// Shared taskbar navigation, after existing auth and page initialization.
if (sidebarPath(window.location.href) !== '/login') {
  loadHqSharedStyle('/assets/paws-navigation.css')
  const loadNavigation = async () => {
    const transitionScript = document.createElement('script')
    transitionScript.src = `/assets/page-transition.js?v=${HQ_ASSET_VERSION}`
    document.body.append(transitionScript)
    try {
      await ensureHqAccessController()
    } catch (error) {
      console.warn('Paws HQ navigation could not initialize', error)
      accessConnectionPanel(true, true)
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadNavigation, {once:true})
  else void loadNavigation()
}
