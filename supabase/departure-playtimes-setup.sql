-- Departure playtimes: shared exceptions, notes, and a trusted current-day projection.
-- No account/session updates, Gingr writes, invoice changes, or sample data.
begin;

create schema if not exists hq_departure_private;
revoke all on schema hq_departure_private from public, anon, authenticated, service_role;

create table if not exists hq_departure_private.source_cache (
  location_id text primary key check (location_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  business_date date not null,
  view jsonb,
  source_version text,
  fetched_at timestamptz,
  source_error text,
  lease_token uuid,
  lease_until timestamptz,
  retry_after timestamptz
);
create table if not exists hq_departure_private.targets (
  key text primary key check (char_length(key) between 1 and 400),
  location_id text not null,
  business_date date not null,
  kind text not null check (kind in ('departure','service')),
  dog_name text not null,
  service_name text not null,
  active boolean not null default true,
  source_version text not null,
  fetched_at timestamptz not null
);
create index if not exists hq_departure_targets_location_day_idx on hq_departure_private.targets(location_id,business_date);
create table if not exists hq_departure_private.action_requests (
  request_id uuid primary key,
  actor_id uuid not null,
  kind text not null check (kind in ('skip','note')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.hq_departure_playtime_overrides (
  key text primary key,
  location_id text not null,
  business_date date not null,
  skipped boolean not null,
  revision integer not null check (revision between 1 and 1000000),
  changed_by uuid not null,
  changed_by_name text not null,
  changed_at timestamptz not null
);
create index if not exists hq_departure_overrides_day_idx on public.hq_departure_playtime_overrides(location_id,business_date);
create table if not exists public.hq_departure_playtime_notes (
  key text primary key,
  location_id text not null,
  business_date date not null,
  note text not null check (char_length(note) <= 1000),
  note_revision integer not null check (note_revision between 1 and 1000000),
  updated_by uuid not null,
  updated_by_name text not null,
  updated_at timestamptz not null
);
create index if not exists hq_departure_notes_day_idx on public.hq_departure_playtime_notes(location_id,business_date);
create table if not exists public.hq_departure_playtime_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  key text not null,
  location_id text not null,
  business_date date not null,
  dog_name text not null,
  service_name text not null,
  actor_id uuid not null,
  actor_name text not null,
  occurred_at timestamptz not null,
  action text not null check (action in ('skip','undo','note')),
  skipped boolean,
  revision integer,
  note text,
  note_revision integer
);
create index if not exists hq_departure_audit_location_time_idx on public.hq_departure_playtime_audit(location_id,occurred_at desc,id desc);

revoke all on all tables in schema hq_departure_private from public, anon, authenticated, service_role;
revoke all on table public.hq_departure_playtime_overrides,public.hq_departure_playtime_notes,public.hq_departure_playtime_audit from public,anon,authenticated,service_role;
revoke all on sequence public.hq_departure_playtime_audit_id_seq from public,anon,authenticated,service_role;
grant select on table public.hq_departure_playtime_overrides,public.hq_departure_playtime_notes,public.hq_departure_playtime_audit to authenticated;

do $$declare target text;begin
  foreach target in array array['hq_departure_playtime_overrides','hq_departure_playtime_notes','hq_departure_playtime_audit'] loop
    execute format('alter table public.%I enable row level security',target);
    execute format('alter table public.%I force row level security',target);
    execute format('drop policy if exists hq_departure_member_read on public.%I',target);
    execute format('create policy hq_departure_member_read on public.%I for select to authenticated using (exists(select 1 from public.hq_tour_staff s where s.user_id=(select auth.uid()) and s.active))',target);
  end loop;
end;$$;

create or replace function hq_departure_private.member()
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); approved boolean;
begin
  select s.active into approved from public.hq_tour_staff s join auth.users u on u.id=s.user_id where s.user_id=actor for share of s;
  if actor is null or approved is distinct from true then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  return actor;
end;$$;
revoke all on function hq_departure_private.member() from public,anon,authenticated,service_role;

create or replace function hq_departure_private.actor_name(p_actor uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(nullif(left(btrim(regexp_replace(coalesce(
    (select coalesce(nullif(i.identity_data->>'name',''),nullif(i.identity_data->>'full_name','')) from auth.identities i
      where i.user_id=p_actor and i.provider='slack_oidc' order by i.id limit 1),''),'[[:cntrl:]]+',' ','g')),120),''),'Paws HQ member');
$$;
revoke all on function hq_departure_private.actor_name(uuid) from public,anon,authenticated,service_role;

create or replace function hq_departure_private.append_only()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'APPEND_ONLY' using errcode='42501';end;$$;
revoke all on function hq_departure_private.append_only() from public,anon,authenticated,service_role;
drop trigger if exists hq_departure_audit_append_only on public.hq_departure_playtime_audit;
create trigger hq_departure_audit_append_only before update or delete on public.hq_departure_playtime_audit for each row execute function hq_departure_private.append_only();

create or replace function public.hq_departure_playtimes_claim_refresh(p_location_id text default '1')
returns jsonb language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); today date:=(stamp at time zone 'America/New_York')::date;
  cache hq_departure_private.source_cache%rowtype; token uuid; busy boolean; due boolean;
begin
  if p_location_id is null or p_location_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('hq-departure-source:'||p_location_id,0));
  insert into hq_departure_private.source_cache(location_id,business_date) values(p_location_id,today) on conflict do nothing;
  select * into cache from hq_departure_private.source_cache where location_id=p_location_id for update;
  if cache.business_date<>today then
    update hq_departure_private.source_cache set business_date=today,view=null,source_version=null,fetched_at=null,source_error=null,lease_token=null,lease_until=null,retry_after=null where location_id=p_location_id returning * into cache;
    delete from hq_departure_private.targets where location_id=p_location_id and business_date<>today;
  end if;
  busy:=cache.lease_token is not null and cache.lease_until>stamp;
  due:=(cache.view is null or cache.source_error is not null or cache.fetched_at<stamp-interval '60 seconds' or cache.fetched_at>stamp+interval '5 seconds') and coalesce(cache.retry_after<=stamp,true);
  if not busy and due then
    token:=gen_random_uuid();
    update hq_departure_private.source_cache set lease_token=token,lease_until=stamp+interval '120 seconds' where location_id=p_location_id;
  end if;
  return jsonb_build_object('claimed',token is not null,'leaseToken',token,'locationId',p_location_id,'businessDate',today,'source',cache.view,
    'refreshDue',due,'refreshing',busy or token is not null,'sourceError',cache.source_error);
end;$$;
revoke all on function public.hq_departure_playtimes_claim_refresh(text) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_claim_refresh(text) to service_role;

create or replace function public.hq_departure_playtimes_publish(p_location_id text,p_lease_token uuid,p_view jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); today date:=(stamp at time zone 'America/New_York')::date;
  cache hq_departure_private.source_cache%rowtype; fetched timestamptz; version text; pet jsonb; service jsonb;
  res text; animal text; name text; owner_name text; species text; departure timestamptz; checked_out timestamptz;
  note_key text; item_key text; occurrence text; catalog text; label text; quantity integer;
  seen text[]:='{}'; all_pets jsonb:='[]'; services jsonb; safe_pet jsonb; safe_service jsonb; clean_view jsonb;
  pet_count integer:=0; service_count integer:=0; dog_count integer; cat_count integer; distinct_pets integer;
begin
  select * into cache from hq_departure_private.source_cache where location_id=p_location_id for update;
  if not found or p_lease_token is null or cache.lease_token is distinct from p_lease_token or cache.business_date<>today or cache.lease_until<stamp then
    return jsonb_build_object('published',false,'businessDate',today);
  end if;
  if p_view is null or jsonb_typeof(p_view)<>'object' or octet_length(p_view::text)>2097152
    or p_view->>'businessDate' is distinct from today::text or p_view->>'locationId' is distinct from p_location_id or p_view->>'sourceComplete' is distinct from 'true'
    or p_view->>'scheduleVersion' is null or p_view->>'scheduleVersion' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_view->'departures') is distinct from 'array' or jsonb_array_length(p_view->'departures')>5000
    or coalesce(p_view->>'fetchedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'INVALID_SOURCE' using errcode='22023';
  end if;
  begin fetched:=(p_view->>'fetchedAt')::timestamptz;exception when others then raise exception 'INVALID_SOURCE' using errcode='22023';end;
  if fetched is null or fetched<stamp-interval '90 seconds' or fetched>stamp+interval '5 seconds' then raise exception 'STALE_SOURCE' using errcode='55000';end if;
  if cache.fetched_at is not null and fetched<cache.fetched_at then return jsonb_build_object('published',false,'businessDate',today);end if;
  version:=p_view->>'scheduleVersion';
  update hq_departure_private.targets set active=false where location_id=p_location_id and business_date=today;
  for pet in select value from jsonb_array_elements(p_view->'departures') loop
    res:=pet->>'reservationId';animal:=pet->>'animalId';name:=pet->>'dogName';owner_name:=pet->>'ownerLast';species:=pet->>'species';
    if jsonb_typeof(pet)<>'object' or res is null or res !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' or animal is null or animal !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
      or name is null or btrim(name)='' or char_length(name)>160 or name~'[[:cntrl:]]' or owner_name is null or char_length(owner_name)>160 or owner_name~'[[:cntrl:]]'
      or species is null or species not in ('dog','cat') or coalesce(pet->>'cancelled','false')<>'false' or jsonb_typeof(pet->'services') is distinct from 'array'
      or coalesce(pet->>'departureAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$'
      or pet->>'checkedOutAt' is not null and pet->>'checkedOutAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
    begin departure:=(pet->>'departureAt')::timestamptz;checked_out:=(pet->>'checkedOutAt')::timestamptz;exception when others then raise exception 'INVALID_SOURCE' using errcode='22023';end;
    if departure is null or (departure at time zone 'America/New_York')::date<>today then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
    note_key:='departure:'||p_location_id||':'||res||':'||animal||':'||today::text;
    if note_key=any(seen) or pet?'noteKey' and pet->>'noteKey' is distinct from note_key then raise exception 'CONFLICTING_SOURCE' using errcode='22023';end if;
    seen:=array_append(seen,note_key);
    insert into hq_departure_private.targets(key,location_id,business_date,kind,dog_name,service_name,active,source_version,fetched_at)
      values(note_key,p_location_id,today,'departure',name,'Departure note',true,version,fetched)
      on conflict(key) do update set active=true,source_version=excluded.source_version,fetched_at=excluded.fetched_at,dog_name=excluded.dog_name;
    services:='[]';
    for service in select value from jsonb_array_elements(pet->'services') loop
      service_count:=service_count+1;if service_count>10000 then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
      item_key:=service->>'key';occurrence:=service->>'occurrenceId';catalog:=service->>'serviceId';label:=service->>'serviceName';
      if jsonb_typeof(service)<>'object' or occurrence is null or occurrence !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' or right(occurrence,11)<>'.'||today::text
        or item_key is distinct from p_location_id||':'||res||':'||animal||':'||occurrence
        or catalog is null or catalog !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' or label is null or btrim(label)='' or char_length(label)>160 or label~'[[:cntrl:]]'
        or service->>'serviceDate' is distinct from today::text or coalesce(service->>'verified','false')<>'false' or coalesce(service->>'quantity','') !~ '^[0-9]{1,4}$' then raise exception 'INVALID_SOURCE' using errcode='22023';end if;
      quantity:=(service->>'quantity')::integer;if quantity not between 1 and 1000 or item_key=any(seen) then raise exception 'CONFLICTING_SOURCE' using errcode='22023';end if;
      seen:=array_append(seen,item_key);
      insert into hq_departure_private.targets(key,location_id,business_date,kind,dog_name,service_name,active,source_version,fetched_at)
        values(item_key,p_location_id,today,'service',name,label,true,version,fetched)
        on conflict(key) do update set active=true,source_version=excluded.source_version,fetched_at=excluded.fetched_at,dog_name=excluded.dog_name,service_name=excluded.service_name;
      safe_service:=jsonb_build_object('key',item_key,'occurrenceId',occurrence,'serviceId',catalog,'serviceName',label,'serviceDate',today,'quantity',quantity,
        'skipped',false,'revision',0,'status','On today’s plan','verified',false,'skippedBy',null,'skippedAt',null,'note','','noteRevision',0,'noteUpdatedBy',null,'noteUpdatedAt',null);
      services:=services||jsonb_build_array(safe_service);
    end loop;
    safe_pet:=jsonb_build_object('reservationId',res,'animalId',animal,'dogName',name,'ownerLast',owner_name,'species',species,'departureAt',departure,'checkedOutAt',checked_out,
      'cancelled',false,'noteKey',note_key,'note','','noteRevision',0,'noteUpdatedBy',null,'noteUpdatedAt',null,'services',services);
    all_pets:=all_pets||jsonb_build_array(safe_pet);pet_count:=pet_count+1;
  end loop;
  select count(distinct value->>'animalId') filter(where value->>'species'='dog'),count(distinct value->>'animalId') filter(where value->>'species'='cat'),count(distinct value->>'animalId')
    into dog_count,cat_count,distinct_pets from jsonb_array_elements(all_pets);
  clean_view:=jsonb_build_object('businessDate',today,'locationId',p_location_id,'timezone','America/New_York','fetchedAt',fetched,'scheduleVersion',version,'sourceComplete',true,'departures',all_pets,
    'summary',jsonb_build_object('dogs',dog_count,'cats',cat_count,'pets',distinct_pets,'departures',pet_count,'playtimes',service_count,'skipped',0));
  update hq_departure_private.source_cache set view=clean_view,source_version=version,fetched_at=fetched,source_error=null,lease_token=null,lease_until=null,retry_after=null where location_id=p_location_id;
  return jsonb_build_object('published',true,'businessDate',today,'sourceVersion',version);
end;$$;
revoke all on function public.hq_departure_playtimes_publish(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_publish(text,uuid,jsonb) to service_role;

create or replace function public.hq_departure_playtimes_fail_refresh(p_location_id text,p_lease_token uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); code text; affected integer;
begin
  code:=case when p_code in ('CONNECTION_REQUIRED','SOURCE_CHANGED','GINGR_KEY_REQUIRED','GINGR_KEY_REJECTED','GINGR_KEY_OR_PERMISSION_REQUIRED','GINGR_CONNECTION_FAILED','GINGR_RATE_LIMITED','GINGR_READ_FAILED','GINGR_RESPONSE_INVALID','GINGR_RESPONSE_TOO_LARGE','SOURCE_MAPPING_REQUIRED','SOURCE_INCOMPLETE','CONFLICTING_SOURCE','STALE_SOURCE','SOURCE_UNAVAILABLE') then p_code else 'SOURCE_UNAVAILABLE' end;
  update hq_departure_private.source_cache set source_error=code,lease_token=null,lease_until=null,retry_after=stamp+case when code='GINGR_RATE_LIMITED' then interval '60 seconds' else interval '30 seconds' end
    where location_id=p_location_id and lease_token=p_lease_token and business_date=(stamp at time zone 'America/New_York')::date;
  get diagnostics affected=row_count;return jsonb_build_object('recorded',affected=1);
end;$$;
revoke all on function public.hq_departure_playtimes_fail_refresh(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_fail_refresh(text,uuid,text) to service_role;

create or replace function public.hq_departure_playtimes_day(p_location_id text default '1')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;stamp timestamptz:=clock_timestamp();today date:=(stamp at time zone 'America/New_York')::date;
  cache hq_departure_private.source_cache%rowtype; source jsonb;states jsonb;notes jsonb;busy boolean;due boolean;stale boolean;age integer;
begin
  actor:=hq_departure_private.member();
  if p_location_id is null or p_location_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  select * into cache from hq_departure_private.source_cache where location_id=p_location_id and business_date=today;
  source:=cache.view;age:=case when cache.fetched_at is null then null else greatest(0,floor(extract(epoch from stamp-cache.fetched_at))::integer) end;
  busy:=coalesce(cache.lease_token is not null and cache.lease_until>stamp,false);
  stale:=source is null or cache.source_error is not null or cache.fetched_at<stamp-interval '90 seconds' or cache.fetched_at>stamp+interval '5 seconds';
  due:=not busy and coalesce(cache.retry_after<=stamp,true) and (source is null or cache.source_error is not null or cache.fetched_at<stamp-interval '60 seconds' or cache.fetched_at>stamp+interval '5 seconds');
  select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'skipped',s.skipped,'revision',s.revision,'skippedBy',case when s.skipped then jsonb_build_object('id',s.changed_by,'name',s.changed_by_name) else null end,'skippedAt',case when s.skipped then to_jsonb(s.changed_at) else null end) order by s.key),'[]') into states
    from public.hq_departure_playtime_overrides s where s.location_id=p_location_id and s.business_date=today;
  select coalesce(jsonb_agg(jsonb_build_object('key',n.key,'note',n.note,'noteRevision',n.note_revision,'noteUpdatedBy',jsonb_build_object('id',n.updated_by,'name',n.updated_by_name),'noteUpdatedAt',n.updated_at) order by n.key),'[]') into notes
    from public.hq_departure_playtime_notes n where n.location_id=p_location_id and n.business_date=today;
  return jsonb_build_object('source',source,'states',states,'notes',notes,'sourceError',cache.source_error,'sourceAgeSeconds',age,'stale',stale,'refreshDue',due,'refreshing',busy,'businessDate',today);
end;$$;
revoke all on function public.hq_departure_playtimes_day(text) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_day(text) to authenticated;

create or replace function public.hq_departure_playtimes_set_skip(p_request_id uuid,p_key text,p_skipped boolean,p_expected_revision integer,p_source_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;actor_name text;stamp timestamptz;today date;target hq_departure_private.targets%rowtype;cache hq_departure_private.source_cache%rowtype;
  state public.hq_departure_playtime_overrides%rowtype;prior hq_departure_private.action_requests%rowtype;payload jsonb;revision integer;was_skipped boolean;changed boolean;ack jsonb;event_id bigint;
begin
  actor:=hq_departure_private.member();
  if p_request_id is null or p_key is null or char_length(p_key) not between 1 and 400 or p_skipped is null or p_expected_revision is null or p_expected_revision not between 0 and 1000000 or p_source_version is null or p_source_version !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  payload:=jsonb_build_object('key',p_key,'skipped',p_skipped,'expectedRevision',p_expected_revision,'sourceVersion',p_source_version);
  perform pg_advisory_xact_lock(hashtextextended('hq-departure-request:'||p_request_id::text,0));
  select * into prior from hq_departure_private.action_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>actor or prior.kind<>'skip' or prior.payload<>payload then raise exception 'REQUEST_ID_CONFLICT' using errcode='23505';end if;
    return prior.result||jsonb_build_object('idempotent',true);
  end if;
  stamp:=clock_timestamp();today:=(stamp at time zone 'America/New_York')::date;
  -- Source publication and all mutations lock the cache before target/state rows.
  select c.* into cache from hq_departure_private.source_cache c join hq_departure_private.targets t on t.location_id=c.location_id where t.key=p_key for share of c;
  if not found then raise exception 'UNKNOWN_SERVICE' using errcode='55000';end if;
  select * into target from hq_departure_private.targets where key=p_key for update;
  if not target.active or target.kind<>'service' or target.business_date<>today or cache.business_date<>today then raise exception 'UNKNOWN_SERVICE' using errcode='55000';end if;
  if cache.view is null or cache.source_error is not null or cache.fetched_at is null or cache.fetched_at<stamp-interval '90 seconds' or cache.fetched_at>stamp+interval '5 seconds' then raise exception 'STALE_SOURCE' using errcode='55000';end if;
  if cache.source_version is distinct from p_source_version or target.source_version is distinct from p_source_version then raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
  select * into state from public.hq_departure_playtime_overrides where key=p_key for update;
  revision:=coalesce(state.revision,0);was_skipped:=coalesce(state.skipped,false);
  if revision<>p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  changed:=was_skipped is distinct from p_skipped;
  if changed then
    if revision>=1000000 then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
    actor_name:=hq_departure_private.actor_name(actor);revision:=revision+1;
    insert into public.hq_departure_playtime_overrides(key,location_id,business_date,skipped,revision,changed_by,changed_by_name,changed_at)
      values(p_key,target.location_id,today,p_skipped,revision,actor,actor_name,stamp)
      on conflict(key) do update set skipped=excluded.skipped,revision=excluded.revision,changed_by=excluded.changed_by,changed_by_name=excluded.changed_by_name,changed_at=excluded.changed_at returning * into state;
    insert into public.hq_departure_playtime_audit(request_id,key,location_id,business_date,dog_name,service_name,actor_id,actor_name,occurred_at,action,skipped,revision)
      values(p_request_id,p_key,target.location_id,today,target.dog_name,target.service_name,actor,actor_name,stamp,case when p_skipped then 'skip' else 'undo' end,p_skipped,revision) returning id into event_id;
  end if;
  ack:=jsonb_build_object('changed',changed,'idempotent',false,'eventId',event_id,'service',jsonb_build_object('key',p_key,'skipped',p_skipped,'revision',revision,'skippedBy',case when p_skipped then jsonb_build_object('id',state.changed_by,'name',state.changed_by_name) else null end,'skippedAt',case when p_skipped then to_jsonb(state.changed_at) else null end));
  insert into hq_departure_private.action_requests(request_id,actor_id,kind,payload,result) values(p_request_id,actor,'skip',payload,ack);
  return ack;
end;$$;
revoke all on function public.hq_departure_playtimes_set_skip(uuid,text,boolean,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_set_skip(uuid,text,boolean,integer,text) to authenticated;

create or replace function public.hq_departure_playtimes_save_note(p_request_id uuid,p_key text,p_note text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;actor_name text;stamp timestamptz;today date;target hq_departure_private.targets%rowtype;cache hq_departure_private.source_cache%rowtype;
  state public.hq_departure_playtime_notes%rowtype;prior hq_departure_private.action_requests%rowtype;payload jsonb;revision integer;note text;changed boolean;ack jsonb;event_id bigint;
begin
  actor:=hq_departure_private.member();
  if p_request_id is null or p_key is null or char_length(p_key) not between 1 and 400 or p_note is null or p_expected_revision is null or p_expected_revision not between 0 and 1000000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  note:=btrim(replace(replace(p_note,E'\r\n',E'\n'),E'\r',E'\n'),E' \t\n\r\f\v'||chr(160)||chr(65279));
  if char_length(note)>1000 or note~'[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  payload:=jsonb_build_object('key',p_key,'note',note,'expectedNoteRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('hq-departure-request:'||p_request_id::text,0));
  select * into prior from hq_departure_private.action_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>actor or prior.kind<>'note' or prior.payload<>payload then raise exception 'REQUEST_ID_CONFLICT' using errcode='23505';end if;
    return prior.result||jsonb_build_object('idempotent',true);
  end if;
  stamp:=clock_timestamp();today:=(stamp at time zone 'America/New_York')::date;
  select c.* into cache from hq_departure_private.source_cache c join hq_departure_private.targets t on t.location_id=c.location_id where t.key=p_key for share of c;
  if not found then raise exception 'UNKNOWN_SERVICE' using errcode='55000';end if;
  select * into target from hq_departure_private.targets where key=p_key for update;
  if not target.active or target.business_date<>today or cache.business_date<>today then raise exception 'UNKNOWN_SERVICE' using errcode='55000';end if;
  if cache.view is null or cache.source_error is not null or cache.fetched_at is null or cache.fetched_at<stamp-interval '90 seconds' or cache.fetched_at>stamp+interval '5 seconds' then raise exception 'STALE_SOURCE' using errcode='55000';end if;
  select * into state from public.hq_departure_playtime_notes where key=p_key for update;
  revision:=coalesce(state.note_revision,0);
  if revision<>p_expected_revision then raise exception 'NOTE_REVISION_CONFLICT' using errcode='40001';end if;
  changed:=note is distinct from coalesce(state.note,'');
  if changed then
    if revision>=1000000 then raise exception 'NOTE_REVISION_CONFLICT' using errcode='40001';end if;
    actor_name:=hq_departure_private.actor_name(actor);revision:=revision+1;
    insert into public.hq_departure_playtime_notes(key,location_id,business_date,note,note_revision,updated_by,updated_by_name,updated_at)
      values(p_key,target.location_id,today,note,revision,actor,actor_name,stamp)
      on conflict(key) do update set note=excluded.note,note_revision=excluded.note_revision,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=excluded.updated_at returning * into state;
    insert into public.hq_departure_playtime_audit(request_id,key,location_id,business_date,dog_name,service_name,actor_id,actor_name,occurred_at,action,note,note_revision)
      values(p_request_id,p_key,target.location_id,today,target.dog_name,target.service_name,actor,actor_name,stamp,'note',note,revision) returning id into event_id;
  end if;
  ack:=jsonb_build_object('changed',changed,'idempotent',false,'eventId',event_id,'service',jsonb_build_object('key',p_key,'note',note,'noteRevision',revision,'noteUpdatedBy',case when state.updated_by is null then null else jsonb_build_object('id',state.updated_by,'name',state.updated_by_name) end,'noteUpdatedAt',state.updated_at));
  insert into hq_departure_private.action_requests(request_id,actor_id,kind,payload,result) values(p_request_id,actor,'note',payload,ack);
  return ack;
end;$$;
revoke all on function public.hq_departure_playtimes_save_note(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_save_note(uuid,text,text,integer) to authenticated;

create or replace function public.hq_departure_playtimes_history(p_location_id text default '1',p_limit integer default 60)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;events jsonb;
begin
  actor:=hq_departure_private.member();
  if p_location_id is null or p_location_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' or p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'requestId',a.request_id,'key',a.key,'businessDate',a.business_date,'dogName',a.dog_name,'serviceName',a.service_name,'actor',jsonb_build_object('id',a.actor_id,'name',a.actor_name),'occurredAt',a.occurred_at,'action',a.action,'skipped',a.skipped,'revision',a.revision,'note',a.note,'noteRevision',a.note_revision) order by a.occurred_at desc,a.id desc),'[]') into events
    from (select * from public.hq_departure_playtime_audit where location_id=p_location_id order by occurred_at desc,id desc limit p_limit) a;
  return events;
end;$$;
revoke all on function public.hq_departure_playtimes_history(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.hq_departure_playtimes_history(text,integer) to authenticated;

notify pgrst,'reload schema';
commit;
