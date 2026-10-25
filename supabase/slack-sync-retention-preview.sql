-- READ ONLY. Run after the retention setup and BEFORE approving activation.
-- Aggregate diagnostics only: no identities, JSON contents, secrets, or users.
with latest as (
  select run_id from hq_access_private.slack_sync_runs order by started_at desc,run_id desc limit 1
), classified as (
  select r.*,
    r.run_id=(select run_id from latest) as latest,
    exists(select 1 from hq_access_private.slack_sync_revocations a where a.run_id=r.run_id) as audit_linked,
    r.status<>'running' and coalesce(r.completed_at,r.started_at)<clock_timestamp()-
      case when r.status in ('error','blocked') then interval '30 days' else interval '7 days' end as expired
  from hq_access_private.slack_sync_runs r
)
select count(*) as total_runs,
  min(started_at) as earliest_run,max(started_at) as latest_run,
  count(*) filter(where status='running') as protected_running_runs,
  count(*) filter(where audit_linked) as protected_audit_parents,
  count(*) filter(where status<>'running' and not latest and not audit_linked and expired) as expired_summary_rows_to_prune,
  count(*) filter(where status<>'running' and (candidates<>'[]'::jsonb or results is distinct from '[]'::jsonb)
    and (latest or audit_linked or not expired)) as retained_completed_payloads_to_compact,
  coalesce(sum(pg_column_size(candidates)+coalesce(pg_column_size(results),0)) filter(where status<>'running'),0) as completed_payload_bytes_before,
  pg_total_relation_size('hq_access_private.slack_sync_runs') as allocated_relation_bytes
from classified;

select enabled,last_maintenance_at,last_compacted,last_pruned from hq_access_private.slack_sync_retention where singleton;

-- Verify every foreign key before approving pruning. Known expected reference:
-- hq_access_private.slack_sync_revocations(run_id), preserved by the helper.
select conrelid::regclass as referencing_table,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where contype='f' and confrelid='hq_access_private.slack_sync_runs'::regclass;

-- The existing schedule must remain exactly every five minutes.
select jobname,schedule,active from cron.job where jobname='paws-hq-slack-access-sync';
