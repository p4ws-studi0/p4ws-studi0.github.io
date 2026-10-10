# Suggestions

`/suggestions.html` is a separate page linked from the sidebar. Its compact editable table reuses Paws HQ typography, themes, and sign-in. The three working fields are suggestion, date, and outcome. All cells accept literal text, including links, multiline notes, informal dates, and partial records. Changes save when leaving a cell. Completely blank new rows stay local until filled or removed. Date-only source records remain present with their original blank fields.

Search matches all three cells without case sensitivity. The outcome filter distinguishes blank responses from responses containing text; it does not infer completion or approval. Drafts and unsaved rows stay visible when filters change. Deleting an entry is reversible from Deleted entries or the five-second Undo notice. Working fields can change without changing the original source values. Valid leading US or ISO dates with explicit years sort newest first. Ties and rows without full valid dates keep their original insertion order. Missing date years remain unknown; sorting never rewrites the entered date or assigns an inferred year.

## Storage and access

Run `suggestions-setup.sql` in the existing Supabase project after Tours membership setup. It is safe to rerun and creates `public.hq_suggestions` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records, including already approved guest accounts. No accounts are enrolled and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates filter by the last loaded revision. IDs, creation details, insertion order, and source metadata are immutable. Browser-created rows cannot claim imported source metadata. Field limits are 20,000 characters for suggestion, 120 for date, and 20,000 for outcome.

Import the CSV privately with stable UUIDs. Filter out existing IDs before inserting, order incoming rows by their original CSV row number, and retain `ON CONFLICT DO NOTHING` as a final duplicate guard. Original CSV row numbers determine order within the same imported file; insertion positions determine order for new entries. Preserve all three cells exactly in `source_values`, along with the source filename and actual CSV row number. A repeated import must neither duplicate entries, revive deleted records, nor overwrite later edits. All 119 data rows are retained, including the survey marker and date-only record. Do not commit source records, private import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `suggestions-rls-check.sql` after setup to verify approved account operations, literal links, partial/date-only rows, field limits, revision/audit controls, immutable source data, reversible deletion, and anonymous/nonstaff/inactive isolation. Its synthetic fixtures and membership changes roll back. If the SQL editor stops after an error, run `rollback;` before another query.
