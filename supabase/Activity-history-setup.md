# Activity history

History is a shared, read-only staff activity page reached from Settings. Every active HQ account has the same access. It records new activity from installation onward; it does not reconstruct past edits or turn existing creation/update timestamps into a fictitious event history.

## Install

Run `activity-history-setup.sql` in the existing Paws Supabase project's SQL Editor after the operational and private knowledgebase schemas. The migration is transactional and safe to rerun: existing events and the first installation timestamp are preserved. A missing operational table aborts installation, rather than silently leaving its section untracked. No account, session, permission tier, workspace-access policy, or existing record is changed.

Then run `activity-history-rls-check.sql`. This **is a rollback-only write test, not a read-only health check**: it creates synthetic rows, temporarily revokes an existing approval within its transaction, simulates an unavailable history table, and rolls everything back. It creates no Auth users. If it fails, run `rollback;` before doing anything else. Use a quiet maintenance window if running against production because the transaction briefly locks its chosen approval and history schema. Prefer the local synthetic database test first.

Publishing the page and installing the migration are separate steps. A frontend deployed before the migration should show an unavailable/setup state, not pretend that an empty list means there has been no activity.

## Event contract

`public.hq_activity_history` exposes these columns through authenticated Supabase queries:

| Column | Meaning |
| --- | --- |
| `id` | Server-generated bigint. Sort descending and paginate using `id < last_id`; preserve cursor IDs as strings. |
| `occurred_at` | Server timestamp, stored as `timestamptz`. Display in America/New_York. |
| `actor_id` | Authoritative Supabase user UUID derived from `auth.uid()`. |
| `actor_name` | Display snapshot from the provider-owned Slack identity, falling back to “Paws HQ member.” User-editable metadata and client arguments cannot set it. |
| `action` | `create`, `update`, `delete`, `restore`, `page_view`, or `sign_in`. |
| `section` | Page slug such as `end-of-day`, `tours`, `training`, or `knowledge-base`. |
| `source_table` / `record_id` | Operational table and UUID for database events; null for client activity. |
| `record_label` | Short identity/date label, at most 160 characters. Suggestions use a generic label plus their date. |
| `changed_fields` | Array of changed business-field **names only**, never their previous/current values. |
| `page_path` | Canonical page path for client-reported activity only. No query strings or fragments. |
| `source` | `database` for trigger-derived changes; `client` for self-reported visits/sign-ins. |

The only retained record content is the minimal display label: for example, the End Of Day date, tour customer name, dog name, basket location, realtor name, vet name, or gift certificate number. Notes, messages, suggestion text, phone/email details, money amounts, original import archives, and old/new field values are not copied. An actor UUID is retained without an Auth foreign key so removing an account cannot cascade-delete history. Display names are descriptive snapshots; use the actor UUID to resolve identity precisely.

`hq_activity_history_info()` returns `{ "started_at": "…", "version": 1, "best_effort": true }` for an active HQ account. `started_at` is the original installation time and survives reruns. The page should clearly state when recording began.

## Record-change capture

An `AFTER INSERT OR UPDATE OR DELETE` trigger captures 16 operational tables: tours; training dogs and logs; dog licenses; follow-up calls; marketing initiatives; biscuit locations and visits; suggestions; gift cards; realtor directory and contacts; K9 cough; the vet cheat sheet; potential training clients; and End Of Day.

An insert is `create`; a substantive field edit is `update`; setting `deleted_at` is `delete`; clearing it is `restore`. A privileged hard deletion is also `delete`. Updates that change only revisions, timestamps, import metadata, or unchanged values produce no event. Capture runs after existing validation/audit triggers, so it describes the saved record. A later rollback also rolls back its event. Normal frontend saves never submit separate record-change events, avoiding duplicate logs or forged actor/action claims.

The membership table, access-sync tables, private audit/control tables, history itself, private knowledge contents/media, and read-only CSV archive are excluded. Privileged maintenance/import work without an explicit active `auth.uid()` is skipped, rather than falsely credited to the record's last editor. There is no backfill.

Capture is deliberately **best-effort** so a logging problem cannot prevent a tour, training entry, or daily closing record from saving. An exception emits only the fixed database warning `HQ_ACTIVITY_HISTORY_WRITE_FAILED`, never a row, credential, or raw error, and permits the original record write. Consequently this is an activity aid, not a guaranteed financial ledger or tamper-proof compliance/security audit. Administrators should investigate that warning; a gap is possible during failures. Browser roles cannot insert, update, delete, truncate, or reset the history identity sequence. Privileged database administrators can still administer the table.

## Page views and sign-ins

`hq_activity_record_visit(p_path text, p_action text default 'page_view')` returns `true` if an event is recorded, `false` for a matching event in the preceding 60 seconds or a logging failure. It checks active HQ membership, stamps the actor and time on the server, and accepts only `page_view`/`sign_in`. Missing access raises `42501`; invalid paths/actions raise `22023`.

Paths must match the explicit operational/Home/Settings/History/login route list or an existing non-archived `hq_knowledge_pages.path`. Pass decoded canonical clean paths, e.g. `/settings` and `/kb/category/Page_Name`, with no `.html`, query, fragment, or percent escape. Root pages omit trailing slashes except `/`; knowledgebase directory pages keep their exact stored canonical path, such as `/kb/` or `/kb/category/`. Unknown routes and external URLs are rejected. No caller-provided page title or arbitrary payload is accepted. Matching actor/action/path calls are serialized and suppressed for 60 seconds, covering duplicate tabs and repeated auth notifications.

The shared frontend reports a page view after confirmed access and a sign-in only when the document initially arrived at Home or the auth callback with OAuth return parameters. It captures only that boolean, never the code/token values. Ordinary persisted sessions and token refreshes do not produce sign-in events. These are explicitly **client-reported site activity**, not proof of an OAuth exchange, identity-provider authentication log, or complete browsing surveillance. A staff member can suppress/spoof a visit to an allowed page; they cannot choose another actor, timestamp, action outside these two, or a database-change source. Browser/network failures can miss visits. Never invoke this RPC for record saves.

## Access and validation

The SELECT policy uses the same active `hq_tour_staff` membership as existing HQ data. Unapproved or revoked accounts receive no rows even with an existing JWT. Anonymous access and direct browser mutations are not granted. The RPCs enforce the same membership check. No new roles, permission levels, or account-management features are introduced.

The SQL test covers real triggers on every operational table, minimal labels, provider-owned identity vs forged profile claims, server timestamps, substantive field detection, no-ops, soft deletion/restoration, hard deletion, rollback, blocked direct history mutation, valid/invalid routes, duplicate suppression, unavailable-log isolation, missing-actor maintenance, and anonymous/unapproved/revoked access. The local database harness uses only synthetic records and no network calls. Production deployment and live verification require a separate authorized step.

## Read-only installation verification

These SQL Editor queries read only schema metadata and the installation timestamp. They neither simulate users nor modify records or approvals. Expect exactly 16 capture triggers, RLS and forced RLS enabled, only authenticated SELECT granted, authenticated RPC execution only, and a single `started_at` row.

```sql
select count(*) as capture_trigger_count, array_agg(c.relname order by c.relname) as covered_tables
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and t.tgname='hq_activity_history_capture' and not t.tgisinternal;

select c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='hq_activity_history';

select role_name,
  has_table_privilege(role_name,'public.hq_activity_history','SELECT') as can_read,
  has_table_privilege(role_name,'public.hq_activity_history','INSERT') as can_insert,
  has_table_privilege(role_name,'public.hq_activity_history','UPDATE') as can_update,
  has_table_privilege(role_name,'public.hq_activity_history','DELETE') as can_delete,
  has_table_privilege(role_name,'public.hq_activity_history','TRUNCATE') as can_truncate,
  has_sequence_privilege(role_name,'public.hq_activity_history_id_seq','USAGE') as can_advance_sequence,
  has_sequence_privilege(role_name,'public.hq_activity_history_id_seq','UPDATE') as can_reset_sequence
from unnest(array['anon','authenticated','service_role']) role_name;

select policyname,cmd,roles,qual
from pg_policies where schemaname='public' and tablename='hq_activity_history';

select p.oid::regprocedure as function_name,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('hq_activity_history_capture','hq_activity_history_info','hq_activity_record_visit')
order by p.proname;

select started_at,version from hq_history_private.installation where singleton;
```
