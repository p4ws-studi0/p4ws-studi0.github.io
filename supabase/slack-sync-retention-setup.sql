-- Internal Slack sync diagnostics only. The five-minute Cron schedule and
-- membership-verification/apply functions are unchanged.
-- Installation does NOT compact/delete old completed diagnostics. See the
-- separate preview and approval-required activation transaction.
begin;

alter table hq_access_private.slack_sync_runs
  add column if not exists candidate_count integer not null default 0,
  add column if not exists checked_count integer,
  add column if not exists active_count integer,
  add column if not exists deactivated_count integer,
  add column if not exists unknown_count integer;

create table if not exists hq_access_private.slack_sync_retention (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  last_maintenance_at timestamptz,
  last_compacted integer not null default 0,
  last_pruned integer not null default 0
);
insert into hq_access_private.slack_sync_retention(singleton) values(true) on conflict do nothing;
alter table hq_access_private.slack_sync_retention enable row level security;
revoke all on table hq_access_private.slack_sync_retention from public,anon,authenticated,service_role;

create index if not exists hq_slack_sync_runs_retention_idx
  on hq_access_private.slack_sync_runs((coalesce(completed_at,started_at)),run_id)
  where status<>'running';

-- Pure row transformation: preserve all existing IDs, status, timestamps,
-- proposed/changed/enrolled counts, and safe error tags. Never touch membership.
create or replace function hq_access_private.slack_sync_run_summary(r hq_access_private.slack_sync_runs)
returns hq_access_private.slack_sync_runs language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(r.candidates)='array' then
    if jsonb_array_length(r.candidates)>0 then r.candidate_count:=jsonb_array_length(r.candidates); end if;
  end if;
  if jsonb_typeof(r.results)='array' then
    if jsonb_array_length(r.results)>0 or r.checked_count is null then
      select count(*)::integer,count(*) filter(where value->>'status'='active')::integer,
        count(*) filter(where value->>'status'='deactivated')::integer,
        count(*) filter(where value->>'status'='unknown')::integer
        into r.checked_count,r.active_count,r.deactivated_count,r.unknown_count
      from jsonb_array_elements(r.results);
    end if;
  end if;
  r.candidates:='[]'::jsonb;
  r.results:='[]'::jsonb;
  if r.error_code is not null and r.error_code not in ('CONFIGURATION_REQUIRED','UPSTREAM_PAYLOAD','DATABASE_UNAVAILABLE',
      'DATABASE_PAYLOAD','SLACK_UNAVAILABLE','WORKSPACE_MISMATCH','SAFETY_LIMIT','SYNC_UNAVAILABLE','ABANDONED_RUN') then
    r.error_code:='SYNC_UNAVAILABLE';
  end if;
  return r;
end;
$$;
revoke all on function hq_access_private.slack_sync_run_summary(hq_access_private.slack_sync_runs) from public,anon,authenticated,service_role;

create or replace function hq_access_private.slack_sync_compact_terminal()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='running' then return new; end if;
  -- Existing completed rows are left alone until explicit cleanup approval.
  if tg_op='UPDATE' and old.status<>'running' then return new; end if;
  return hq_access_private.slack_sync_run_summary(new);
exception when others then
  -- Diagnostic compaction must never stop a valid offboarding transaction,
  -- and a summary failure must not silently retain full identity payloads.
  new.candidate_count:=case when jsonb_typeof(new.candidates)='array' and jsonb_array_length(new.candidates)>0
    then jsonb_array_length(new.candidates) else coalesce(new.candidate_count,0) end;
  new.candidates:='[]'::jsonb; new.results:='[]'::jsonb;
  new.checked_count:=null; new.active_count:=null;
  new.deactivated_count:=null; new.unknown_count:=null;
  if new.error_code is not null and new.error_code not in ('CONFIGURATION_REQUIRED','UPSTREAM_PAYLOAD','DATABASE_UNAVAILABLE',
      'DATABASE_PAYLOAD','SLACK_UNAVAILABLE','WORKSPACE_MISMATCH','SAFETY_LIMIT','SYNC_UNAVAILABLE','ABANDONED_RUN') then
    new.error_code:='SYNC_UNAVAILABLE';
  end if;
  raise warning 'HQ_SLACK_SYNC_COMPACTION_FAILED';
  return new;
end;
$$;
revoke all on function hq_access_private.slack_sync_compact_terminal() from public,anon,authenticated,service_role;
drop trigger if exists hq_slack_sync_compact_terminal on hq_access_private.slack_sync_runs;
create trigger hq_slack_sync_compact_terminal before insert or update on hq_access_private.slack_sync_runs
for each row execute function hq_access_private.slack_sync_compact_terminal();

-- Never called by a browser. Remains inert until the separate activation step.
-- Current/running runs and revocation-audit parents are always protected.
create or replace function hq_access_private.maintain_slack_sync_diagnostics(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path='' as $$
declare latest_run uuid; compacted integer:=0; pruned integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 then
    raise exception 'A maintenance batch must contain 1 to 1000 rows.' using errcode='22023';
  end if;
  if not exists(select 1 from hq_access_private.slack_sync_retention where singleton and enabled) then
    return jsonb_build_object('enabled',false,'compacted',0,'pruned',0);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(823754122);
  select run_id into latest_run from hq_access_private.slack_sync_runs order by started_at desc,run_id desc limit 1;

  with expired as (
    select r.run_id from hq_access_private.slack_sync_runs r
    where r.status<>'running' and r.run_id is distinct from latest_run
      and coalesce(r.completed_at,r.started_at)<clock_timestamp()-case when r.status in ('error','blocked') then interval '30 days' else interval '7 days' end
      and not exists(select 1 from hq_access_private.slack_sync_revocations a where a.run_id=r.run_id)
    order by coalesce(r.completed_at,r.started_at),r.run_id
    limit p_limit for update of r skip locked
  )
  delete from hq_access_private.slack_sync_runs r using expired e where r.run_id=e.run_id;
  get diagnostics pruned=row_count;

  with chosen as materialized (
    select r.* from hq_access_private.slack_sync_runs r
    where r.status<>'running' and (r.candidates<>'[]'::jsonb or r.results is distinct from '[]'::jsonb)
    order by coalesce(r.completed_at,r.started_at),r.run_id
    limit p_limit for update of r skip locked
  ), summaries as materialized (
    select (hq_access_private.slack_sync_run_summary(c)).* from chosen c
  )
  update hq_access_private.slack_sync_runs r set
    candidates=s.candidates,results=s.results,candidate_count=s.candidate_count,checked_count=s.checked_count,
    active_count=s.active_count,deactivated_count=s.deactivated_count,unknown_count=s.unknown_count,error_code=s.error_code
  from summaries s where r.run_id=s.run_id;
  get diagnostics compacted=row_count;

  update hq_access_private.slack_sync_retention set last_maintenance_at=clock_timestamp(),last_compacted=compacted,last_pruned=pruned where singleton;
  return jsonb_build_object('enabled',true,'compacted',compacted,'pruned',pruned);
end;
$$;
revoke all on function hq_access_private.maintain_slack_sync_diagnostics(integer) from public,anon,authenticated,service_role;

-- Same start checks/snapshot/lock as the existing endpoint. Housekeeping runs
-- only after a valid new run is stored, never in place of Slack verification.
create or replace function public.hq_slack_sync_start(p_run_id uuid,p_requested_at timestamptz,p_team_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c hq_access_private.slack_sync_control; snapshot jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(823754122);
  select * into strict c from hq_access_private.slack_sync_control where singleton for share;
  if not c.enabled then return jsonb_build_object('accepted',false,'reason','disabled'); end if;
  if p_requested_at is null or p_requested_at<clock_timestamp()-interval '5 minutes' or p_requested_at>clock_timestamp()+interval '30 seconds' or p_team_id !~ '^T[A-Z0-9]+$' then
    raise exception 'Invalid sync request' using errcode='22023';
  end if;
  if exists(select 1 from hq_access_private.slack_sync_runs where run_id=p_run_id) then return jsonb_build_object('accepted',false,'reason','replay'); end if;
  if exists(select 1 from hq_access_private.slack_sync_runs where status='running' and started_at>clock_timestamp()-interval '2 minutes') then
    return jsonb_build_object('accepted',false,'reason','busy');
  end if;
  update hq_access_private.slack_sync_runs set status='error',error_code='ABANDONED_RUN',completed_at=clock_timestamp()
    where status='running' and started_at<=clock_timestamp()-interval '2 minutes';
  snapshot:=public.hq_slack_sync_candidates(p_team_id);
  if jsonb_array_length(snapshot)>100 then raise exception 'Sync population exceeds safety bound' using errcode='22023'; end if;
  insert into hq_access_private.slack_sync_runs(run_id,requested_at,team_id,dry_run,candidates) values(p_run_id,p_requested_at,p_team_id,c.dry_run,snapshot);
  begin
    perform hq_access_private.maintain_slack_sync_diagnostics(1000);
  exception when others then
    -- Cleanup failure must not prevent the unchanged five-minute security check.
    raise warning 'HQ_SLACK_SYNC_RETENTION_FAILED';
  end;
  return jsonb_build_object('accepted',true,'dry_run',c.dry_run,'candidates',snapshot);
end;
$$;
revoke all on function public.hq_slack_sync_start(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.hq_slack_sync_start(uuid,timestamptz,text) to service_role;

comment on table hq_access_private.slack_sync_retention is
  'Internal diagnostic retention only: disabled until separately approved. Normal terminal summaries 7 days; error/blocked 30 days; latest/running/revocation-linked records protected.';
comment on column hq_access_private.slack_sync_runs.candidate_count is 'Planned snapshot population; full candidate JSON exists only while a new run is running.';
comment on column hq_access_private.slack_sync_runs.checked_count is 'Number of reported results, or null when a failed/disabled run never supplied a complete result array.';
notify pgrst,'reload schema';
commit;
