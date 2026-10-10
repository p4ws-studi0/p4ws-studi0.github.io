-- All synthetic records and membership changes roll back after this check.
begin;
create temporary table biscuit_check_context (
  actor uuid, outsider uuid, location uuid, other_location uuid, imported_location uuid,
  visit uuid, imported_visit uuid, archive uuid
) on commit drop;
insert into biscuit_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.biscuit_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.biscuit_check_context to authenticated,anon;

select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.biscuit_check_context;

-- Private imports retain complete source rows and their original visit-group spans.
insert into public.hq_biscuit_locations(id,location_name,town,source_file,source_row,source_values)
select imported_location,'Fixture location','Fixture town','Fixture.csv',3,
       jsonb_build_array('Fixture location','8/19','Fixture items','Fixture person','Fixture town',E'Line one\r\nLine two  ')
       || to_jsonb(array_fill(''::text,array[33]))
from pg_temp.biscuit_check_context;
insert into public.hq_biscuit_visits(id,location_id,visited_on,items_given,spoke_to,town,notes,
                                  source_file,source_row,source_column,source_values)
select imported_visit,imported_location,'8/19','Fixture items','Fixture person','Fixture town',E'Line one\r\nLine two  ',
       'Fixture.csv',3,2,jsonb_build_array('8/19','Fixture items','Fixture person','Fixture town',E'Line one\r\nLine two  ')
from pg_temp.biscuit_check_context;
insert into public.hq_biscuit_sources(id,source_file,source_rows)
select archive,'Fixture.csv',jsonb_build_array(to_jsonb(array_fill('Header'::text,array[39])),
       jsonb_build_array('Fixture location','8/19') || to_jsonb(array_fill(''::text,array[37])))
from pg_temp.biscuit_check_context;

do $$
declare c record;
begin
  select * into c from pg_temp.biscuit_check_context;
  begin
    insert into public.hq_biscuit_locations(id,location_name,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid row fixture','Fixture.csv',3,'["one","two"]'::jsonb);
    raise exception 'Incomplete original location source row accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_biscuit_visits(id,location_id,visited_on,source_file,source_row,source_values)
    values(gen_random_uuid(),c.imported_location,'8/19','Fixture.csv',3,'["8/19"]'::jsonb);
    raise exception 'Missing original visit source column accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_biscuit_visits(id,location_id,visited_on,source_file,source_row,source_column,source_values)
    values(gen_random_uuid(),c.imported_location,'8/19','Fixture.csv',3,39,'["8/19",""]'::jsonb);
    raise exception 'Visit source group outside original row accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_biscuit_visits(id,location_id,visited_on,source_file,source_row,source_column,source_values,source_year)
    values(gen_random_uuid(),c.imported_location,'8/19','Fixture.csv',3,2,'["8/19"]'::jsonb,2101);
    raise exception 'Out-of-range source year accepted.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare
  c record;
  l public.hq_biscuit_locations%rowtype;
  v public.hq_biscuit_visits%rowtype;
  original_l public.hq_biscuit_locations%rowtype;
  original_v public.hq_biscuit_visits%rowtype;
  removed_at timestamptz;
  affected integer;
  before_visits jsonb;
begin
  select * into c from pg_temp.biscuit_check_context;
  select * into original_l from public.hq_biscuit_locations where id=c.imported_location;
  select * into original_v from public.hq_biscuit_visits where id=c.imported_visit;
  if jsonb_array_length(original_l.source_values) <> 39
     or original_v.source_values is distinct from jsonb_build_array(original_v.visited_on,original_v.items_given,
                    original_v.spoke_to,original_v.town,original_v.notes)
     or original_v.source_year is not null then raise exception 'Exact original source preservation failed.'; end if;
  if not exists(select 1 from public.hq_biscuit_sources where id=c.archive) then
    raise exception 'Approved account cannot read the archive.';
  end if;

  insert into public.hq_biscuit_locations(id,town,revision,created_at,created_by,updated_at,updated_by,
                                         source_file,source_row,source_values)
  values(c.location,'  Fixture town  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.csv',3,to_jsonb(array_fill('forged'::text,array[39]))) returning * into l;
  if l.revision <> 1 or l.created_by <> c.actor or l.updated_by <> c.actor or l.created_at = '2000-01-01'
     or l.updated_at = '2000-01-01' or l.town <> '  Fixture town  ' or l.location_name <> '' or l.status <> 'active'
     or l.source_file is not null or l.source_row is not null or l.source_values is not null then
    raise exception 'Partial location, literal text, audit stamps, or provenance control failed.';
  end if;
  insert into public.hq_biscuit_locations(id,location_name) values(c.other_location,'Other fixture');
  insert into public.hq_biscuit_visits(id,location_id,notes,revision,created_at,created_by,updated_at,updated_by,
                                    source_file,source_row,source_column,source_values,source_year)
  values(c.visit,c.location,E'  Notes only\r\n  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.csv',3,2,'["forged"]'::jsonb,1999) returning * into v;
  if v.revision <> 1 or v.created_by <> c.actor or v.updated_by <> c.actor or v.created_at = '2000-01-01'
     or v.updated_at = '2000-01-01' or v.notes is distinct from E'  Notes only\r\n  ' or v.visited_on <> ''
     or v.source_file is not null or v.source_row is not null or v.source_column is not null
     or v.source_values is not null or v.source_year is not null then
    raise exception 'Partial visit, literal text, audit stamps, or provenance control failed.';
  end if;
  update public.hq_biscuit_locations set location_name='Renamed fixture',status='closed',status_notes='Status fixture',
      revision=99,updated_by=c.outsider,updated_at='2000-01-01' where id=c.location and revision=1 returning * into l;
  if l.revision <> 2 or l.updated_by <> c.actor or l.updated_at = '2000-01-01' or l.status <> 'closed'
     or l.town <> '  Fixture town  ' then raise exception 'Location update audit or literal value failed.'; end if;
  update public.hq_biscuit_visits set visited_on='next Thursday',items_given='Basket / replacement',revision=99,
      updated_by=c.outsider,updated_at='2000-01-01' where id=c.visit and revision=1 returning * into v;
  if v.revision <> 2 or v.updated_by <> c.actor or v.updated_at = '2000-01-01'
     or v.notes is distinct from E'  Notes only\r\n  ' then raise exception 'Visit update audit or literal value failed.'; end if;
  update public.hq_biscuit_locations set town='Stale edit' where id=c.location and revision=1;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Stale location overwrote a record.'; end if;
  update public.hq_biscuit_visits set notes='Stale edit' where id=c.visit and revision=1;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Stale visit overwrote a record.'; end if;

  update public.hq_biscuit_visits set deleted_at='2000-01-01' where id=c.visit and revision=2 returning * into v;
  if v.deleted_at is null or v.deleted_at = '2000-01-01' or v.revision <> 3 then raise exception 'Visit deletion stamp failed.'; end if;
  removed_at:=v.deleted_at;
  update public.hq_biscuit_visits set deleted_at='2001-01-01' where id=c.visit and revision=3 returning * into v;
  if v.deleted_at is distinct from removed_at then raise exception 'Visit deletion timestamp changed.'; end if;
  update public.hq_biscuit_visits set deleted_at=null where id=c.visit and revision=4 returning * into v;
  if v.deleted_at is not null or v.revision <> 5 or v.visited_on <> 'next Thursday' then raise exception 'Visit restore failed.'; end if;

  select jsonb_agg(to_jsonb(x) order by x.id) into before_visits from public.hq_biscuit_visits x where x.location_id=c.location;
  update public.hq_biscuit_locations set deleted_at='2000-01-01' where id=c.location and revision=2 returning * into l;
  if l.deleted_at is null or l.deleted_at='2000-01-01' or l.revision <> 3 then raise exception 'Location deletion stamp failed.'; end if;
  removed_at:=l.deleted_at;
  if (select jsonb_agg(to_jsonb(x) order by x.id) from public.hq_biscuit_visits x where x.location_id=c.location)
     is distinct from before_visits then raise exception 'Deleting location changed visit history.'; end if;
  begin
    insert into public.hq_biscuit_visits(id,location_id,visited_on) values(gen_random_uuid(),c.location,'8/20');
    raise exception 'A deleted location accepted a new visit.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_biscuit_visits set notes='Changed while parent deleted' where id=c.visit;
    raise exception 'A deleted location accepted a visit update.';
  exception when insufficient_privilege then null; end;
  update public.hq_biscuit_locations set deleted_at='2001-01-01' where id=c.location and revision=3 returning * into l;
  if l.deleted_at is distinct from removed_at then raise exception 'Location deletion timestamp changed.'; end if;
  update public.hq_biscuit_locations set deleted_at=null where id=c.location and revision=4 returning * into l;
  if l.deleted_at is not null or l.revision <> 5 or l.location_name <> 'Renamed fixture'
     or (select jsonb_agg(to_jsonb(x) order by x.id) from public.hq_biscuit_visits x where x.location_id=c.location)
        is distinct from before_visits then raise exception 'Location restore lost visit history.'; end if;
  update public.hq_biscuit_visits set spoke_to='After restore fixture' where id=c.visit and revision=5;

  update public.hq_biscuit_locations set location_name='Edited imported location' where id=c.imported_location returning * into l;
  update public.hq_biscuit_visits set notes='Edited imported visit' where id=c.imported_visit returning * into v;
  if l.source_file is distinct from original_l.source_file or l.source_row is distinct from original_l.source_row
     or l.source_values is distinct from original_l.source_values or l.position is distinct from original_l.position
     or v.source_file is distinct from original_v.source_file or v.source_row is distinct from original_v.source_row
     or v.source_column is distinct from original_v.source_column or v.source_values is distinct from original_v.source_values
     or v.source_year is distinct from original_v.source_year or v.position is distinct from original_v.position then
    raise exception 'Editing changed original source metadata or order.';
  end if;
  begin update public.hq_biscuit_locations set id=gen_random_uuid() where id=c.location;
    raise exception 'Location identity changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set created_at='2000-01-01' where id=c.location;
    raise exception 'Location creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set created_by=c.outsider where id=c.location;
    raise exception 'Location creator changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set position=position+1 where id=c.location;
    raise exception 'Location source order changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_biscuit_locations set source_file='Changed.csv' where id=c.imported_location;
    raise exception 'Location source file changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set source_row=4 where id=c.imported_location;
    raise exception 'Location source row changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set source_values=to_jsonb(array_fill('changed'::text,array[39])) where id=c.imported_location;
    raise exception 'Location original cells changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set status='unknown' where id=c.location;
    raise exception 'Invalid location status accepted.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_locations set location_name='',town='',status_notes='' where id=c.location;
    raise exception 'An empty location accepted.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set id=gen_random_uuid() where id=c.visit;
    raise exception 'Visit identity changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set location_id=c.other_location where id=c.visit;
    raise exception 'Visit parent changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set created_at='2000-01-01' where id=c.visit;
    raise exception 'Visit creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set created_by=c.outsider where id=c.visit;
    raise exception 'Visit creator changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set position=position+1 where id=c.visit;
    raise exception 'Visit original order changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_biscuit_visits set source_file='Changed.csv' where id=c.imported_visit;
    raise exception 'Visit source file changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set source_row=4 where id=c.imported_visit;
    raise exception 'Visit source row changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set source_column=7 where id=c.imported_visit;
    raise exception 'Visit original column changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set source_values='["changed"]'::jsonb where id=c.imported_visit;
    raise exception 'Visit original cells changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set source_year=2025 where id=c.imported_visit;
    raise exception 'Original unknown year was changed.'; exception when check_violation then null; end;
  begin update public.hq_biscuit_visits set visited_on='',items_given='',spoke_to='',town='',notes='' where id=c.visit;
    raise exception 'An empty visit accepted.'; exception when check_violation then null; end;
  begin delete from public.hq_biscuit_locations where id=c.location;
    raise exception 'Permanent location deletion allowed.'; exception when insufficient_privilege then null; end;
  begin delete from public.hq_biscuit_visits where id=c.visit;
    raise exception 'Permanent visit deletion allowed.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_biscuit_sources(id,source_file,source_rows) values(gen_random_uuid(),'Forged.csv','[]'::jsonb);
    raise exception 'Archive browser insert allowed.'; exception when insufficient_privilege then null; end;
  begin update public.hq_biscuit_sources set source_rows='[]'::jsonb where id=c.archive;
    raise exception 'Archive browser update allowed.'; exception when insufficient_privilege then null; end;
  begin delete from public.hq_biscuit_sources where id=c.archive;
    raise exception 'Archive browser delete allowed.'; exception when insufficient_privilege then null; end;
end $$;

do $$
declare c record; field text; limit_value integer; stored text;
begin
  select * into c from pg_temp.biscuit_check_context;
  for field,limit_value in select * from (values ('location_name',500),('town',200),('status_notes',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_biscuit_locations set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),c.location;
    if char_length(stored) <> limit_value then raise exception 'Location field % lost text.',field; end if;
    begin execute format('update public.hq_biscuit_locations set %I=$1 where id=$2',field) using repeat('x',limit_value+1),c.location;
      raise exception 'Location field % accepted too much text.',field; exception when check_violation then null; end;
  end loop;
  for field,limit_value in select * from (values ('visited_on',120),('items_given',20000),('spoke_to',500),('town',200),('notes',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_biscuit_visits set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),c.visit;
    if char_length(stored) <> limit_value then raise exception 'Visit field % lost text.',field; end if;
    begin execute format('update public.hq_biscuit_visits set %I=$1 where id=$2',field) using repeat('x',limit_value+1),c.visit;
      raise exception 'Visit field % accepted too much text.',field; exception when check_violation then null; end;
  end loop;
  begin insert into public.hq_biscuit_locations(id,location_name) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'Whitespace-only location accepted.'; exception when check_violation then null; end;
  begin insert into public.hq_biscuit_visits(id,location_id,notes) values(gen_random_uuid(),c.location,E' \t\r\n ');
    raise exception 'Whitespace-only visit accepted.'; exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.biscuit_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.biscuit_check_context;
  if exists(select 1 from public.hq_biscuit_locations) or exists(select 1 from public.hq_biscuit_visits)
     or exists(select 1 from public.hq_biscuit_sources) then raise exception 'Nonstaff read biscuit data.'; end if;
  update public.hq_biscuit_locations set town='Unauthorized' where id=c.location;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Nonstaff updated location.'; end if;
  update public.hq_biscuit_visits set notes='Unauthorized' where id=c.visit;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Nonstaff updated visit.'; end if;
  begin insert into public.hq_biscuit_locations(id,location_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted location.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_biscuit_visits(id,location_id,notes) values(gen_random_uuid(),c.location,'Unauthorized');
    raise exception 'Nonstaff inserted visit.'; exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.biscuit_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.biscuit_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.biscuit_check_context;
  if exists(select 1 from public.hq_biscuit_locations) or exists(select 1 from public.hq_biscuit_visits)
     or exists(select 1 from public.hq_biscuit_sources) then raise exception 'Inactive staff read biscuit data.'; end if;
  update public.hq_biscuit_locations set town='Unauthorized' where id=c.location;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Inactive staff updated location.'; end if;
  update public.hq_biscuit_visits set notes='Unauthorized' where id=c.visit;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Inactive staff updated visit.'; end if;
  begin insert into public.hq_biscuit_locations(id,location_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted location.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_biscuit_visits(id,location_id,notes) values(gen_random_uuid(),c.location,'Unauthorized');
    raise exception 'Inactive staff inserted visit.'; exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_biscuit_locations; raise exception 'Anonymous location read allowed.';
    exception when insufficient_privilege then null; end;
  begin perform * from public.hq_biscuit_visits; raise exception 'Anonymous visit read allowed.';
    exception when insufficient_privilege then null; end;
  begin perform * from public.hq_biscuit_sources; raise exception 'Anonymous archive read allowed.';
    exception when insufficient_privilege then null; end;
  begin insert into public.hq_biscuit_locations(id,location_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous location insert allowed.'; exception when insufficient_privilege then null; end;
  begin update public.hq_biscuit_visits set notes='Unauthorized';
    raise exception 'Anonymous visit update allowed.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, literal and partial values, field limits, audit/revisions, immutable source/parent/year, reversible location and visit deletion, read-only archive, and anonymous/nonstaff/inactive isolation.' as result;
rollback;
