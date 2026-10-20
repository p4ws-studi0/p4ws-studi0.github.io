#!/usr/bin/env python3
"""Export the KB to a PRIVATE directory; never edits or deploys the website.

Example: python3 scripts/prepare-private-kb.py --output /absolute/private/kb-export
The export includes confidential content. Do not commit or publish its output.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import re
import shutil
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit

VOID = {'br', 'hr', 'img', 'col'}
TAGS = set('h1 h2 h3 h4 h5 h6 p span strong em b i u s strike a li ul ol br hr table tbody thead tfoot tr td th col colgroup section div font blockquote label samp big small code pre sup sub dl dt dd img details summary'.split())
DROP_CONTENT = {'script', 'style', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript'}
ATTRS = set('class id title lang dir width height rowspan colspan start type align valign scope face color size alt'.split())
STYLE_PROPERTIES = set('font-size font-family font-style font-weight line-height letter-spacing text-align text-decoration text-indent color background-color vertical-align list-style-position list-style-image list-style-type margin margin-left margin-right margin-top margin-bottom padding padding-left padding-right padding-top padding-bottom border border-style border-width border-color border-radius outline box-sizing width min-width max-width height min-height max-height display opacity float clear left top cursor white-space word-break overflow-wrap'.split())
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico'}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def clean_path(value: str) -> str:
    path = unquote(urlsplit(value).path)
    if not path.startswith('/') or '\\' in path or '\x00' in path or any(part in {'.', '..'} for part in path.split('/')):
        raise ValueError(f'Invalid KB route: {value!r}')
    if path.endswith('/index.html'):
        return path[:-10]
    return path[:-5] if path.endswith('.html') else path


def public_url(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit(parsed._replace(path=quote(unquote(parsed.path), safe='/@:+,;=-._~')))


def safe_style(value: str) -> str:
    # The old imported pages use formatting only. Never retain CSS requests,
    # executable expressions, custom properties, or positioning declarations.
    if re.search(r'url\s*\(|(?:-webkit-)?image-set\s*\(|expression\s*\(|@import|javascript|behavior|binding|[\\<>]', value, re.I):
        return ''
    result = []
    for declaration in value.split(';'):
        key, separator, val = declaration.partition(':')
        key, val = key.strip().lower(), val.strip()
        if separator and key in STYLE_PROPERTIES and val and not re.search(r'[{}]', val):
            result.append(f'{key}: {val}')
    return '; '.join(result)


def safe_href(value: str, source_url: str) -> str | None:
    if re.search(r'[\x00-\x20]', value.strip()):
        # Spaces in source filenames are ordinary URL path characters.
        value = value.strip()
        if re.search(r'[\x00-\x1f]', value):
            return None
    target = urlsplit(urljoin(source_url, value))
    if target.scheme not in {'https', 'http', 'mailto', 'tel'}:
        return None
    if target.username or target.password:
        return None
    if target.scheme in {'mailto', 'tel'}:
        return value
    if target.netloc == 'hq.pawspet.com':
        route = clean_path(target.path)
        return public_url(urlunsplit(('', '', route, target.query, target.fragment)))
    return public_url(target.geturl())


class ArticleSanitizer(HTMLParser):
    def __init__(self, repo: Path, source: Path, media: dict, external: set, missing: set):
        super().__init__(convert_charrefs=False)
        self.repo, self.source, self.media, self.external, self.missing = repo, source, media, external, missing
        self.source_url = 'https://hq.pawspet.com/' + source.relative_to(repo).as_posix()
        self.output, self.text, self.dropped = [], [], []

    def image_attributes(self, attrs: dict) -> dict:
        result = {}
        src = attrs.get('src', '')
        target = urlsplit(urljoin(self.source_url, src))
        if target.scheme != 'https' or target.username or target.password:
            return result
        if target.netloc == 'hq.pawspet.com':
            relative = unquote(target.path).lstrip('/')
            original = (self.repo / relative).resolve()
            if not original.is_relative_to(self.repo):
                raise ValueError(f'Missing or unsafe KB image in {self.source}: {src}')
            if not original.is_file():
                if self.source.relative_to(self.repo).parts[0] == 'kb':
                    raise ValueError(f'Missing active KB image in {self.source}: {src}')
                self.missing.add((self.source.relative_to(self.repo).as_posix(), target.path))
                return result
            extension = original.suffix.lower()
            if extension not in IMAGE_EXTENSIONS:
                raise ValueError(f'Unsupported KB image type: {relative}')
            data = original.read_bytes()
            checksum = digest(data)
            storage_path = f'{checksum}{extension}'
            self.media[relative] = {'source_file': relative, 'storage_path': storage_path,
                                    'sha256': checksum, 'bytes': len(data),
                                    'content_type': mimetypes.guess_type(original.name)[0] or 'application/octet-stream'}
            result['data-knowledge-image'] = storage_path
        else:
            # Original third-party image embedding is retained, not downloaded.
            result['src'] = target.geturl()
            result['referrerpolicy'] = 'no-referrer'
            self.external.add(target.geturl())
        return result

    def handle_starttag(self, tag: str, attr_list: list):
        if self.dropped:
            if tag in DROP_CONTENT:
                self.dropped.append(tag)
            return
        if tag in DROP_CONTENT:
            self.dropped.append(tag)
            return
        if tag not in TAGS:
            return
        original = dict(attr_list)
        attrs = {k: v for k, v in original.items() if k in ATTRS and v is not None}
        if original.get('style'):
            style = safe_style(original['style'])
            if style:
                attrs['style'] = style
        if tag == 'a':
            href = safe_href(original.get('href', ''), self.source_url)
            if href:
                attrs['href'] = href
            if original.get('target') == '_blank':
                attrs.update(target='_blank', rel='noopener noreferrer')
        elif tag == 'img':
            attrs.update(self.image_attributes(original))
            if not attrs.get('src') and not attrs.get('data-knowledge-image'):
                return
            if attrs.get('alt'):
                self.text.append(attrs['alt'])
        rendered = ''.join(f' {key}="{html.escape(value, quote=True)}"' for key, value in attrs.items())
        self.output.append(f'<{tag}{rendered}>')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.dropped:
            if tag == self.dropped[-1]:
                self.dropped.pop()
            return
        if tag in TAGS and tag not in VOID:
            self.output.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.dropped:
            self.output.append(html.escape(data, quote=False))
            self.text.append(data)

    def handle_entityref(self, name):
        if not self.dropped:
            self.output.append(f'&{name};')
            self.text.append(html.unescape(f'&{name};'))

    def handle_charref(self, name):
        if not self.dropped:
            self.output.append(f'&#{name};')
            self.text.append(html.unescape(f'&#{name};'))


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def prepare(repo: Path, output: Path) -> dict:
    repo, output = repo.resolve(), output.resolve()
    if output == repo or output.is_relative_to(repo):
        raise ValueError('The export contains confidential content and must be OUTSIDE the website repository.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use a new or empty private output directory; existing exports are never overwritten.')
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o700)
    media, external, missing, pages, plan = {}, set(), set(), [], []
    for folder in ['kb', 'kb copy', 'not_in_use 10.39.45 PM']:
        for source in sorted((repo / folder).rglob('*.html')):
            raw = source.read_text(encoding='utf-8')
            matches = list(re.finditer(r'<article\b[^>]*>([\s\S]*?)</article\s*>', raw, re.I))
            if len(matches) != 1:
                raise ValueError(f'Expected exactly one article block: {source}')
            route = clean_path('/' + source.relative_to(repo).as_posix())
            sanitizer = ArticleSanitizer(repo, source, media, external, missing)
            sanitizer.feed(matches[0].group(1))
            sanitizer.close()
            content = ''.join(sanitizer.output)
            title_match = re.search(r'<title\b[^>]*>(.*?)</title\s*>', raw, re.I | re.S)
            title = html.unescape(re.sub(r'\s+', ' ', title_match.group(1)).strip()) if title_match else source.stem
            title = re.sub(r'\s*-\s*Paws Help Site\s*$', '', title).replace('_', ' ').strip()
            relative = source.relative_to(repo).as_posix()
            page = {'path': route, 'title': title, 'category': source.parent.name.strip() if source.parent != repo / folder else 'Knowledge Base',
                    'html_content': content, 'search_text': ' '.join(' '.join(sanitizer.text).split()),
                    'source_sha256': digest(raw.encode()), 'content_sha256': digest(content.encode()),
                    'is_archive': folder != 'kb', 'page_kind': 'index' if source.name == 'index.html' else 'article'}
            pages.append(page)
            shell = '<article class="prose dark:prose-invert max-w-none paws-knowledge-page" data-knowledge-page="' + html.escape(route, quote=True) + '"><p role="status">Loading knowledgebase…</p></article>'
            plan.append({'file': relative, 'path': route, 'source_sha256': page['source_sha256'],
                         'article_replacement': shell, 'content_sha256': page['content_sha256']})
            backup = output / 'source' / relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_text(raw, encoding='utf-8')
    if len({page['path'] for page in pages}) != len(pages):
        raise ValueError('Canonical KB path collision: no public shells were changed.')
    # Preserve the old screenshots and variants as private objects too. Leaving
    # an unreferenced screenshot under the public directory would still leak it.
    for original in sorted((repo / 'images/qu').rglob('*')):
        if not original.is_file() or original.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        relative = original.relative_to(repo).as_posix()
        if relative not in media:
            data = original.read_bytes()
            checksum = digest(data)
            media[relative] = {'source_file': relative, 'storage_path': f'{checksum}{original.suffix.lower()}',
                               'sha256': checksum, 'bytes': len(data), 'content_type': mimetypes.guess_type(original.name)[0] or 'application/octet-stream'}
    for entry in media.values():
        destination = output / 'media' / entry['storage_path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copyfile(repo / entry['source_file'], destination)
    (output / 'knowledge-pages.json').write_text(json.dumps(pages, ensure_ascii=False, indent=2) + '\n')
    (output / 'knowledge-media.json').write_text(json.dumps({'bucket': 'hq-knowledge-media', 'public': False, 'objects': list(media.values())}, indent=2) + '\n')
    (output / 'knowledge-shell-plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
    columns = list(pages[0])
    with (output / 'knowledge-pages.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows({key: str(value).lower() if isinstance(value, bool) else value for key, value in page.items()} for page in pages)
    statements = ['-- CONFIDENTIAL KB CONTENT: never commit or publish this file.', 'begin;']
    row_statements = []
    for page in pages:
        values = [('true' if page[key] else 'false') if isinstance(page[key], bool) else sql_string(page[key]) for key in columns]
        updates = ', '.join(f'{key}=excluded.{key}' for key in columns if key != 'path')
        statement = f"insert into public.hq_knowledge_pages ({', '.join(columns)}) values ({', '.join(values)}) on conflict (path) do update set {updates}, updated_at=statement_timestamp();"
        statements.append(statement)
        row_statements.append(statement)
    statements.extend(['commit;', ''])
    (output / 'knowledge-pages-seed.sql').write_text('\n'.join(statements), encoding='utf-8')
    chunk_dir = output / 'sql-chunks'
    chunk_dir.mkdir()
    chunk, chunk_size, chunks = [], 0, []
    for statement in row_statements:
        size = len(statement.encode('utf-8')) + 1
        if size > 149000:
            raise ValueError('A single KB record exceeds the SQL-editor chunk size; use the private CSV import.')
        if chunk and chunk_size + size > 149000:
            chunks.append(chunk)
            chunk, chunk_size = [], 0
        chunk.append(statement)
        chunk_size += size
    if chunk:
        chunks.append(chunk)
    for number, chunk in enumerate(chunks, 1):
        (chunk_dir / f'{number:03}.sql').write_text('-- CONFIDENTIAL: never publish.\nbegin;\n' + '\n'.join(chunk) + '\ncommit;\n', encoding='utf-8')
    inventory = {
        'active_pages': sum(not page['is_archive'] for page in pages), 'archive_pages': sum(page['is_archive'] for page in pages),
        'active_article_pages': sum(not page['is_archive'] and page['page_kind'] == 'article' for page in pages),
        'source_files': [entry['file'] for entry in plan], 'local_media_files': sorted(media),
        'all_public_qu_files_to_review': sorted(str(path.relative_to(repo)) for path in (repo / 'images/qu').rglob('*') if path.is_file()),
        'external_image_urls_not_revocable_by_hq': sorted(external),
        'preexisting_missing_archive_images_omitted': [{'source': source, 'image': image} for source, image in sorted(missing)],
        'public_search_files_to_scrub': ['search/index.json', 'assets/navigation.json'],
        'other_public_archive_to_review': 'not_in_use 10.39.45 PM',
        'source_history_warning': 'The GitHub repository and its prior commits are public. Current-file migration cannot revoke copies or protect old commits.',
        'cutover_requirements': ['Apply schema and import private page seed first.', 'Upload every media object into the PRIVATE bucket and verify byte hashes.', 'Check active-staff, inactive-staff, nonstaff, and anonymous RLS access.', 'Apply all shell rewrites and remove public prose/media/search copies in one reviewed deployment.', 'Do not change auth session settings or sign out users.']}
    (output / 'leak-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
    # Restrict all confidential output files, including snapshots, to the owner.
    for path in output.rglob('*'):
        path.chmod(0o700 if path.is_dir() else 0o600)
    return {'active_pages': inventory['active_pages'], 'archive_pages': inventory['archive_pages'],
            'local_media_files': len(media), 'media_objects': len({item['storage_path'] for item in media.values()}),
            'external_images_retained': len(external), 'sql_chunks': len(chunks), 'output': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='An empty PRIVATE directory outside the website repository.')
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.repo, args.output), indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f'KB export stopped: {error}\n')
