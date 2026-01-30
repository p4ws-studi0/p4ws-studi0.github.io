







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
    options: {
      redirectTo: 'http://127.0.0.1:5500/auth/callback'
    }
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
  if (headerRight.querySelector('.user-avatar')) return

  const avatarUrl = getSlackAvatar(session)
  if (!avatarUrl) {
    console.warn('No Slack avatar found')
    return
  }

const avatarWrapper = document.getElementById('avatarWrapper')
if (!avatarWrapper) return

if (avatarWrapper.querySelector('.user-avatar')) return

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


  headerRight.appendChild(img)
  console.log('✅ Avatar injected')

  
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
 * SIDEBAR TOGGLE (INJECTED-SAFE)
 *************************************************/
document.addEventListener('click', e => {
  const toggle = e.target.closest('#menuToggle')
  if (!toggle) return

  if (window.innerWidth >= 1024) return

  const sideMenu = document.getElementById('sideMenu')
  if (!sideMenu) return

  sideMenu.classList.toggle('-translate-x-full')
  toggle.classList.toggle('open')
})


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

// restore theme on load
if (localStorage.getItem('theme') === 'light') {
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
document.dispatchEvent(new Event('supabase:ready'))
