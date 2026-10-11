-- All synthetic records and membership changes roll back after this check.
begin;
create temporary table realtor_check_context (
  actor uuid, outsider uuid, realtor uuid, other_realtor uuid, imported_realtor uuid,
  contact uuid, imported_contact uuid
) on commit drop;
insert into realtor_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.realtor_check_context) then raise exception 'No approved staff member available.'; end if;
end $$;
grant select on pg_temp.realtor_check_context to authenticated,anon;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.realtor_check_context;

insert into public.hq_realtors(id,realtor_name,phone,email,location,source_file,source_row,source_values)
select imported_realtor,'Fixture realtor  ','(000) 000-0000  ','fixture@example.invalid','Fixture location  ',
       'Fixture.csv',3,jsonb_build_array('Fixture realtor  ','(000) 000-0000  ','fixture@example.invalid','Fixture location  ',
          '3/4/2024,08/19/25',E'First line\r\nSecond line  ','','')
from pg_temp.realtor_check_context;
insert into public.hq_realtor_contacts(id,realtor_id,contacted_date,notes,source_file,source_row,source_column,source_values)
select imported_contact,imported_realtor,'3/4/2024,08/19/25',E'First line\r\nSecond line  ','Fixture.csv',3,5,
       jsonb_build_array('3/4/2024,08/19/25',E'First line\r\nSecond line  ')
from pg_temp.realtor_check_context;
do $$ declare c record;
begin
  select * into c from pg_temp.realtor_check_context;
  begin
    insert into public.hq_realtors(id,realtor_name,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.csv',3,'["one","two"]'::jsonb);
    raise exception 'Incomplete original realtor row accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_realtor_contacts(id,realtor_id,notes,source_file,source_row,source_column,source_values)
    values(gen_random_uuid(),c.imported_realtor,'Invalid column fixture','Fixture.csv',3,6,'["","fixture"]'::jsonb);
    raise exception 'Invalid original contact source column accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_realtor_contacts(id,realtor_id,notes,source_file,source_row,source_column,source_values)
    values(gen_random_uuid(),c.imported_realtor,'Invalid pair fixture','Fixture.csv',3,5,'["fixture"]'::jsonb);
    raise exception 'Incomplete original contact source pair accepted.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare
  c record;
  r public.hq_realtors%rowtype;
  h public.hq_realtor_contacts%rowtype;
  original_r public.hq_realtors%rowtype;
  original_h public.hq_realtor_contacts%rowtype;
  affected integer;
  removed_at timestamptz;
  before_history jsonb;
begin
  select * into c from pg_temp.realtor_check_context;
  select * into original_r from public.hq_realtors where id=c.imported_realtor;
  select * into original_h from public.hq_realtor_contacts where id=c.imported_contact;
  if jsonb_build_array(original_r.realtor_name,original_r.phone,original_r.email,original_r.location,
       original_h.contacted_date,original_h.notes,'','') is distinct from original_r.source_values
     or jsonb_build_array(original_h.contacted_date,original_h.notes) is distinct from original_h.source_values then
    raise exception 'Literal eight-cell row or two-cell contact pair changed.';
  end if;

  insert into public.hq_realtors(id,phone,revision,created_at,created_by,updated_at,updated_by,source_file,source_row,source_values)
  values(c.realtor,'  Call later / pending  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
       'Forged.csv',3,'["forged","","","","","","",""]'::jsonb) returning * into r;
  if r.revision <> 1 or r.created_by <> c.actor or r.updated_by <> c.actor or r.created_at='2000-01-01'
     or r.updated_at='2000-01-01' or r.phone <> '  Call later / pending  ' or r.realtor_name <> '' or r.email <> '' or r.location <> ''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Partial directory entry, literal text, audit, or provenance control failed.';
  end if;
  insert into public.hq_realtors(id,realtor_name) values(c.other_realtor,'Other fixture');
  insert into public.hq_realtor_contacts(id,realtor_id,notes,revision,created_at,created_by,updated_at,updated_by,
                                       source_file,source_row,source_column,source_values)
  values(c.contact,c.realtor,E'  Notes-only fixture\r\n  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
       'Forged.csv',3,7,'["forged",""]'::jsonb) returning * into h;
  if h.revision <> 1 or h.created_by <> c.actor or h.updated_by <> c.actor or h.created_at='2000-01-01'
     or h.updated_at='2000-01-01' or h.notes is distinct from E'  Notes-only fixture\r\n  ' or h.contacted_date <> ''
     or h.source_file is not null or h.source_row is not null or h.source_column is not null or h.source_values is not null then
    raise exception 'Partial history entry, literal text, audit, or provenance control failed.';
  end if;
  update public.hq_realtors set realtor_name='Renamed fixture',revision=99,updated_by=c.outsider,updated_at='2000-01-01'
    where id=c.realtor and revision=1 returning * into r;
  if r.revision <> 2 or r.updated_by <> c.actor or r.updated_at='2000-01-01' or r.phone <> '  Call later / pending  ' then
    raise exception 'Directory update audit or literal values changed.';
  end if;
  update public.hq_realtor_contacts set contacted_date='3/4/2024.08/19/25',revision=99,updated_by=c.outsider,updated_at='2000-01-01'
    where id=c.contact and revision=1 returning * into h;
  if h.revision <> 2 or h.updated_by <> c.actor or h.updated_at='2000-01-01'
     or h.contacted_date <> '3/4/2024.08/19/25' or h.notes is distinct from E'  Notes-only fixture\r\n  ' then
    raise exception 'History update audit or literal composite date changed.';
  end if;
  update public.hq_realtors set phone='Stale' where id=c.realtor and revision=1;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Stale directory edit overwrote data.'; end if;
  update public.hq_realtor_contacts set notes='Stale' where id=c.contact and revision=1;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Stale history edit overwrote data.'; end if;

  update public.hq_realtor_contacts set deleted_at='2000-01-01' where id=c.contact and revision=2 returning * into h;
  if h.deleted_at is null or h.deleted_at='2000-01-01' or h.revision <> 3 then raise exception 'History deletion stamp failed.'; end if;
  removed_at:=h.deleted_at;
  update public.hq_realtor_contacts set deleted_at='2001-01-01' where id=c.contact and revision=3 returning * into h;
  if h.deleted_at is distinct from removed_at then raise exception 'History deletion timestamp changed.'; end if;
  update public.hq_realtor_contacts set deleted_at=null where id=c.contact and revision=4 returning * into h;
  if h.deleted_at is not null or h.revision <> 5 or h.contacted_date <> '3/4/2024.08/19/25' then raise exception 'History restoration lost literal values.'; end if;
  update public.hq_realtor_contacts set deleted_at=now() where id=c.contact and revision=5;
  select jsonb_agg(to_jsonb(x) order by x.id) into before_history from public.hq_realtor_contacts x where x.realtor_id=c.realtor;
  update public.hq_realtors set deleted_at='2000-01-01' where id=c.realtor and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at='2000-01-01' or r.revision <> 3 then raise exception 'Directory deletion stamp failed.'; end if;
  removed_at:=r.deleted_at;
  if (select jsonb_agg(to_jsonb(x) order by x.id) from public.hq_realtor_contacts x where x.realtor_id=c.realtor)
       is distinct from before_history then raise exception 'Directory deletion changed contact history.'; end if;
  begin insert into public.hq_realtor_contacts(id,realtor_id,notes) values(gen_random_uuid(),c.realtor,'Deleted parent fixture');
    raise exception 'Deleted realtor accepted new history.'; exception when insufficient_privilege then null; end;
  begin update public.hq_realtor_contacts set notes='Deleted parent fixture' where id=c.contact;
    raise exception 'Deleted realtor accepted a history edit.'; exception when insufficient_privilege then null; end;
  begin update public.hq_realtor_contacts set deleted_at=null where id=c.contact;
    raise exception 'Deleted realtor accepted a history restoration.'; exception when insufficient_privilege then null; end;
  update public.hq_realtors set deleted_at='2001-01-01' where id=c.realtor and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Directory deletion timestamp changed.'; end if;
  update public.hq_realtors set deleted_at=null where id=c.realtor and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision <> 5 or r.realtor_name <> 'Renamed fixture'
     or (select jsonb_agg(to_jsonb(x) order by x.id) from public.hq_realtor_contacts x where x.realtor_id=c.realtor)
          is distinct from before_history then raise exception 'Restoring realtor changed individual history deletion.'; end if;
  update public.hq_realtor_contacts set deleted_at=null where id=c.contact and revision=6;

  update public.hq_realtors set realtor_name='Edited imported fixture' where id=c.imported_realtor returning * into r;
  update public.hq_realtor_contacts set notes='Edited imported fixture' where id=c.imported_contact returning * into h;
  if r.source_file is distinct from original_r.source_file or r.source_row is distinct from original_r.source_row
     or r.source_values is distinct from original_r.source_values or r.position is distinct from original_r.position
     or h.source_file is distinct from original_h.source_file or h.source_row is distinct from original_h.source_row
     or h.source_column is distinct from original_h.source_column or h.source_values is distinct from original_h.source_values
     or h.position is distinct from original_h.position then raise exception 'Working edits changed source metadata or order.'; end if;
  begin update public.hq_realtors set id=gen_random_uuid() where id=c.realtor;
    raise exception 'Directory identity changed.'; exception when check_violation then null; end;
  begin update public.hq_realtors set created_at='2000-01-01' where id=c.realtor;
    raise exception 'Directory creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_realtors set created_by=c.outsider where id=c.realtor;
    raise exception 'Directory creator changed.'; exception when check_violation then null; end;
  begin update public.hq_realtors set position=position+1 where id=c.realtor;
    raise exception 'Directory source order changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_realtors set source_file='Changed.csv' where id=c.imported_realtor;
    raise exception 'Directory source file changed.'; exception when check_violation then null; end;
  begin update public.hq_realtors set source_row=4 where id=c.imported_realtor;
    raise exception 'Directory source row changed.'; exception when check_violation then null; end;
  begin update public.hq_realtors set source_values='["changed","","","","","","",""]'::jsonb where id=c.imported_realtor;
    raise exception 'Directory source cells changed.'; exception when check_violation then null; end;
  begin update public.hq_realtors set realtor_name='',phone='',email='',location='' where id=c.realtor;
    raise exception 'Empty directory entry accepted.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set id=gen_random_uuid() where id=c.contact;
    raise exception 'History identity changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set realtor_id=c.other_realtor where id=c.contact;
    raise exception 'History parent changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set created_at='2000-01-01' where id=c.contact;
    raise exception 'History creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set created_by=c.outsider where id=c.contact;
    raise exception 'History creator changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set position=position+1 where id=c.contact;
    raise exception 'History original order changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_realtor_contacts set source_file='Changed.csv' where id=c.imported_contact;
    raise exception 'History source file changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set source_row=4 where id=c.imported_contact;
    raise exception 'History source row changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set source_column=7 where id=c.imported_contact;
    raise exception 'History source pair changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set source_values='["changed",""]'::jsonb where id=c.imported_contact;
    raise exception 'History source cells changed.'; exception when check_violation then null; end;
  begin update public.hq_realtor_contacts set contacted_date='',notes='' where id=c.contact;
    raise exception 'Empty history entry accepted.'; exception when check_violation then null; end;
  begin delete from public.hq_realtors where id=c.realtor;
    raise exception 'Permanent directory deletion allowed.'; exception when insufficient_privilege then null; end;
  begin delete from public.hq_realtor_contacts where id=c.contact;
    raise exception 'Permanent history deletion allowed.'; exception when insufficient_privilege then null; end;
end $$;

do $$ declare c record; field text; limit_value integer; stored text;
begin
  select * into c from pg_temp.realtor_check_context;
  for field,limit_value in select * from (values ('realtor_name',500),('phone',200),('email',500),('location',2000)) as limits(name,max_length)
  loop
    execute format('update public.hq_realtors set %I=$1 where id=$2 returning %I',field,field) into stored using repeat('x',limit_value),c.realtor;
    if char_length(stored) <> limit_value then raise exception 'Directory field % lost text.',field; end if;
    begin execute format('update public.hq_realtors set %I=$1 where id=$2',field) using repeat('x',limit_value+1),c.realtor;
      raise exception 'Directory field % accepted too much text.',field; exception when check_violation then null; end;
  end loop;
  for field,limit_value in select * from (values ('contacted_date',500),('notes',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_realtor_contacts set %I=$1 where id=$2 returning %I',field,field) into stored using repeat('x',limit_value),c.contact;
    if char_length(stored) <> limit_value then raise exception 'History field % lost text.',field; end if;
    begin execute format('update public.hq_realtor_contacts set %I=$1 where id=$2',field) using repeat('x',limit_value+1),c.contact;
      raise exception 'History field % accepted too much text.',field; exception when check_violation then null; end;
  end loop;
  begin insert into public.hq_realtors(id,phone) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'Whitespace-only directory entry accepted.'; exception when check_violation then null; end;
  begin insert into public.hq_realtor_contacts(id,realtor_id,notes) values(gen_random_uuid(),c.realtor,E' \t\r\n ');
    raise exception 'Whitespace-only history entry accepted.'; exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.realtor_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.realtor_check_context;
  if exists(select 1 from public.hq_realtors) or exists(select 1 from public.hq_realtor_contacts) then raise exception 'Nonstaff read realtor data.'; end if;
  update public.hq_realtors set phone='Unauthorized' where id=c.realtor;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Nonstaff updated directory.'; end if;
  update public.hq_realtor_contacts set notes='Unauthorized' where id=c.contact;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Nonstaff updated history.'; end if;
  begin insert into public.hq_realtors(id,realtor_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted directory.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_realtor_contacts(id,realtor_id,notes) values(gen_random_uuid(),c.realtor,'Unauthorized');
    raise exception 'Nonstaff inserted history.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.realtor_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.realtor_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.realtor_check_context;
  if exists(select 1 from public.hq_realtors) or exists(select 1 from public.hq_realtor_contacts) then raise exception 'Inactive staff read realtor data.'; end if;
  update public.hq_realtors set phone='Unauthorized' where id=c.realtor;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Inactive staff updated directory.'; end if;
  update public.hq_realtor_contacts set notes='Unauthorized' where id=c.contact;
  get diagnostics affected=row_count;if affected <> 0 then raise exception 'Inactive staff updated history.'; end if;
  begin insert into public.hq_realtors(id,realtor_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted directory.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_realtor_contacts(id,realtor_id,notes) values(gen_random_uuid(),c.realtor,'Unauthorized');
    raise exception 'Inactive staff inserted history.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_realtors; raise exception 'Anonymous directory read allowed.'; exception when insufficient_privilege then null; end;
  begin perform * from public.hq_realtor_contacts; raise exception 'Anonymous history read allowed.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_realtors(id,realtor_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous directory insert allowed.'; exception when insufficient_privilege then null; end;
  begin update public.hq_realtor_contacts set notes='Unauthorized';
    raise exception 'Anonymous history update allowed.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved directory and history CRUD, literal/partial values and field limits, audit/revisions, immutable source/parent, reversible deletion with history retention, deleted-parent protection, and anonymous/nonstaff/inactive isolation.' as result;
rollback;
