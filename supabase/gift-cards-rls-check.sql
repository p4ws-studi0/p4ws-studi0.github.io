-- Execute after gift-cards-setup.sql. All fixture records and access changes roll back.
begin;
create temporary table gift_cards_check_context (
  actor uuid, outsider uuid, entry uuid, imported_entry uuid, limits_entry uuid, duplicate_entry uuid
) on commit drop;
-- Prefer an existing guest account when one is named as such; approved guests use the same policy.
insert into gift_cards_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.gift_cards_check_context) then
    raise exception 'No approved staff member available.';
  end if;
end $$;
grant select on pg_temp.gift_cards_check_context to authenticated,anon;

-- A private administrative import may retain its original cells and source identifiers.
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.gift_cards_check_context;
insert into public.hq_gift_cards(id,certificate_number,amount,purchased_date,purchaser_name,purchase_initials,redeemed_date,redeemer_name,redemption_initials,source_file,source_row,source_values)
select imported_entry,'0007',' $50.00 ','  9/28  ',E'Fixture buyer\r\nSecond line  ','AB','next Thursday','Fixture recipient','CD','Fixture.csv',3,
       jsonb_build_array('0007',' $50.00 ','  9/28  ',E'Fixture buyer\r\nSecond line  ','AB','next Thursday','Fixture recipient','CD')
from pg_temp.gift_cards_check_context;
do $$ begin
  begin
    insert into public.hq_gift_cards(id,certificate_number,source_file,source_row,source_values)
    values(gen_random_uuid(),'Invalid source fixture','Fixture.csv',3,'["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_gift_cards(id,certificate_number,source_file,source_row,source_values)
    values(gen_random_uuid(),'0008','Fixture.csv',2,'["0008","","","","","","",""]'::jsonb);
    raise exception 'A header row was accepted as imported gift-card data.';
  exception when check_violation then null; end;
end $$;

-- Synthetic fixed roster entries are seeded administratively, never through the browser role.
insert into public.hq_gift_cards(id,certificate_number)
select entry,'0008' from pg_temp.gift_cards_check_context;
insert into public.hq_gift_cards(id,certificate_number)
select limits_entry,'0009' from pg_temp.gift_cards_check_context;
insert into public.hq_gift_cards(id,certificate_number)
select duplicate_entry,'0008' from pg_temp.gift_cards_check_context;

set local role authenticated;
do $$
declare
  c record;
  r public.hq_gift_cards%rowtype;
  original public.hq_gift_cards%rowtype;
  affected integer;
  removed_at timestamptz;
begin
  select * into c from pg_temp.gift_cards_check_context;
  select * into original from public.hq_gift_cards where id=c.imported_entry;
  if original.source_values is distinct from jsonb_build_array('0007',' $50.00 ','  9/28  ',E'Fixture buyer\r\nSecond line  ','AB','next Thursday','Fixture recipient','CD') then
    raise exception 'Imported source cells were not retained.';
  end if;
  if jsonb_build_array(original.certificate_number,original.amount,original.purchased_date,original.purchaser_name,
                       original.purchase_initials,original.redeemed_date,original.redeemer_name,original.redemption_initials)
     is distinct from original.source_values then
    raise exception 'Original working values lost literal dates, blanks, whitespace, or line endings.';
  end if;
  if r.id is not null then raise exception 'Unexpected fixture state.'; end if;
  select * into r from public.hq_gift_cards where id=c.entry;
  if r.revision <> 1 or r.created_by <> c.actor or r.updated_by <> c.actor
     or r.certificate_number <> '0008' or r.amount <> '' or r.purchased_date <> '' or r.purchaser_name <> ''
     or r.purchase_initials <> '' or r.redeemed_date <> '' or r.redeemer_name <> '' or r.redemption_initials <> ''
     or r.source_file is not null or r.source_row is not null or r.source_values is not null then
    raise exception 'Existing number-only roster entry lost literal values or audit controls.';
  end if;
  if has_table_privilege('authenticated','public.hq_gift_cards','INSERT')
     or has_sequence_privilege('authenticated','public.hq_gift_cards_position_seq','USAGE')
     or exists(select 1 from pg_policies where schemaname='public' and tablename='hq_gift_cards' and cmd='INSERT') then
    raise exception 'Browser certificate creation is still granted.';
  end if;
  begin
    insert into public.hq_gift_cards(id,certificate_number) values(gen_random_uuid(),'NEW-FIXTURE');
    raise exception 'Approved account added a new certificate.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_gift_cards(id,certificate_number,amount) values(c.entry,'0008','Changed by upsert')
      on conflict(id) do update set amount=excluded.amount;
    raise exception 'Approved account inserted/upserted a certificate.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_gift_cards set certificate_number='CHANGED' where id=c.entry;
    raise exception 'Approved account changed a certificate number.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set certificate_number='' where id=c.entry;
    raise exception 'Approved account cleared a certificate number.';
  exception when check_violation then null; end;
  update public.hq_gift_cards set amount='Renamed fixture',revision=99,updated_by=c.outsider,
                                  updated_at='2000-01-01'
  where id=c.entry and revision=1 returning * into r;
  if r.revision <> 2 or r.updated_by <> c.actor or r.updated_at = '2000-01-01'
     or r.redeemer_name <> '' then raise exception 'Update audit or revision stamping failed.'; end if;
  update public.hq_gift_cards set redeemer_name='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Stale edit overwrote a record.'; end if;

  update public.hq_gift_cards set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at = '2000-01-01' or r.revision <> 3 then
    raise exception 'Server-controlled soft deletion failed.';
  end if;
  removed_at := r.deleted_at;
  update public.hq_gift_cards set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_gift_cards set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision <> 5 or r.amount <> 'Renamed fixture' or r.redeemer_name <> '' then
    raise exception 'Restore did not retain the record.';
  end if;

  update public.hq_gift_cards set amount='Edited fixture' where id=c.imported_entry returning * into r;
  if r.source_file is distinct from original.source_file or r.source_row is distinct from original.source_row
     or r.source_values is distinct from original.source_values or r.position is distinct from original.position then
    raise exception 'Editing changed original source metadata.';
  end if;
  begin
    update public.hq_gift_cards set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set position=position+1 where id=c.entry;
    raise exception 'Original position changed.';
  exception when check_violation or generated_always then null; end;
  begin
    update public.hq_gift_cards set source_file='Changed.csv' where id=c.imported_entry;
    raise exception 'Original source file changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set source_row=4 where id=c.imported_entry;
    raise exception 'Original source row changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set source_values='["changed","","","","","","",""]'::jsonb where id=c.imported_entry;
    raise exception 'Original source cells changed.';
  exception when check_violation then null; end;
  begin
    update public.hq_gift_cards set certificate_number='',amount='',purchased_date='',purchaser_name='',purchase_initials='',redeemed_date='',redeemer_name='',redemption_initials='' where id=c.entry;
    raise exception 'Completely empty entry accepted.';
  exception when check_violation then null; end;
  begin
    delete from public.hq_gift_cards where id=c.entry;
    raise exception 'Permanent deletion allowed.';
  exception when insufficient_privilege then null; end;
end $$;

-- A number can be claimed only once, including through a duplicate older blank slot or restore.
do $$
declare c record;
begin
  select * into c from pg_temp.gift_cards_check_context;
  begin
    update public.hq_gift_cards set purchaser_name='Second customer' where id=c.duplicate_entry;
    raise exception 'Two active filled entries used one certificate number.';
  exception when unique_violation then null; end;
  update public.hq_gift_cards set deleted_at=now() where id=c.entry;
  update public.hq_gift_cards set purchaser_name='Second customer' where id=c.duplicate_entry;
  begin
    update public.hq_gift_cards set deleted_at=null where id=c.entry;
    raise exception 'Restore created two active filled entries for one certificate.';
  exception when unique_violation then null; end;
  update public.hq_gift_cards set deleted_at=now() where id=c.duplicate_entry;
  update public.hq_gift_cards set deleted_at=null where id=c.entry;
end $$;

-- Existing roster slots retain literal blank fields and support forgiving detail updates.
do $$
declare
  c record;
  field text;
  limit_value integer;
  stored text;
  r public.hq_gift_cards%rowtype;
begin
  select * into c from pg_temp.gift_cards_check_context;
  update public.hq_gift_cards set amount=' $50.00 ',purchased_date='next Thursday',
      purchaser_name=E'  Fixture buyer\r\nSecond line  ',redeemed_date='June 10 / afternoon',redemption_initials='  AB  '
    where id=c.limits_entry returning * into r;
  if r.certificate_number <> '0009' or r.amount <> ' $50.00 ' or r.purchased_date <> 'next Thursday'
     or r.purchaser_name is distinct from E'  Fixture buyer\r\nSecond line  '
     or r.redeemed_date <> 'June 10 / afternoon' or r.redemption_initials <> '  AB  ' then
    raise exception 'Literal certificate number, amount, name, date, or initials changed.';
  end if;
  for field,limit_value in
    select * from (values ('amount',120),('purchased_date',120),('purchaser_name',20000),
                         ('purchase_initials',120),('redeemed_date',120),('redeemer_name',20000),('redemption_initials',120)) as limits(name,max_length)
  loop
    execute format('update public.hq_gift_cards set %I=$1 where id=$2 returning %I',field,field)
      into stored using repeat('x',limit_value),c.limits_entry;
    if char_length(stored) <> limit_value then raise exception 'Field % limit lost text.',field; end if;
    begin
      execute format('update public.hq_gift_cards set %I=$1 where id=$2',field)
        using repeat('x',limit_value+1),c.limits_entry;
      raise exception 'Field % accepted too much text.',field;
    exception when check_violation then null; end;
  end loop;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.gift_cards_check_context;
do $$
declare c record; affected integer;
begin
  select * into c from pg_temp.gift_cards_check_context;
  if exists(select 1 from public.hq_gift_cards) then raise exception 'Nonstaff read gift card data.'; end if;
  update public.hq_gift_cards set redeemer_name='Unauthorized' where id=c.entry;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Nonstaff updated an entry.'; end if;
  begin
    insert into public.hq_gift_cards(id,amount) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Nonstaff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.gift_cards_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.gift_cards_check_context;
do $$
declare affected integer;
begin
  if exists(select 1 from public.hq_gift_cards) then raise exception 'Inactive staff read gift card data.'; end if;
  update public.hq_gift_cards set redeemer_name='Unauthorized' where id=(select entry from pg_temp.gift_cards_check_context);
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Inactive staff updated an entry.'; end if;
  begin
    insert into public.hq_gift_cards(id,amount) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Inactive staff inserted an entry.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_gift_cards; raise exception 'Anonymous read allowed.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hq_gift_cards(id,amount) values(gen_random_uuid(),'Unauthorized');
    raise exception 'Anonymous insert allowed.';
  exception when insufficient_privilege then null; end;
  begin
    update public.hq_gift_cards set redeemer_name='Unauthorized';
    raise exception 'Anonymous update allowed.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: fixed certificate roster, browser insert/upsert and number changes blocked, approved detail edits, literal values and field limits, audit/revisions, immutable source, reversible deletion, and anonymous/nonstaff/inactive isolation.' as result;
rollback;
