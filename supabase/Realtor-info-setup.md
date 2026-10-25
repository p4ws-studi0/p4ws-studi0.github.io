# Realtor information

`/realtor-info` is a separate page reached through the Paws HQ menu. It reuses Paws HQ typography, themes, and sign-in. Search covers the realtor name, phone, email, location, and active contact history. Open a realtor for full details and readable history, or choose Log contact to open a simple date/notes form. Both realtor details and contact entries use explicit Save and Cancel controls; moving between fields never writes data. Untouched date-prefilled drafts stay local and do not show unsaved changes. Failed saves retain their draft and same-ID reconciliation path. Contact deletion remains reversible.

The directory stacks into readable rows on small screens, without a horizontal scroller. Long notes expand on request. Valid single phone numbers and email addresses have conservative call/email links; incomplete or compound values remain readable text, with no validation requirement or stored-value normalization. Any nonblank directory field is enough to save a realtor; a name can be added later. All form fields support literal text, line breaks, and partial records.

The source's first and second date/notes pairs remain separate history entries. Composite dates remain one literal field, including their original commas, periods, and spacing. Dates without a year remain unknown. The page never splits a date cell into additional contacts or assigns an inferred year. Phone numbers, email addresses, blanks, spelling, and trailing whitespace are preserved.

Deleting a history entry is reversible from Deleted contacts or the five-second Undo notice. Deleting a realtor preserves all history, including individually deleted entries. Restoring the realtor brings its history back without reviving entries deleted separately. The server blocks creating, editing, deleting, or restoring history for a deleted realtor until the realtor is restored.

## Storage and access

Run `realtor-info-setup.sql` in the existing Supabase project after Tours membership setup. It safely creates `hq_realtors` and `hq_realtor_contacts`. Access uses the existing active Paws HQ workspace membership, including guest accounts. This page adds no access tier or account enrollment, and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates filter by the last loaded revision. Record IDs, creation details, source order, source metadata, and each history entry's parent realtor are immutable. Browser-created records cannot claim imported metadata. Changing history locks its undeleted parent against concurrent deletion for that transaction.

Directory text limits are 500 characters for name, 200 for phone, 500 for email, and 2,000 for location. History limits are 500 for date contacted and 20,000 for notes. Original parent metadata retains all eight source cells; child metadata retains its original two-cell pair and source column 5 or 7. Actual CSV row numbers are retained and must be at least 3.

Import privately with stable UUIDv5 IDs. Filter out existing IDs before inserting and retain `ON CONFLICT DO NOTHING` as a final duplicate guard. Filtering prevents an existing history entry from reaching its before-insert parent guard when its realtor has since been deleted. Reimports must not duplicate records, revive deleted entries, or overwrite later edits. The source contains 16 realtors and 19 contact-history entries. Do not commit CSV contents, private import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `realtor-info-rls-check.sql` after setup to verify approved account operations, partial/literal values, field limits, audit/revision controls, immutable source/parent metadata, reversible deletion with history retention, deleted-parent protection, and anonymous/nonstaff/inactive isolation. Its synthetic fixtures and membership changes roll back. If the SQL editor stops after an error, run `rollback;` before another query.

PostgreSQL-compatible validation passed the rollback-only security checks and independently verified the private import. The 16 directory entries and 19 history pairs reconstruct all 128 original cells exactly, including blanks and whitespace. Source order and metadata remain intact. Setup/import reruns preserve later edits, deleted history, deleted realtors, and restoration without reviving separately deleted entries.
