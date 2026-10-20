# Private knowledgebase

The knowledgebase uses the same administrator-managed `hq_tour_staff.active`
approval as the shared HQ tables. Authenticated browser clients may SELECT
approved content. They cannot create, edit, or delete knowledgebase records or
media. Anonymous, inactive, and unapproved accounts have no content access.

This migration changes no Auth configuration, session lifetime, inactivity
timeout, refresh-token setting, user account, or existing staff approval. The
browser reuses the single `supabaseClient` declared by `script.js` and never
calls `signOut`, creates a second auth client, or writes session storage.

## Private export and import

Run the exporter with an **empty absolute directory outside the website
repository**:

```sh
python3 scripts/prepare-private-kb.py --output /absolute/private/kb-export
```

The export contains confidential information. Keep it outside Git, website
hosting, and public artifacts. Its directory is owner-only and its files are
mode 0600. The exporter itself makes no website changes and performs no network
requests. It includes:

- All active and archived KB pages, each retaining its distinct clean route.
- Sanitized HTML and search text in JSON, CSV, one SQL seed, and SQL-editor
  chunks smaller than 150 KB. Import **one** format, not all formats.
- Original source snapshots for private recovery.
- The local KB image files, including unreferenced screenshot variants under
  `images/qu`, with SHA-256 object names and MIME metadata.
- A shell rewrite plan and a public-content leak inventory.

Apply `knowledge-base-setup.sql` first. Import the private CSV using an
administrator Table Editor import, or execute the private SQL chunks in order.
Both use `public.hq_knowledge_pages`; `path` is the stable primary key. SQL seeds
are idempotent upserts and do not delete existing records. CSV imports into an
already populated table require the editor's appropriate conflict handling or
the SQL upsert method instead.

Upload all files in the export's flat `media` directory to the **private**
`hq-knowledge-media` bucket, retaining `<sha256>.<extension>` object
names at the bucket root. Verify object bytes and page checksums before cutover. Do not make the
bucket public. The schema adds separate restrictive SELECT guards for `anon`
and `authenticated`: they block this bucket even if an older broad permissive
Storage policy exists. Other buckets retain their existing behavior. The
anonymous guard never queries the private staff table. Review the resulting
policy list and test with a deliberately broad permissive policy locally.

## Public cutover

Each existing KB HTML file remains at its existing physical filename. Replace
only its article body with the export's `article_replacement`; verify the
original source checksum before applying it. Load `assets/knowledge-base.css`
and `assets/knowledge-base.js` after the existing shared client is available.
The shell carries `data-knowledge-page` with the canonical clean route.
`.html` links still resolve to the same file, and clean aliases retain the
existing navigation behavior.

The shared menu calls `window.PawsKnowledgeBase.loadSearchIndex()` to retrieve
private rows containing `path`, `search_text`, `title`, `category`, and
`page_kind`. Only nonarchive pages appear in this search response. Update the
legacy KB search to use this source as well. Remove all prose from public
`assets/navigation.json` and `search/index.json`; remove public archived
content and former local image copies in the same deployment. Keep page titles
and routes public only if that metadata is acceptable.

The client uses authenticated `storage.download()` requests and temporary
in-memory blob URLs, rather than bearer signed URLs. It revokes blob URLs on
page hide and confirmed access removal. It clears article contents before a
cached page is restored, then requests them again. No content is stored in
localStorage, sessionStorage, IndexedDB, or a service worker by this feature.

The client listens for `paws-access-revoked` (and the alias
`paws:access-revoked`) to clear a displayed article. It emits
`paws-knowledge-access-denied` on confirmed denial; navigation should clear
private search text in response. `paws-access-restored` re-fetches a page after
an explicit access restoration or account switch. Network errors retain the existing login and
show a retry state. A missing/inactive approval clears private content; it
does not sign out the user.

## Verification

1. Compare all exported page checksums, counts, and private media hashes.
2. With an existing active staff JWT, read an article, search text, and image.
   Confirm the current login remains intact across native navigation and reload.
3. Verify anonymous, authenticated nonstaff, and inactive-staff requests cannot
   read page rows or image bytes. Test direct PostgREST and Storage access.
   Simulate inactive staff in a rollback transaction rather than disabling a
   real account for testing.
4. Verify all active and archived clean and `.html` paths deliver public shells
   without prose. Verify public JSON and former screenshot URLs reveal no KB
   content. Test tables, lists, images, relative links, theme, and Back/Forward.
5. Confirm both menu and legacy KB search find article body phrases for active
   staff and clear those phrases after confirmed access removal.

## Historical exposure and external images

The GitHub repository and its old commits were public before this migration.
Protecting current files does not erase old commits, third-party caches,
downloads, or forks. History cleanup or repository privacy is a separate,
explicitly reviewed task; this migration never rewrites Git history or changes
hosting configuration.

Existing external HTTPS image embeds are retained without downloading them.
Their original third-party URLs remain outside HQ's access control. Local KB
screenshots are private; any external image requiring confidentiality needs its
own migration and an assessment of the original host's exposure.

Keep recovery copies private. Re-publishing the original HTML, search JSON, or
images as a rollback would reopen the original exposure.
