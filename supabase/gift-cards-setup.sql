-- Shared gift card records for the existing approved Paws HQ accounts.
-- Run after Tours membership setup. No source CSV values or new approvals are included.
begin;

create table if not exists public.hq_gift_cards (
  id uuid primary key,
  certificate_number text not null default '' check (char_length(certificate_number) <= 120),
  amount text not null default '' check (char_length(amount) <= 120),
  purchased_date text not null default '' check (char_length(purchased_date) <= 120),
  purchaser_name text not null default '' check (char_length(purchaser_name) <= 20000),
  purchase_initials text not null default '' check (char_length(purchase_initials) <= 120),
  redeemed_date text not null default '' check (char_length(redeemed_date) <= 120),
  redeemer_name text not null default '' check (char_length(redeemer_name) <= 20000),
  redemption_initials text not null default '' check (char_length(redemption_initials) <= 120),
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
  constraint hq_gift_cards_not_empty check (
    btrim(certificate_number || amount || purchased_date || purchaser_name || purchase_initials || redeemed_date || redeemer_name || redemption_initials,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_gift_cards_source_complete check (
    (source_file is null and source_row is null and source_values is null)
    or (source_file is not null and source_row is not null and source_row >= 3 and source_values is not null
        and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 8)
  )
);

create index if not exists hq_gift_cards_position_idx on public.hq_gift_cards (position,id);
-- Preserve older duplicate blank/history rows, but allow only one active filled entry per number.
-- PostgreSQL uniqueness also serializes competing claims from separate devices.
create unique index if not exists hq_gift_cards_active_number_idx
on public.hq_gift_cards (btrim(certificate_number, ' ' || chr(9) || chr(10) || chr(13)))
where deleted_at is null and
  btrim(amount || purchased_date || purchaser_name || purchase_initials || redeemed_date || redeemer_name || redemption_initials,
        ' ' || chr(9) || chr(10) || chr(13)) <> '';

-- All eight working cells remain literal text. Identity, source, order, and audit values are protected.
create or replace function public.hq_gift_cards_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in staff member is required to change gift card records.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      raise exception 'The certificate roster is fixed. Update an existing certificate instead.' using errcode = '42501';
    end if;
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if new.deleted_at is not null then new.deleted_at := stamp; end if;
  else
    if new.id is distinct from old.id or new.certificate_number is distinct from old.certificate_number
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Record identity, certificate number, and creation details cannot be changed.' using errcode = '23514';
    end if;
    if new.position is distinct from old.position or new.source_file is distinct from old.source_file
       or new.source_row is distinct from old.source_row or new.source_values is distinct from old.source_values then
      raise exception 'Original gift card source metadata and order cannot be changed.' using errcode = '23514';
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
revoke all on function public.hq_gift_cards_stamp_changes() from public, anon, authenticated;

drop trigger if exists hq_gift_cards_stamp_changes on public.hq_gift_cards;
create trigger hq_gift_cards_stamp_changes before insert or update on public.hq_gift_cards
for each row execute function public.hq_gift_cards_stamp_changes();

alter table public.hq_gift_cards enable row level security;
revoke all on table public.hq_gift_cards from public, anon, authenticated;
grant select,update on table public.hq_gift_cards to authenticated;
revoke all on sequence public.hq_gift_cards_position_seq from public, anon, authenticated;

drop policy if exists hq_gift_cards_select on public.hq_gift_cards;
create policy hq_gift_cards_select on public.hq_gift_cards for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_gift_cards_insert on public.hq_gift_cards;

drop policy if exists hq_gift_cards_update on public.hq_gift_cards;
create policy hq_gift_cards_update on public.hq_gift_cards for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

comment on table public.hq_gift_cards is 'Fixed gift-card certificate roster for approved Paws HQ accounts. Browser users edit details of existing certificates only; certificate numbers and source data are immutable. Deletion is reversible. This table logs records; it performs no financial transactions.';
comment on column public.hq_gift_cards.certificate_number is 'Immutable certificate number from the existing roster. Browser users cannot add certificates or change their numbers.';
comment on column public.hq_gift_cards.source_values is 'Immutable original CSV cells in displayed column order, including blank strings. Browser-created records have no source metadata.';
comment on column public.hq_gift_cards.position is 'Immutable insertion/source order, independent of edits to the displayed cells.';
comment on column public.hq_gift_cards.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';
notify pgrst, 'reload schema';
commit;
