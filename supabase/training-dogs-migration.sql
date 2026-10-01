-- Reversible dog deletion. Existing dogs and training entries remain intact.
begin;
alter table public.hq_training_dogs add column if not exists deleted_at timestamptz;
create or replace function public.hq_training_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (select 1 from public.hq_tour_staff s where s.user_id = actor and s.active) then
    raise exception 'A signed-in staff member is required to change training records.' using errcode = '42501';
  end if;
  if tg_table_name = 'hq_training_logs' then
    if not exists (select 1 from public.hq_training_dogs d where d.id = new.dog_id and d.deleted_at is null) then
      raise exception 'Restore this dog before changing training rows.' using errcode = '55000';
    end if;
    if tg_op = 'UPDATE' then
      if not exists (select 1 from public.hq_training_dogs d where d.id = old.dog_id and d.deleted_at is null) then
        raise exception 'Restore this dog before changing training rows.' using errcode = '55000';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if tg_table_name = 'hq_training_logs' and current_user = 'authenticated' then
      new.source_file := null;
      new.source_row := null;
      new.source_values := null;
    end if;
    if new.deleted_at is not null then new.deleted_at := stamp; end if;
  else
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Record identity and creation details cannot be changed.' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
    if tg_table_name = 'hq_training_logs' then
      if new.position is distinct from old.position or new.source_file is distinct from old.source_file
         or new.source_row is distinct from old.source_row or new.source_values is distinct from old.source_values then
        raise exception 'Original training source metadata and order cannot be changed.' using errcode = '23514';
      end if;
    end if;
    if new.deleted_at is not null then
      new.deleted_at := case when old.deleted_at is null then stamp else old.deleted_at end;
    end if;
  end if;
  new.updated_at := stamp;
  new.updated_by := actor;
  return new;
end;
$$;
revoke all on function public.hq_training_stamp_changes() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
