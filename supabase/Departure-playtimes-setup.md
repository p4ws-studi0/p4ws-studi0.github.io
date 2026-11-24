# Departure playtimes

The production page is `departure-playtimes.html` (clean URL `/departure-playtimes`). It preserves the approved boarding-pet roster, care icons, filter, skipped styling, and inline notes. Its menu entry belongs in **Pet Care & Training**. Do not copy any prototype SQLite data, fake identities, sample schedules, or local connection controls into production.

## Shared data and access

Apply `departure-playtimes-setup.sql` to the existing Paws project. The migration adds new tables/functions only; it does not change existing staff access, sign-in configuration, sessions, financial data, or existing trackers. Every active `hq_tour_staff` member has the same access, including workspace guests. A revoked member cannot read the roster, refresh Gingr, or save changes.

- `hq_departure_private.source_cache`: one sanitized current-day schedule per location, with a refresh lease. No raw Gingr payloads or prices.
- `hq_departure_private.targets`: current-day mutation targets, retired atomically when a service disappears. Earlier targets are removed on day rollover without deleting staff records.
- `hq_departure_playtime_overrides`, `hq_departure_playtime_notes`: shared, revisioned exceptions and notes.
- `hq_departure_playtime_audit`: append-only human changes with server-owned account attribution.
- `hq_departure_private.action_requests`: compact acknowledgements for safe request retries. Polling does not create history records.

Authenticated writes use guarded RPCs rather than direct table writes. Stale source data, removed services, conflicting revisions, and reused request IDs are rejected. Notes use an independent revision so changing a skip cannot overwrite a teammate's note. The frontend keeps unsaved drafts in memory; account changes clear private state. At midnight, old unsaved drafts can be copied or dismissed but cannot be saved onto today's pets.

## Gingr function

Deploy `supabase/functions/hq-departure-playtimes/index.ts` with JWT verification **enabled**. The function validates the real user and active HQ membership before acquiring the shared refresh lease. It uses the existing `GINGR_API_KEY` secret and Supabase runtime secrets. No new client-side credentials are needed.

Tenant is restricted to `pawspet`, location `1`, Eastern business time. Optional existing `GINGR_SUBDOMAIN` / `GINGR_LOCATION_ID` must match those values. `HQ_ORIGIN` defaults to `https://hq.pawspet.com`; loopback origins are also allowed for local review.

For dashboard deployment, generate a single-file equivalent from the checked-in modules:

```sh
node scripts/build-departure-function.mjs /absolute/private/output/index.ts
```

The generated file includes its source SHA-256 and contains no secrets. Do not edit the generated file separately.

The connector reuses the verified ordinary Gingr API operations: reservation types, species, the digital whiteboard, reservation reads (checked-in and date range), animal details, locations, and service catalogs. Boarding reservation types `20`, `22`, and `7` include dogs and cats. Each actual booked package stays one item. Catalog availability never creates a booking. Unmapped activity bookings pause the roster rather than silently hiding possible playtimes.

Visible tabs poll the small shared day RPC every 30 seconds. A single provider refresh is eligible after 60 seconds, coalesced across users by a database lease. Source errors immediately pause editing and retain the last good roster with a warning. Writes require a complete source no older than 90 seconds. The first visitor after midnight refreshes that day's schedule; no unattended cron job is required.

## Billing boundary

This page performs **no Gingr writes, invoice changes, payment changes, or charges**. It records the scheduled plan and exceptions. “On today's plan” is explicitly scheduled and unverified. Existing invoicing remains the source of actual charges. No invented billing integration or numeric charge estimate is shown.

## Validation and launch

Run the Edge/provider and frontend tests with Node 24. The database test requires the existing local PGlite package:

```sh
node --test tests/departure-playtimes-edge.test.mjs tests/departure-playtimes-provider.test.mjs tests/departure-playtimes-frontend.test.mjs
PAWS_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/departure-playtimes-database.mjs
python3 scripts/build-navigation.py
```

Before adding the final route/menu to live HQ, review the real authenticated preview and confirm:

1. Today's boarding cats/dogs and booked packages match Gingr, ordered by departure.
2. Skip, reload, second-browser read, undo, and note autosave preserve real account attribution.
3. A removed/revised schedule cannot accept an outdated skip; an old browser cannot overwrite a newer note.
4. Revoked/anonymous accounts receive no schedule; failed refreshes pause changes.
5. Mobile portrait, desktop, dark/light mode, care filter, recent changes, and midnight rollover behave correctly.

The existing full PostgreSQL backup includes the new schema and public tables. Source files belong in the normal site repository; runtime secrets remain in Supabase.

To roll back the UI, remove the menu/search entry and page assets. Preserve the new tables/audit and disable only the new function if necessary. No existing feature depends on this schema. Never drop staff-entered data as part of an ordinary UI rollback.

## Preview status — November 24, 2026

The user approved an unlisted preview at `https://hq.pawspet.com/preview/departure-playtimes/`. Its files are generated from these production sources using `scripts/build-departure-preview.mjs`; it has no navigation/search entry and includes a no-index tag and visible Preview label. The final `/departure-playtimes` route and prepared menu changes are still held on the feature branch.

The new schema has been applied successfully. All three public data tables have RLS enabled and forced, with no direct authenticated insert/update/delete privilege. The new Edge function has been deployed with JWT verification enabled. Anonymous day-RPC and refresh requests returned HTTP 401 without schedule data.

Live browser checks passed with an existing HQ account: real Gingr roster matched the established local connector; a skip appeared in a second tab, undo survived reload, a note appeared in a second tab, clearing the note persisted, and all four actions showed the real account in Recent changes. The pet's original state and empty note were restored. Care filters, empty-filter feedback, desktop light/dark mode, and unchanged live navigation were checked. The approved responsive CSS is retained; the available browser's viewport override did not actually resize the view, so this pass did not add a new physical phone-width visual verification.

Offline validation passed: 48 Edge/provider/frontend tests, 12 PostgreSQL scenario groups, and 53 shared navigation/auth/transition regressions. No actual reservation or billing records were modified. The next release step is to publish the prepared root page/assets and navigation after user review of the preview.
