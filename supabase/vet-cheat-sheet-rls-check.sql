-- Execute after vet-cheat-sheet-setup.sql. All synthetic fixtures and access changes roll back.
begin;
create temporary table vet_cheat_sheet_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid
) on commit drop;
insert into vet_cheat_sheet_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.vet_cheat_sheet_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.vet_cheat_sheet_check_context to authenticated,anon;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.vet_cheat_sheet_check_context;

-- An administrative import keeps every literal cell, including whitespace and blanks.
insert into public.hq_vet_cheat_sheet(id,veterinarian,phone,normal_hours,lunch_break,menu_button,no_reply_email,notes,source_file,source_row,source_values)
select imported_entry,'Fixture Vet  ','0012030000000','M-F 8-5; S 9-12','Yes','','no - notes ',E'Line one\r\nLine two  ',
       'Fixture.csv',2,jsonb_build_array('Fixture Vet  ','0012030000000','M-F 8-5; S 9-12','Yes','','no - notes ',E'Line one\r\nLine two  ')
from pg_temp.vet_cheat_sheet_check_context;
do $$ begin
  begin
    insert into public.hq_vet_cheat_sheet(id,veterinarian,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.csv',2,'["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_vet_cheat_sheet(id,veterinarian,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid header fixture','Fixture.csv',1,'["fixture","","","","","",""]'::jsonb);
    raise exception 'A header row was accepted as imported record data.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare c record; r public.hq_vet_cheat_sheet%rowtype; original public.hq_vet_cheat_sheet%rowtype;
        affected integer; removed_at timestamptz;
begin
  select * into c from pg_temp.vet_cheat_sheet_check_context;
  select * into original from public.hq_vet_cheat_sheet where id=c.imported_entry;
  if original.source_values is distinct from jsonb_build_array('Fixture Vet  ','0012030000000','M-F 8-5; S 9-12','Yes','','no - notes ',E'Line one\r\nLine two  ') then
    raise exception 'Imported source cells were not retained.';
  end if;
  if jsonb_build_array(original.veterinarian,original.phone,original.normal_hours,original.lunch_break,
                       original.menu_button,original.no_reply_email,original.notes) is distinct from original.source_values then
    raise exception 'Original working values lost literal cells, blanks, whitespace, or line endings.';
  end if;
  insert into public.hq_vet_cheat_sheet(id,menu_button,revision,created_at,created_by,updated_at,updated_by,
                                      source_file,source_row,source_values)
  values(c.entry,'  n/a  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.csv',1,'["forged","","","","","",""]'::jsonb) returning * into r;
  if r.revision<>1 or r.created_by<>c.actor or r.updated_by<>c.actor
     or r.created_at='2000-01-01' or r.updated_at='2000-01-01'
     or r.menu_button<>'  n/a  ' or r.veterinarian<>'' or r.phone<>'' or r.normal_hours<>''
     or r.lunch_break<>'' or r.no_reply_email<>'' or r.notes<>''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Partial entry, literal values, audit stamps, or provenance control failed.';
  end if;
  update public.hq_vet_cheat_sheet set phone='00123 ext. 4',revision=99,updated_by=c.outsider,updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision<>2 or r.updated_by<>c.actor or r.updated_at='2000-01-01' or r.menu_button<>'  n/a  ' then
    raise exception 'Update audit or revision stamping failed.';
  end if;
  update public.hq_vet_cheat_sheet set phone='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Stale edit overwrote a record.'; end if;
  update public.hq_vet_cheat_sheet set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at='2000-01-01' or r.revision<>3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at:=r.deleted_at;
  update public.hq_vet_cheat_sheet set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_vet_cheat_sheet set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision<>5 or r.phone<>'00123 ext. 4' or r.menu_button<>'  n/a  ' then
    raise exception 'Restore did not retain the record.';
  end if;
  update public.hq_vet_cheat_sheet set phone='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin update public.hq_vet_cheat_sheet set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.'; exception when check_violation then null; end;
  begin update public.hq_vet_cheat_sheet set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_vet_cheat_sheet set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.'; exception when check_violation then null; end;
  begin update public.hq_vet_cheat_sheet set position=position+1 where id=c.entry;
    raise exception 'Original position changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_vet_cheat_sheet set source_file='Changed.csv' where id=c.imported_entry;
    raise exception 'Original source file changed.'; exception when check_violation then null; end;
  begin update public.hq_vet_cheat_sheet set source_row=3 where id=c.imported_entry;
    raise exception 'Original source row changed.'; exception when check_violation then null; end;
  begin update public.hq_vet_cheat_sheet set source_values='["changed","","","","","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.'; exception when check_violation then null; end;
  begin update public.hq_vet_cheat_sheet set veterinarian='',phone='',normal_hours='',lunch_break='',menu_button='',no_reply_email='',notes='' where id=c.entry;
    raise exception 'Completely empty entry accepted.'; exception when check_violation then null; end;
  begin delete from public.hq_vet_cheat_sheet where id=c.entry;
    raise exception 'Permanent deletion allowed.'; exception when insufficient_privilege then null; end;
end $$;

-- Freeform hours, partial entries, phone formats and notes remain text. Repeated names are allowed.
do $$
declare partial_entry uuid:=gen_random_uuid(); field text; limit_value integer; stored text;
        r public.hq_vet_cheat_sheet%rowtype;
begin
  insert into public.hq_vet_cheat_sheet(id,menu_button) values(partial_entry,'  n/a  ') returning * into r;
  if r.menu_button<>'  n/a  ' or r.veterinarian<>'' or r.phone<>'' or r.notes<>'' then
    raise exception 'Menu-only partial record did not preserve literal values and blanks.';
  end if;
  update public.hq_vet_cheat_sheet set veterinarian='Fixture Vet  ',phone='00123 / ext. 4',normal_hours='Call for hours',
    lunch_break='yes - varies',no_reply_email='no - notes ',notes=E'  Staff note\r\nSecond line  ' where id=partial_entry returning * into r;
  if r.veterinarian<>'Fixture Vet  ' or r.phone<>'00123 / ext. 4' or r.normal_hours<>'Call for hours'
     or r.lunch_break<>'yes - varies' or r.no_reply_email<>'no - notes ' or r.notes is distinct from E'  Staff note\r\nSecond line  ' then
    raise exception 'Literal name, phone, hours, flags, or notes changed.';
  end if;
  insert into public.hq_vet_cheat_sheet(id,veterinarian) values(gen_random_uuid(),'Fixture Vet  ');
  for field,limit_value in select * from (values ('veterinarian',500),('phone',200),('normal_hours',2000),
    ('lunch_break',500),('menu_button',500),('no_reply_email',2000),('notes',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_vet_cheat_sheet set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),partial_entry;
    if char_length(stored)<>limit_value then raise exception 'Field % limit lost text.',field; end if;
    begin execute format('update public.hq_vet_cheat_sheet set %I=$1 where id=$2',field) using repeat('x',limit_value+1),partial_entry;
      raise exception 'Field % accepted too much text.',field; exception when check_violation then null; end;
  end loop;
  begin insert into public.hq_vet_cheat_sheet(id,notes) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'A whitespace-only row was accepted.'; exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.vet_cheat_sheet_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.vet_cheat_sheet_check_context;
  if exists(select 1 from public.hq_vet_cheat_sheet) then raise exception 'Nonstaff read veterinarian data.'; end if;
  update public.hq_vet_cheat_sheet set phone='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin insert into public.hq_vet_cheat_sheet(id,veterinarian) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.vet_cheat_sheet_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.vet_cheat_sheet_check_context;
do $$ declare affected integer;
begin
  if exists(select 1 from public.hq_vet_cheat_sheet) then raise exception 'Inactive staff read veterinarian data.'; end if;
  update public.hq_vet_cheat_sheet set phone='Unauthorized' where id=(select entry from pg_temp.vet_cheat_sheet_check_context);
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin insert into public.hq_vet_cheat_sheet(id,veterinarian) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_vet_cheat_sheet; raise exception 'Anonymous read allowed.';
    exception when insufficient_privilege then null; end;
  begin insert into public.hq_vet_cheat_sheet(id,veterinarian) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.'; exception when insufficient_privilege then null; end;
  begin update public.hq_vet_cheat_sheet set phone='Unauthorized'; raise exception 'Anonymous update allowed.';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, partial entries, exact text and field limits, audit and revisions, immutable source, reversible deletion, and anonymous/nonstaff/inactive isolation.' as result;
rollback;
