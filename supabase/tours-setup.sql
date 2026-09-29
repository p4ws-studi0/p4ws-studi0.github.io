-- Paws HQ Tours: run once in the existing Supabase project's SQL Editor.
-- Rerunning this script preserves records and approved staff memberships.
-- It creates no tours and approves no users. Add approved user IDs separately.
-- Supabase project used by HQ: dppjgglaeieevsfwsbii.

begin;

create table if not exists public.hq_tour_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true
);

create table if not exists public.hq_tours (
  id uuid primary key,
  customer_name text not null,
  customer_info text not null default '',
  tour_date date not null,
  tour_time time without time zone not null,
  has_file text not null default 'unknown',
  booking_status text not null default 'unknown',
  staff_initials text not null,
  outside_hours_confirmed boolean not null default false,
  deleted_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  constraint hq_tours_customer_name_valid
    check (btrim(customer_name) <> '' and char_length(customer_name) <= 120),
  constraint hq_tours_customer_info_valid
    check (char_length(customer_info) <= 1000),
  constraint hq_tours_staff_initials_valid
    check (btrim(staff_initials) <> '' and char_length(staff_initials) <= 10),
  constraint hq_tours_time_minute_precision
    check (extract(second from tour_time) = 0 and tour_time < time '24:00'),
  constraint hq_tours_has_file_valid
    check (has_file in ('yes', 'no', 'unknown')),
  constraint hq_tours_booking_status_valid
    check (booking_status in ('confirmed', 'tentative', 'none', 'unknown')),
  constraint hq_tours_outside_hours_confirmed
    check (
      tour_time between time '10:30' and time '15:00'
      or outside_hours_confirmed
    ),
  constraint hq_tours_revision_positive check (revision > 0)
);

create index if not exists hq_tours_schedule_idx
  on public.hq_tours (tour_date, tour_time, id)
  where deleted_at is null;

create index if not exists hq_tours_deleted_idx
  on public.hq_tours (deleted_at desc)
  where deleted_at is not null;

-- The client supplies its UUID once per new tour, so a retry cannot create
-- duplicate records. Audit fields and revisions are always server controlled.
create or replace function public.hq_tours_stamp_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null then
    raise exception 'A signed-in user is required to change a tour.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if new.deleted_at is not null then
      new.deleted_at := stamp;
    end if;
  else
    if new.id is distinct from old.id
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Tour ID and creation details cannot be changed.'
        using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
    if new.deleted_at is not null then
      if old.deleted_at is null then
        new.deleted_at := stamp;
      else
        new.deleted_at := old.deleted_at;
      end if;
    end if;
  end if;

  new.updated_at := stamp;
  new.updated_by := actor;
  return new;
end;
$$;

revoke all on function public.hq_tours_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_tours_stamp_changes on public.hq_tours;
create trigger hq_tours_stamp_changes
before insert or update on public.hq_tours
for each row execute function public.hq_tours_stamp_changes();

alter table public.hq_tour_staff enable row level security;
alter table public.hq_tours enable row level security;

-- No browser role can enroll users or permanently delete tours.
revoke all on table public.hq_tour_staff from public, anon, authenticated;
revoke all on table public.hq_tours from public, anon, authenticated;
grant select on table public.hq_tour_staff to authenticated;
grant select, insert, update on table public.hq_tours to authenticated;

drop policy if exists hq_tour_staff_read_self on public.hq_tour_staff;
create policy hq_tour_staff_read_self
on public.hq_tour_staff for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists hq_tours_staff_select on public.hq_tours;
create policy hq_tours_staff_select
on public.hq_tours for select to authenticated
using (
  exists (
    select 1 from public.hq_tour_staff s
    where s.user_id = (select auth.uid()) and s.active
  )
);

drop policy if exists hq_tours_staff_insert on public.hq_tours;
create policy hq_tours_staff_insert
on public.hq_tours for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.hq_tour_staff s
    where s.user_id = (select auth.uid()) and s.active
  )
);

drop policy if exists hq_tours_staff_update on public.hq_tours;
create policy hq_tours_staff_update
on public.hq_tours for update to authenticated
using (
  exists (
    select 1 from public.hq_tour_staff s
    where s.user_id = (select auth.uid()) and s.active
  )
)
with check (
  exists (
    select 1 from public.hq_tour_staff s
    where s.user_id = (select auth.uid()) and s.active
  )
);

comment on table public.hq_tours is
  'Paws HQ staff tour calendar. Dates/times are local to America/New_York; deletion is reversible.';
comment on table public.hq_tour_staff is
  'Administrator-managed Tours allowlist. Slack sign-in alone does not grant Tours access.';
comment on column public.hq_tours.revision is
  'Server-incremented optimistic lock. Client updates must filter by expected revision.';

notify pgrst, 'reload schema';
commit;
