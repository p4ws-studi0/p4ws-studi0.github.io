-- Shared End Of Day records for the existing approved Paws HQ accounts.
-- All source data is imported privately; this script does not enroll accounts.
begin;

create table if not exists public.hq_end_of_day (
  id uuid primary key,
  entry_date date not null unique,
  staff_name text not null default '' check (char_length(staff_name) <= 500),
  cash_received text not null default '' check (char_length(cash_received) <= 200),
  checks_received text not null default '' check (char_length(checks_received) <= 200),
  card_tips_received text not null default '' check (char_length(card_tips_received) <= 200),
  card_tips_paid text not null default '' check (char_length(card_tips_paid) <= 200),
  receipts_paid text not null default '' check (char_length(receipts_paid) <= 200),
  receipt_description text not null default '' check (char_length(receipt_description) <= 20000),
  drawer_total text not null default '' check (char_length(drawer_total) <= 200),
  cash_replaced text not null default '' check (char_length(cash_replaced) <= 200),
  cash_deposit text not null default '' check (char_length(cash_deposit) <= 200),
  check_deposit text not null default '' check (char_length(check_deposit) <= 200),
  total_deposit text not null default '' check (char_length(total_deposit) <= 200),
  notes text not null default '' check (char_length(notes) <= 20000),
  additional_note text not null default '' check (char_length(additional_note) <= 20000),
  bills_100 text not null default '' check (char_length(bills_100) <= 200),
  bills_50 text not null default '' check (char_length(bills_50) <= 200),
  bills_20 text not null default '' check (char_length(bills_20) <= 200),
  bills_10 text not null default '' check (char_length(bills_10) <= 200),
  bills_5 text not null default '' check (char_length(bills_5) <= 200),
  bills_1 text not null default '' check (char_length(bills_1) <= 200),
  quarters text not null default '' check (char_length(quarters) <= 200),
  dimes text not null default '' check (char_length(dimes) <= 200),
  nickels text not null default '' check (char_length(nickels) <= 200),
  pennies text not null default '' check (char_length(pennies) <= 200),
  position bigint generated always as identity,
  source_file text,
  source_column integer,
  source_date text,
  source_values jsonb,
  deleted_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  constraint hq_end_of_day_not_empty check (
    btrim(staff_name || cash_received || checks_received || card_tips_received || card_tips_paid || receipts_paid || receipt_description || cash_replaced || cash_deposit || check_deposit || notes || additional_note || bills_100 || bills_50 || bills_20 || bills_10 || bills_5 || bills_1 || quarters || dimes || nickels || pennies,
          ' ' || chr(9) || chr(10) || chr(13)) <> ''
  ),
  constraint hq_end_of_day_source_complete check (
    (source_file is null and source_column is null and source_date is null and source_values is null)
    or (source_file is not null and source_column is not null and source_column >= 2 and source_date is not null
        and source_values is not null and jsonb_typeof(source_values) = 'array' and jsonb_array_length(source_values) = 24)
  )
);
create index if not exists hq_end_of_day_date_idx on public.hq_end_of_day(entry_date desc,id);

-- Parse currency without floating point, while keeping the original working string.
-- Blank is absent; other values accept a sign, leading $, correctly grouped commas,
-- accounting parentheses, .50 and 40., at most two decimal places and the stated limit.
create or replace function public.hq_end_of_day_money(value text)
returns numeric language plpgsql immutable strict set search_path = '' as $$
declare
  cleaned text := regexp_replace(value,'^[[:space:]]+|[[:space:]]+$','','g');
  accounting boolean := false;
  sign_seen boolean := false;
  negative boolean := false;
  amount numeric;
begin
  if cleaned = '' then return null; end if;
  if left(cleaned,1) = '(' or right(cleaned,1) = ')' then
    if left(cleaned,1) <> '(' or right(cleaned,1) <> ')' then
      raise exception 'Enter a valid dollar amount.' using errcode = '22023';
    end if;
    accounting := true;
    negative := true;
    cleaned := regexp_replace(substring(cleaned,2,char_length(cleaned)-2),'^[[:space:]]+|[[:space:]]+$','','g');
  end if;
  if left(cleaned,1) in ('+','-') then
    if accounting then raise exception 'Use a sign or accounting parentheses, not both.' using errcode = '22023'; end if;
    sign_seen := true;
    negative := left(cleaned,1) = '-';
    cleaned := substring(cleaned,2);
  end if;
  if left(cleaned,1) = '$' then cleaned := substring(cleaned,2); end if;
  if left(cleaned,1) in ('+','-') then
    if accounting or sign_seen then raise exception 'Enter one sign for a dollar amount.' using errcode = '22023'; end if;
    negative := left(cleaned,1) = '-';
    cleaned := substring(cleaned,2);
  end if;
  if cleaned !~ '^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:[.][0-9]{0,2})?$'
     and cleaned !~ '^[.][0-9]{1,2}$' then
    raise exception 'Enter a dollar amount with no more than two decimal places.' using errcode = '22023';
  end if;
  amount := replace(cleaned,',','')::numeric;
  if amount > 999999999.99 then
    raise exception 'Dollar amounts cannot exceed 999999999.99 in magnitude.' using errcode = '22023';
  end if;
  return case when negative then -amount else amount end;
end;
$$;
revoke all on function public.hq_end_of_day_money(text) from public,anon,authenticated;

-- Sum dollar amounts, not bill/coin counts. An entirely blank set stays blank.
create or replace function public.hq_end_of_day_sum(values_to_sum text[])
returns text language plpgsql immutable strict set search_path = '' as $$
declare value text; amount numeric; total numeric := 0; has_value boolean := false;
begin
  foreach value in array values_to_sum loop
    amount := public.hq_end_of_day_money(value);
    if amount is not null then total := total + amount; has_value := true; end if;
  end loop;
  if not has_value then return ''; end if;
  return total::numeric(16,2)::text;
end;
$$;
revoke all on function public.hq_end_of_day_sum(text[]) from public,anon,authenticated;

create or replace function public.hq_end_of_day_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare actor uuid := auth.uid(); stamp timestamptz := statement_timestamp(); field text;
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id=actor and s.active
  ) then raise exception 'A signed-in staff member is required to change End Of Day records.' using errcode='42501'; end if;
  if tg_op='INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
    if current_user='authenticated' then
      new.source_file := null;
      new.source_column := null;
      new.source_date := null;
      new.source_values := null;
      new.drawer_total := public.hq_end_of_day_sum(array[new.bills_100,new.bills_50,new.bills_20,new.bills_10,new.bills_5,new.bills_1,new.quarters,new.dimes,new.nickels,new.pennies]);
      new.total_deposit := public.hq_end_of_day_sum(array[new.cash_deposit,new.check_deposit]);
    end if;
    if new.deleted_at is not null then new.deleted_at := stamp; end if;
  else
    if new.id is distinct from old.id or new.entry_date is distinct from old.entry_date
       or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
      raise exception 'The day, record identity, and creation details cannot be changed.' using errcode='23514';
    end if;
    if new.position is distinct from old.position or new.source_file is distinct from old.source_file
       or new.source_column is distinct from old.source_column or new.source_date is distinct from old.source_date
       or new.source_values is distinct from old.source_values then
      raise exception 'Original End Of Day source metadata and order cannot be changed.' using errcode='23514';
    end if;
    if array[new.bills_100,new.bills_50,new.bills_20,new.bills_10,new.bills_5,new.bills_1,new.quarters,new.dimes,new.nickels,new.pennies]
       is distinct from array[old.bills_100,old.bills_50,old.bills_20,old.bills_10,old.bills_5,old.bills_1,old.quarters,old.dimes,old.nickels,old.pennies] then
      new.drawer_total := public.hq_end_of_day_sum(array[new.bills_100,new.bills_50,new.bills_20,new.bills_10,new.bills_5,new.bills_1,new.quarters,new.dimes,new.nickels,new.pennies]);
    else new.drawer_total := old.drawer_total; end if;
    if array[new.cash_deposit,new.check_deposit] is distinct from array[old.cash_deposit,old.check_deposit] then
      new.total_deposit := public.hq_end_of_day_sum(array[new.cash_deposit,new.check_deposit]);
    else new.total_deposit := old.total_deposit; end if;
    new.revision := old.revision+1;
    if new.deleted_at is not null then
      new.deleted_at := case when old.deleted_at is null then stamp else old.deleted_at end;
    end if;
  end if;
  -- Check only browser inserts and changed money inputs. Historic cached totals stay exact.
  foreach field in array array['cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','cash_replaced','cash_deposit','check_deposit','bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'] loop
    if (tg_op='INSERT' and current_user='authenticated') or (tg_op='UPDATE' and (to_jsonb(new)->>field) is distinct from (to_jsonb(old)->>field)) then
      perform public.hq_end_of_day_money(to_jsonb(new)->>field);
    end if;
  end loop;
  new.updated_at := stamp;
  new.updated_by := actor;
  return new;
end;
$$;
revoke all on function public.hq_end_of_day_stamp_changes() from public,anon,authenticated;
drop trigger if exists hq_end_of_day_stamp_changes on public.hq_end_of_day;
create trigger hq_end_of_day_stamp_changes before insert or update on public.hq_end_of_day
for each row execute function public.hq_end_of_day_stamp_changes();

alter table public.hq_end_of_day enable row level security;
revoke all on table public.hq_end_of_day from public,anon,authenticated;
grant select,insert,update on table public.hq_end_of_day to authenticated;
revoke all on sequence public.hq_end_of_day_position_seq from public,anon,authenticated;
grant usage on sequence public.hq_end_of_day_position_seq to authenticated;
-- Trigger helper functions execute as the caller; only the approved-row policies allow data access.
grant execute on function public.hq_end_of_day_money(text),public.hq_end_of_day_sum(text[]) to authenticated;

drop policy if exists hq_end_of_day_select on public.hq_end_of_day;
create policy hq_end_of_day_select on public.hq_end_of_day for select to authenticated
using (exists(select 1 from public.hq_tour_staff s where s.user_id=(select auth.uid()) and s.active));
drop policy if exists hq_end_of_day_insert on public.hq_end_of_day;
create policy hq_end_of_day_insert on public.hq_end_of_day for insert to authenticated
with check (created_by=(select auth.uid()) and exists(select 1 from public.hq_tour_staff s where s.user_id=(select auth.uid()) and s.active));
drop policy if exists hq_end_of_day_update on public.hq_end_of_day;
create policy hq_end_of_day_update on public.hq_end_of_day for update to authenticated
using (exists(select 1 from public.hq_tour_staff s where s.user_id=(select auth.uid()) and s.active))
with check (exists(select 1 from public.hq_tour_staff s where s.user_id=(select auth.uid()) and s.active));

comment on table public.hq_end_of_day is 'Shared daily End Of Day entries. Existing approved staff have reversible CRUD. The immutable day is unique, including deleted entries. No opening balance or inferred cash-flow formula is applied.';
comment on column public.hq_end_of_day.source_values is 'Immutable 24 original CSV cells in physical row2–25 order, including cached totals, blank fields, and unlabelled row15. Browser-created records have no source metadata.';
comment on column public.hq_end_of_day.drawer_total is 'Server-protected denomination-dollar sum. Original imports retain cached text; denomination changes recompute exactly to cents.';
comment on column public.hq_end_of_day.total_deposit is 'Server-protected sum of cash/check deposits. Original imports retain cached text; deposit input changes recompute exactly to cents.';
comment on column public.hq_end_of_day.revision is 'Server-incremented optimistic lock. Browser updates filter by expected revision.';
notify pgrst,'reload schema';
commit;
