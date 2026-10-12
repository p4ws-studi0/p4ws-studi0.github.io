-- Shared K9 Cough records for the existing approved Paws HQ accounts.
-- Run after Tours membership setup. No source CSV values or new approvals are included.
begin;

create table if not exists public.hq_k9_cough (
  id uuid primary key,
  added_date text not null default '' check (char_length(added_date) <= 500),
  initials text not null default '' check (char_length(initials) <= 120),
  pet_name text not null default '' check (char_length(pet_name) <= 1000),
  service_dates text not null default '' check (char_length(service_dates) <= 2000),
  room text not null default '' check (char_length(room) <= 2000),
  group_type text not null default '' check (char_length(group_type) <= 1000),
  services text not null default '' check (char_length(services) <= 1000),
  notes text not null default '' check (char_length(notes) <= 20000),
  pcw_reimbursement text not null default '' check (char_length(pcw_reimbursement) <= 20000),
  management_follow_up text not null default '' check (char_length(management_follow_up) <= 20000),
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
  constraint hq_k9_cough_not_empty check (
    btrim(added_date || initials || pet_name || service_dates || room || group_type || services || notes || pcw_reimbursement || management_follow_up,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_k9_cough_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 3 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 10)
  )
);

create index if not exists hq_k9_cough_position_idx on public.hq_k9_cough (position,id);

-- All ten working cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_k9_cough_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change K9 Cough records.' using errcode = '42501';
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
      raise exception 'Original K9 Cough source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_k9_cough_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_k9_cough_stamp_changes on public.hq_k9_cough;
create trigger hq_k9_cough_stamp_changes before insert or update on public.hq_k9_cough
for each row execute function public.hq_k9_cough_stamp_changes();

alter table public.hq_k9_cough enable row level security;
revoke all on table public.hq_k9_cough from public, anon, authenticated;
grant select,insert,update on table public.hq_k9_cough to authenticated;
revoke all on sequence public.hq_k9_cough_position_seq from public, anon, authenticated;
grant usage on sequence public.hq_k9_cough_position_seq to authenticated;

drop policy if exists hq_k9_cough_select on public.hq_k9_cough;
create policy hq_k9_cough_select on public.hq_k9_cough for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_k9_cough_insert on public.hq_k9_cough;
create policy hq_k9_cough_insert on public.hq_k9_cough for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_k9_cough_update on public.hq_k9_cough;
create policy hq_k9_cough_update on public.hq_k9_cough for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_k9_cough is 'Shared K9 Cough records for approved Paws HQ accounts. All ten cells remain literal text and deletion is reversible. No diagnosis, reimbursement amount, or reimbursement status is inferred.';
comment on column public.hq_k9_cough.source_values is 'Immutable original CSV cells in displayed column order, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_k9_cough.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_k9_cough.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';
notify pgrst, 'reload schema';
commit;
