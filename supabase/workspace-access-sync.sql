-- Apply AFTER workspace-access-setup.sql and the original Slack sync setup.
-- All same-workspace identities are verified, including new and reactivated members.
-- Existing control settings and Auth sessions remain unchanged.
begin;
alter table hq_access_private.slack_sync_runs add column if not exists enrolled integer not null default 0;
create or replace function public.hq_slack_sync_candidates(p_team_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id',u.id,'staff_active',coalesce(s.active,false),'identity_count',coalesce(i.n,0),
    'slack_user_id',case when i.n=1 then i.slack_user_id else null end) order by u.id),'[]'::jsonb)
  from auth.users u left join public.hq_tour_staff s on s.user_id=u.id
  left join lateral (
    select count(*)::integer as n,
      min(case when coalesce(nullif(a.identity_data->>'sub',''),nullif(a.identity_data->>'provider_id','')) ~ '^[UW][A-Z0-9]+$'
        and (nullif(a.identity_data->>'sub','') is null or nullif(a.identity_data->>'provider_id','') is null or a.identity_data->>'sub'=a.identity_data->>'provider_id')
        then coalesce(nullif(a.identity_data->>'sub',''),nullif(a.identity_data->>'provider_id','')) else null end) as slack_user_id
    from auth.identities a
    where a.user_id=u.id and a.provider='slack_oidc'
      and coalesce(a.identity_data#>>'{custom_claims,https://slack.com/team_id}',a.identity_data->>'https://slack.com/team_id')=p_team_id
      and (a.identity_data#>>'{custom_claims,https://slack.com/team_id}' is null or a.identity_data->>'https://slack.com/team_id' is null
        or a.identity_data#>>'{custom_claims,https://slack.com/team_id}'=a.identity_data->>'https://slack.com/team_id')
  ) i on true
  where p_team_id='T02QW28SR39' and exists(select 1 from auth.identities a where a.user_id=u.id and a.provider='slack_oidc' and coalesce(a.identity_data#>>'{custom_claims,https://slack.com/team_id}',a.identity_data->>'https://slack.com/team_id')=p_team_id);
$$;


create or replace function public.hq_slack_sync_finish(p_run_id uuid,p_results jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c hq_access_private.slack_sync_control; r hq_access_private.slack_sync_runs;
  proposed_count integer; active_count integer; changed_count integer:=0; enrolled_count integer:=0;
  current_candidates jsonb; member_result jsonb; applied jsonb; outcome text;
begin
  perform pg_catalog.pg_advisory_xact_lock(823754122);
  select * into strict r from hq_access_private.slack_sync_runs where run_id=p_run_id for update;
  if r.status<>'running' then return jsonb_build_object('status','blocked','changed',0,'enrolled',0); end if;
  select * into strict c from hq_access_private.slack_sync_control where singleton for share;
  if not c.enabled then
    update hq_access_private.slack_sync_runs set status='disabled',completed_at=clock_timestamp() where run_id=p_run_id;
    return jsonb_build_object('status','disabled','changed',0,'enrolled',0);
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

  -- Use the same lock order as the on-demand enrollment RPC. No Auth row changes.
  perform u.id from auth.users u where exists(select 1 from jsonb_array_elements(p_results) q where q->>'status'<>'unknown' and (q->>'user_id')::uuid=u.id) order by u.id for update;
  perform a.id from auth.identities a where a.provider='slack_oidc' and exists(select 1 from jsonb_array_elements(p_results) q where q->>'status'<>'unknown' and (q->>'user_id')::uuid=a.user_id) order by a.user_id,a.id for share;
  perform s.user_id from public.hq_tour_staff s where exists(select 1 from jsonb_array_elements(p_results) q where q->>'status'<>'unknown' and (q->>'user_id')::uuid=s.user_id) order by s.user_id for update;
  current_candidates:=public.hq_slack_sync_candidates(r.team_id);
  select count(*) filter(where q->>'status'='deactivated' and exists(select 1 from public.hq_tour_staff s where s.user_id=(q->>'user_id')::uuid and s.active)),
    count(*) filter(where q->>'status'='active') into proposed_count,active_count from jsonb_array_elements(p_results) q;
  if proposed_count>c.max_revocations or proposed_count>0 and active_count=0
    or exists(select 1 from jsonb_array_elements(p_results) q where q->>'status'<>'unknown' and not exists(select 1 from jsonb_array_elements(current_candidates) a where a->>'user_id'=q->>'user_id' and a->>'slack_user_id'=q->>'slack_user_id' and (a->>'identity_count')::integer=1)) then
    outcome:='blocked';
  elsif r.dry_run or c.dry_run then outcome:='dry_run';
  else
    for member_result in select q from jsonb_array_elements(p_results) q where q->>'status'<>'unknown' order by q->>'user_id' loop
      applied:=public.hq_workspace_access_apply((member_result->>'user_id')::uuid,member_result->>'slack_user_id',r.team_id,member_result->>'status'='deactivated',r.started_at,'scheduled');
      if applied->>'changed'='true' then
        if member_result->>'status'='deactivated' then
          changed_count:=changed_count+1;
          insert into hq_access_private.slack_sync_revocations(run_id,user_id,slack_user_id,team_id) values(p_run_id,(member_result->>'user_id')::uuid,member_result->>'slack_user_id',r.team_id);
        else enrolled_count:=enrolled_count+1;
        end if;
      end if;
    end loop;
    if changed_count>c.max_revocations then raise exception 'Revocation safety limit exceeded' using errcode='22023'; end if;
    outcome:=case when changed_count+enrolled_count>0 then 'applied' else 'unchanged' end;
  end if;
  update hq_access_private.slack_sync_runs set status=outcome,results=p_results,proposed=proposed_count,changed=changed_count,enrolled=enrolled_count,completed_at=clock_timestamp() where run_id=p_run_id;
  return jsonb_build_object('status',outcome,'changed',changed_count,'enrolled',enrolled_count);
end;
$$;
revoke all on function public.hq_slack_sync_candidates(text) from public,anon,authenticated;
revoke all on function public.hq_slack_sync_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hq_slack_sync_candidates(text) to service_role;
grant execute on function public.hq_slack_sync_finish(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
