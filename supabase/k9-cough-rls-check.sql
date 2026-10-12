-- Execute after k9-cough-setup.sql. All fixture records and access changes roll back.
begin;
create temporary table k9_cough_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid
) on commit drop;
-- Prefer an existing guest account when one is named as such; approved guests use the same policy.
insert into k9_cough_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.k9_cough_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.k9_cough_check_context to authenticated,anon;

-- A private administrative import may retain its original cells and source identifiers.
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.k9_cough_check_context;
insert into public.hq_k9_cough(id,added_date,initials,pet_name,service_dates,room,group_type,services,notes,pcw_reimbursement,management_follow_up,source_file,source_row,source_values)
select imported_entry,'7/8/2024','AB','Fixture pet  ','7/8 - 7/10','Fixture room','indiv.','Boarding',E'Line one\r\nLine two  ','PCW note: $50 / pending','Management fixture','Fixture.csv',3,
       jsonb_build_array('7/8/2024','AB','Fixture pet  ','7/8 - 7/10','Fixture room','indiv.','Boarding',E'Line one\r\nLine two  ','PCW note: $50 / pending','Management fixture')
from pg_temp.k9_cough_check_context;
do $$ begin
  begin
    insert into public.hq_k9_cough(id,added_date,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.csv',3,'["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_k9_cough(id,pet_name,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid header fixture','Fixture.csv',2,'["","","fixture","","","","","","",""]'::jsonb);
    raise exception 'A header row was accepted as imported case data.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare
  c record;
  r public.hq_k9_cough%rowtype;
  original public.hq_k9_cough%rowtype;
  affected integer;
  removed_at timestamptz;
begin
  select * into c from pg_temp.k9_cough_check_context;
  select * into original from public.hq_k9_cough where id=c.imported_entry;
  if original.source_values is distinct from jsonb_build_array('7/8/2024','AB','Fixture pet  ','7/8 - 7/10','Fixture room','indiv.','Boarding',E'Line one\r\nLine two  ','PCW note: $50 / pending','Management fixture') then
    raise exception 'Imported source cells were not retained.';
  end if;
  if jsonb_build_array(original.added_date,original.initials,original.pet_name,original.service_dates,
                       original.room,original.group_type,original.services,original.notes,original.pcw_reimbursement,original.management_follow_up)
     is distinct from original.source_values then
    raise exception 'Original working values lost literal dates, blanks, whitespace, or line endings.';
  end if;
  insert into public.hq_k9_cough(id,services,revision,created_at,created_by,updated_at,updated_by,
                                    source_file,source_row,source_values)
  values(c.entry,'  AB  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.csv',1,'["forged","","","","","","","","",""]'::jsonb) returning * into r;
  if r.revision <> 1 or r.created_by <> c.actor or r.updated_by <> c.actor
     or r.created_at = '2000-01-01' or r.updated_at = '2000-01-01'
     or r.services <> '  AB  ' or r.added_date <> '' or r.initials <> '' or r.pet_name <> '' or r.service_dates <> ''
     or r.room <> '' or r.group_type <> '' or r.notes <> '' or r.pcw_reimbursement <> '' or r.management_follow_up <> ''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Partial entry, literal values, audit stamps, or provenance control failed.';
  end if;
  update public.hq_k9_cough set initials='Renamed fixture',revision=99,updated_by=c.outsider,
                                  updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision <> 2 or r.updated_by <> c.actor or r.updated_at = '2000-01-01'
     or r.services <> '  AB  ' then raise exception 'Update audit or revision stamping failed.'; end if;
  update public.hq_k9_cough set services='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Stale edit overwrote a record.'; end if;

  update public.hq_k9_cough set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at = '2000-01-01' or r.revision <> 3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at := r.deleted_at;
  update public.hq_k9_cough set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_k9_cough set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision <> 5 or r.initials <> 'Renamed fixture' or r.services <> '  AB  ' then
    raise exception 'Restore did not retain the record.';
  end if;

  update public.hq_k9_cough set initials='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin
    update public.hq_k9_cough set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_k9_cough set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_k9_cough set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_k9_cough set position=position+1 where id=c.entry;
    raise exception 'Original position changed.';
  exception when check_violation or generated_always then null; end;
  begin
    update public.hq_k9_cough set source_file='Changed.csv' where id=c.imported_entry;
    raise exception 'Original source file changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_k9_cough set source_row=4 where id=c.imported_entry;
    raise exception 'Original source row changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_k9_cough set source_values='["changed","","","","","","","","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_k9_cough set added_date='',initials='',pet_name='',service_dates='',room='',group_type='',services='',notes='',pcw_reimbursement='',management_follow_up='' where id=c.entry;
    raise exception 'Completely empty entry accepted.';
  exception when check_violation then null; end;
  begin
    delete from public.hq_k9_cough where id=c.entry;
    raise exception 'Permanent deletion allowed.';
  exception when insufficient_privilege then null; end;
end $$;

-- Clinical and reimbursement descriptions remain literal text; no derived status or amounts.
do $$
declare
  partial_entry uuid := gen_random_uuid();
  field text;
  limit_value integer;
  stored text;
  r public.hq_k9_cough%rowtype;
begin
  insert into public.hq_k9_cough(id,pcw_reimbursement) values(partial_entry,'  PCW note: $50 / pending  ') returning * into r;
  if r.pcw_reimbursement <> '  PCW note: $50 / pending  ' or r.added_date <> '' or r.pet_name <> '' or r.management_follow_up <> '' then
    raise exception 'Reimbursement-only partial record did not preserve literal values and blanks.';
  end if;
  update public.hq_k9_cough set added_date='next Thursday',pet_name='Fixture pet  ',service_dates='7/8, 7/10 / afternoon',
      notes=E'  Staff note\r\nSecond line  ',management_follow_up='Contact note / not yet confirmed' where id=partial_entry returning * into r;
  if r.added_date <> 'next Thursday' or r.pet_name <> 'Fixture pet  ' or r.service_dates <> '7/8, 7/10 / afternoon'
     or r.notes is distinct from E'  Staff note\r\nSecond line  ' or r.management_follow_up <> 'Contact note / not yet confirmed' then
    raise exception 'Literal dates, name, notes, or management text changed.';
  end if;
  -- Repeated pet names remain independent cases.
  insert into public.hq_k9_cough(id,pet_name) values(gen_random_uuid(),'Fixture pet  ');
  for field,limit_value in
    select * from (values ('added_date',500),('initials',120),('pet_name',1000),('service_dates',2000),('room',2000),
                         ('group_type',1000),('services',1000),('notes',20000),('pcw_reimbursement',20000),('management_follow_up',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_k9_cough set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),partial_entry;
    if char_length(stored) <> limit_value then raise exception 'Field % limit lost text.',field; end if;
    begin
      execute format('update public.hq_k9_cough set %I=$1 where id=$2',field)
        using repeat('x',limit_value+1),partial_entry;
      raise exception 'Field % accepted too much text.',field;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.hq_k9_cough(id,notes) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'A whitespace-only row was accepted.';
  exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.k9_cough_check_context;
do $$
declare c record; affected integer;
begin
  select * into c from pg_temp.k9_cough_check_context;
  if exists(select 1 from public.hq_k9_cough) then raise exception 'Nonstaff read K9 Cough data.'; end if;
  update public.hq_k9_cough set services='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin
    insert into public.hq_k9_cough(id,initials) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.k9_cough_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.k9_cough_check_context;
do $$
declare affected integer;
begin
  if exists(select 1 from public.hq_k9_cough) then raise exception 'Inactive staff read K9 Cough data.'; end if;
  update public.hq_k9_cough set services='Unauthorized' where id=(select entry from pg_temp.k9_cough_check_context);
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin
    insert into public.hq_k9_cough(id,initials) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_k9_cough; raise exception 'Anonymous read allowed.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_k9_cough(id,initials) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_k9_cough set services='Unauthorized';
    raise exception 'Anonymous update allowed.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, partial entries, exact text and field limits, audit and revisions, immutable source, reversible deletion, and anonymous/nonstaff isolation.' as result;
rollback;
