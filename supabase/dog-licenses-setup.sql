-- Shared dog-license requests for the existing approved Paws HQ accounts.
-- No PDF values are included here. Import source records privately after setup.
begin;

create table if not exists public.hq_dog_licenses (
  id uuid primary key,
  pet_name text not null default '' check (char_length(pet_name) <= 120),
  request_type text not null default '' check (char_length(request_type) <= 80),
  initials text not null default '' check (char_length(initials) <= 120),
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
  constraint hq_dog_licenses_not_empty check (
    btrim(pet_name || request_type || initials) <> ''
  ),
  constraint hq_dog_licenses_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 1 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 3)
  )
);

create index if not exists hq_dog_licenses_position_idx on public.hq_dog_licenses (position,id);

-- Working cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_dog_licenses_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change dog-license records.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if current_user = 'authenticated' then
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
    if new.position is distinct from old.position or new.source_file is distinct from old.source_file
       or new.source_row is distinct from old.source_row or new.source_values is distinct from old.source_values then
      raise exception 'Original dog-license source metadata and order cannot be changed.' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
    if new.deleted_at is not null then
      new.deleted_at := case when old.deleted_at is null then stamp else old.deleted_at end;
    end if;
  end if;
  new.updated_at := stamp;
  new.updated_by := actor;
  return new;
end;
$$;
revoke all on function public.hq_dog_licenses_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_dog_licenses_stamp_changes on public.hq_dog_licenses;
create trigger hq_dog_licenses_stamp_changes before insert or update on public.hq_dog_licenses
for each row execute function public.hq_dog_licenses_stamp_changes();

alter table public.hq_dog_licenses enable row level security;
revoke all on table public.hq_dog_licenses from public, anon, authenticated;
grant select,insert,update on table public.hq_dog_licenses to authenticated;
revoke all on sequence public.hq_dog_licenses_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_dog_licenses_position_seq to authenticated;

drop policy if exists hq_dog_licenses_select on public.hq_dog_licenses;
create policy hq_dog_licenses_select on public.hq_dog_licenses for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_dog_licenses_insert on public.hq_dog_licenses;
create policy hq_dog_licenses_insert on public.hq_dog_licenses for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_dog_licenses_update on public.hq_dog_licenses;
create policy hq_dog_licenses_update on public.hq_dog_licenses for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_dog_licenses is 'Shared dog-license requests for approved Paws HQ accounts. Cells remain literal text and deletion is reversible.';
comment on column public.hq_dog_licenses.source_values is 'Immutable original PDF cells, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_dog_licenses.position is 'Immutable original order, independent of edits to the displayed cells.';
notify pgrst, 'reload schema';
commit;
