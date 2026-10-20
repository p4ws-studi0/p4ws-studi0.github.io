-- Every verified active member of the Paws Slack workspace has the same HQ access.
-- Schema only: no user/session changes, approval enrollment, or deactivation at install.
begin;
create schema if not exists hq_access_private;
revoke all on schema hq_access_private from public,anon,authenticated,service_role;

create table if not exists hq_access_private.workspace_access_state (
  user_id uuid primary key,
  slack_user_id text not null,
  team_id text not null check(team_id='T02QW28SR39'),
  active boolean not null,
  checked_at timestamptz not null
);
alter table hq_access_private.workspace_access_state enable row level security;
revoke all on table hq_access_private.workspace_access_state from public,anon,authenticated,service_role;

create table if not exists hq_access_private.workspace_access_audit (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  slack_user_id text not null,
  team_id text not null check(team_id='T02QW28SR39'),
  action text not null check(action in ('enrolled','reactivated','revoked')),
  previous_active boolean,
  source text not null check(source in ('sign-in','scheduled')),
  checked_at timestamptz not null,
  changed_at timestamptz not null default clock_timestamp()
);
alter table hq_access_private.workspace_access_audit enable row level security;
revoke all on table hq_access_private.workspace_access_audit from public,anon,authenticated,service_role;

create or replace function public.hq_workspace_access_apply(
  p_user_id uuid,p_slack_user_id text,p_team_id text,p_deleted boolean,p_checked_at timestamptz,p_source text default 'sign-in'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  matched_count integer; actual_slack_id text; previous boolean; existed boolean; changed boolean:=false; outcome text; latest timestamptz;
begin
  if p_user_id is null or p_team_id is distinct from 'T02QW28SR39' or p_slack_user_id is null or p_slack_user_id !~ '^[UW][A-Z0-9]+$' or p_deleted is null
    or p_source not in ('sign-in','scheduled') or p_source is null or p_checked_at is null or p_checked_at<clock_timestamp()-interval '2 minutes' or p_checked_at>clock_timestamp()+interval '10 seconds' then
    raise exception 'Invalid verified membership' using errcode='22023';
  end if;
  -- Serialize enrollment for this Auth user. This is a row lock only, never an Auth update.
  perform id from auth.users where id=p_user_id for update;
  if not found then raise exception 'Auth account unavailable' using errcode='42501'; end if;
  -- Existing identity updates are locked, and the parent lock prevents a concurrent
  -- identity insert from changing the matched identity population during this apply.
  perform id from auth.identities where user_id=p_user_id and provider='slack_oidc' for share;
  select count(*)::integer,
    min(case when coalesce(nullif(a.identity_data->>'sub',''),nullif(a.identity_data->>'provider_id','')) ~ '^[UW][A-Z0-9]+$'
      and (nullif(a.identity_data->>'sub','') is null or nullif(a.identity_data->>'provider_id','') is null or a.identity_data->>'sub'=a.identity_data->>'provider_id')
      then coalesce(nullif(a.identity_data->>'sub',''),nullif(a.identity_data->>'provider_id','')) else null end)
    into matched_count,actual_slack_id
  from auth.identities a
  where a.user_id=p_user_id and a.provider='slack_oidc'
    and coalesce(a.identity_data#>>'{custom_claims,https://slack.com/team_id}',a.identity_data->>'https://slack.com/team_id')='T02QW28SR39'
    and (a.identity_data#>>'{custom_claims,https://slack.com/team_id}' is null or a.identity_data->>'https://slack.com/team_id' is null
      or a.identity_data#>>'{custom_claims,https://slack.com/team_id}'=a.identity_data->>'https://slack.com/team_id');
  if matched_count<>1 or actual_slack_id is distinct from p_slack_user_id then
    raise exception 'Provider identity changed or is unverified' using errcode='42501';
  end if;
  select checked_at into latest from hq_access_private.workspace_access_state where user_id=p_user_id;
  if latest is not null and p_checked_at<latest then
    return jsonb_build_object('allowed',false,'status','superseded','changed',false);
  end if;
  insert into hq_access_private.workspace_access_state(user_id,slack_user_id,team_id,active,checked_at)
    values(p_user_id,p_slack_user_id,p_team_id,not p_deleted,p_checked_at)
    on conflict(user_id) do update set slack_user_id=excluded.slack_user_id,team_id=excluded.team_id,active=excluded.active,checked_at=excluded.checked_at;
  select active into previous from public.hq_tour_staff where user_id=p_user_id for update;
  existed:=found;
  if p_deleted then
    if existed and previous then
      update public.hq_tour_staff set active=false where user_id=p_user_id;
      changed:=true;
    end if;
    outcome:='revoked';
  elsif not existed then
    insert into public.hq_tour_staff(user_id,active) values(p_user_id,true);
    changed:=true;outcome:='enrolled';
  elsif not previous then
    update public.hq_tour_staff set active=true where user_id=p_user_id;
    changed:=true;outcome:='reactivated';
  else outcome:='active';
  end if;
  if changed then
    insert into hq_access_private.workspace_access_audit(user_id,slack_user_id,team_id,action,previous_active,checked_at,source)
      values(p_user_id,p_slack_user_id,p_team_id,outcome,previous,p_checked_at,p_source);
  end if;
  return jsonb_build_object('allowed',not p_deleted,'status',outcome,'changed',changed);
end;
$$;
revoke all on function public.hq_workspace_access_apply(uuid,text,text,boolean,timestamptz,text) from public,anon,authenticated;
grant execute on function public.hq_workspace_access_apply(uuid,text,text,boolean,timestamptz,text) to service_role;
comment on function public.hq_workspace_access_apply(uuid,text,text,boolean,timestamptz,text) is
  'Server-only application of a fresh explicit Slack membership check. One shared staff approval, no roles or guest tiers, no Auth/session mutations.';
notify pgrst,'reload schema';
commit;
