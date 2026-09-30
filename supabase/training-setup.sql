-- Paws HQ training logs. Requires the existing administrator-managed hq_tour_staff allowlist.
-- No source CSV values are included here. Run the private import separately.
begin;

create table if not exists public.hq_training_dogs (
  id uuid primary key,
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id)
);

create table if not exists public.hq_training_logs (
  id uuid primary key,
  dog_id uuid not null references public.hq_training_dogs(id),
  day_label text not null default '' check (char_length(day_label) <= 40),
  date_label text not null default '' check (char_length(date_label) <= 40),
  session_label text not null default '' check (char_length(session_label) <= 40),
  time_label text not null default '' check (char_length(time_label) <= 100),
  trainer text not null default '' check (char_length(trainer) <= 120),
  work_detail text not null default '' check (char_length(work_detail) <= 6000),
  notes text not null default '' check (char_length(notes) <= 10000),
  position bigint generated always as identity,
  source_file text,
  source_row integer,
  source_values jsonb,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  constraint hq_training_logs_not_empty check (
    btrim(day_label || date_label || session_label || time_label || trainer || work_detail || notes) <> ''
  ),
  constraint hq_training_logs_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 2 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 7)
  )
);

create index if not exists hq_training_logs_dog_position_idx on public.hq_training_logs (dog_id,position,id);

-- Preserve imported strings verbatim; metadata, audit stamps, and positions are server controlled.
create or replace function public.hq_training_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null then
    raise exception 'A signed-in staff member is required to change training records.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if tg_table_name = 'hq_training_logs' then
      if current_user = 'authenticated' then
        new.source_file := null;
        new.source_row := null;
        new.source_values := null;
      end if;
      if new.deleted_at is not null then new.deleted_at := stamp; end if;
    end if;
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
      if new.deleted_at is not null then
        new.deleted_at := case when old.deleted_at is null then stamp else old.deleted_at end;
      end if;
    end if;
  end if;
  new.updated_at := stamp;
  new.updated_by := actor;
  return new;
end;
$$;
revoke all on function public.hq_training_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_training_dogs_stamp_changes on public.hq_training_dogs;
create trigger hq_training_dogs_stamp_changes before insert or update on public.hq_training_dogs
for each row execute function public.hq_training_stamp_changes();
drop trigger if exists hq_training_logs_stamp_changes on public.hq_training_logs;
create trigger hq_training_logs_stamp_changes before insert or update on public.hq_training_logs
for each row execute function public.hq_training_stamp_changes();

alter table public.hq_training_dogs enable row level security;
alter table public.hq_training_logs enable row level security;
revoke all on table public.hq_training_dogs, public.hq_training_logs from public, anon, authenticated;
grant select,insert,update on table public.hq_training_dogs, public.hq_training_logs to authenticated;
revoke all on sequence public.hq_training_logs_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_training_logs_position_seq to authenticated;

do $$
declare target text;
begin
  foreach target in array array['hq_training_dogs','hq_training_logs'] loop
    execute format('drop policy if exists %I on public.%I',target || '_select',target);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))',target || '_select',target);
    execute format('drop policy if exists %I on public.%I',target || '_insert',target);
    execute format('create policy %I on public.%I for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))',target || '_insert',target);
    execute format('drop policy if exists %I on public.%I',target || '_update',target);
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active)) with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))',target || '_update',target);
  end loop;
end;
$$;

comment on table public.hq_training_dogs is 'Shared dog training logs for the existing approved Paws HQ staff.';
comment on table public.hq_training_logs is 'Seven original training fields stored verbatim; position preserves source order; deletion is reversible.';
comment on column public.hq_training_logs.source_values is 'Immutable original CSV cells, including blank strings. Not sent by the browser when creating new entries.';
comment on column public.hq_training_logs.date_label is 'Literal source date. Missing years and blank dates must not be guessed.';
notify pgrst, 'reload schema';
commit;
