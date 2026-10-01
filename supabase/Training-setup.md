# Paws HQ dog training

`/training.html` is a separate, shared dog-training log linked from the sidebar. The homepage is unchanged. It reuses the site's Inter typography, glass panels, theme controls, header, footer, and Supabase sign-in.

The live database has all 58 entries from the three supplied CSVs (22, 17, and 19 entries). All 406 source cells were compared exactly after import, including blank values, whitespace, spelling, and yearless dates. The partial rows remain present. Source CSVs and private import payloads are deliberately excluded from the public website repository.

## Use

Select a dog and type directly into the seven-column training sheet. **Tab** moves between cells; changes save when leaving a cell. **Add row** inserts a new row at the top with an editable date default. **Delete** removes a row immediately; the five-second notice offers **Undo**. **Add dog** opens a small inline name field. **Rename** edits the selected dog’s name in that same form. **Delete dog** moves the dog out of the active selector into **Deleted dogs**, where **Restore** brings back the dog and its training rows. Dog deletion preserves every row, including individually deleted rows. Finish pending row edits before deleting a dog. There are no session dialogs, cards, search controls, or trainer filters.

All seven fields accept ordinary text. Partial entries are allowed; dates, time ranges, trainer names, and session labels have no rigid input format. A completely empty persisted row must be filled or deleted. Long cells expand while focused; other rows remain compact. The table scrolls horizontally on small screens and keeps its column headings visible while scrolling through many rows.

Rows sort by session date, newest first, with original position descending as the tie-breaker. The date parser recognizes common month/day, ISO, and named-month dates for display sorting only. Yearless dates use each row's immutable creation year as a stable sort anchor; the stored date text is never changed. Blank or unrecognized dates stay adjacent to the nearest preceding dated row in source order (leading blanks use the first dated row); all-undated logs use reverse source order. New rows stay at the top while being entered, then sort when leaving the sheet or refreshing.

## Automatic saves

Updates contain only changed cells and use the loaded revision. Edits typed during a pending save queue behind its returned revision without replacing focused inputs. A lost response recovers the same record before retrying. Changes to different cells can merge with a teammate's work; competing edits to the same cell keep the local draft and show a reload action. Failed saves stay visible with Retry. Background refresh pauses while the sheet is focused or any unsaved work remains, and sign-out clears loaded records and invalidates pending responses.

## Database

The existing `hq_tour_staff` active membership list controls access to `hq_training_dogs` and `hq_training_logs`, including the same approved guest accounts. No new accounts are automatically enrolled. Deactivating membership revokes both Tours and training access.

`training-setup.sql` creates only the two training tables and their indexes, row security, policies, and audit trigger. It can be rerun without dropping records. Apply it after the existing Tours membership setup when preparing another environment. Source data must be imported separately through a private administrative process; never add it to the public site assets.

`training-dogs-migration.sql` adds reversible dog deletion to an already configured database. It is applied in the live project. `training-setup.sql` also includes it for new or existing environments. Deletion timestamps and revision increments are controlled by the server. Renaming changes only the dog record; references and original source metadata keep their original values. The server blocks log changes for deleted dogs until they are restored.

The browser uses authenticated select/insert/update access. Anonymous and unapproved users have no record access. Hard deletion is not granted. Audit fields, immutable source metadata, and revisions are server controlled. Every browser update filters by the loaded revision to prevent stale edits from overwriting a teammate's change. A lost insert response reuses the same UUID and recovers the existing row before retrying.

The original seven cells are retained in immutable `source_values` for imported entries; subsequent edits update the working fields. The source filename, row, and original ordering are immutable too. Browser-created entries have no imported source metadata.

## Verification

Run `node --test tests/*.test.cjs` for the 47 application regression checks (27 training and 20 Tours). Training tests use synthetic data and cover exact text preservation, compact inline entry, flexible input, date sorting, queued autosaves, pagination, editing conflicts, lost responses, reversible deletion, authorization, logout races, dog rename conflicts, deletion/restoration, and preservation of dog history.

`training-rls-check.sql` verifies approved CRUD, exact text, audit/revision rules, source provenance, restoration, and anonymous/nonstaff isolation. It runs in a transaction and rolls back all fixture data and membership changes. It passed locally and against the live Supabase project before import. If interrupted on an error, run `rollback;` before another query.

`training-dogs-check.sql` checks rename conflicts, dog deletion/restoration, unchanged row contents, server-controlled timestamps, and protection against stale tabs. It passed locally and against the live database; its temporary fixture records roll back.
