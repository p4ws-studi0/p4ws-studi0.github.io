-- Shared suggestions for the existing approved Paws HQ accounts.
-- Run after Tours membership setup. No source CSV values or new approvals are included.
begin;

create table if not exists public.hq_suggestions (
  id uuid primary key,
  suggestion text not null default '' check (char_length(suggestion) <= 20000),
  suggestion_date text not null default '' check (char_length(suggestion_date) <= 120),
  outcome text not null default '' check (char_length(outcome) <= 20000),
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
  constraint hq_suggestions_not_empty check (
    btrim(suggestion || suggestion_date || outcome,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_suggestions_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 1 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 3)
  )
);

create index if not exists hq_suggestions_position_idx on public.hq_suggestions (position,id);

-- All three working cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_suggestions_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change suggestions.' using errcode = '42501';
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
      raise exception 'Original suggestion source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_suggestions_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_suggestions_stamp_changes on public.hq_suggestions;
create trigger hq_suggestions_stamp_changes before insert or update on public.hq_suggestions
for each row execute function public.hq_suggestions_stamp_changes();

alter table public.hq_suggestions enable row level security;
revoke all on table public.hq_suggestions from public, anon, authenticated;
grant select,insert,update on table public.hq_suggestions to authenticated;
revoke all on sequence public.hq_suggestions_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_suggestions_position_seq to authenticated;

drop policy if exists hq_suggestions_select on public.hq_suggestions;
create policy hq_suggestions_select on public.hq_suggestions for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_suggestions_insert on public.hq_suggestions;
create policy hq_suggestions_insert on public.hq_suggestions for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_suggestions_update on public.hq_suggestions;
create policy hq_suggestions_update on public.hq_suggestions for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_suggestions is 'Shared suggestions for approved Paws HQ accounts. All three cells remain literal text and deletion is reversible.';
comment on column public.hq_suggestions.source_values is 'Immutable original CSV cells in displayed column order, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_suggestions.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_suggestions.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';
notify pgrst, 'reload schema';
commit;
