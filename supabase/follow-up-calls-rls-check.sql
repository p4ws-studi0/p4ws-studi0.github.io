-- Execute after follow-up-calls-setup.sql. All fixture records and access changes roll back.
begin;
create temporary table follow_up_calls_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid
) on commit drop;
-- Prefer an existing guest account when one is named as such; approved guests use the same policy.
insert into follow_up_calls_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.follow_up_calls_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.follow_up_calls_check_context to authenticated,anon;

-- A private administrative import may retain its original cells and source identifiers.
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.follow_up_calls_check_context;
insert into public.hq_follow_up_calls(id,owner_name,pet_name,res_start_date,res_end_date,call_made,call_made_on,initials,notes,source_file,source_row,source_values)
select imported_entry,'Fixture owner','Fixture pet','  9/28  ','10/1','VM','9/29  11 am','',E'Line one\r\nLine two  ','Fixture.pdf',1,
       jsonb_build_array('Fixture owner','Fixture pet','  9/28  ','10/1','VM','9/29  11 am','',E'Line one\r\nLine two  ')
from pg_temp.follow_up_calls_check_context;
do $$ begin
  begin
    insert into public.hq_follow_up_calls(id,owner_name,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.pdf',1,'["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare
  c record;
  r public.hq_follow_up_calls%rowtype;
  original public.hq_follow_up_calls%rowtype;
  affected integer;
  removed_at timestamptz;
begin
  select * into c from pg_temp.follow_up_calls_check_context;
  select * into original from public.hq_follow_up_calls where id=c.imported_entry;
  if original.source_values is distinct from jsonb_build_array('Fixture owner','Fixture pet','  9/28  ','10/1','VM','9/29  11 am','',E'Line one\r\nLine two  ') then
    raise exception 'Imported source cells were not retained.';
  end if;
  if jsonb_build_array(original.owner_name,original.pet_name,original.res_start_date,original.res_end_date,
                       original.call_made,original.call_made_on,original.initials,original.notes)
     is distinct from original.source_values then
    raise exception 'Original working values lost literal dates, blanks, whitespace, or line endings.';
  end if;
  insert into public.hq_follow_up_calls(id,initials,revision,created_at,created_by,updated_at,updated_by,
                                    source_file,source_row,source_values)
  values(c.entry,'  AB  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.pdf',1,'["forged","","","","","","",""]'::jsonb) returning * into r;
  if r.revision <> 1 or r.created_by <> c.actor or r.updated_by <> c.actor
     or r.created_at = '2000-01-01' or r.updated_at = '2000-01-01'
     or r.initials <> '  AB  ' or r.owner_name <> '' or r.pet_name <> '' or r.res_start_date <> '' or r.res_end_date <> ''
     or r.call_made <> '' or r.call_made_on <> '' or r.notes <> ''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Partial entry, literal values, audit stamps, or provenance control failed.';
  end if;
  update public.hq_follow_up_calls set pet_name='Renamed fixture',revision=99,updated_by=c.outsider,
                                  updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision <> 2 or r.updated_by <> c.actor or r.updated_at = '2000-01-01'
     or r.initials <> '  AB  ' then raise exception 'Update audit or revision stamping failed.'; end if;
  update public.hq_follow_up_calls set initials='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Stale edit overwrote a record.'; end if;

  update public.hq_follow_up_calls set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at = '2000-01-01' or r.revision <> 3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at := r.deleted_at;
  update public.hq_follow_up_calls set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_follow_up_calls set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision <> 5 or r.pet_name <> 'Renamed fixture' or r.initials <> '  AB  ' then
    raise exception 'Restore did not retain the record.';
  end if;

  update public.hq_follow_up_calls set pet_name='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin
    update public.hq_follow_up_calls set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_follow_up_calls set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_follow_up_calls set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_follow_up_calls set position=position+1 where id=c.entry;
    raise exception 'Original position changed.';
  exception when check_violation or generated_always then null; end;
  begin
    update public.hq_follow_up_calls set source_file='Changed.pdf' where id=c.imported_entry;
    raise exception 'Original source file changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_follow_up_calls set source_row=2 where id=c.imported_entry;
    raise exception 'Original source row changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_follow_up_calls set source_values='["changed","","","","","","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_follow_up_calls set owner_name='',pet_name='',res_start_date='',res_end_date='',call_made='',call_made_on='',initials='',notes='' where id=c.entry;
    raise exception 'Completely empty entry accepted.';
  exception when check_violation then null; end;
  begin
    delete from public.hq_follow_up_calls where id=c.entry;
    raise exception 'Permanent deletion allowed.';
  exception when insufficient_privilege then null; end;
end $$;

-- Field lengths allow long notes and forgiving values while bounding every cell.
do $$
declare
  entry_id uuid := gen_random_uuid();
  field text;
  limit_value integer;
  stored text;
  r public.hq_follow_up_calls%rowtype;
begin
  insert into public.hq_follow_up_calls(id,notes)
  values(entry_id,E'  Notes-only fixture\r\n  ') returning * into r;
  if r.notes is distinct from E'  Notes-only fixture\r\n  ' or r.owner_name <> '' then
    raise exception 'Notes-only partial entry did not preserve literal text.';
  end if;
  update public.hq_follow_up_calls set res_start_date='next Thursday',res_end_date='9/30',
      call_made='Left a voicemail / retry',call_made_on='Monday afternoon' where id=entry_id;
  for field,limit_value in
    select * from (values ('owner_name',200),('pet_name',200),('res_start_date',120),('res_end_date',120),
                          ('call_made',1000),('call_made_on',500),('initials',120),('notes',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_follow_up_calls set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),entry_id;
    if char_length(stored) <> limit_value then raise exception 'Field % limit lost text.',field; end if;
    begin
      execute format('update public.hq_follow_up_calls set %I=$1 where id=$2',field)
        using repeat('x',limit_value+1),entry_id;
      raise exception 'Field % accepted too much text.',field;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.hq_follow_up_calls(id,notes) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'A whitespace-only row was accepted.';
  exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.follow_up_calls_check_context;
do $$
declare c record; affected integer;
begin
  select * into c from pg_temp.follow_up_calls_check_context;
  if exists(select 1 from public.hq_follow_up_calls) then raise exception 'Nonstaff read follow-up data.'; end if;
  update public.hq_follow_up_calls set initials='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin
    insert into public.hq_follow_up_calls(id,pet_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.follow_up_calls_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.follow_up_calls_check_context;
do $$
declare affected integer;
begin
  if exists(select 1 from public.hq_follow_up_calls) then raise exception 'Inactive staff read follow-up data.'; end if;
  update public.hq_follow_up_calls set initials='Unauthorized' where id=(select entry from pg_temp.follow_up_calls_check_context);
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin
    insert into public.hq_follow_up_calls(id,pet_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_follow_up_calls; raise exception 'Anonymous read allowed.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_follow_up_calls(id,pet_name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_follow_up_calls set initials='Unauthorized';
    raise exception 'Anonymous update allowed.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, partial entries, exact text and field limits, audit and revisions, immutable source, reversible deletion, and anonymous/nonstaff isolation.' as result;
rollback;
