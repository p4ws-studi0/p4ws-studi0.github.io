# Paws HQ Tours setup

The page uses the existing HQ Supabase client and Slack sign-in. The database is activated in project `dppjgglaeieevsfwsbii`, and the authorization, validation, revision, deletion, and restoration checks passed against the live database inside a transaction that rolled back all test data. All 20 existing Paws HQ accounts, including guest accounts, were approved at the owner's request. No new accounts are enrolled automatically.

## Website files

The local repository at `~/Downloads/paws-hq` now contains `tours.html`, `assets/tours.js`, `supabase/tours-setup.sql`, `supabase/tours-rls-check.sql`, and `tests/tours.test.cjs`. The home page and shared sidebar both link to `/tours.html`. Existing site CSS, header/footer, theme controls, and Slack sign-in are reused. 

Publish updates through the normal GitHub Pages workflow. The page URL is `https://hq.pawspet.com/tours.html`. There are no sample records in the production page. The local browser preview uses separate sample data and does not contact Supabase.

Run the application regression checks with `node --test tests/tours.test.cjs`. All 12 checks passed. Browser verification covered adding, editing, automatic reordering, deletion/undo, outside-hours validation, keyboard controls, and a 390px phone layout without horizontal overflow.

## Service menu shortcuts

The screenshot shows five menu labels, but does not contain the link destinations. To preserve those shortcuts, add the original links inside the `menuLinks` div in `tours.html` and remove its `hidden` attribute. Do not guess the URLs. This is optional for the scheduling features; the current page keeps this area hidden.

## Setup reference and adding future staff

The initial setup and approval of the 20 existing accounts are already complete. Use these instructions when setting up another environment or adding an approved staff account.

1. In the Supabase project already used by HQ (`dppjgglaeieevsfwsbii`), open **SQL Editor** and run `tours-setup.sql`.
2. Sign in to HQ with your own Slack account at least once. In Supabase **Authentication → Users**, identify your account and copy its user UUID. Verify the account before approving it.
3. Approve your own account first with the SQL below, replacing the placeholder with the copied UUID. Then add each approved staff member separately after their first HQ sign-in.

```sql
insert into public.hq_tour_staff (user_id, active)
values ('PASTE-VERIFIED-AUTH-USER-UUID-HERE'::uuid, true)
on conflict (user_id) do update set active = excluded.active;
```

Do not add every existing Auth user automatically. Only an administrator running SQL can change this list; users cannot approve themselves from the page.

To revoke a staff member's Tours access without removing their historical attribution:

```sql
update public.hq_tour_staff
set active = false
where user_id = 'PASTE-AUTH-USER-UUID-HERE'::uuid;
```

Reload the Tours page after setup or approval. A signed-in account outside the active allowlist has no Tours record access. Existing Slack login behavior elsewhere in HQ is unchanged. Deactivate staff membership instead of deleting Auth users referenced in historical tour records.

## Data and behavior

- `public.hq_tours` stores the customer, optional details, tour date/time, file status, booking status, staff initials, and outside-hours confirmation. `public.hq_tour_staff` controls access.
- Tour dates and times are local wall-clock values in **America/New_York**, configured in the page. They are stored separately as a `date` and `time without time zone`, with minute precision. Do not convert them to UTC before saving. Audit timestamps are `timestamptz`.
- Normal tour hours are **10:30 a.m.–3:00 p.m.**, inclusive. A time outside that window requires `outside_hours_confirmed = true`; the database enforces it too.
- Limits: customer name 120 characters and nonblank; customer information 1,000 characters; staff initials 10 characters and nonblank. File status is `yes`, `no`, or `unknown`; booking status is `confirmed`, `tentative`, `none`, or `unknown`.
- The page generates one UUID for each new tour and reuses that UUID when retrying its save. A duplicate ID must be handled by retrieving the existing record, not by generating another ID or silently overwriting it with an upsert.
- The database stamps creator/editor identity, timestamps, and the numeric `revision`. Updates filter by both the tour ID and the revision loaded by the page. A successful update returns the new row and revision. Zero returned rows means the record changed or access was lost; reload it before making another decision. The database increments revisions but does not substitute for the client's revision filter.
- Removing a tour sets `deleted_at`; restoring it sets `deleted_at` back to `null`. Both operations use the same revision check. Active staff can read removed tours for restoration. Browser users have no permanent DELETE privilege.
- Staff can see only their own allowlist entry and can manage shared tours while their entry is active. No service-role key belongs in the page.

## Check before use

After the setup SQL and your own staff approval, run `tours-rls-check.sql` in the SQL Editor. It uses one approved account's ID to simulate requests, creates a temporary tour, tests revocation inside the same transaction, and rolls back all changes. It creates no Auth users and preserves the staff account's approved status. If a check fails, run `rollback;` before continuing. This file passed both locally with simulated Auth roles and against the live Supabase database. Verification after rollback confirmed 20 active approvals, zero tour records, and row security enabled on both tables.

Then check the actual page with an approved account: add an ordinary-hours tour, add an explicitly confirmed outside-hours tour, edit it, remove it, and restore it. Open two copies of the same tour, save one, and confirm the stale copy reports a conflict instead of overwriting it. Check a signed-in unapproved account receives no Tours data.

The setup script can be rerun for this schema without dropping tour records or staff memberships. It is intended to create these new tables, not reconcile an unrelated pre-existing table with the same name. It changes only the two Tours tables, their policies/indexes, and their audit trigger.

## Screenshot reference

The screenshot's October 3, 11:00 a.m. entry has **not** been inserted. The screenshot omits the year; confirm the intended year and customer details before entering that tour. No sample customer data is added by the setup or retained by the verification script.
