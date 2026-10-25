-- Read-only batched display photos for existing History actors.
-- Run after activity-history-setup.sql; no Auth/profile/event rows are changed.
begin;

do $$ begin
  if to_regclass('public.hq_activity_history') is null then
    raise exception 'Install activity-history-setup.sql before History photos.';
  end if;
end $$;

create or replace function public.hq_activity_history_avatars(p_actor_ids uuid[])
returns table(actor_id uuid, avatar_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.hq_tour_staff s
      join auth.users u on u.id=s.user_id where s.user_id=auth.uid() and s.active) then
    raise exception 'Active HQ membership is required.' using errcode='42501';
  end if;
  if p_actor_ids is null or cardinality(p_actor_ids)>100 or coalesce(array_ndims(p_actor_ids),1)<>1
      or array_position(p_actor_ids,null) is not null then
    raise exception 'Request up to 100 History actor IDs.' using errcode='22023';
  end if;

  -- Only provider-owned Slack identity fields are considered. Editable Auth
  -- profile metadata, caller-supplied URLs, emails and private identity data
  -- are never exposed. Missing/unsafe photos are omitted for a generic icon.
  return query
  with requested as (select distinct unnest(p_actor_ids) as id),
  eligible as (
    select r.id from requested r where exists(select 1 from public.hq_activity_history h
      where h.actor_id=r.id and h.action<>'page_view')
  )
  select distinct on (e.id) e.id, candidate.url
  from eligible e join auth.identities i on i.user_id=e.id and i.provider='slack_oidc'
  cross join lateral (values
    (1,i.identity_data->>'avatar_url'), (2,i.identity_data->>'picture'),
    (3,i.identity_data->>'image_192'), (4,i.identity_data->>'image_512'),
    (5,i.identity_data->>'https://slack.com/user_image_192'), (6,i.identity_data->>'https://slack.com/user_image_512'),
    (7,i.identity_data->'custom_claims'->>'https://slack.com/user_image_192'),
    (8,i.identity_data->'custom_claims'->>'https://slack.com/user_image_512')
  ) candidate(priority,url)
  where char_length(candidate.url) between 1 and 2048
    and candidate.url !~ '[[:space:][:cntrl:]#]'
    and position(chr(92) in candidate.url)=0
    and (
      candidate.url ~ '^https://(avatars[.]slack-edge[.]com|a[.]slack-edge[.]com)/[^#[:space:][:cntrl:]]+$'
      or candidate.url ~ '^https://secure[.]gravatar[.]com/avatar/[a-fA-F0-9]{32}([?][^#[:space:][:cntrl:]]*)?$'
    )
  order by e.id,candidate.priority,i.id;
end;
$$;

revoke all on function public.hq_activity_history_avatars(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.hq_activity_history_avatars(uuid[]) to authenticated;
comment on function public.hq_activity_history_avatars(uuid[]) is
  'Read-only provider-owned Slack photo URLs for up to 100 actors in visible History. Active HQ staff only; exact HTTPS Slack CDN or standard secure Gravatar avatar URL; no profile/event mutations or upstream API calls.';

notify pgrst, 'reload schema';
commit;
