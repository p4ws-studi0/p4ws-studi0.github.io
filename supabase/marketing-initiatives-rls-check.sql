-- Execute after marketing-initiatives-setup.sql. All fixture records and access changes roll back.
begin;
create temporary table marketing_initiatives_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid
) on commit drop;
-- Prefer an existing guest account when one is named as such; approved guests use the same policy.
insert into marketing_initiatives_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.marketing_initiatives_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.marketing_initiatives_check_context to authenticated,anon;

-- A private administrative import may retain its original cells and source identifiers.
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.marketing_initiatives_check_context;
insert into public.hq_marketing_initiatives(id,drop_off_location,initiative_date,notes,source_file,source_row,source_values,source_year)
select imported_entry,'Fixture location','  8/19  ',E'Line one\r\nLine two  ','Fixture.csv',1,
       jsonb_build_array('Fixture location','  8/19  ',E'Line one\r\nLine two  '),2025
from pg_temp.marketing_initiatives_check_context;
do $$ begin
  begin
    insert into public.hq_marketing_initiatives(id,drop_off_location,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.csv',1,'["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_marketing_initiatives(id,drop_off_location,source_file,source_row,source_values,source_year)
    values(gen_random_uuid(),'Invalid year fixture','Fixture.csv',1,'["one","two","three"]'::jsonb,2101);
    raise exception 'An out-of-range source year was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_marketing_initiatives(id,drop_off_location,source_year)
    values(gen_random_uuid(),'Missing source fixture',2025);
    raise exception 'Source year was accepted without source metadata.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare
  c record;
  r public.hq_marketing_initiatives%rowtype;
  original public.hq_marketing_initiatives%rowtype;
  affected integer;
  removed_at timestamptz;
begin
  select * into c from pg_temp.marketing_initiatives_check_context;
  select * into original from public.hq_marketing_initiatives where id=c.imported_entry;
  if original.source_values is distinct from jsonb_build_array('Fixture location','  8/19  ',E'Line one\r\nLine two  ') then
    raise exception 'Imported source cells were not retained.';
  end if;
  if jsonb_build_array(original.drop_off_location,original.initiative_date,original.notes)
     is distinct from original.source_values or original.source_year is distinct from 2025 then
    raise exception 'Working values or source year context lost literal values.';
  end if;
  insert into public.hq_marketing_initiatives(id,notes,revision,created_at,created_by,updated_at,updated_by,
                                    source_file,source_row,source_values,source_year)
  values(c.entry,'  AB  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.csv',1,'["forged","",""]'::jsonb,1999) returning * into r;
  if r.revision <> 1 or r.created_by <> c.actor or r.updated_by <> c.actor
     or r.created_at = '2000-01-01' or r.updated_at = '2000-01-01'
     or r.notes <> '  AB  ' or r.drop_off_location <> '' or r.initiative_date <> ''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null or r.source_year is not null then
    raise exception 'Partial entry, literal values, audit stamps, or provenance control failed.';
  end if;
  update public.hq_marketing_initiatives set drop_off_location='Renamed fixture',revision=99,updated_by=c.outsider,
                                  updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision <> 2 or r.updated_by <> c.actor or r.updated_at = '2000-01-01'
     or r.notes <> '  AB  ' then raise exception 'Update audit or revision stamping failed.'; end if;
  update public.hq_marketing_initiatives set notes='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Stale edit overwrote a record.'; end if;

  update public.hq_marketing_initiatives set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at = '2000-01-01' or r.revision <> 3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at := r.deleted_at;
  update public.hq_marketing_initiatives set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_marketing_initiatives set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision <> 5 or r.drop_off_location <> 'Renamed fixture' or r.notes <> '  AB  ' then
    raise exception 'Restore did not retain the record.';
  end if;

  update public.hq_marketing_initiatives set drop_off_location='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.source_year is distinct from original.source_year
     or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin
    update public.hq_marketing_initiatives set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set position=position+1 where id=c.entry;
    raise exception 'Original position changed.';
  exception when check_violation or generated_always then null; end;
  begin
    update public.hq_marketing_initiatives set source_file='Changed.csv' where id=c.imported_entry;
    raise exception 'Original source file changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set source_row=2 where id=c.imported_entry;
    raise exception 'Original source row changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set source_values='["changed","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set source_year=2026 where id=c.imported_entry;
    raise exception 'Original source year changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set source_year=null where id=c.imported_entry;
    raise exception 'Original source year was cleared.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set source_year=2025 where id=c.entry;
    raise exception 'A browser-created row gained source year metadata.';
  exception when check_violation then null; end;
  begin
    update public.hq_marketing_initiatives set drop_off_location='',initiative_date='',notes='' where id=c.entry;
    raise exception 'Completely empty entry accepted.';
  exception when check_violation then null; end;
  begin
    delete from public.hq_marketing_initiatives where id=c.entry;
    raise exception 'Permanent deletion allowed.';
  exception when insufficient_privilege then null; end;
end $$;

-- Field lengths allow long notes and forgiving dates while bounding each cell.
do $$
declare
  entry_id uuid := gen_random_uuid();
  field text;
  limit_value integer;
  stored text;
  r public.hq_marketing_initiatives%rowtype;
begin
  insert into public.hq_marketing_initiatives(id,notes)
  values(entry_id,E'  Notes-only fixture\r\n  ') returning * into r;
  if r.notes is distinct from E'  Notes-only fixture\r\n  ' or r.drop_off_location <> '' then
    raise exception 'Notes-only partial entry did not preserve literal text.';
  end if;
  update public.hq_marketing_initiatives set initiative_date='next Thursday / afternoon' where id=entry_id;
  for field,limit_value in
    select * from (values ('drop_off_location',500),('initiative_date',120),('notes',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_marketing_initiatives set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),entry_id;
    if char_length(stored) <> limit_value then raise exception 'Field % limit lost text.',field; end if;
    begin
      execute format('update public.hq_marketing_initiatives set %I=$1 where id=$2',field)
        using repeat('x',limit_value+1),entry_id;
      raise exception 'Field % accepted too much text.',field;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.hq_marketing_initiatives(id,notes) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'A whitespace-only row was accepted.';
  exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.marketing_initiatives_check_context;
do $$
declare c record; affected integer;
begin
  select * into c from pg_temp.marketing_initiatives_check_context;
  if exists(select 1 from public.hq_marketing_initiatives) then raise exception 'Nonstaff read marketing data.'; end if;
  update public.hq_marketing_initiatives set notes='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin
    insert into public.hq_marketing_initiatives(id,drop_off_location) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.marketing_initiatives_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.marketing_initiatives_check_context;
do $$
declare affected integer;
begin
  if exists(select 1 from public.hq_marketing_initiatives) then raise exception 'Inactive staff read marketing data.'; end if;
  update public.hq_marketing_initiatives set notes='Unauthorized' where id=(select entry from pg_temp.marketing_initiatives_check_context);
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin
    insert into public.hq_marketing_initiatives(id,drop_off_location) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_marketing_initiatives; raise exception 'Anonymous read allowed.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_marketing_initiatives(id,drop_off_location) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_marketing_initiatives set notes='Unauthorized';
    raise exception 'Anonymous update allowed.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, partial entries, exact text and field limits, audit and revisions, immutable source and year context, reversible deletion, and anonymous/nonstaff isolation.' as result;
rollback;
