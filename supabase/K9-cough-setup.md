# K9 Cough log

`/k9-cough.html` is a separate page linked from the sidebar. Its compact editable table reuses Paws HQ typography, themes, and sign-in. The ten working fields follow the source column order: date added, initials, pet name, dates of service, room, group or individual, services, notes, PCW reimbursement, and management follow-up. All values remain literal text, including informal dates, trailing whitespace, blank cells, descriptions, and reimbursement notes. Partial rows are allowed; changes save when leaving a cell. Entirely blank new rows stay local until filled or removed.

Each source row is a separate record, including repeated cases for the same pet. The log does not infer a diagnosis, reimbursement amount, or reimbursement status from entered values. Dates and service ranges are never rewritten or assigned a missing year. Deleting an entry is reversible from Deleted entries or the five-second Undo notice. Working edits leave original source cells unchanged.

## Storage and access

Run `k9-cough-setup.sql` in the existing Supabase project after Tours membership setup. It is safe to rerun and creates `public.hq_k9_cough` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records, including already approved guest accounts. No accounts are enrolled and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates filter by the last loaded revision. IDs, creation details, source order, and original source metadata are immutable. Browser-created rows cannot claim imported metadata. Working field limits are 500 characters for date added, 120 for initials, 1,000 each for pet name, group, and services, 2,000 each for service dates and room, and 20,000 each for notes, reimbursement text, and management follow-up.

Import the CSV privately with stable UUIDv5 IDs. Filter out existing IDs before inserting and retain `ON CONFLICT DO NOTHING` as a final duplicate guard. Preserve all ten cells exactly in `source_values`, along with the source filename and actual CSV row number (at least 3). Reimports must not duplicate entries, revive deleted records, or overwrite later edits. The source has a blank first row, column headers on row 2, and 64 records on rows 3–66; repeated pet cases are retained separately. Do not commit source records, private import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `k9-cough-rls-check.sql` after setup to verify approved account operations, partial/literal values, independent cases for repeated pet names, field limits, audit/revision controls, immutable source data, reversible deletion, and anonymous/nonstaff/inactive isolation. Its synthetic fixtures and membership changes roll back. If the SQL editor stops after an error, run `rollback;` before another query.

PostgreSQL-compatible validation passed the rollback-only access checks and verified all 64 original records, all 640 cells, and source metadata exactly against the private seed and an independent CSV verification script. Original source order, blank fields, trailing whitespace, and repeated pet cases remain intact. Setup/import reruns preserve later edits, deleted entries, and restored cases.
