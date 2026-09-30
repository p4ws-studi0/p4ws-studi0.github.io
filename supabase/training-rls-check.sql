-- Execute after training-setup.sql. All test changes roll back.
begin;
create temporary table training_check_context (actor uuid, outsider uuid, dog uuid, entry uuid) on commit drop;
insert into training_check_context
select user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff where active order by user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.training_check_context) then raise exception 'No approved staff member available.'; end if;
end $$;
grant select on pg_temp.training_check_context to authenticated,anon;
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.training_check_context;
do $$
declare c record; d public.hq_training_dogs%rowtype; r public.hq_training_logs%rowtype; affected integer;
begin
  select * into c from pg_temp.training_check_context;
  insert into public.hq_training_dogs(id,name,revision,created_by,updated_by)
  values(c.dog,'Temporary training verification',99,c.outsider,c.outsider) returning * into d;
  if d.revision <> 1 or d.created_by <> c.actor or d.updated_by <> c.actor then raise exception 'Dog audit stamping failed.'; end if;
  insert into public.hq_training_logs(id,dog_id,day_label,notes,source_file,source_row,source_values)
  values(c.entry,c.dog,'6','  Exact source text  ','Forged.csv',2,'["6","","","","","",""]'::jsonb) returning * into r;
  if r.revision <> 1 or r.created_by <> c.actor or r.notes <> '  Exact source text  '
     or r.source_file is not null or r.source_values is not null then raise exception 'Entry stamping, text preservation, or provenance control failed.'; end if;
  update public.hq_training_logs set notes='Revised note' where id=c.entry and revision=1 returning * into r;
  if r.revision <> 2 then raise exception 'Entry revision failed.'; end if;
  update public.hq_training_logs set notes='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Stale edit overwrote record.'; end if;
  update public.hq_training_logs set deleted_at=now() where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.revision <> 3 then raise exception 'Soft delete failed.'; end if;
  update public.hq_training_logs set deleted_at=null where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is not null or r.revision <> 4 then raise exception 'Restore failed.'; end if;
  update public.hq_training_dogs set name='Renamed training verification' where id=c.dog and revision=1 returning * into d;
  if d.revision <> 2 then raise exception 'Dog rename revision failed.'; end if;
  begin
    update public.hq_training_logs set position=position+1 where id=c.entry;
    raise exception 'Original position changed.';
  exception when check_violation or generated_always then null; end;
  begin
    update public.hq_training_logs set source_file='Changed.csv' where id=c.entry;
    raise exception 'Original source metadata changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_training_logs set day_label='',notes='' where id=c.entry;
    raise exception 'Completely empty entry accepted.';
  exception when check_violation then null; end;
  begin
    delete from public.hq_training_logs where id=c.entry;
    raise exception 'Permanent entry deletion allowed.';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.hq_training_dogs where id=c.dog;
    raise exception 'Permanent dog deletion allowed.';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.training_check_context;
do $$
declare c record; affected integer;
begin
  select * into c from pg_temp.training_check_context;
  if exists(select 1 from public.hq_training_dogs) or exists(select 1 from public.hq_training_logs) then raise exception 'Nonstaff read training data.'; end if;
  update public.hq_training_logs set notes='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Nonstaff updated entry.'; end if;
  begin
    insert into public.hq_training_dogs(id,name) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted dog.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_training_logs(id,dog_id,day_label) values(gen_random_uuid(),c.dog,'1');
    raise exception 'Nonstaff inserted entry.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.training_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.training_check_context;
do $$ begin
  if exists(select 1 from public.hq_training_logs) or exists(select 1 from public.hq_training_dogs) then
    raise exception 'Inactive staff member read training data.';
  end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_training_logs; raise exception 'Anonymous entry read allowed.';
  exception when insufficient_privilege then null; end;
  begin perform * from public.hq_training_dogs; raise exception 'Anonymous dog read allowed.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: approved staff CRUD, exact text, audit and revisions, reversible deletion, provenance, and anonymous/nonstaff isolation.' as result;
rollback;
