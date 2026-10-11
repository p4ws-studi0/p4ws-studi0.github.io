# Gift cards

`/gift-cards.html` is a separate page linked from the sidebar. Its compact editable table reuses Paws HQ typography, themes, and sign-in. The eight working fields are certificate number, amount, purchase date, purchaser name, purchase initials, redemption date, redeemer name, and redemption initials. Cells accept literal text, including leading zeros, amounts with currency symbols, multiline names, informal dates, and partial entries. A certificate-number-only row is a valid record. Changes save when leaving a cell. Entirely blank new rows stay local until filled or removed.

This page logs gift-card records only. It does not charge customers, issue certificates, redeem funds, or perform another financial transaction. Follow the existing checkout procedure when completing a purchase or redemption, then update the log. No balance or status is inferred from the entered values.

Deleting an entry is reversible from Deleted entries or the five-second Undo notice. Editing working fields leaves the original source cells unchanged. Missing date years remain unknown; sorting never rewrites entered dates or assigns an inferred year. Certificate numbers are editable text rather than unique record IDs, so repeated source numbers remain separate entries.

## Storage and access

Run `gift-cards-setup.sql` in the existing Supabase project after Tours membership setup. It is safe to rerun and creates `public.hq_gift_cards` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records, including already approved guest accounts. No accounts are enrolled and permanent deletion is not granted.

The server controls audit timestamps, actor IDs, revisions, and deletion timestamps. Updates filter by the last loaded revision. IDs, creation details, source order, and source metadata are immutable. Browser-created rows cannot claim imported metadata. Field limits are 20,000 characters for purchaser and redeemer names and 120 for every other working field.

Import the CSV privately with stable UUIDs. Filter out existing IDs before inserting and retain `ON CONFLICT DO NOTHING` as a final duplicate guard. Preserve all eight cells exactly in `source_values`, along with the source filename and actual CSV row number (at least 3). A repeated import must not duplicate entries, revive deleted records, or overwrite later edits. The source contains 262 records, including 224 certificate-number-only entries. Do not commit source records, private import scripts, credentials, or fixture databases to the public website repository.

## Validation

Run `node --test tests/*.test.cjs` for application checks. Run `gift-cards-rls-check.sql` after setup to verify approved account operations, leading zeros, literal amounts and dates, partial/number-only records, field limits, audit/revision controls, immutable source data, reversible deletion, and anonymous/nonstaff/inactive isolation. Its synthetic fixtures and membership changes roll back. If the SQL editor stops after an error, run `rollback;` before another query.

PostgreSQL-compatible validation passed the rollback-only access checks and verified all 262 source records, all 2,096 working cells, and original metadata exactly against the private seed. Insertion order follows the original CSV rows, and all 224 certificate-number-only records remain present. Repeated setup/import preserves working edits, audit details, and deleted entries.
