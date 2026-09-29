-- Run as the administrator in Supabase SQL Editor AFTER tours-setup.sql
-- and after approving at least one real staff account.
-- Uses one approved account's ID to simulate JWTs; creates no Auth users.
-- All test changes are rolled back. On any failure, run: rollback;

begin;

create temporary table hq_tours_check_context (
  actor uuid not null,
  nonstaff uuid not null,
  tour_id uuid not null
) on commit drop;

insert into hq_tours_check_context (actor, nonstaff, tour_id)
select user_id, gen_random_uuid(), gen_random_uuid()
from public.hq_tour_staff
where active
order by user_id
limit 1;

do $$
begin
  if not exists (select 1 from pg_temp.hq_tours_check_context) then
    raise exception 'Approve your verified user ID before running this check.';
  end if;
  if exists (
    select 1 from public.hq_tour_staff s
    join pg_temp.hq_tours_check_context c on s.user_id = c.nonstaff
  ) then
    raise exception 'Test UUID collision; roll back and rerun.';
  end if;
end;
$$;

grant select on pg_temp.hq_tours_check_context to authenticated, anon;

-- An active staff member can create and edit a shared tour.
set local role authenticated;
select set_config('request.jwt.claim.sub', actor::text, true),
       set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true)
from pg_temp.hq_tours_check_context;

do $$
declare
  ctx record;
  saved public.hq_tours%rowtype;
  changed integer;
begin
  select * into ctx from pg_temp.hq_tours_check_context;
  if (select count(*) from public.hq_tour_staff) <> 1 then
    raise exception 'Staff membership SELECT must expose only the caller row.';
  end if;

  insert into public.hq_tours (
    id, customer_name, tour_date, tour_time, staff_initials,
    revision, created_at, updated_at, created_by, updated_by
  ) values (
    ctx.tour_id, 'Temporary RLS verification', date '2099-10-03', time '11:00', 'QA',
    99, timestamptz '2000-01-01 00:00:00+00', timestamptz '2000-01-01 00:00:00+00',
    ctx.nonstaff, ctx.nonstaff
  ) returning * into saved;

  if saved.revision <> 1 or saved.created_by <> ctx.actor or saved.updated_by <> ctx.actor
     or saved.created_at = timestamptz '2000-01-01 00:00:00+00'
     or saved.created_at <> saved.updated_at then
    raise exception 'Insert audit fields were not stamped by the server.';
  end if;

  update public.hq_tours set staff_initials = 'QC', updated_by = ctx.nonstaff
  where id = ctx.tour_id and revision = 1
  returning * into saved;
  if saved.revision is distinct from 2 or saved.updated_by <> ctx.actor then
    raise exception 'Update revision or audit stamping failed.';
  end if;

  update public.hq_tours set customer_name = 'Stale edit must not save'
  where id = ctx.tour_id and revision = 1;
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'Stale revision update was accepted.';
  end if;

  update public.hq_tours set deleted_at = now()
  where id = ctx.tour_id and revision = 2
  returning * into saved;
  if saved.revision is distinct from 3 or saved.deleted_at is null then
    raise exception 'Soft deletion failed.';
  end if;

  update public.hq_tours set deleted_at = null
  where id = ctx.tour_id and revision = 3
  returning * into saved;
  if saved.revision is distinct from 4 or saved.deleted_at is not null then
    raise exception 'Restoration failed.';
  end if;

  begin
    update public.hq_tours set tour_time = time '09:00', outside_hours_confirmed = false
    where id = ctx.tour_id;
    raise exception 'An unconfirmed outside-hours tour was accepted.';
  exception when check_violation then null;
  end;

  update public.hq_tours set tour_time = time '09:00', outside_hours_confirmed = true
  where id = ctx.tour_id
  returning * into saved;
  if saved.revision is distinct from 5 then
    raise exception 'Confirmed outside-hours update failed.';
  end if;

  begin
    update public.hq_tours set tour_time = time '11:00:30' where id = ctx.tour_id;
    raise exception 'Sub-minute tour time was accepted.';
  exception when check_violation then null;
  end;

  begin
    update public.hq_tours set customer_name = '  ' where id = ctx.tour_id;
    raise exception 'Blank customer name was accepted.';
  exception when check_violation then null;
  end;

  begin
    update public.hq_tours set id = gen_random_uuid() where id = ctx.tour_id;
    raise exception 'Tour ID changed.';
  exception when check_violation then null;
  end;

  begin
    update public.hq_tours set created_by = ctx.nonstaff where id = ctx.tour_id;
    raise exception 'Tour creation identity changed.';
  exception when check_violation then null;
  end;

  begin
    delete from public.hq_tours where id = ctx.tour_id;
    raise exception 'A browser user permanently deleted a tour.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.hq_tour_staff set active = false where user_id = ctx.actor;
    raise exception 'A browser user changed staff authorization.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- A signed-in nonmember cannot read or change any tour or approve themself.
select set_config('request.jwt.claim.sub', nonstaff::text, true),
       set_config('request.jwt.claims', json_build_object('sub', nonstaff, 'role', 'authenticated')::text, true)
from pg_temp.hq_tours_check_context;

do $$
declare
  ctx record;
  changed integer;
begin
  select * into ctx from pg_temp.hq_tours_check_context;
  if exists (select 1 from public.hq_tours) then
    raise exception 'Nonmember can read tours.';
  end if;
  if exists (select 1 from public.hq_tour_staff) then
    raise exception 'Nonmember can read staff memberships.';
  end if;
  update public.hq_tours set staff_initials = 'BAD' where id = ctx.tour_id;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Nonmember can edit tours.'; end if;

  begin
    insert into public.hq_tours (id, customer_name, tour_date, tour_time, staff_initials)
    values (gen_random_uuid(), 'Blocked', date '2099-10-03', time '11:00', 'BAD');
    raise exception 'Nonmember can create tours.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.hq_tour_staff (user_id, active) values (ctx.nonstaff, true);
    raise exception 'Nonmember can approve themself.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Revocation applies to existing sessions, without waiting for JWT renewal.
reset role;
update public.hq_tour_staff set active = false
where user_id = (select actor from pg_temp.hq_tours_check_context);

set local role authenticated;
select set_config('request.jwt.claim.sub', actor::text, true),
       set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true)
from pg_temp.hq_tours_check_context;

do $$
declare
  changed integer;
begin
  if exists (select 1 from public.hq_tours) then
    raise exception 'Inactive staff can read tours.';
  end if;
  update public.hq_tours set staff_initials = 'BAD'
  where id = (select tour_id from pg_temp.hq_tours_check_context);
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Inactive staff can edit tours.'; end if;

  begin
    insert into public.hq_tours (id, customer_name, tour_date, tour_time, staff_initials)
    values (gen_random_uuid(), 'Blocked', date '2099-10-03', time '11:00', 'BAD');
    raise exception 'Inactive staff can create tours.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Signed-out requests have no Tours or membership privileges.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.hq_tours;
    raise exception 'Anonymous users can read tours.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.hq_tour_staff;
    raise exception 'Anonymous users can read staff membership.';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('anon', 'public.hq_tours', 'INSERT')
     or has_table_privilege('anon', 'public.hq_tours', 'UPDATE')
     or has_table_privilege('anon', 'public.hq_tours', 'DELETE') then
    raise exception 'Anonymous users hold Tours write privileges.';
  end if;
end;
$$;

reset role;
select 'PASS: Tours authorization, audit fields, validation, optimistic revision checks, removal and restoration. The next statement rolls back all test changes.' as result;
rollback;
