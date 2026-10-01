-- Checks only temporary fixture records; everything rolls back.
begin;
create temporary table training_dog_check (actor uuid, dog uuid, entry uuid) on commit drop;
insert into training_dog_check select user_id,gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff where active order by user_id limit 1;
grant select on pg_temp.training_dog_check to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.training_dog_check;
do $$
declare c record; d public.hq_training_dogs%rowtype; snapshot jsonb; affected integer; deleted_stamp timestamptz;
begin
  select * into c from pg_temp.training_dog_check;
  if c.actor is null then raise exception 'No approved staff account found.'; end if;
  insert into public.hq_training_dogs(id,name) values(c.dog,'Temporary dog management check') returning * into d;
  insert into public.hq_training_logs(id,dog_id,day_label,date_label,notes)
  values(c.entry,c.dog,'1','9/30','  Unchanged training history  ');
  select to_jsonb(l) into snapshot from public.hq_training_logs l where l.id=c.entry;
  update public.hq_training_dogs set name='Renamed fixture dog' where id=c.dog and revision=d.revision returning * into d;
  if d.name <> 'Renamed fixture dog' or d.revision<>2 then raise exception 'Rename failed.';end if;
  update public.hq_training_dogs set name='Stale name' where id=c.dog and revision=1;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Stale dog edit overwrote a name.';end if;
  update public.hq_training_dogs set deleted_at='2000-01-01' where id=c.dog and revision=d.revision returning * into d;
  if d.deleted_at is null or d.deleted_at='2000-01-01'::timestamptz or d.revision<>3 then raise exception 'Dog deletion audit failed.';end if;
  deleted_stamp:=d.deleted_at;
  if (select to_jsonb(l) from public.hq_training_logs l where l.id=c.entry) is distinct from snapshot then raise exception 'Deleting a dog modified training history.';end if;
  begin
    update public.hq_training_logs set notes='Must not change' where id=c.entry;
    raise exception 'Deleted dog log edit was accepted.';
  exception when object_not_in_prerequisite_state then null;end;
  begin
    insert into public.hq_training_logs(id,dog_id,day_label) values(gen_random_uuid(),c.dog,'2');
    raise exception 'Deleted dog log insert was accepted.';
  exception when object_not_in_prerequisite_state then null;end;
  update public.hq_training_dogs set deleted_at='2001-01-01' where id=c.dog and revision=d.revision returning * into d;
  if d.deleted_at<>deleted_stamp then raise exception 'Repeated deletion replaced its original timestamp.';end if;
  update public.hq_training_dogs set deleted_at=null where id=c.dog and revision=d.revision returning * into d;
  if d.deleted_at is not null or d.revision<>5 then raise exception 'Dog restore failed.';end if;
  if (select to_jsonb(l) from public.hq_training_logs l where l.id=c.entry) is distinct from snapshot then raise exception 'Restoring a dog modified its history.';end if;
  update public.hq_training_logs set notes='Allowed after restore' where id=c.entry;
  begin
    delete from public.hq_training_dogs where id=c.dog;
    raise exception 'Permanent dog deletion was allowed.';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: rename, revision conflicts, reversible dog deletion, unchanged training rows, and stale-tab protection.' as result;
rollback;
