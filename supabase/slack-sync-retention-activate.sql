-- APPROVAL-REQUIRED FINAL STEP. Irreversibly removes old INTERNAL diagnostic
-- details/expired summaries, then enables the same retention on the existing
-- five-minute sync. Does not touch Auth, staff approvals, revocation audit,
-- business records, business History, or the Cron schedule.
-- Review slack-sync-retention-preview.sql aggregates first. Do not execute this
-- file until the owner approves this concrete cleanup and automatic retention.
begin;
update hq_access_private.slack_sync_retention set enabled=true where singleton;
do $$
declare batch jsonb; completed boolean:=false;
begin
  for attempt in 1..20 loop
    batch:=hq_access_private.maintain_slack_sync_diagnostics(1000);
    if (batch->>'compacted')::integer=0 and (batch->>'pruned')::integer=0 then completed:=true;exit; end if;
  end loop;
  -- A larger backlog should be reviewed explicitly, not turned into an
  -- unbounded blocking migration. Raising rolls this entire cleanup back.
  if not completed then raise exception 'Diagnostic backlog exceeds this bounded cleanup. Review before retrying.'; end if;
end;
$$;
commit;
