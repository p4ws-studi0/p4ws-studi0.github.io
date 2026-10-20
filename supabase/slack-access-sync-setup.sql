-- Paws HQ Slack offboarding. Installation is inert: disabled and dry-run by default.
-- Existing Auth users, sessions, refresh tokens, keys, and staff approvals are untouched.
-- Run as project administrator. Re-running preserves controls, history, and trigger secret.
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists hq_access_private;
revoke all on schema hq_access_private from public, anon, authenticated, service_role;

create table if not exists hq_access_private.slack_sync_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  dry_run boolean not null default true,
  max_revocations integer not null default 3 check (max_revocations between 1 and 3)
);
insert into hq_access_private.slack_sync_control (singleton) values (true) on conflict do nothing;

create table if not exists hq_access_private.slack_sync_runs (
  run_id uuid primary key,
  requested_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  team_id text not null,
  dry_run boolean not null,
  status text not null default 'running' check (status in ('running','applied','dry_run','unchanged','blocked','disabled','error')),
  candidates jsonb not null,
  results jsonb,
  proposed integer not null default 0,
  changed integer not null default 0,
  error_code text
);
create index if not exists hq_slack_sync_runs_started_idx on hq_access_private.slack_sync_runs (started_at desc);

create table if not exists hq_access_private.slack_sync_revocations (
  run_id uuid not null references hq_access_private.slack_sync_runs(run_id),
  user_id uuid not null,
  slack_user_id text not null,
  team_id text not null,
  revoked_at timestamptz not null default clock_timestamp(),
  reason text not null default 'slack_deleted_true' check (reason = 'slack_deleted_true'),
  primary key (run_id,user_id)
);
revoke all on all tables in schema hq_access_private from public, anon, authenticated, service_role;
alter table hq_access_private.slack_sync_control enable row level security;
alter table hq_access_private.slack_sync_runs enable row level security;
alter table hq_access_private.slack_sync_revocations enable row level security;

-- Vault is provided by Supabase. The 32-byte token is never embedded in Cron SQL.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hq_slack_access_sync_trigger') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'hq_slack_access_sync_trigger', 'Server-only HQ offboarding Cron trigger');
  end if;
end;
$$;

create or replace function public.hq_slack_sync_config()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('enabled',c.enabled,'dry_run',c.dry_run,'max_revocations',c.max_revocations,
    'trigger_secret',(select v.decrypted_secret from vault.decrypted_secrets v where v.name='hq_slack_access_sync_trigger' limit 1))
  from hq_access_private.slack_sync_control c where c.singleton;
$$;

-- Only provider-owned identity_data is read; editable user_metadata is never used.
create or replace function public.hq_slack_sync_candidates(p_team_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'identity_count',coalesce(i.n,0),
    'slack_user_id',case when i.n=1 then i.slack_user_id else null end) order by s.user_id),'[]'::jsonb)
  from public.hq_tour_staff s
  left join lateral (
    select count(*)::integer as n,
      min(case when coalesce(nullif(a.identity_data->>'sub',''),nullif(a.identity_data->>'provider_id','')) ~ '^[UW][A-Z0-9]+$'
        and (nullif(a.identity_data->>'sub','') is null or nullif(a.identity_data->>'provider_id','') is null or a.identity_data->>'sub'=a.identity_data->>'provider_id')
        then coalesce(nullif(a.identity_data->>'sub',''),nullif(a.identity_data->>'provider_id','')) else null end) as slack_user_id
    from auth.identities a
    where a.user_id=s.user_id and a.provider='slack_oidc'
      and coalesce(a.identity_data#>>'{custom_claims,https://slack.com/team_id}',a.identity_data->>'https://slack.com/team_id')=p_team_id
      and (a.identity_data#>>'{custom_claims,https://slack.com/team_id}' is null or a.identity_data->>'https://slack.com/team_id' is null
        or a.identity_data#>>'{custom_claims,https://slack.com/team_id}'=a.identity_data->>'https://slack.com/team_id')
  ) i on true
  where s.active and p_team_id ~ '^T[A-Z0-9]+$';
$$;

create or replace function public.hq_slack_sync_start(p_run_id uuid,p_requested_at timestamptz,p_team_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c hq_access_private.slack_sync_control; snapshot jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(823754122);
  select * into strict c from hq_access_private.slack_sync_control where singleton for share;
  if not c.enabled then return jsonb_build_object('accepted',false,'reason','disabled'); end if;
  if p_requested_at is null or p_requested_at < clock_timestamp()-interval '5 minutes' or p_requested_at > clock_timestamp()+interval '30 seconds' or p_team_id !~ '^T[A-Z0-9]+$' then
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
  return jsonb_build_object('accepted',true,'dry_run',c.dry_run,'candidates',snapshot);
end;
$$;

create or replace function public.hq_slack_sync_fail(p_run_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_code not in ('CONFIGURATION_REQUIRED','UPSTREAM_PAYLOAD','DATABASE_UNAVAILABLE','DATABASE_PAYLOAD','SLACK_UNAVAILABLE','WORKSPACE_MISMATCH','SAFETY_LIMIT','SYNC_UNAVAILABLE') then p_code:='SYNC_UNAVAILABLE'; end if;
  update hq_access_private.slack_sync_runs set status=case when p_code='SAFETY_LIMIT' then 'blocked' else 'error' end,error_code=p_code,completed_at=clock_timestamp()
    where run_id=p_run_id and status='running';
  return jsonb_build_object('changed',0);
end;
$$;

create or replace function public.hq_slack_sync_finish(p_run_id uuid,p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c hq_access_private.slack_sync_control; r hq_access_private.slack_sync_runs; proposed_count integer; active_count integer; changed_count integer:=0; outcome text; current_candidates jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(823754122);
  select * into strict r from hq_access_private.slack_sync_runs where run_id=p_run_id for update;
  if r.status<>'running' then return jsonb_build_object('status','blocked','changed',0); end if;
  select * into strict c from hq_access_private.slack_sync_control where singleton for share;
  if not c.enabled then
    update hq_access_private.slack_sync_runs set status='disabled',completed_at=clock_timestamp() where run_id=p_run_id;
    return jsonb_build_object('status','disabled','changed',0);
  end if;
  if r.started_at<clock_timestamp()-interval '2 minutes' or p_results is null or jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>100 then
    raise exception 'Invalid sync results' using errcode='22023';
  end if;
  if jsonb_array_length(p_results)<>jsonb_array_length(r.candidates)
     or exists(select 1 from jsonb_array_elements(p_results) e where jsonb_typeof(e)<>'object' or e->>'user_id' is null or e->>'user_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or e->>'status' is null or e->>'status' not in ('active','deactivated','unknown') or not(e ? 'slack_user_id')
       or jsonb_typeof(e->'slack_user_id') not in ('null','string'))
     or (select count(distinct e->>'user_id') from jsonb_array_elements(p_results) e)<>jsonb_array_length(p_results)
     or exists(select 1 from jsonb_array_elements(p_results) e where not exists(select 1 from jsonb_array_elements(r.candidates) s where s->>'user_id'=e->>'user_id' and s->'slack_user_id'=e->'slack_user_id'
       and (e->>'status'='unknown' or (s->>'identity_count')::integer=1 and e->>'slack_user_id' ~ '^[UW][A-Z0-9]+$'))) then
    raise exception 'Results must match the server snapshot' using errcode='22023';
  end if;
  select count(*) filter(where e->>'status'='deactivated'),count(*) filter(where e->>'status'='active') into proposed_count,active_count from jsonb_array_elements(p_results) e;
  current_candidates:=public.hq_slack_sync_candidates(r.team_id);
  if proposed_count>c.max_revocations or proposed_count>0 and active_count=0
    or exists(select 1 from jsonb_array_elements(p_results) e where e->>'status'='deactivated' and not exists(select 1 from jsonb_array_elements(current_candidates) a
      where a->>'user_id'=e->>'user_id' and a->>'slack_user_id'=e->>'slack_user_id' and (a->>'identity_count')::integer=1)) then
    outcome:='blocked';
  elsif r.dry_run or c.dry_run then outcome:='dry_run';
  elsif proposed_count=0 then outcome:='unchanged';
  else
    with changed as (
      update public.hq_tour_staff s set active=false where s.active and exists(select 1 from jsonb_array_elements(p_results) e where e->>'status'='deactivated' and (e->>'user_id')::uuid=s.user_id)
      returning s.user_id
    ), audited as (
      insert into hq_access_private.slack_sync_revocations(run_id,user_id,slack_user_id,team_id)
      select p_run_id,changed_staff.user_id,e->>'slack_user_id',r.team_id from changed changed_staff join jsonb_array_elements(p_results) e on (e->>'user_id')::uuid=changed_staff.user_id returning user_id
    ) select count(*) into changed_count from audited;
    outcome:=case when changed_count=0 then 'unchanged' else 'applied' end;
  end if;
  update hq_access_private.slack_sync_runs set status=outcome,results=p_results,proposed=proposed_count,changed=changed_count,completed_at=clock_timestamp() where run_id=p_run_id;
  return jsonb_build_object('status',outcome,'changed',changed_count);
end;
$$;

-- No browser role can list provider identities, obtain the trigger token, or alter approval.
revoke all on function public.hq_slack_sync_config() from public,anon,authenticated;
revoke all on function public.hq_slack_sync_candidates(text) from public,anon,authenticated;
revoke all on function public.hq_slack_sync_start(uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function public.hq_slack_sync_fail(uuid,text) from public,anon,authenticated;
revoke all on function public.hq_slack_sync_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hq_slack_sync_config() to service_role;
grant execute on function public.hq_slack_sync_candidates(text) to service_role;
grant execute on function public.hq_slack_sync_start(uuid,timestamptz,text) to service_role;
grant execute on function public.hq_slack_sync_fail(uuid,text) to service_role;
grant execute on function public.hq_slack_sync_finish(uuid,jsonb) to service_role;

-- Paused until enabled=true. The handler independently authenticates the dedicated token.
select cron.schedule('paws-hq-slack-access-sync','*/5 * * * *',$cron$
  select net.http_post(
    url:='https://dppjgglaeieevsfwsbii.supabase.co/functions/v1/hq-slack-access-sync',
    headers:=jsonb_build_object('Content-Type','application/json','x-hq-sync-secret',v.decrypted_secret),
    body:=jsonb_build_object('run_id',gen_random_uuid(),'requested_at',clock_timestamp()),
    timeout_milliseconds:=120000
  )
  from hq_access_private.slack_sync_control c
  join vault.decrypted_secrets v on v.name='hq_slack_access_sync_trigger'
  where c.singleton and c.enabled;
$cron$);

comment on table hq_access_private.slack_sync_control is 'False-only Slack offboarding; disabled and dry-run at first installation. Does not control Auth session lifetime.';
comment on table hq_access_private.slack_sync_revocations is 'Private audit of explicit Slack deleted=true findings. Historical Auth users and attribution are retained.';
commit;
