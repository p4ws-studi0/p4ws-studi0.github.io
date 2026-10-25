# Internal Slack sync diagnostic retention

This reduces internal diagnostic storage while preserving the existing Slack membership check every **five minutes**. It does not modify Auth users, sessions, refresh tokens, staff approvals, membership-verification decisions, business records, or the staff-facing History page. It does not change `cron.job`, extension-managed HTTP responses, or Cron's own execution logs.

## Installation and approval boundary

1. Apply `slack-sync-retention-setup.sql` after the current Slack-sync and workspace-access migrations. It adds a compact summary trigger for **future completed runs** and installs an inactive retention helper. Existing completed payloads remain unchanged. The new private retention setting starts `enabled=false`; rerunning setup preserves its current setting.
2. Run `slack-sync-retention-preview.sql`. This is read-only and shows aggregate counts, date coverage, existing payload/allocated bytes, referencing foreign keys, and the unchanged five-minute schedule. It prints no identity/result JSON, tokens, names, or accounts.
3. Review the exact cleanup scope and obtain the owner's final confirmation before executing `slack-sync-retention-activate.sql`. This separate transaction permanently compacts old completed diagnostic details, removes eligible expired diagnostic summaries, and enables the same retention for future runs. It does not delete deactivation audit entries or their parent runs. Clearing old diagnostic JSON and removing expired summaries is irreversible through the normal product UI; rolling back the activation transaction before commit restores it.

Do not run the activation file merely to test installation. It is the explicit approval-required step. If an unexpected foreign key references `slack_sync_runs`, review it before activation; do not drop or cascade that constraint. The known reference is `slack_sync_revocations(run_id)` and its parent rows are excluded from pruning. Any additional FK prevents deletion normally; background maintenance failure is isolated from membership checks.

Reapply this add-on last if the older `slack-access-sync-setup.sql` is ever rerun: that historical file defines the pre-retention `hq_slack_sync_start`. The terminal trigger remains attached across function replacements, but the maintenance hook must be restored by this add-on. Workspace-aware finish/candidate/apply functions are not replaced by this change.

## What is retained

An in-progress run keeps its full server-generated candidate snapshot. The existing finish function still uses that exact snapshot, locks/rechecks provider identities, applies the original safety limits, and performs its normal verified membership changes before marking the run complete. No verification or apply logic is removed.

When a new run leaves `running`, a `BEFORE` trigger replaces candidate and result arrays with `[]`, retaining the run ID, status, timestamps, workspace, dry-run flag, safe error tag, and existing `proposed`/`changed`/`enrolled` counts. It adds `candidate_count`, `checked_count`, `active_count`, `deactivated_count`, and `unknown_count`. `candidate_count` is the planned population; result counts remain null when a failed/disabled run never submitted a complete result list. The actual revocation audit retains its per-account attribution separately, unchanged.

The trigger covers successful, unchanged, dry-run, disabled, blocked, failed, and abandoned terminal outcomes. If summary calculation fails, it emits only the fixed warning `HQ_SLACK_SYNC_COMPACTION_FAILED`, still removes the full diagnostic arrays, and allows the existing membership transaction to finish. It never emits raw errors, identity JSON, or Slack payloads.

Once explicitly enabled, maintenance retains ordinary terminal summaries for **seven days** and failed/blocked summaries for **30 days**, using completion time, or start time for older rows without one. It always preserves:

- Every `running` row and its full snapshot.
- The latest run by start time/run ID, even if its summary is otherwise expired.
- Every parent referenced by a real `slack_sync_revocations` audit entry. Such parents remain as small summaries indefinitely.

The existing five-minute `hq_slack_sync_start` invokes maintenance after storing a valid new run. No extra Cron job or invocation schedule is introduced. Each call handles at most 1,000 expired rows and 1,000 retained payloads, skips locked rows, and uses a partial timestamp index. Cleanup shares the existing sync advisory lock. A cleanup failure emits `HQ_SLACK_SYNC_RETENTION_FAILED` and does not stop the normal security check. If the underlying sync is disabled, no new sync invocation runs and no diagnostic rows accumulate; this feature does not introduce a separate cleanup scheduler.

The one-time activation transaction allows at most 20 bounded batches. A larger backlog raises an exception and rolls the whole activation back for review. Locked rows can remain for the next scheduled pass. All helpers/settings remain private to the database owner; browser and service-role direct access is revoked. The existing public start RPC retains its service-role-only execution permission.

## Recovery and storage expectations

To pause future maintenance without changing Slack checks, an administrator can set only `hq_access_private.slack_sync_retention.enabled=false`. That does not reconstruct deleted diagnostic details/summaries, and future terminal runs still use compact summaries. Do not alter the actual `slack_sync_control` or its five-minute schedule to pause cleanup.

Ordinary autovacuum can make deleted/updated tuple space reusable. PostgreSQL's allocated relation size need not shrink immediately after compaction/pruning; compare payload bytes and eligible row counts separately from allocation. This change runs no `VACUUM FULL`, table rewrite, or extension-log purge.

## Validation

`tests/slack-sync-retention-database.mjs` runs real SQL/functions in a synthetic in-memory PGlite database with local Cron/Vault stubs. It never contacts Supabase/Slack or reads production records. Point `PAWS_PGLITE_MODULE` to an installed PGlite module if it is not available as `@electric-sql/pglite`:

```sh
PAWS_PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/slack-sync-retention-database.mjs
node --test tests/slack-access-sync.test.cjs tests/workspace-access.test.cjs
```

Coverage includes rerunnable approval-gated install; full pending snapshots; replay/busy/stale-input and malformed-result rejection; actual verified revocation/enrollment; dry-run and unknown states; identity races; revocation safety limits; failure/abandonment/disabled completion; summary-failure isolation; old-payload compaction; seven-/30-day expiration; latest/running/audit-linked protection; bounded batches; private ACLs; and snapshots proving Auth/session/member/audit/business/Cron data are unchanged by cleanup.
