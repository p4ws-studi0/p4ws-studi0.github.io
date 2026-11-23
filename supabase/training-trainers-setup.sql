-- Shared, private trainer choices. No training values, accounts, or sessions are rewritten.
begin;

create table if not exists public.hq_training_trainers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  constraint hq_training_trainers_individual_name check (
    name !~ '[[:cntrl:]&,/+;]'
    and name !~* '(^|[[:space:]])and([[:space:]]|$)'
  )
);

create unique index if not exists hq_training_trainers_name_key
  on public.hq_training_trainers ((lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))));

-- Install/reinstall is atomic. Seeding never changes an existing roster choice or log.
drop trigger if exists hq_training_trainers_stamp_changes on public.hq_training_trainers;
with candidates as (
  select regexp_replace(btrim(person), '[[:space:]]+', ' ', 'g') as name,
         l.created_by, l.position, l.id
  from public.hq_training_logs l
  join public.hq_training_dogs d on d.id = l.dog_id
  cross join lateral regexp_split_to_table(l.trainer,
    '[[:space:]]+and[[:space:]]+|[[:space:]]*[&+/;][[:space:]]*', 'i') as person
  where l.deleted_at is null
), unique_names as (
  select distinct on (lower(name)) name, created_by
  from candidates
  where name <> '' and char_length(name) <= 120
    and name !~ '[[:cntrl:]&,/+;]'
    and name !~* '(^|[[:space:]])and([[:space:]]|$)'
  -- Prefer an existing capitalized spelling over an all-lowercase variant.
  order by lower(name), (name = lower(name)), position, id
)
insert into public.hq_training_trainers (name, created_by, updated_by)
select name, created_by, created_by from unique_names
on conflict do nothing;

create or replace function public.hq_training_trainer_stamp_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
begin
  if actor is null or not exists (
    select 1 from public.hq_tour_staff s where s.user_id = actor and s.active
  ) then
    raise exception 'A signed-in workspace member is required to change trainer names.' using errcode = '42501';
  end if;
  if new.name ~ '[[:cntrl:]]' then
    raise exception 'Enter one trainer name without control characters.' using errcode = '23514';
  end if;
  new.name := regexp_replace(btrim(new.name), '[[:space:]]+', ' ', 'g');
  if tg_op = 'INSERT' then
    new.created_at := stamp;
    new.created_by := actor;
    new.revision := 1;
  else
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Trainer identity and creation details cannot be changed.' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := stamp;
  new.updated_by := actor;
  return new;
end;
$$;
revoke all on function public.hq_training_trainer_stamp_changes() from public, anon, authenticated;

create trigger hq_training_trainers_stamp_changes before insert or update on public.hq_training_trainers
for each row execute function public.hq_training_trainer_stamp_changes();

alter table public.hq_training_trainers enable row level security;
revoke all on table public.hq_training_trainers from public, anon, authenticated;
grant select, insert, update on table public.hq_training_trainers to authenticated;

drop policy if exists hq_training_trainers_select on public.hq_training_trainers;
create policy hq_training_trainers_select on public.hq_training_trainers for select to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active));

drop policy if exists hq_training_trainers_insert on public.hq_training_trainers;
create policy hq_training_trainers_insert on public.hq_training_trainers for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

drop policy if exists hq_training_trainers_update on public.hq_training_trainers;
create policy hq_training_trainers_update on public.hq_training_trainers for update to authenticated
using (exists (select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active))
with check (updated_by = (select auth.uid()) and exists (
  select 1 from public.hq_tour_staff s where s.user_id = (select auth.uid()) and s.active
));

-- Only newly entered or explicitly changed trainer values require roster membership.
-- Imported trainer strings remain literal, even when another cell in that row is edited.
create or replace function public.hq_training_validate_trainers()
returns trigger language plpgsql set search_path = '' as $$
declare
  selected_names text[];
begin
  if tg_op = 'UPDATE' and new.trainer is not distinct from old.trainer then return new; end if;
  if new.trainer ~ '[[:cntrl:]]' then
    raise exception 'Choose trainers from the shared trainer list.' using errcode = '23514';
  end if;
  if btrim(new.trainer) = '' then return new; end if;

  select array_agg(lower(regexp_replace(btrim(person), '[[:space:]]+', ' ', 'g')))
    into selected_names
  from regexp_split_to_table(new.trainer,
    '[[:space:]]+and[[:space:]]+|[[:space:]]*[&+/;][[:space:]]*', 'i') as person;

  if exists (select 1 from unnest(selected_names) as person where person = '')
     or cardinality(selected_names) <> (select count(distinct person) from unnest(selected_names) as person)
     or exists (
       select 1 from unnest(selected_names) as person
       where not exists (
         select 1 from public.hq_training_trainers t
         where t.active and lower(regexp_replace(btrim(t.name), '[[:space:]]+', ' ', 'g')) = person
       )
     ) then
    raise exception 'Choose trainers from the shared trainer list.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.hq_training_validate_trainers() from public, anon, authenticated;

drop trigger if exists hq_training_logs_validate_trainers on public.hq_training_logs;
create trigger hq_training_logs_validate_trainers before insert or update of trainer on public.hq_training_logs
for each row execute function public.hq_training_validate_trainers();

comment on table public.hq_training_trainers is 'Private shared trainer choices; every active Paws HQ workspace member can maintain them. Inactive choices retain historical identity.';
notify pgrst, 'reload schema';
commit;
