# Marketing initiatives

`/marketing-initiatives.html` is a separate page linked from the sidebar. Its compact editable table reuses Paws HQ typography, themes, and sign-in. The three working fields are drop-off location, date, and notes. Cells accept literal text and partial entries; changes save when leaving a cell. Blank new rows stay local until filled or removed. Deleted entries remain restorable, including after the five-second Undo notice expires.

Rows sort by the latest recognized leading numeric US or ISO date, then original source order. Undated rows retain source order. Imported yearless dates use immutable `source_year` only while the working date still exactly matches its original `source_values[1]`; changing it to another yearless date uses the current Eastern year for sorting. An explicit year takes precedence. Restoring the original date restores its imported year context. The stored date is never rewritten. The four yearless `8/19` dates in the supplied export retain their source context of 2025.

## Storage and access

Run `marketing-initiatives-setup.sql` in the existing Supabase project after Tours membership setup. It is safe to rerun and creates `public.hq_marketing_initiatives` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records, including already approved guest accounts. No accounts are enrolled and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates filter by the last loaded revision. Record IDs, creation details, insertion order, source metadata, and source year context are immutable. Browser-created rows cannot claim imported metadata or a source year. Field limits are 500 characters for location, 120 for date, and 20,000 for notes. Source years are nullable integers from 1900 through 2100.

Import the CSV privately with stable UUIDs and `ON CONFLICT DO NOTHING`, preserving all three cells exactly in `source_values` and retaining the source filename, row, and any known year context. A repeated import must neither duplicate records nor overwrite later edits. Do not commit source records, private import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `marketing-initiatives-rls-check.sql` after setup to verify approved account operations, literal and partial entries, field limits, revision/audit controls, immutable source/year metadata, reversible deletion, and anonymous/nonstaff/inactive isolation. Its synthetic fixtures and membership changes are rolled back. If the SQL editor stops after an error, run `rollback;` before another query.

Initial validation passed 33 page behavior checks, PostgreSQL-compatible schema/import rerun checks, and the live rollback-only access checks. The private import preserves all 40 source records and all 120 working cells exactly, including blank dates and multiline notes; source metadata and year context match the private seed. Repeating setup or import preserves existing records and subsequent edits. Source records are stored only in the protected database, never in public page assets.
