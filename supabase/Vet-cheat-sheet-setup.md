# Vet Cheat Sheet

`/vet-cheat-sheet.html` is a separate page linked from the sidebar. It reuses Paws HQ typography, themes, and sign-in. The seven working fields follow the source order: veterinarian, phone, normal hours, lunch break, menu button, no-reply email information, and notes. Every field remains literal text, including informal hours, phone formats, surrounding whitespace, freeform contact flags, and blank cells. Partial records are allowed; changes save when leaving a cell. Entirely blank new rows stay local until filled or removed.

Each source row is a separate veterinarian record. The page does not infer current availability, lunch times, a phone menu digit, or email behavior from entered text. Deletion is reversible from Deleted entries or the five-second Undo notice. Working edits leave original source cells unchanged.

## Storage and access

Run `vet-cheat-sheet-setup.sql` in the existing Supabase project after Tours membership setup. It is safe to rerun and creates `public.hq_vet_cheat_sheet` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records, including already approved guest accounts. No accounts are enrolled and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates filter by the last loaded revision. IDs, creation details, source order, and original source metadata are immutable. Browser-created rows cannot claim imported metadata. Limits are 500 characters for veterinarian, lunch break, and menu button, 200 for phone, 2,000 each for normal hours and no-reply email information, and 20,000 for notes.

Import the CSV privately with stable UUIDv5 IDs. Filter out existing IDs before inserting and retain `ON CONFLICT DO NOTHING` as a final duplicate guard. Preserve all seven cells exactly in `source_values`, along with the source filename and actual CSV row number (at least 2). Reimports must not duplicate entries, revive deleted records, or overwrite later edits. The source has column headers on row 1 and nine records on rows 2–10; a partial record and all blank fields remain intact. Keep the original header labels in the private import archive. Do not commit source records, private import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `vet-cheat-sheet-rls-check.sql` after setup to verify approved account operations, partial and literal values, field limits, audit and revision controls, immutable source data, reversible deletion, and anonymous, nonstaff, and inactive isolation. Its synthetic fixtures and membership changes roll back. If the SQL editor stops after an error, run `rollback;` before another query.

PostgreSQL-compatible validation passed the rollback-only access checks and verified all nine original records, all 63 working cells and 63 archived cells, and source metadata exactly against the private seed and an independently authored CSV verification script. Original source order, blank fields, trailing whitespace, and phone strings remain intact. Setup and import reruns preserve later edits, deleted entries, and restored records.
