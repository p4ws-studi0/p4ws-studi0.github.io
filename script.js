







/*************************************************
 * SUPABASE
 *************************************************/
const supabaseClient = supabase.createClient(
  'https://dppjgglaeieevsfwsbii.supabase.co',
  'sb_publishable_PtLQ22zTKhRlWiAX1lQ1Ew_Z5HHnKYy'
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
  '/settings.html',
  '/kb/',            // if you later add folders
]

function isProtectedPage() {
  return PROTECTED_PATHS.some(path =>
    window.location.pathname.startsWith(path)
  )
}
async function enforceAuthGate() {
  const isLoginPage = window.location.pathname === '/login.html'
  const body = document.body

  // Always show login page immediately
  if (isLoginPage) {
    body.style.opacity = '1'
    body.dataset.auth = 'login'
    return
  }

  const { data } = await supabaseClient.auth.getSession()

  if (!data.session) {
    window.location.replace('/login.html')
    return
  }

  // Logged in → reveal protected page
  body.style.opacity = '1'
  body.dataset.auth = 'ok'
}

window.addEventListener('load', enforceAuthGate)



/*************************************************
 * EVENTS
 *************************************************/

// run once header is injected
document.addEventListener('header:ready', updateHeaderAuthUI)

// react to login/logout
supabaseClient.auth.onAuthStateChange(() => {
  updateHeaderAuthUI()
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
    if (link.getAttribute('href') === '/kb/index.html') label = 'Knowledge Base'
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
    return path.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/'
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

/* -----------------------------
   LOAD INDEX
----------------------------- */

async function loadSearchIndex() {
  if (SEARCH_READY) return

  try {
    const res = await fetch('/search/index.json')
    SEARCH_INDEX = await res.json()
    SEARCH_READY = true
  } catch (err) {
    console.error('Search index failed to load', err)
  }
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
  let out = text

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

    DEBOUNCE_TIMER = setTimeout(() => {
      renderResults(searchKB(query), query)
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

// Shared taskbar navigation, after the existing auth and page initialization.
if (window.location.pathname !== '/login.html') {
  const navigationStyle = document.createElement('link')
  navigationStyle.rel = 'stylesheet'
  navigationStyle.href = '/assets/paws-navigation.css?v=20261017d'
  document.head.append(navigationStyle)
  const loadNavigation = () => {
    const transitionScript = document.createElement('script')
    transitionScript.src = '/assets/page-transition.js?v=20261017d'
    document.body.append(transitionScript)
    const navigationScript = document.createElement('script')
    navigationScript.src = '/assets/paws-navigation.js?v=20261017d'
    document.body.append(navigationScript)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadNavigation, {once:true})
  else loadNavigation()
}
