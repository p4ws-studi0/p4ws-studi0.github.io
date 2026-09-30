# Paws HQ dog training

`/training.html` is a separate, shared dog-training log linked from the sidebar. The homepage is unchanged. It reuses the site's Inter typography, glass panels, theme controls, header, footer, and Supabase sign-in.

The live database has all 58 entries from the three supplied CSVs (22, 17, and 19 entries). All 406 source cells were compared exactly after import, including blank values, whitespace, spelling, and yearless dates. The partial rows remain present. Source CSVs and private import payloads are deliberately excluded from the public website repository.

## Use

Choose a dog, search its log or filter by trainer, and use **Log session**, **Edit**, or **Delete**. Add and rename dogs from the page. Deleted entries can be restored from **Deleted**, or immediately with **Undo**. Notices disappear after five seconds. Records keep the original session order; new sessions append. Day labels carry forward for grouping only, without filling blank stored cells. All seven original columns remain editable text so date/year and time assumptions are never imposed on old records.

## Database

The existing `hq_tour_staff` active membership list controls access to `hq_training_dogs` and `hq_training_logs`, including the same approved guest accounts. No new accounts are automatically enrolled. Deactivating membership revokes both Tours and training access.

`training-setup.sql` creates only the two training tables and their indexes, row security, policies, and audit trigger. It can be rerun without dropping records. Apply it after the existing Tours membership setup when preparing another environment. Source data must be imported separately through a private administrative process; never add it to the public site assets.

The browser uses authenticated select/insert/update access. Anonymous and unapproved users have no record access. Hard deletion is not granted. Audit fields, immutable source metadata, and revisions are server controlled. Every browser update filters by the loaded revision to prevent stale edits from overwriting a teammate's change. A lost insert response reuses the same UUID and recovers the existing row before retrying.

The original seven cells are retained in immutable `source_values` for imported entries; subsequent edits update the working fields. The source filename, row, and original ordering are immutable too. Browser-created entries have no imported source metadata.

## Verification

Run `node --test tests/*.test.cjs` for the 38 application regression checks (18 training and 20 Tours). Training tests use synthetic data and cover exact text preservation, partial entries, grouping/filtering, pagination, editing conflicts, lost save responses, reversible deletion, authorization, and logout races.

`training-rls-check.sql` verifies approved CRUD, exact text, audit/revision rules, source provenance, restoration, and anonymous/nonstaff isolation. It runs in a transaction and rolls back all fixture data and membership changes. It passed locally and against the live Supabase project before import. If interrupted on an error, run `rollback;` before another query.
