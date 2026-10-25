-- Shared HQ activity history. Install after the existing operational schemas.
-- No backfill, account changes, session changes, or operational RLS changes.
begin;

create schema if not exists hq_history_private;
revoke all on schema hq_history_private from public, anon, authenticated, service_role;

create table if not exists hq_history_private.installation (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default clock_timestamp(),
  version integer not null default 1 check (version = 1)
);
revoke all on table hq_history_private.installation from public, anon, authenticated, service_role;
insert into hq_history_private.installation(singleton) values(true) on conflict do nothing;

create table if not exists public.hq_activity_history (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  actor_name text not null check (btrim(actor_name) <> '' and char_length(actor_name) <= 120),
  action text not null check (action in ('create','update','delete','restore','page_view','sign_in')),
  section text not null check (section ~ '^[a-z][a-z0-9-]{0,59}$'),
  source_table text,
  record_id uuid,
  record_label text not null default '' check (char_length(record_label) <= 160),
  changed_fields text[] not null default '{}'::text[]
    check (cardinality(changed_fields) <= 80 and array_to_string(changed_fields, ',') !~ '[^a-z0-9_,]'),
  page_path text,
  source text not null check (source in ('database','client')),
  constraint hq_activity_history_source_valid check (
    (source = 'database' and source_table is not null and record_id is not null
      and page_path is null and action in ('create','update','delete','restore'))
    or (source = 'client' and source_table is null and record_id is null
      and page_path is not null and action in ('page_view','sign_in') and cardinality(changed_fields) = 0)
  )
);

create index if not exists hq_activity_history_time_idx on public.hq_activity_history(occurred_at desc, id desc);
create index if not exists hq_activity_history_actor_idx on public.hq_activity_history(actor_id, id desc);
create index if not exists hq_activity_history_section_idx on public.hq_activity_history(section, id desc);
create index if not exists hq_activity_history_action_idx on public.hq_activity_history(action, id desc);
create index if not exists hq_activity_history_visit_idx
  on public.hq_activity_history(actor_id, action, page_path, occurred_at desc) where source = 'client';

alter table public.hq_activity_history enable row level security;
alter table public.hq_activity_history force row level security;
revoke all on table public.hq_activity_history from public, anon, authenticated, service_role;
revoke all on sequence public.hq_activity_history_id_seq from public, anon, authenticated, service_role;
grant select on table public.hq_activity_history to authenticated;

drop policy if exists hq_activity_history_staff_read on public.hq_activity_history;
create policy hq_activity_history_staff_read on public.hq_activity_history for select to authenticated
using (action<>'page_view' and exists(select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

-- UUID and time are authoritative. Names are a display snapshot from the
-- provider-owned Slack identity, never caller arguments or editable profile data.
-- No FK: removing an Auth user must not erase or rewrite an older event.
create or replace function hq_history_private.actor_name(p_actor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(left(btrim(regexp_replace(coalesce(
    (select coalesce(nullif(i.identity_data->>'name',''), nullif(i.identity_data->>'full_name',''))
      from auth.identities i where i.user_id = p_actor and i.provider = 'slack_oidc'
      order by i.id limit 1), ''), '[[:cntrl:]]+', ' ', 'g')), 120), ''), 'Paws HQ member');
$$;
revoke all on function hq_history_private.actor_name(uuid) from public, anon, authenticated, service_role;

create or replace function public.hq_activity_history_info()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.hq_tour_staff s where s.user_id = auth.uid() and s.active) then
    raise exception 'Active HQ membership is required.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('started_at', started_at, 'version', version, 'best_effort', true)
    from hq_history_private.installation where singleton);
end;
$$;
revoke all on function public.hq_activity_history_info() from public, anon, authenticated, service_role;
grant execute on function public.hq_activity_history_info() to authenticated;

create or replace function public.hq_activity_history_capture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  before_row jsonb;
  after_row jsonb;
  row_data jsonb;
  fields text[];
  changed text[];
  event_action text;
  event_section text;
  label text;
  parent_label text;
  target_id uuid;
begin
  -- Anonymous/admin imports without a real active HQ actor are not invented
  -- human activity. Operational authorization remains the existing table's job.
  if actor is null or not exists(select 1 from public.hq_tour_staff s
      join auth.users u on u.id = s.user_id where s.user_id = actor and s.active) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_schema <> 'public' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Explicit scope: no account/membership/security tables, imported archives,
  -- private knowledge content, or this history table can enter this trigger.
  case tg_table_name
    when 'hq_tours' then
      event_section := 'tours';
      fields := array['customer_name','customer_info','tour_date','tour_time','has_file','booking_status','staff_initials','outside_hours_confirmed'];
    when 'hq_training_dogs' then
      event_section := 'training'; fields := array['name'];
    when 'hq_training_logs' then
      event_section := 'training'; fields := array['dog_id','day_label','date_label','session_label','time_label','trainer','work_detail','notes'];
    when 'hq_dog_licenses' then
      event_section := 'dog-licenses'; fields := array['pet_name','request_type','initials'];
    when 'hq_follow_up_calls' then
      event_section := 'follow-up-calls'; fields := array['owner_name','pet_name','res_start_date','res_end_date','call_made','call_made_on','initials','notes'];
    when 'hq_marketing_initiatives' then
      event_section := 'marketing-initiatives'; fields := array['drop_off_location','initiative_date','notes'];
    when 'hq_biscuit_locations' then
      event_section := 'biscuit-baskets'; fields := array['location_name','town','status','status_notes'];
    when 'hq_biscuit_visits' then
      event_section := 'biscuit-baskets'; fields := array['location_id','visited_on','items_given','spoke_to','town','notes'];
    when 'hq_suggestions' then
      event_section := 'suggestions'; fields := array['suggestion','suggestion_date','outcome'];
    when 'hq_gift_cards' then
      event_section := 'gift-cards'; fields := array['certificate_number','amount','purchased_date','purchaser_name','purchase_initials','redeemed_date','redeemer_name','redemption_initials'];
    when 'hq_realtors' then
      event_section := 'realtor-info'; fields := array['realtor_name','phone','email','location'];
    when 'hq_realtor_contacts' then
      event_section := 'realtor-info'; fields := array['realtor_id','contacted_date','notes'];
    when 'hq_k9_cough' then
      event_section := 'k9-cough'; fields := array['added_date','initials','pet_name','service_dates','room','group_type','services','notes','pcw_reimbursement','management_follow_up'];
    when 'hq_vet_cheat_sheet' then
      event_section := 'vet-cheat-sheet'; fields := array['veterinarian','phone','normal_hours','lunch_break','menu_button','no_reply_email','notes'];
    when 'hq_potential_training_clients' then
      event_section := 'potential-training-clients'; fields := array['owner','dog','phone','initial_conversation','first_contact','follow_up','evaluation','outcome'];
    when 'hq_end_of_day' then
      event_section := 'end-of-day'; fields := array['entry_date','staff_name','cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','receipt_description','drawer_total','cash_replaced','cash_deposit','check_deposit','total_deposit','notes','additional_note','bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
    else
      if tg_op = 'DELETE' then return old; else return new; end if;
  end case;

  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  row_data := coalesce(after_row, before_row);
  target_id := (row_data->>'id')::uuid;
  if tg_op = 'INSERT' then
    event_action := 'create';
    select coalesce(array_agg(f order by f), '{}'::text[]) into changed
      from unnest(fields) f where after_row ? f and after_row->f is distinct from 'null'::jsonb and after_row->f is distinct from '""'::jsonb;
  elsif tg_op = 'DELETE' then
    event_action := 'delete'; changed := '{}'::text[];
  else
    select coalesce(array_agg(f order by f), '{}'::text[]) into changed
      from unnest(fields) f where before_row->f is distinct from after_row->f;
    if before_row->>'deleted_at' is null and after_row->>'deleted_at' is not null then
      event_action := 'delete';
    elsif before_row->>'deleted_at' is not null and after_row->>'deleted_at' is null then
      event_action := 'restore';
    elsif cardinality(changed) = 0 then
      return new; -- Includes revisions/timestamps, retry no-ops, and import metadata.
    else event_action := 'update';
    end if;
  end if;

  -- Minimal labels identify the row; no notes, message/suggestion text,
  -- financial amounts, contact details, or before/after values are retained.
  case tg_table_name
    when 'hq_tours' then label := row_data->>'customer_name';
    when 'hq_training_dogs' then label := row_data->>'name';
    when 'hq_training_logs' then
      select d.name into parent_label from public.hq_training_dogs d where d.id = (row_data->>'dog_id')::uuid;
      label := concat_ws(' · ', nullif(parent_label,''), nullif(row_data->>'date_label',''));
    when 'hq_dog_licenses' then label := row_data->>'pet_name';
    when 'hq_follow_up_calls' then label := concat_ws(' · ',nullif(row_data->>'owner_name',''),nullif(row_data->>'pet_name',''));
    when 'hq_marketing_initiatives' then label := row_data->>'drop_off_location';
    when 'hq_biscuit_locations' then label := row_data->>'location_name';
    when 'hq_biscuit_visits' then
      select l.location_name into parent_label from public.hq_biscuit_locations l where l.id = (row_data->>'location_id')::uuid;
      label := concat_ws(' · ',nullif(parent_label,''),nullif(row_data->>'visited_on',''));
    when 'hq_suggestions' then label := concat_ws(' · ','Suggestion',nullif(row_data->>'suggestion_date',''));
    when 'hq_gift_cards' then label := concat('Card ',row_data->>'certificate_number');
    when 'hq_realtors' then label := row_data->>'realtor_name';
    when 'hq_realtor_contacts' then
      select r.realtor_name into parent_label from public.hq_realtors r where r.id = (row_data->>'realtor_id')::uuid;
      label := concat_ws(' · ',nullif(parent_label,''),nullif(row_data->>'contacted_date',''));
    when 'hq_k9_cough' then label := row_data->>'pet_name';
    when 'hq_vet_cheat_sheet' then label := row_data->>'veterinarian';
    when 'hq_potential_training_clients' then label := concat_ws(' · ',nullif(row_data->>'owner',''),nullif(row_data->>'dog',''));
    when 'hq_end_of_day' then label := row_data->>'entry_date';
  end case;
  label := left(btrim(regexp_replace(coalesce(label,''), '[[:cntrl:]]+', ' ', 'g')),160);
  insert into public.hq_activity_history(actor_id, actor_name, action, section, source_table, record_id, record_label, changed_fields, source)
    values(actor, hq_history_private.actor_name(actor), event_action, event_section, tg_table_name, target_id, label, changed, 'database');
  if tg_op = 'DELETE' then return old; else return new; end if;
exception when others then
  -- History is best-effort, not a financial/security ledger. An unavailable log
  -- must never undo a successful staff record edit. Never emit SQLERRM/row data.
  raise warning 'HQ_ACTIVITY_HISTORY_WRITE_FAILED';
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.hq_activity_history_capture() from public, anon, authenticated, service_role;

do $$
declare target text;
begin
  foreach target in array array['hq_tours','hq_training_dogs','hq_training_logs','hq_dog_licenses','hq_follow_up_calls',
    'hq_marketing_initiatives','hq_biscuit_locations','hq_biscuit_visits','hq_suggestions','hq_gift_cards','hq_realtors',
    'hq_realtor_contacts','hq_k9_cough','hq_vet_cheat_sheet','hq_potential_training_clients','hq_end_of_day'] loop
    -- Fail installation if a required schema is missing instead of silently
    -- claiming to track a section that has not actually been instrumented.
    execute format('drop trigger if exists hq_activity_history_capture on public.%I', target);
    execute format('create trigger hq_activity_history_capture after insert or update or delete on public.%I for each row execute function public.hq_activity_history_capture()', target);
  end loop;
end;
$$;

create or replace function public.hq_activity_record_visit(p_path text, p_action text default 'sign_in')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  event_section text;
  event_label text;
  stamp timestamptz;
begin
  if actor is null or not exists(select 1 from public.hq_tour_staff s
      join auth.users u on u.id=s.user_id where s.user_id=actor and s.active) then
    raise exception 'Active HQ membership is required.' using errcode='42501';
  end if;
  -- Deliberately precedes path validation: all old page-view calls are quiet
  -- no-ops, including clients still using an obsolete canonical route.
  if p_action='page_view' then return false; end if;
  if p_action is null or p_action<>'sign_in' or p_path is null or char_length(p_path)>512
      or p_path !~ '^/' or p_path ~ '[[:cntrl:]?#%]' or position(chr(92) in p_path)>0 or p_path ~ '(^|/)\.\.?(/|$)' then
    raise exception 'A canonical HQ page and supported activity type are required.' using errcode='22023';
  end if;

  select entry.section,entry.label into event_section,event_label from (values
    ('/','home','Home'),('/settings','settings','Settings'),('/history','history','History'),('/login','account','Sign in'),
    ('/occupied-runs','occupied-runs','Occupied Runs'),('/end-of-day','end-of-day','End Of Day'),
    ('/tours','tours','Tours'),('/training','training','Training'),('/dog-licenses','dog-licenses','Dog Licenses'),
    ('/follow-up-calls','follow-up-calls','Follow-Up Calls'),('/marketing-initiatives','marketing-initiatives','Marketing Initiatives'),
    ('/biscuit-baskets','biscuit-baskets','Biscuit Baskets'),('/suggestions','suggestions','Suggestions'),
    ('/gift-cards','gift-cards','Gift Cards'),('/realtor-info','realtor-info','Realtor Info'),
    ('/k9-cough','k9-cough','K9 Cough'),('/vet-cheat-sheet','vet-cheat-sheet','Vet Cheat Sheet'),
    ('/potential-training-clients','potential-training-clients','Potential Training Clients'),
    ('/grooming-price-list','grooming-price-list','Grooming Price List'),('/boarding-base-rates','boarding-base-rates','Boarding Base Rates'),
    ('/digital-whiteboard','digital-whiteboard','Digital Whiteboard'),('/map2','occupied-runs','Occupied Runs Map'),
    ('/run_cards_temp','run-cards','Run Cards')
  ) as entry(path,section,label) where entry.path=p_path;
  if event_section is null then
    select 'knowledge-base',left(k.title,160) into event_section,event_label
      from public.hq_knowledge_pages k where k.path=p_path and not k.is_archive;
  end if;
  if event_section is null then
    raise exception 'This is not a supported HQ page.' using errcode='22023';
  end if;

  begin
    perform pg_advisory_xact_lock(hashtextextended(actor::text || ':sign_in:' || p_path,0));
    stamp:=clock_timestamp();
    if exists(select 1 from public.hq_activity_history h where h.actor_id=actor and h.source='client'
        and h.action='sign_in' and h.page_path=p_path and h.occurred_at>stamp-interval '60 seconds') then
      return false;
    end if;
    insert into public.hq_activity_history(occurred_at,actor_id,actor_name,action,section,record_label,page_path,source)
      values(stamp,actor,hq_history_private.actor_name(actor),'sign_in',event_section,event_label,p_path,'client');
    return true;
  exception when others then
    raise warning 'HQ_ACTIVITY_HISTORY_WRITE_FAILED';
    return false;
  end;
end;
$$;
revoke all on function public.hq_activity_record_visit(text,text) from public,anon,authenticated,service_role;
grant execute on function public.hq_activity_record_visit(text,text) to authenticated;
comment on function public.hq_activity_record_visit(text,text) is
  'Best-effort self-reported sign-in only, active HQ staff, server actor/time and safe canonical route. Legacy page_view requests always return false without storing or exposing browsing history.';


comment on table public.hq_activity_history is
  'Shared append-only staff activity from installation onward. Database events are trigger-derived; client sign-ins are self-reported. Page views are discontinued and legacy rows hidden. Best-effort; no historical reconstruction or field values.';
comment on column public.hq_activity_history.actor_name is
  'Provider-owned Slack identity display-name snapshot; actor_id is the authoritative Supabase actor.';
comment on column public.hq_activity_history.changed_fields is
  'Business field names only. No before/after values, messages, notes, credentials, or source archives.';

notify pgrst, 'reload schema';
commit;
