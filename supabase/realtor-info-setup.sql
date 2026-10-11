-- Shared realtor directory entries for the existing approved Paws HQ accounts.
-- Run after Tours membership setup. No source CSV values or new approvals are included.
begin;

create table if not exists public.hq_realtors (
  id uuid primary key,
  realtor_name text not null default '' check (char_length(realtor_name) <= 500),
  phone text not null default '' check (char_length(phone) <= 200),
  email text not null default '' check (char_length(email) <= 500),
  location text not null default '' check (char_length(location) <= 2000),
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
  constraint hq_realtors_not_empty check (
    btrim(realtor_name || phone || email || location,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_realtors_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 3 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 8)
  )
);

create index if not exists hq_realtors_position_idx on public.hq_realtors (position,id);

-- All four working directory cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_realtors_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change realtor directory entries.' using errcode = '42501';
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
      raise exception 'Original realtor source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_realtors_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_realtors_stamp_changes on public.hq_realtors;
create trigger hq_realtors_stamp_changes before insert or update on public.hq_realtors
for each row execute function public.hq_realtors_stamp_changes();

alter table public.hq_realtors enable row level security;
revoke all on table public.hq_realtors from public, anon, authenticated;
grant select,insert,update on table public.hq_realtors to authenticated;
revoke all on sequence public.hq_realtors_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_realtors_position_seq to authenticated;

drop policy if exists hq_realtors_select on public.hq_realtors;
create policy hq_realtors_select on public.hq_realtors for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_realtors_insert on public.hq_realtors;
create policy hq_realtors_insert on public.hq_realtors for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_realtors_update on public.hq_realtors;
create policy hq_realtors_update on public.hq_realtors for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_realtors is 'Shared realtor directory entries for approved Paws HQ accounts. Contact history and original eight-cell CSV rows survive reversible deletion.';
comment on column public.hq_realtors.source_values is 'Immutable full original CSV row: all eight cells, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_realtors.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_realtors.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';


create table if not exists public.hq_realtor_contacts (
  id uuid primary key,
  realtor_id uuid not null references public.hq_realtors(id),
  contacted_date text not null default '' check (char_length(contacted_date) <= 500),
  notes text not null default '' check (char_length(notes) <= 20000),
  position bigint generated always as identity,
  source_file text,
  source_row integer,
  source_column integer,
  source_values jsonb,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  constraint hq_realtor_contacts_not_empty check (
    btrim(contacted_date || notes,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_realtor_contacts_source_complete check (
    (source_file is null and source_row is null and source_column is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 3 and source_column is not null
        and source_column in (5,7) and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 2)
  )
);

create index if not exists hq_realtor_contacts_position_idx on public.hq_realtor_contacts (realtor_id,position,id);

-- Both working contact-history cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_realtor_contacts_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change realtor contact history.' using errcode = '42501';
  end if;
  -- Lock the parent against concurrent deletion while changing contact history.
  perform 1 from public.hq_realtors l where l.id = new.realtor_id and l.deleted_at is null for share;
  if not found then
    raise exception 'Restore the realtor before changing contact history.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if current_user = 'authenticated' then
      new.source_file := null;
      new.source_row := null;
      new.source_column := null;
      new.source_values := null;
    end if;
    if new.deleted_at is not null then new.deleted_at := stamp; end if;
  else
    if new.id is distinct from old.id or new.realtor_id is distinct from old.realtor_id or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Record identity and creation details cannot be changed.' using errcode = '23514';
    end if;
    if new.position is distinct from old.position or new.source_file is distinct from old.source_file
       or new.source_row is distinct from old.source_row or new.source_column is distinct from old.source_column
       or new.source_values is distinct from old.source_values then
      raise exception 'Original realtor contact source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_realtor_contacts_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_realtor_contacts_stamp_changes on public.hq_realtor_contacts;
create trigger hq_realtor_contacts_stamp_changes before insert or update on public.hq_realtor_contacts
for each row execute function public.hq_realtor_contacts_stamp_changes();

alter table public.hq_realtor_contacts enable row level security;
revoke all on table public.hq_realtor_contacts from public, anon, authenticated;
grant select,insert,update on table public.hq_realtor_contacts to authenticated;
revoke all on sequence public.hq_realtor_contacts_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_realtor_contacts_position_seq to authenticated;

drop policy if exists hq_realtor_contacts_select on public.hq_realtor_contacts;
create policy hq_realtor_contacts_select on public.hq_realtor_contacts for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_realtor_contacts_insert on public.hq_realtor_contacts;
create policy hq_realtor_contacts_insert on public.hq_realtor_contacts for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_realtor_contacts_update on public.hq_realtor_contacts;
create policy hq_realtor_contacts_update on public.hq_realtor_contacts for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_realtor_contacts is 'Shared realtor contact history for approved Paws HQ accounts. Both cells remain literal text and deletion is reversible.';
comment on column public.hq_realtor_contacts.source_values is 'Immutable original contact date/note pair from source_column onward, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_realtor_contacts.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_realtor_contacts.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';


notify pgrst, 'reload schema';
commit;
