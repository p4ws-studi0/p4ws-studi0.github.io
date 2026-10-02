-- Execute after dog-licenses-setup.sql. All fixture records and access changes roll back.
begin;
create temporary table dog_licenses_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid
) on commit drop;
-- Prefer an existing guest account when one is named as such; approved guests use the same policy.
insert into dog_licenses_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.dog_licenses_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.dog_licenses_check_context to authenticated,anon;

-- A private administrative import may retain its original cells and source identifiers.
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.dog_licenses_check_context;
insert into public.hq_dog_licenses(id,pet_name,request_type,initials,source_file,source_row,source_values)
select imported_entry,'Fixture pet','  follow up  ','','Fixture.pdf',1,
       '["Fixture pet","  follow up  ",""]'::jsonb
from pg_temp.dog_licenses_check_context;

set local role authenticated;
do $$
declare
  c record;
  r public.hq_dog_licenses%rowtype;
  original public.hq_dog_licenses%rowtype;
  affected integer;
  removed_at timestamptz;
begin
  select * into c from pg_temp.dog_licenses_check_context;
  select * into original from public.hq_dog_licenses where id=c.imported_entry;
  if original.source_values is distinct from '["Fixture pet","  follow up  ",""]'::jsonb then
    raise exception 'Imported source cells were not retained.';
  end if;
  insert into public.hq_dog_licenses(id,initials,revision,created_at,created_by,updated_at,updated_by,
                                    source_file,source_row,source_values)
  values(c.entry,'  AB  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.pdf',1,'["forged","",""]'::jsonb) returning * into r;
  if r.revision <> 1 or r.created_by <> c.actor or r.updated_by <> c.actor
     or r.created_at = '2000-01-01' or r.updated_at = '2000-01-01'
     or r.initials <> '  AB  ' or r.pet_name <> '' or r.request_type <> ''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Partial entry, literal values, audit stamps, or provenance control failed.';
  end if;
  update public.hq_dog_licenses set pet_name='Renamed fixture',revision=99,updated_by=c.outsider,
                                  updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision <> 2 or r.updated_by <> c.actor or r.updated_at = '2000-01-01'
     or r.initials <> '  AB  ' then raise exception 'Update audit or revision stamping failed.'; end if;
  update public.hq_dog_licenses set initials='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Stale edit overwrote a record.'; end if;

  update public.hq_dog_licenses set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at = '2000-01-01' or r.revision <> 3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at := r.deleted_at;
  update public.hq_dog_licenses set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_dog_licenses set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision <> 5 or r.pet_name <> 'Renamed fixture' or r.initials <> '  AB  ' then
    raise exception 'Restore did not retain the record.';
  end if;

  update public.hq_dog_licenses set pet_name='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin
    update public.hq_dog_licenses set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_dog_licenses set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_dog_licenses set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_dog_licenses set position=position+1 where id=c.entry;
    raise exception 'Original position changed.';
  exception when check_violation or generated_always then null; end;
  begin
    update public.hq_dog_licenses set source_file='Changed.pdf' where id=c.imported_entry;
    raise exception 'Original source file changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_dog_licenses set source_row=2 where id=c.imported_entry;
    raise exception 'Original source row changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_dog_licenses set source_values='["changed","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_dog_licenses set pet_name='',request_type='',initials='' where id=c.entry;
    raise exception 'Completely empty entry accepted.';
  exception when check_violation then null; end;
  begin
    delete from public.hq_dog_licenses where id=c.entry;
    raise exception 'Permanent deletion allowed.';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.dog_licenses_check_context;
do $$
declare c record; affected integer;
begin
  select * into c from pg_temp.dog_licenses_check_context;
  if exists(select 1 from public.hq_dog_licenses) then raise exception 'Nonstaff read dog-license data.'; end if;
  update public.hq_dog_licenses set initials='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin
    insert into public.hq_dog_licenses(id,pet_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.dog_licenses_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.dog_licenses_check_context;
do $$
declare affected integer;
begin
  if exists(select 1 from public.hq_dog_licenses) then raise exception 'Inactive staff read dog-license data.'; end if;
  update public.hq_dog_licenses set initials='Unauthorized' where id=(select entry from pg_temp.dog_licenses_check_context);
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin
    insert into public.hq_dog_licenses(id,pet_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_dog_licenses; raise exception 'Anonymous read allowed.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_dog_licenses(id,pet_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_dog_licenses set initials='Unauthorized';
    raise exception 'Anonymous update allowed.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, partial entries, exact text, audit and revisions, immutable source, reversible deletion, and anonymous/nonstaff isolation.' as result;
rollback;
