-- Execute after potential-training-clients-setup.sql. All synthetic fixtures and access changes roll back.
begin;
create temporary table potential_training_clients_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid
) on commit drop;
insert into potential_training_clients_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.potential_training_clients_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.potential_training_clients_check_context to authenticated,anon;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.potential_training_clients_check_context;

-- An administrative import keeps every literal cell, including whitespace and blanks.
insert into public.hq_potential_training_clients(id,owner,dog,phone,initial_conversation,first_contact,follow_up,evaluation,outcome,source_file,source_row,source_values)
select imported_entry,'Fixture Owner  ','Fixture dog  ','0012030000000','AB / ?','6/25','','8/27 3;30 / AB ',E'Line one\r\nLine two  ',
       'Fixture.csv',3,jsonb_build_array('Fixture Owner  ','Fixture dog  ','0012030000000','AB / ?','6/25','','8/27 3;30 / AB ',E'Line one\r\nLine two  ')
from pg_temp.potential_training_clients_check_context;
do $$ begin
  begin
    insert into public.hq_potential_training_clients(id,owner,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.csv',3,'["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_potential_training_clients(id,owner,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid header fixture','Fixture.csv',2,'["fixture","","","","","","",""]'::jsonb);
    raise exception 'A header row was accepted as imported record data.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare c record; r public.hq_potential_training_clients%rowtype; original public.hq_potential_training_clients%rowtype;
        affected integer; removed_at timestamptz;
begin
  select * into c from pg_temp.potential_training_clients_check_context;
  select * into original from public.hq_potential_training_clients where id=c.imported_entry;
  if original.source_values is distinct from jsonb_build_array('Fixture Owner  ','Fixture dog  ','0012030000000','AB / ?','6/25','','8/27 3;30 / AB ',E'Line one\r\nLine two  ') then
    raise exception 'Imported source cells were not retained.';
  end if;
  if jsonb_build_array(original.owner,original.dog,original.phone,original.initial_conversation,original.first_contact,
                       original.follow_up,original.evaluation,original.outcome) is distinct from original.source_values then
    raise exception 'Original working values lost literal cells, blanks, whitespace, or line endings.';
  end if;
  insert into public.hq_potential_training_clients(id,follow_up,revision,created_at,created_by,updated_at,updated_by,
                                      source_file,source_row,source_values)
  values(c.entry,'  n/a  ',99,'2000-01-01',c.outsider,'2000-01-01',c.outsider,
         'Forged.csv',1,'["forged","","","","","","",""]'::jsonb) returning * into r;
  if r.revision<>1 or r.created_by<>c.actor or r.updated_by<>c.actor
     or r.created_at='2000-01-01' or r.updated_at='2000-01-01'
     or r.follow_up<>'  n/a  ' or r.owner<>'' or r.dog<>'' or r.phone<>'' or r.initial_conversation<>''
     or r.first_contact<>'' or r.evaluation<>'' or r.outcome<>''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Partial entry, literal values, audit stamps, or provenance control failed.';
  end if;
  update public.hq_potential_training_clients set phone='00123 ext. 4',revision=99,updated_by=c.outsider,updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision<>2 or r.updated_by<>c.actor or r.updated_at='2000-01-01' or r.follow_up<>'  n/a  ' then
    raise exception 'Update audit or revision stamping failed.';
  end if;
  update public.hq_potential_training_clients set phone='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Stale edit overwrote a record.'; end if;
  update public.hq_potential_training_clients set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at='2000-01-01' or r.revision<>3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at:=r.deleted_at;
  update public.hq_potential_training_clients set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_potential_training_clients set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision<>5 or r.phone<>'00123 ext. 4' or r.follow_up<>'  n/a  ' then
    raise exception 'Restore did not retain the record.';
  end if;
  update public.hq_potential_training_clients set phone='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin update public.hq_potential_training_clients set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.'; exception when check_violation then null; end;
  begin update public.hq_potential_training_clients set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_potential_training_clients set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.'; exception when check_violation then null; end;
  begin update public.hq_potential_training_clients set position=position+1 where id=c.entry;
    raise exception 'Original position changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_potential_training_clients set source_file='Changed.csv' where id=c.imported_entry;
    raise exception 'Original source file changed.'; exception when check_violation then null; end;
  begin update public.hq_potential_training_clients set source_row=4 where id=c.imported_entry;
    raise exception 'Original source row changed.'; exception when check_violation then null; end;
  begin update public.hq_potential_training_clients set source_values='["changed","","","","","","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.'; exception when check_violation then null; end;
  begin update public.hq_potential_training_clients set owner='',dog='',phone='',initial_conversation='',first_contact='',follow_up='',evaluation='',outcome='' where id=c.entry;
    raise exception 'Completely empty entry accepted.'; exception when check_violation then null; end;
  begin delete from public.hq_potential_training_clients where id=c.entry;
    raise exception 'Permanent deletion allowed.'; exception when insufficient_privilege then null; end;
end $$;

-- Freeform conversations, dates, follow-up, evaluations, phone formats, and outcomes remain text. Repeated owners or dogs are allowed.
do $$
declare partial_entry uuid:=gen_random_uuid(); field text; limit_value integer; stored text;
        r public.hq_potential_training_clients%rowtype;
begin
  insert into public.hq_potential_training_clients(id,follow_up) values(partial_entry,'  n/a  ') returning * into r;
  if r.follow_up<>'  n/a  ' or r.owner<>'' or r.dog<>'' or r.phone<>'' or r.outcome<>'' then
    raise exception 'Follow-up-only partial record did not preserve literal values and blanks.';
  end if;
  update public.hq_potential_training_clients set owner='Fixture Owner  ',phone='00123 / ext. 4',initial_conversation='AB / ?',
    first_contact='next Thursday',evaluation='8/27 3;30 / AB ',outcome=E'  Staff note\r\nSecond line  ' where id=partial_entry returning * into r;
  if r.owner<>'Fixture Owner  ' or r.phone<>'00123 / ext. 4' or r.initial_conversation<>'AB / ?'
     or r.first_contact<>'next Thursday' or r.evaluation<>'8/27 3;30 / AB ' or r.outcome is distinct from E'  Staff note\r\nSecond line  ' then
    raise exception 'Literal name, phone, conversations, dates, or outcomes changed.';
  end if;
  insert into public.hq_potential_training_clients(id,owner) values(gen_random_uuid(),'Fixture Owner  ');
  for field in select unnest(array['owner','dog','phone','initial_conversation','first_contact','follow_up','evaluation','outcome']) loop
    execute format('insert into public.hq_potential_training_clients(id,%I) values($1,$2) returning *',field)
      into r using gen_random_uuid(),'  Partial literal value  ';
    if (to_jsonb(r)->>field) is distinct from '  Partial literal value  ' then
      raise exception 'Partial field % lost its literal text.',field;
    end if;
    if (select count(*) from jsonb_each_text(jsonb_build_object('owner',r.owner,'dog',r.dog,'phone',r.phone,
        'initial_conversation',r.initial_conversation,'first_contact',r.first_contact,'follow_up',r.follow_up,
        'evaluation',r.evaluation,'outcome',r.outcome)) item where item.value='')<>7 then
      raise exception 'Partial field % did not retain seven blank fields.',field;
    end if;
  end loop;
  for field,limit_value in select * from (values ('owner',500),('dog',500),('phone',200),('initial_conversation',2000),
    ('first_contact',2000),('follow_up',20000),('evaluation',20000),('outcome',20000)) as limits(name,max_length)
  loop
    execute format('update public.hq_potential_training_clients set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),partial_entry;
    if char_length(stored)<>limit_value then raise exception 'Field % limit lost text.',field; end if;
    begin execute format('update public.hq_potential_training_clients set %I=$1 where id=$2',field) using repeat('x',limit_value+1),partial_entry;
      raise exception 'Field % accepted too much text.',field; exception when check_violation then null; end;
  end loop;
  begin insert into public.hq_potential_training_clients(id,outcome) values(gen_random_uuid(),E' \t\r\n ');
    raise exception 'A whitespace-only row was accepted.'; exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.potential_training_clients_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.potential_training_clients_check_context;
  if exists(select 1 from public.hq_potential_training_clients) then raise exception 'Nonstaff read owner data.'; end if;
  update public.hq_potential_training_clients set phone='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin insert into public.hq_potential_training_clients(id,owner) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.potential_training_clients_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.potential_training_clients_check_context;
do $$ declare affected integer;
begin
  if exists(select 1 from public.hq_potential_training_clients) then raise exception 'Inactive staff read owner data.'; end if;
  update public.hq_potential_training_clients set phone='Unauthorized' where id=(select entry from pg_temp.potential_training_clients_check_context);
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin insert into public.hq_potential_training_clients(id,owner) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_potential_training_clients; raise exception 'Anonymous read allowed.';
    exception when insufficient_privilege then null; end;
  begin insert into public.hq_potential_training_clients(id,owner) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.'; exception when insufficient_privilege then null; end;
  begin update public.hq_potential_training_clients set phone='Unauthorized'; raise exception 'Anonymous update allowed.';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved account CRUD, partial entries, exact text and field limits, audit and revisions, immutable source, reversible deletion, and anonymous/nonstaff/inactive isolation.' as result;
rollback;
