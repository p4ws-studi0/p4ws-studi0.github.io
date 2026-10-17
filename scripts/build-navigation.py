#!/usr/bin/env python3
"""Build navigation metadata from existing public links and KB prose."""
from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import re
import json

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

CATEGORIES = [
    {'id': 'front-desk', 'title': 'Front Desk'},
    {'id': 'pet-care', 'title': 'Pet Care & Training'},
    {'id': 'outreach', 'title': 'Marketing & Outreach'},
    {'id': 'office', 'title': 'Office & Team'},
    {'id': 'knowledge-base', 'title': 'Knowledge Base'},
]

ICON_KEYS = {
    'home': 'home', 'kb': 'book', 'settings': 'settings',
    'digital-whiteboard': 'dashboard', 'occupied-runs': 'building', 'tours': 'calendar',
    'follow-up-calls': 'phone', 'grooming-price-list': 'scissors', 'boarding-base-rates': 'tag',
    'training': 'training', 'potential-training-clients': 'users', 'dog-licenses': 'badge',
    'k9-cough': 'health', 'vet-cheat-sheet': 'medical', 'marketing-initiatives': 'megaphone',
    'biscuit-baskets': 'gift', 'realtor-info': 'building', 'end-of-day': 'clipboard',
    'gift-cards': 'gift', 'suggestions': 'bulb',
}

DIRECT_ONLY_PAGES = {'/digital-whiteboard'}

QUICK_ACCESS_SECTIONS = {
    'runCardsMenu': 'Run Cards', 'printablesMenu': 'Printables',
    'priceSheetsMenu': 'Price Sheets', 'infoSheetsMenu': 'Info Sheets',
}

QUICK_ACCESS_ACTIONS = {
    'today': '/#quick-access-run-cards-today',
    'tomorrow': '/#quick-access-run-cards-tomorrow',
}

QUICK_ACCESS_ALIASES = {
    'Tip Log': ['tips', 'tip sheet', 'gratuities', 'printable tip log'],
    'Laundry Log': ['laundry', 'washing', 'laundry sheet'],
    'Tour Questionarre': ['tour questionnaire', 'tour questions', 'tour form'],
    'Special Instructions Sheet': ['special instructions', 'care instructions', 'special care form'],
    'Daily Grooming Checklist': ['daily grooming checklist', 'groomer checklist', 'bath checklist'],
    'First Day Sheet': ['first day', 'first visit', 'new dog form', 'daycare first day'],
    'Dog Suite List': ['dog suites', 'suite list', 'lodging rooms'],
    'Grooming Notes for Customer': ['grooming notes', 'groomer notes', 'customer grooming handout'],
    'Confirmation Call Checklist': ['confirmation calls', 'reservation phone calls', 'call checklist'],
    'SOP Document': ['sop', 'standard operating procedures', 'procedures document'],
    'Incident Policy': ['incident policy', 'accident policy', 'incident response'],
    'Employment Application Form': ['job application', 'employment form', 'hiring', 'apply for job'],
    'Room Screws Tracking Sheet': ['room screws', 'kennel screws', 'maintenance tracking'],
    'Employee Handbook': ['employee handbook', 'staff handbook', 'team handbook'],
    'Dog Boarding': ['dog boarding prices', 'boarding price sheet', 'kennel rates'],
    'Doggie Daycare': ['daycare prices', 'doggie daycare cost', 'day care rates'],
    'Dog Activities': ['activities prices', 'playtime cost', 'dog activities menu'],
    'Cat Boarding': ['cat boarding prices', 'cat rates', 'cat hotel cost'],
    'Puppy': ['puppy prices', 'puppy rates', 'puppy menu'],
    'Fecal Parasite Guide': ['fecal parasites', 'poop parasites', 'worms', 'parasite guide'],
    'OPG Fecal Processing Guide': ['opg', 'fecal processing', 'poop sample', 'stool sample'],
    'Dog Space Requirements': ['dog space requirements', 'kennel sizes', 'room sizes', 'space guide'],
    '2027 Peak Calendar': ['2027 peak calendar', '2027 holiday dates', 'peak dates'],
    'Career Advancement Chart': ['career chart', 'career advancement', 'career progression', 'employee levels', 'promotions', 'career ladder'],
}

def is_quick_access_resource(href: str) -> bool:
    url = urlsplit(href)
    if url.scheme != 'https' or url.username or url.password:
        return False
    if url.netloc == 'drive.google.com':
        return bool(re.fullmatch(r'/file/d/[A-Za-z0-9_-]+/view/?', url.path))
    if url.netloc == 'docs.google.com':
        return bool(re.fullmatch(r'/(?:document|spreadsheets)/d/[A-Za-z0-9_-]+/edit/?', url.path))
    return False

def clean_page_href(href: str) -> str:
    """Use GitHub Pages' native HTML aliases, retaining directory slashes."""
    url = urlsplit(href)
    if url.scheme or url.netloc:
        return href
    path = url.path
    if path.endswith('/index.html'):
        path = path.removesuffix('index.html')
    else:
        path = path.removesuffix('.html')
    return urlunsplit(url._replace(path=path))

def page_source(repo: Path, href: str) -> Path:
    """Resolve public clean routes to the existing source HTML files."""
    path = urlsplit(href).path
    if path.endswith('/'):
        return repo / path.lstrip('/') / 'index.html'
    candidate = repo / path.lstrip('/')
    return candidate if path.endswith('.html') else Path(str(candidate) + '.html')

def slug_for(href: str) -> str:
    path = urlsplit(clean_page_href(href)).path
    if path == '/':
        return 'home'
    if path == '/kb/':
        return 'kb'
    # Keep existing category IDs stable after changing their public URLs.
    if path.endswith('/'):
        path += 'index.html'
    return re.sub(r'[^a-z0-9]+', '-', path.removesuffix('.html').strip('/').lower()).strip('-')

class SidebarParser(HTMLParser):
    """Read links with native details/summary hierarchy, without relying on CSS."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.details = []
        self.summary_text = None
        self.link = None
        self.icon_depth = 0
        self.apps = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'details':
            self.details.append({'label': '', 'group': attrs.get('data-nav-group')})
        elif tag == 'summary':
            self.summary_text = []
        elif tag == 'a':
            href = attrs.get('href', '')
            if href.startswith('/') and not href.startswith('//'):
                self.link = {'href': href, 'text': [], 'context': [dict(d) for d in self.details]}
        if self.icon_depth:
            self.icon_depth += 1
        elif tag == 'span' and 'hq-nav-icon' in attrs.get('class', '').split():
            self.icon_depth = 1

    def handle_endtag(self, tag):
        if self.icon_depth:
            self.icon_depth -= 1
        if tag == 'summary' and self.summary_text is not None:
            if self.details:
                self.details[-1]['label'] = ' '.join(''.join(self.summary_text).split())
            self.summary_text = None
        elif tag == 'details':
            if self.details:
                self.details.pop()
        elif tag == 'a' and self.link is not None:
            href = clean_page_href(self.link['href'])
            title = ' '.join(''.join(self.link['text']).split())
            context = self.link['context']
            category = context[0]['label'] if context else 'Paws HQ'
            section = context[-1]['label'] if len(context) > 1 else None
            if title == 'View all' and section:
                title = section
            if href == '/kb/':
                title = 'Knowledge Base'
                category = 'Knowledge Base'
            app_id = slug_for(href)
            app = {'id': app_id, 'href': href, 'title': title, 'category': category,
                   'kind': 'article' if href.startswith('/kb/') and not urlsplit(href).path.endswith('/') else 'page',
                   'iconKey': ICON_KEYS.get(app_id, 'book' if href.startswith('/kb/') else 'app')}
            if section:
                app['section'] = section
            self.apps.append(app)
            self.link = None

    def handle_data(self, data):
        if self.icon_depth:
            return
        if self.summary_text is not None:
            self.summary_text.append(data)
        if self.link is not None:
            self.link['text'].append(data)

class QuickAccessParser(HTMLParser):
    """Inventory the existing dropdown resources without requesting them."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.current = None
        self.entries = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        section = self.stack[-1]['section'] if self.stack else None
        section = QUICK_ACCESS_SECTIONS.get(attrs.get('id'), section)
        if tag not in VOID:
            self.stack.append({'tag': tag, 'section': section})
        if tag == 'a' and section and section != 'Run Cards':
            href = attrs.get('href', '')
            if is_quick_access_resource(href):
                self.current = {'tag': tag, 'section': section, 'href': href, 'text': []}
        elif tag == 'button' and section == 'Run Cards' and attrs.get('data-start') in QUICK_ACCESS_ACTIONS:
            self.current = {'tag': tag, 'section': section, 'start': attrs['data-start'], 'text': []}

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.current and self.current['tag'] == tag:
            item = self.current
            title = ' '.join(' '.join(item['text']).split())
            section = item['section']
            if 'start' in item:
                start = item['start']
                entry = {'id': f'quick-access-run-cards-{start}', 'href': QUICK_ACCESS_ACTIONS[start],
                         'title': f'Run Cards {title}', 'kind': 'action', 'iconKey': 'clipboard',
                         'aliases': ['run cards', f'run cards {start}', f'{start} room cards', f'{start} kennel cards', f'{start} run sheets']}
            else:
                slug = re.sub(r'[^a-z0-9]+', '-', f'{section}-{title}'.lower()).strip('-')
                entry = {'id': f'quick-access-{slug}', 'href': item['href'], 'title': title,
                         'kind': 'resource', 'iconKey': {'Printables': 'print', 'Price Sheets': 'tag', 'Info Sheets': 'book'}[section],
                         'aliases': QUICK_ACCESS_ALIASES.get(title, [])}
            entry.update({'category': 'Quick Access', 'section': section, 'quickAccess': True})
            entry['aliases'] = list(dict.fromkeys(entry['aliases'] + [section.lower(), 'quick access']))
            self.entries.append(entry)
            self.current = None
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]['tag'] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        if self.current:
            self.current['text'].append(data)

def quick_access_from(repo: Path) -> list[dict]:
    parser = QuickAccessParser()
    parser.feed((repo / 'index.html').read_text())
    return parser.entries

class ArticleSearchText(HTMLParser):
    """Read only visible article prose, with main/body fallback for older pages."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.text = {'article': [], 'main': [], 'body': []}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        parent = self.stack[-1] if self.stack else {'ignore': False, 'scope': None}
        ignore = parent['ignore'] or tag in {'script', 'style', 'nav', 'header', 'footer', 'aside', 'template', 'noscript'}
        ignore = ignore or attrs.get('id') in {'header', 'sideMenu', 'footer'}
        ignore = ignore or 'hidden' in attrs or attrs.get('aria-hidden') == 'true'
        scope = tag if tag in self.text else parent['scope']
        if tag == 'img' and not ignore and scope and attrs.get('alt'):
            self.text[scope].append(attrs['alt'])
        if tag not in VOID:
            self.stack.append({'tag': tag, 'ignore': ignore, 'scope': scope})

    def handle_startendtag(self, tag, attrs):
        if tag not in VOID:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]['tag'] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        if self.stack and not self.stack[-1]['ignore']:
            scope = self.stack[-1]['scope']
            if scope:
                self.text[scope].append(data)

    def result(self):
        for scope in ['article', 'main', 'body']:
            text = ' '.join(' '.join(self.text[scope]).split())
            if text:
                return text[:20000]
        return ''

def aliases_for(app: dict) -> list[str]:
    """Everyday search language mapped to actual page destinations only."""
    route_aliases = {
        'home': ['homepage', 'dashboard', 'start'],
        'kb': ['help', 'instructions', 'how to', 'procedures', 'policies', 'manual'],
        'settings': ['preferences', 'appearance', 'theme', 'dark mode', 'light mode'],
        'occupied-runs': ['occupied rooms', 'kennels', 'run cards', 'room cards', 'boarding rooms'],
        'tours': ['tour schedule', 'visits', 'facility tour', 'tour appointments'],
        'follow-up-calls': ['client calls', 'phone calls', 'new customer follow up', 'new client follow up'],
        'grooming-price-list': ['grooming prices', 'grooming cost', 'haircut prices', 'bath prices', 'groomer prices'],
        'boarding-base-rates': ['boarding prices', 'boarding cost', 'kennel cost', 'breed prices', 'overnight prices'],
        'training': ['training log', 'training sessions', 'dog lessons', 'training notes'],
        'potential-training-clients': ['training leads', 'prospective training clients', 'training inquiries', 'interested in training'],
        'dog-licenses': ['dog licence', 'dog license', 'dog licenses', 'dog licences', 'dog tags', 'license tracking'],
        'k9-cough': ['kennel cough', 'sick dogs', 'cough', 'canine cough', 'illness tracking'],
        'vet-cheat-sheet': ['veterinarian', 'veterinary contacts', 'vet phone numbers', 'animal hospital'],
        'marketing-initiatives': ['advertising', 'promotions', 'marketing projects', 'outreach ideas'],
        'biscuit-baskets': ['biscuit delivery', 'basket visits', 'business visits', 'biscuit outreach'],
        'realtor-info': ['real estate agents', 'realtors', 'realtor contacts'],
        'end-of-day': ['end of day', 'eod', 'closing sheet', 'cash sheet', 'cash', 'cash drawer', 'drawer', 'deposit', 'closing', 'daily cash count'],
        'gift-cards': ['gift card', 'gift certificate', 'certificate number', 'gift balance', 'redeem gift card'],
        'suggestions': ['suggestion box', 'ideas', 'feedback', 'improvements'],
    }
    aliases = list(route_aliases.get(app['id'], []))
    if app['kind'] == 'article' and app['href'].startswith('/kb/'):
        title = app['title'].lower()
        rules = [
            (r'medic|\bmeds?\b|insulin|\bpills?\b', ['medicine', 'meds', 'pills', 'giving medication']),
            (r'feed|food|meal', ['food', 'meals', 'feeding', 'breakfast', 'dinner']),
            (r'groom|bath', ['grooming', 'bathing', 'bath', 'haircut']),
            (r'cough|respiratory', ['kennel cough', 'cough', 'sick dog']),
            (r'vaccin', ['vaccines', 'shots', 'vaccinations']),
            (r'check.?in|checking in|arrival', ['check in', 'checking in', 'arrivals', 'drop off']),
            (r'check.?out|checking out|departure', ['check out', 'checking out', 'departures', 'pick up']),
            (r'group play|playtime|play session', ['play group', 'playtime', 'dog play', 'group activities']),
            (r'clean|saniti|disinfect', ['cleaning', 'sanitizing', 'disinfecting']),
            (r'vomit', ['throwing up', 'vomiting', 'sick dog']),
            (r'diarrhea|diarrhoea', ['loose stool', 'diarrhea', 'upset stomach']),
            (r'stool', ['poop', 'stool', 'bowel movements']),
            (r'emergency|first aid', ['emergency', 'first aid', 'urgent help']),
            (r'phone|telephone', ['phone', 'calling', 'telephone']),
            (r'boarding', ['overnight stay', 'boarding']),
            (r'daycare', ['day care', 'daycare']),
            (r'peak rate|calendar', ['calendar', 'peak dates', 'holiday dates']),
            (r'lodging area map', ['floor plan', 'building map', 'room locations', 'kennel map']),
        ]
        for pattern, words in rules:
            if re.search(pattern, title):
                aliases.extend(words)
    return list(dict.fromkeys(aliases))

def manifest_from(repo: Path) -> dict:
    parser = SidebarParser()
    parser.feed((repo / 'partials/sidebar.html').read_text())
    seen = set()
    apps = []
    for app in parser.apps:
        path = urlsplit(app['href']).path
        if path in DIRECT_ONLY_PAGES:
            continue
        candidate = page_source(repo, app['href'])
        if candidate.is_file() and app['href'] not in seen:
            seen.add(app['href'])
            app['aliases'] = aliases_for(app)
            if app['kind'] == 'article' and path.startswith('/kb/'):
                text = ArticleSearchText()
                text.feed(candidate.read_text())
                app['searchText'] = text.result()
            apps.append(app)
    for app in quick_access_from(repo):
        if app['href'] not in seen:
            seen.add(app['href'])
            apps.append(app)
    return {'apps': apps, 'categories': CATEGORIES, 'source': 'partials/sidebar.html',
            'sources': ['partials/sidebar.html', 'index.html#quickAccessControls'],
            'mode': 'local-preview', 'pinned': ['home', 'tours', 'occupied-runs', 'end-of-day', 'kb']}

if __name__ == '__main__':
    repo = Path(__file__).resolve().parents[1]
    manifest = manifest_from(repo)
    manifest['mode'] = 'production'
    (repo / 'assets/navigation.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f"Built {len(manifest['apps'])} navigation destinations")
