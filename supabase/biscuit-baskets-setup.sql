-- Shared biscuit basket locations for the existing approved Paws HQ accounts.
-- Run after Tours membership setup. No source CSV values or new approvals are included.
begin;

create table if not exists public.hq_biscuit_locations (
  id uuid primary key,
  location_name text not null default '' check (char_length(location_name) <= 500),
  town text not null default '' check (char_length(town) <= 200),
  status text not null default 'active' check (status in ('active','closed','do_not_visit')),
  status_notes text not null default '' check (char_length(status_notes) <= 20000),
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
  constraint hq_biscuit_locations_not_empty check (
    btrim(location_name || town || status_notes,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_biscuit_locations_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 1 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 39)
  )
);

create index if not exists hq_biscuit_locations_position_idx on public.hq_biscuit_locations (position,id);

-- Working location text remains literal; status is a separate editable flag. Identity, source, order, and audit values are protected.
create or replace function public.hq_biscuit_locations_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change biscuit basket locations.' using errcode = '42501';
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
      raise exception 'Original biscuit basket location source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_biscuit_locations_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_biscuit_locations_stamp_changes on public.hq_biscuit_locations;
create trigger hq_biscuit_locations_stamp_changes before insert or update on public.hq_biscuit_locations
for each row execute function public.hq_biscuit_locations_stamp_changes();

alter table public.hq_biscuit_locations enable row level security;
revoke all on table public.hq_biscuit_locations from public, anon, authenticated;
grant select,insert,update on table public.hq_biscuit_locations to authenticated;
revoke all on sequence public.hq_biscuit_locations_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_biscuit_locations_position_seq to authenticated;

drop policy if exists hq_biscuit_locations_select on public.hq_biscuit_locations;
create policy hq_biscuit_locations_select on public.hq_biscuit_locations for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_biscuit_locations_insert on public.hq_biscuit_locations;
create policy hq_biscuit_locations_insert on public.hq_biscuit_locations for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_biscuit_locations_update on public.hq_biscuit_locations;
create policy hq_biscuit_locations_update on public.hq_biscuit_locations for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_biscuit_locations is 'Shared biscuit basket locations for approved Paws HQ accounts. Location history and original CSV rows survive reversible deletion.';
comment on column public.hq_biscuit_locations.source_values is 'Immutable full original CSV row: all 39 cells, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_biscuit_locations.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_biscuit_locations.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';


create table if not exists public.hq_biscuit_visits (
  id uuid primary key,
  location_id uuid not null references public.hq_biscuit_locations(id),
  visited_on text not null default '' check (char_length(visited_on) <= 120),
  items_given text not null default '' check (char_length(items_given) <= 20000),
  spoke_to text not null default '' check (char_length(spoke_to) <= 500),
  town text not null default '' check (char_length(town) <= 200),
  notes text not null default '' check (char_length(notes) <= 20000),
  position bigint generated always as identity,
  source_file text,
  source_row integer,
  source_column integer,
  source_values jsonb,
  source_year integer check (source_year between 1900 and 2100),
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  constraint hq_biscuit_visits_not_empty check (
    btrim(visited_on || items_given || spoke_to || town || notes,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_biscuit_visits_source_complete check (
    (source_file is null and source_row is null and source_column is null and source_values is null and source_year is null)
    or (source_file is not null and source_row is not null and source_row >= 1 and source_column is not null
        and source_column between 2 and 39 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) in (1,2,3,5)
        and source_column + jsonb_array_length(source_values) <= 40)
  )
);

create index if not exists hq_biscuit_visits_position_idx on public.hq_biscuit_visits (location_id,position,id);

-- All five working visit cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_biscuit_visits_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change biscuit basket visits.' using errcode = '42501';
  end if;
  -- Lock the parent against concurrent deletion while changing its visit history.
  perform 1 from public.hq_biscuit_locations l where l.id = new.location_id and l.deleted_at is null for share;
  if not found then
    raise exception 'Restore the location before changing its visits.' using errcode = '42501';
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
      new.source_year := null;
    end if;
    if new.deleted_at is not null then new.deleted_at := stamp; end if;
  else
    if new.id is distinct from old.id or new.location_id is distinct from old.location_id or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Record identity and creation details cannot be changed.' using errcode = '23514';
    end if;
    if new.position is distinct from old.position or new.source_file is distinct from old.source_file
       or new.source_row is distinct from old.source_row or new.source_column is distinct from old.source_column
       or new.source_values is distinct from old.source_values
       or new.source_year is distinct from old.source_year then
      raise exception 'Original biscuit basket visit source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_biscuit_visits_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_biscuit_visits_stamp_changes on public.hq_biscuit_visits;
create trigger hq_biscuit_visits_stamp_changes before insert or update on public.hq_biscuit_visits
for each row execute function public.hq_biscuit_visits_stamp_changes();

alter table public.hq_biscuit_visits enable row level security;
revoke all on table public.hq_biscuit_visits from public, anon, authenticated;
grant select,insert,update on table public.hq_biscuit_visits to authenticated;
revoke all on sequence public.hq_biscuit_visits_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_biscuit_visits_position_seq to authenticated;

drop policy if exists hq_biscuit_visits_select on public.hq_biscuit_visits;
create policy hq_biscuit_visits_select on public.hq_biscuit_visits for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_biscuit_visits_insert on public.hq_biscuit_visits;
create policy hq_biscuit_visits_insert on public.hq_biscuit_visits for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_biscuit_visits_update on public.hq_biscuit_visits;
create policy hq_biscuit_visits_update on public.hq_biscuit_visits for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_biscuit_visits is 'Shared biscuit basket visits for approved Paws HQ accounts. All five cells remain literal text and deletion is reversible.';
comment on column public.hq_biscuit_visits.source_values is 'Immutable original visit group cells from source_column onward, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_biscuit_visits.source_year is 'Immutable import context for a source date without a year. Browser-created entries leave it null; stored date text is never rewritten.';
comment on column public.hq_biscuit_visits.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_biscuit_visits.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';


-- A protected archive keeps the complete source, including headers and unassigned cells.
create table if not exists public.hq_biscuit_sources (
  id uuid primary key,
  source_file text not null check (btrim(source_file) <> ''),
  source_rows jsonb not null check (jsonb_typeof(source_rows) = 'array'),
  imported_at timestamptz not null default now()
);
alter table public.hq_biscuit_sources enable row level security;
revoke all on table public.hq_biscuit_sources from public, anon, authenticated;
grant select on table public.hq_biscuit_sources to authenticated;
drop policy if exists hq_biscuit_sources_select on public.hq_biscuit_sources;
create policy hq_biscuit_sources_select on public.hq_biscuit_sources for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));
comment on table public.hq_biscuit_sources is 'Read-only archive of complete original Biscuit Basket CSV exports for approved Paws HQ accounts. Imported privately; no browser writes.';
notify pgrst, 'reload schema';
commit;
