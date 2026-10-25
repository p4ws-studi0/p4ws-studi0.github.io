-- Run only in the SQL Editor after activity-history-setup.sql.
-- Synthetic writes and a temporary approval change are rolled back together.
-- This is not a read-only production health check. On an error run ROLLBACK.
begin;

create temporary table history_check_context as
select user_id as actor, gen_random_uuid() as outsider, clock_timestamp() as started_at,
  (select other.user_id from public.hq_tour_staff other where other.active and other.user_id<>staff.user_id order by other.user_id limit 1) as other_actor,
  '/kb/history-check-' || gen_random_uuid()::text as kb_path,
  (select day::date from generate_series(date '2090-01-01', date '2099-12-31', interval '1 day') day
    where not exists(select 1 from public.hq_end_of_day e where e.entry_date = day::date) limit 1) as fixture_day
from public.hq_tour_staff staff where active order by user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.history_check_context) then raise exception 'An existing active HQ account is required.'; end if;
end $$;
create temporary table history_check_rows(table_name text primary key, id uuid not null);
insert into history_check_rows
select table_name, gen_random_uuid() from unnest(array['hq_tours','hq_training_dogs','hq_training_logs','hq_dog_licenses',
  'hq_follow_up_calls','hq_marketing_initiatives','hq_biscuit_locations','hq_biscuit_visits','hq_suggestions',
  'hq_gift_cards','hq_realtors','hq_realtor_contacts','hq_k9_cough','hq_vet_cheat_sheet','hq_potential_training_clients','hq_end_of_day']) table_name;
grant select on pg_temp.history_check_context, pg_temp.history_check_rows to authenticated, anon;

select set_config('request.jwt.claim.sub',actor::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated',
    'user_metadata',jsonb_build_object('full_name','HISTORY_FORGED_ACTOR_NAME'))::text,true)
from pg_temp.history_check_context;

-- Retain a pre-existing style page-view fixture, but never expose it through
-- the current staff policy. This is synthetic and rolled back with the test.
create temporary table history_check_legacy_view as
with inserted as (
  insert into public.hq_activity_history(actor_id,actor_name,action,section,record_label,page_path,source)
    select actor,'History fixture','page_view','history','Legacy browsing fixture','/history','client'
    from pg_temp.history_check_context returning id
) select id from inserted;

-- The fixed gift-card roster is never expanded by a browser. An administrator
-- seeds this synthetic certificate in the same rollback-only transaction.
insert into public.hq_gift_cards(id,certificate_number)
select id, 'History fixture ' || id::text from pg_temp.history_check_rows where table_name = 'hq_gift_cards';
insert into public.hq_knowledge_pages(path,title,category,html_content,search_text,source_sha256,content_sha256,page_kind)
select kb_path,'History KB fixture','History','<p>Synthetic only</p>','Synthetic only',repeat('0',64),repeat('0',64),'article'
from pg_temp.history_check_context;

set local role authenticated;
do $$
declare c record; item record; before_count bigint; after_count bigint; event public.hq_activity_history%rowtype; fixture_id uuid;
begin
  select * into c from pg_temp.history_check_context;
  if exists(select 1 from public.hq_activity_history where action='page_view') then
    raise exception 'Discontinued page views remain visible to staff.';
  end if;
  if (public.hq_activity_history_info()->>'started_at')::timestamptz > clock_timestamp()
      or (public.hq_activity_history_info()->>'version')::int <> 1 then raise exception 'History installation metadata is invalid.'; end if;

  insert into public.hq_tours(id,customer_name,customer_info,tour_date,tour_time,staff_initials)
    select id,'History tour fixture','HISTORY_PRIVATE_VALUE',c.fixture_day,'11:00','HC' from pg_temp.history_check_rows where table_name='hq_tours';
  insert into public.hq_training_dogs(id,name)
    select id,'History dog fixture' from pg_temp.history_check_rows where table_name='hq_training_dogs';
  insert into public.hq_training_logs(id,dog_id,notes)
    select id,(select id from pg_temp.history_check_rows where table_name='hq_training_dogs'),'HISTORY_PRIVATE_VALUE'
    from pg_temp.history_check_rows where table_name='hq_training_logs';
  insert into public.hq_dog_licenses(id,pet_name)
    select id,'History license fixture' from pg_temp.history_check_rows where table_name='hq_dog_licenses';
  insert into public.hq_follow_up_calls(id,owner_name,notes)
    select id,'History follow-up fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_follow_up_calls';
  insert into public.hq_marketing_initiatives(id,drop_off_location,notes)
    select id,'History marketing fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_marketing_initiatives';
  insert into public.hq_biscuit_locations(id,location_name,status_notes)
    select id,'History basket fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_biscuit_locations';
  insert into public.hq_biscuit_visits(id,location_id,notes)
    select id,(select id from pg_temp.history_check_rows where table_name='hq_biscuit_locations'),'HISTORY_PRIVATE_VALUE'
    from pg_temp.history_check_rows where table_name='hq_biscuit_visits';
  insert into public.hq_suggestions(id,suggestion)
    select id,'HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_suggestions';
  insert into public.hq_realtors(id,realtor_name,phone)
    select id,'History realtor fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_realtors';
  insert into public.hq_realtor_contacts(id,realtor_id,notes)
    select id,(select id from pg_temp.history_check_rows where table_name='hq_realtors'),'HISTORY_PRIVATE_VALUE'
    from pg_temp.history_check_rows where table_name='hq_realtor_contacts';
  insert into public.hq_k9_cough(id,pet_name,notes)
    select id,'History cough fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_k9_cough';
  insert into public.hq_vet_cheat_sheet(id,veterinarian,notes)
    select id,'History veterinarian fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_vet_cheat_sheet';
  insert into public.hq_potential_training_clients(id,owner,follow_up)
    select id,'History client fixture','HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_potential_training_clients';
  insert into public.hq_end_of_day(id,entry_date,notes)
    select id,c.fixture_day,'HISTORY_PRIVATE_VALUE' from pg_temp.history_check_rows where table_name='hq_end_of_day';

  if (select count(*) from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id where h.action='create') <> 16 then
    raise exception 'Every operational table must emit exactly one create event.';
  end if;
  if exists(select 1 from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id
      where h.actor_id<>c.actor or h.actor_name='HISTORY_FORGED_ACTOR_NAME' or h.occurred_at<c.started_at
      or h.source<>'database' or h.source_table<>f.table_name or h.page_path is not null) then
    raise exception 'Actor, source, or time can be forged.';
  end if;
  select h.* into event from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id
    where f.table_name='hq_end_of_day';
  if event.record_label<>c.fixture_day::text or event.section<>'end-of-day' then raise exception 'End Of Day label is not the actual date.'; end if;

  for item in select * from (values ('hq_tours','customer_info'),('hq_training_dogs','name'),('hq_training_logs','notes'),
      ('hq_dog_licenses','initials'),('hq_follow_up_calls','notes'),('hq_marketing_initiatives','notes'),
      ('hq_biscuit_locations','status_notes'),('hq_biscuit_visits','notes'),('hq_suggestions','outcome'),
      ('hq_gift_cards','purchase_initials'),('hq_realtors','phone'),('hq_realtor_contacts','notes'),
      ('hq_k9_cough','notes'),('hq_vet_cheat_sheet','notes'),('hq_potential_training_clients','follow_up'),('hq_end_of_day','notes')) v(table_name,field_name) loop
    select id into fixture_id from pg_temp.history_check_rows r where r.table_name=item.table_name;
    execute format('update public.%I set %I=$1 where id=$2',item.table_name,item.field_name) using 'History changed fixture',fixture_id;
    select h.* into event from public.hq_activity_history h where h.record_id=fixture_id order by id desc limit 1;
    if event.action<>'update' or event.changed_fields<>array[item.field_name] then raise exception 'Changed-field detection failed for %.',item.table_name; end if;
  end loop;
  select count(*) into before_count from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id;
  if before_count<>32 then raise exception 'Expected 16 creates and 16 updates.'; end if;
  for item in select * from pg_temp.history_check_rows loop
    execute format('update public.%I set updated_at=updated_at where id=$1',item.table_name) using item.id;
  end loop;
  select count(*) into after_count from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id;
  if after_count<>before_count then raise exception 'A no-op or metadata-only update created history.'; end if;

  select id into fixture_id from pg_temp.history_check_rows where table_name='hq_tours';
  update public.hq_tours set deleted_at=clock_timestamp() where id=fixture_id;
  update public.hq_tours set deleted_at=clock_timestamp() where id=fixture_id;
  update public.hq_tours set deleted_at=null where id=fixture_id;
  if (select array_agg(action order by id) from public.hq_activity_history where record_id=fixture_id)
      <>array['create','update','delete','restore'] then raise exception 'Soft delete/restore or duplicate delete classification failed.'; end if;
  begin
    update public.hq_tours set customer_info='HISTORY_ROLLED_BACK_VALUE' where id=fixture_id;
    raise exception 'Deliberate history rollback fixture';
  exception when raise_exception then null; end;
  if (select count(*) from public.hq_activity_history where record_id=fixture_id)<>4 then raise exception 'Rolled-back record edits left events.'; end if;

  if exists(select 1 from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id
      where to_jsonb(h)::text like '%HISTORY_PRIVATE_VALUE%' or to_jsonb(h)::text like '%HISTORY_ROLLED_BACK_VALUE%'
      or h.changed_fields && array['id','created_at','updated_at','created_by','updated_by','revision','source_values','position']) then
    raise exception 'History exposed a private value or imported/audit metadata.';
  end if;

  begin
    insert into public.hq_activity_history(actor_id,actor_name,action,section,source,page_path)
      values(c.outsider,'Forged','sign_in','home','client','/');
    raise exception 'Browser forged a history event.';
  exception when insufficient_privilege then null; end;
  begin update public.hq_activity_history set actor_name='Forged' where actor_id=c.actor;
    raise exception 'Browser changed history.'; exception when insufficient_privilege then null; end;
  begin delete from public.hq_activity_history where actor_id=c.actor;
    raise exception 'Browser deleted history.'; exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.hq_activity_history_capture()','EXECUTE') then raise exception 'Browser can execute the capture function.'; end if;

  if public.hq_activity_record_visit(c.kb_path,'page_view') then raise exception 'A discontinued page view was recorded.'; end if;
  if public.hq_activity_record_visit('/obsolete.html?old-client','page_view') then raise exception 'An old cached page-view call was not a quiet no-op.'; end if;
  if not public.hq_activity_record_visit(c.kb_path,'sign_in') then raise exception 'A fresh sign-in was not recorded.'; end if;
  if public.hq_activity_record_visit(c.kb_path,'sign_in') then raise exception 'A matching sign-in was not deduplicated.'; end if;
  perform public.hq_activity_record_visit('/history');
  perform public.hq_activity_record_visit('/settings','sign_in');
  perform public.hq_activity_record_visit('/login','sign_in');
  for item in select * from (values ('https://example.invalid/'),('//example.invalid/'),('/settings?token=private'),('/settings#private'),
      ('/settings.html'),('/settings/'),('/kb/not-an-existing-page'),('/../settings'),('/settings%3Fsecret'),('/private-made-up-route')) p(path) loop
    begin perform public.hq_activity_record_visit(item.path,'sign_in');
      raise exception 'Invalid route was accepted: %',item.path; exception when invalid_parameter_value then null; end;
  end loop;
  begin perform public.hq_activity_record_visit('/history','update');
    raise exception 'Visit RPC accepted a forged database action.'; exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.hq_activity_history h where h.actor_id=c.actor and h.occurred_at>=c.started_at and h.source='client'
      and (h.source_table is not null or h.record_id is not null or h.changed_fields<>'{}'::text[] or h.action<>'sign_in')) then
    raise exception 'Client-reported activity masquerades as a record change.';
  end if;
end;
$$;

reset role;
do $$ begin
  if not exists(select 1 from public.hq_activity_history where id=(select id from pg_temp.history_check_legacy_view)) then
    raise exception 'Discontinuing page views permanently deleted a retained row.';
  end if;
end $$;
-- Where a second active account already exists, verify this is shared history
-- rather than an accidental read-own-events policy. No account is created.
select set_config('request.jwt.claim.sub',coalesce(other_actor,actor)::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',coalesce(other_actor,actor),'role','authenticated')::text,true)
from pg_temp.history_check_context;
set local role authenticated;
do $$ begin
  if (select count(*) from public.hq_activity_history h join pg_temp.history_check_rows f on f.id=h.record_id)<>34 then
    raise exception 'Another active HQ account cannot read the shared record history.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',actor::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.history_check_context;
-- A hard delete by a privileged administrator with an explicit real staff
-- actor is observable; browser DELETE privileges remain unchanged and denied.
delete from public.hq_tours where id=(select id from pg_temp.history_check_rows where table_name='hq_tours');
do $$ begin
  if (select count(*) from public.hq_activity_history where record_id=(select id from pg_temp.history_check_rows where table_name='hq_tours') and action='delete')<>2 then
    raise exception 'A privileged hard delete was not recorded.';
  end if;
end $$;

-- Simulate history storage failure, proving a normal operational save survives.
alter table public.hq_activity_history add constraint history_check_unavailable check(false) not valid;
set local role authenticated;
update public.hq_end_of_day set notes='History unavailable fixture' where id=(select id from pg_temp.history_check_rows where table_name='hq_end_of_day');
do $$ begin
  if (select notes from public.hq_end_of_day where id=(select id from pg_temp.history_check_rows where table_name='hq_end_of_day'))<>'History unavailable fixture' then
    raise exception 'A history failure prevented the operational edit.';
  end if;
end $$;
reset role;
alter table public.hq_activity_history drop constraint history_check_unavailable;

-- A privileged maintenance deletion with no user claim must not be attributed
-- to the record's previous editor or presented as a new human event.
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
delete from public.hq_end_of_day where id=(select id from pg_temp.history_check_rows where table_name='hq_end_of_day');
do $$ begin
  if (select count(*) from public.hq_activity_history where record_id=(select id from pg_temp.history_check_rows where table_name='hq_end_of_day'))<>2 then
    raise exception 'Maintenance without an actor invented a human history event.';
  end if;
end $$;

-- An unapproved JWT, then a revoked existing account, cannot see the log or
-- submit visits. Existing authenticated tokens are not enough by themselves.
select set_config('request.jwt.claim.sub',outsider::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from pg_temp.history_check_context;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.hq_activity_history) then raise exception 'Unapproved account read history.'; end if;
  begin perform public.hq_activity_history_info(); raise exception 'Unapproved account read metadata.'; exception when insufficient_privilege then null; end;
  begin perform public.hq_activity_record_visit('/','page_view'); raise exception 'Unapproved account submitted a visit.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.history_check_context);
select set_config('request.jwt.claim.sub',actor::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from pg_temp.history_check_context;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.hq_activity_history) then raise exception 'Revoked account read history.'; end if;
  begin perform public.hq_activity_history_info(); raise exception 'Revoked account read metadata.'; exception when insufficient_privilege then null; end;
  begin perform public.hq_activity_record_visit('/','page_view'); raise exception 'Revoked account submitted a visit.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.hq_activity_history; raise exception 'Anonymous role read history.'; exception when insufficient_privilege then null; end;
  begin perform public.hq_activity_history_info(); raise exception 'Anonymous role read metadata.'; exception when insufficient_privilege then null; end;
  begin perform public.hq_activity_record_visit('/','page_view'); raise exception 'Anonymous role submitted a visit.'; exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select 'PASS: all 16 operational tables, server actor/time, field names without values, no-op suppression, transactional rollback, create/update/delete/restore, append-only browser permissions, safe sign-in routes and deduplication, discontinued page-view no-ops and hidden retained rows, best-effort failure isolation, and anonymous/unapproved/revoked isolation.' as result;
