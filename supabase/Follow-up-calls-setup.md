# New-client follow-up calls

`/follow-up-calls.html` is a separate page linked from the sidebar. It reuses Paws HQ typography, themes, sign-in, and compact editable tables. The eight source columns are owner name, pet name, reservation start date, reservation end date, call made, call made on, initials, and notes. All cells accept literal text, including partial entries and informal dates. Changes save when leaving a cell. Completely blank rows stay local until filled or removed.

Deleting a row is reversible from **Deleted entries** or the five-second **Undo** notice. Working fields can change without changing the original source values. Rows sort by the newest reservation end date. Valid leading numeric US dates accept two- or four-digit years; yearless dates use the current Eastern year for sorting while the entered text stays unchanged. Ties and undated rows retain original source order.

## Storage and access

Run `follow-up-calls-setup.sql` in the existing Supabase project after Tours membership setup. It is safe to rerun and creates `public.hq_follow_up_calls` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records, including already approved guest accounts. No accounts are enrolled and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates must filter by the last loaded revision. IDs, creation details, original order, and source metadata are immutable. Browser-created rows cannot claim imported source metadata.

Import PDF records privately with stable UUIDs and `ON CONFLICT DO NOTHING`, preserving all eight cells exactly in `source_values` and retaining the source filename and row. A repeated import must neither duplicate records nor overwrite later edits. Do not commit PDF contents, customer records, import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `follow-up-calls-rls-check.sql` after setup for approved account operations, partial and literal entries, field limits, audit/revision controls, immutable source data, reversible deletion, and anonymous/nonstaff/inactive isolation. Its synthetic fixtures and membership changes are rolled back. If the SQL editor stops after an error, run `rollback;` before another query.

The initial import preserved 56 records from the PDF and its matching Google Sheets export. The export recovers names and long notes clipped at the PDF margins. One callback note in an adjacent unlabeled cell is retained as a second paragraph in Notes. Original blanks, spelling, spacing, and informal dates remain unchanged. Customer values are stored only in the protected database, never in public page source.

The initial rollout passed 152 application tests, PostgreSQL-compatible schema/import rerun checks, and the live rollback-only access checks. Every imported source row and all eight mapped values were verified exactly; rerunning the import preserves subsequent edits.
