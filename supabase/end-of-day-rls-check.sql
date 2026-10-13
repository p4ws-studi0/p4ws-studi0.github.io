-- Execute after end-of-day-setup.sql. All synthetic data and access changes roll back.
begin;
create temporary table end_of_day_check_context(actor uuid,outsider uuid,entry uuid,imported_entry uuid,fixture_day date) on commit drop;
insert into end_of_day_check_context
select s.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       date '5000-01-01'+floor(random()*36500)::integer
from public.hq_tour_staff s join auth.users u on u.id=s.user_id
where s.active order by (coalesce(u.email,'') ilike '%guest%') desc,s.user_id limit 1;
do $$ begin
  if not exists(select 1 from pg_temp.end_of_day_check_context) then raise exception 'No approved staff member available.'; end if;
end $$;
grant select on pg_temp.end_of_day_check_context to authenticated,anon;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.end_of_day_check_context;

-- Administrative imports preserve all24 literal cells, including cached deposit differences.
insert into public.hq_end_of_day(id,entry_date,staff_name,cash_received,checks_received,card_tips_received,card_tips_paid,receipts_paid,receipt_description,drawer_total,cash_replaced,cash_deposit,check_deposit,total_deposit,notes,additional_note,bills_100,bills_50,bills_20,bills_10,bills_5,bills_1,quarters,dimes,nickels,pennies,source_file,source_column,source_date,source_values)
select imported_entry,fixture_day+1,'Fixture staff  ','0.00','','0','0.00','','Fixture receipt  ','100.50','-6.68','40.','2.50','999.99',E'Fixture note\r\nSecond line  ',' ','100.00','','','','','','.50','','','','Fixture.csv',2,'fixture header','["Fixture staff  ", "0.00", "", "0", "0.00", "", "Fixture receipt  ", "100.50", "-6.68", "40.", "2.50", "999.99", "Fixture note\r\nSecond line  ", " ", "100.00", "", "", "", "", "", ".50", "", "", ""]'::jsonb
from pg_temp.end_of_day_check_context;
do $$ begin
  begin
    insert into public.hq_end_of_day(id,entry_date,notes,source_file,source_column,source_date,source_values)
    values(gen_random_uuid(),(select fixture_day+2 from pg_temp.end_of_day_check_context),'Invalid source fixture','Fixture.csv',2,'header','["one","two"]'::jsonb);
    raise exception 'An incomplete source row was accepted.';
  exception when check_violation then null; end;
  begin
    insert into public.hq_end_of_day(id,entry_date,notes,source_file,source_column,source_date,source_values)
    values(gen_random_uuid(),(select fixture_day+2 from pg_temp.end_of_day_check_context),'Invalid source fixture','Fixture.csv',1,'header','["Fixture staff  ", "0.00", "", "0", "0.00", "", "Fixture receipt  ", "100.50", "-6.68", "40.", "2.50", "999.99", "Fixture note\r\nSecond line  ", " ", "100.00", "", "", "", "", "", ".50", "", "", ""]'::jsonb);
    raise exception 'The source label column was accepted as an imported day.';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$
declare c record; r public.hq_end_of_day%rowtype; original public.hq_end_of_day%rowtype; affected integer; removed_at timestamptz;
begin
  select * into c from pg_temp.end_of_day_check_context;
  select * into original from public.hq_end_of_day where id=c.imported_entry;
  if original.source_values is distinct from '["Fixture staff  ", "0.00", "", "0", "0.00", "", "Fixture receipt  ", "100.50", "-6.68", "40.", "2.50", "999.99", "Fixture note\r\nSecond line  ", " ", "100.00", "", "", "", "", "", ".50", "", "", ""]'::jsonb or
     jsonb_build_array(original.staff_name,original.cash_received,original.checks_received,original.card_tips_received,original.card_tips_paid,original.receipts_paid,original.receipt_description,original.drawer_total,original.cash_replaced,original.cash_deposit,original.check_deposit,original.total_deposit,original.notes,original.additional_note,original.bills_100,original.bills_50,original.bills_20,original.bills_10,original.bills_5,original.bills_1,original.quarters,original.dimes,original.nickels,original.pennies) is distinct from original.source_values then
    raise exception 'Original literal cells, blanks, or line endings changed.';
  end if;
  insert into public.hq_end_of_day(id,entry_date,notes,cash_replaced,drawer_total,total_deposit,
      revision,created_at,created_by,updated_at,updated_by,source_file,source_column,source_date,source_values)
  values(c.entry,c.fixture_day,E'  Staff note\r\nSecond line  ',' -6.68 ','forged','forged',99,'2000-01-01',c.outsider,
    '2000-01-01',c.outsider,'Forged.csv',1,'Forged header','[]'::jsonb) returning * into r;
  if r.revision<>1 or r.created_by<>c.actor or r.updated_by<>c.actor or r.created_at='2000-01-01' or r.updated_at='2000-01-01'
     or r.cash_replaced<>' -6.68 ' or r.drawer_total<>'' or r.total_deposit<>''
     or r.source_file is not null or r.source_column is not null or r.source_date is not null or r.source_values is not null then
    raise exception 'Literal partial row, protected totals, audit, or source stripping failed.';
  end if;
  update public.hq_end_of_day set staff_name='Edited fixture',revision=99,updated_at='2000-01-01',updated_by=c.outsider
  where id=c.entry and revision=1 returning * into r;
  if r.revision<>2 or r.updated_by<>c.actor or r.updated_at='2000-01-01' then raise exception 'Audit or revision stamping failed.'; end if;
  update public.hq_end_of_day set notes='Stale edit' where id=c.entry and revision=1;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Stale edit overwrote a daily record.'; end if;
  update public.hq_end_of_day set deleted_at='2000-01-01' where id=c.entry and revision=2 returning * into r;
  if r.deleted_at is null or r.deleted_at='2000-01-01' or r.revision<>3 then raise exception 'Soft deletion timestamp failed.'; end if;
  removed_at:=r.deleted_at;
  begin
    insert into public.hq_end_of_day(id,entry_date,notes) values(gen_random_uuid(),c.fixture_day,'Duplicate deleted day');
    raise exception 'A deleted day was duplicated.';
  exception when unique_violation then null; end;
  update public.hq_end_of_day set deleted_at='2001-01-01' where id=c.entry and revision=3 returning * into r;
  if r.deleted_at is distinct from removed_at then raise exception 'Original deletion timestamp changed.'; end if;
  update public.hq_end_of_day set deleted_at=null where id=c.entry and revision=4 returning * into r;
  if r.deleted_at is not null or r.revision<>5 or r.staff_name<>'Edited fixture' then raise exception 'Restore lost the daily record.'; end if;
  begin
    insert into public.hq_end_of_day(id,entry_date,notes) values(gen_random_uuid(),c.fixture_day,'Duplicate active day');
    raise exception 'An active day was duplicated.';
  exception when unique_violation then null; end;

  -- Unrelated edits and attempted total overrides retain historical cached literals.
  update public.hq_end_of_day set notes='Edited note',drawer_total='999',total_deposit='888' where id=c.imported_entry returning * into r;
  if r.drawer_total is distinct from original.drawer_total or r.total_deposit is distinct from original.total_deposit then
    raise exception 'Notes-only editing replaced historical cached totals.';
  end if;
  update public.hq_end_of_day set drawer_total='forged',total_deposit='forged' where id=c.imported_entry returning * into r;
  if r.drawer_total<>'100.50' or r.total_deposit<>'999.99' then raise exception 'Computed-only overrides were accepted.'; end if;
  update public.hq_end_of_day set cash_received='$12.50' where id=c.imported_entry returning * into r;
  if r.drawer_total<>'100.50' or r.total_deposit<>'999.99' or r.cash_received<>'$12.50' then
    raise exception 'Unrelated money inputs changed historical totals or raw text.';
  end if;
  update public.hq_end_of_day set bills_100='$100.00' where id=c.imported_entry returning * into r;
  if r.drawer_total<>'100.50' or r.total_deposit<>'999.99' then raise exception 'Denomination change affected the wrong computed total.'; end if;
  update public.hq_end_of_day set cash_deposit='$40.00' where id=c.imported_entry returning * into r;
  if r.total_deposit<>'42.50' or r.drawer_total<>'100.50' then raise exception 'Deposit change failed selective recalculation.'; end if;
  if r.source_file is distinct from original.source_file or r.source_column is distinct from original.source_column
     or r.source_date is distinct from original.source_date or r.source_values is distinct from original.source_values
     or r.position is distinct from original.position then raise exception 'Editing changed original source metadata.'; end if;
  begin update public.hq_end_of_day set id=gen_random_uuid() where id=c.entry;
    raise exception 'Record identity changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set entry_date=entry_date+1 where id=c.entry;
    raise exception 'The record date changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set created_at='2000-01-01' where id=c.entry;
    raise exception 'Creation stamp changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set created_by=c.outsider where id=c.entry;
    raise exception 'Creator changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set position=position+1 where id=c.entry;
    raise exception 'Original position changed.'; exception when check_violation or generated_always then null; end;
  begin update public.hq_end_of_day set source_file='Changed.csv' where id=c.imported_entry;
    raise exception 'Source filename changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set source_column=3 where id=c.imported_entry;
    raise exception 'Source column changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set source_date='Changed header' where id=c.imported_entry;
    raise exception 'Source date header changed.'; exception when check_violation then null; end;
  begin update public.hq_end_of_day set source_values='[]'::jsonb where id=c.imported_entry;
    raise exception 'Source cells changed.'; exception when check_violation then null; end;
  begin delete from public.hq_end_of_day where id=c.entry;
    raise exception 'Permanent deletion allowed.'; exception when insufficient_privilege then null; end;
  begin insert into public.hq_end_of_day(id,entry_date,drawer_total,total_deposit) values(gen_random_uuid(),c.fixture_day+2,'1','2');
    raise exception 'A derived-total-only blank day was accepted.'; exception when check_violation then null; end;
end $$;

-- All editable fields allow independent partial rows. Money values use exact cents.
do $$
declare c record; field text; input text; expected numeric; max_length integer; partial_id uuid; day_offset integer:=10;
        r public.hq_end_of_day%rowtype; editable_fields text[]:=array['staff_name','cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','receipt_description','cash_replaced','cash_deposit','check_deposit','notes','additional_note','bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
        money_fields text[]:=array['cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','cash_replaced','cash_deposit','check_deposit','bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
begin
  select * into c from pg_temp.end_of_day_check_context;
  foreach field in array editable_fields loop
    partial_id:=gen_random_uuid();day_offset:=day_offset+1;
    input:=case when field=any(money_fields) then ' 1.25 ' else '  Partial literal value  ' end;
    execute format('insert into public.hq_end_of_day(id,entry_date,%I) values($1,$2,$3) returning *',field)
      into r using partial_id,c.fixture_day+day_offset,input;
    if (to_jsonb(r)->>field) is distinct from input then raise exception 'Partial field % lost raw text.',field; end if;
    if (select count(*) from unnest(editable_fields) f where to_jsonb(r)->>f='')<>21 then
      raise exception 'Partial field % did not retain21 blank editable fields.',field;
    end if;
    max_length:=case when field='staff_name' then 500 when field=any(money_fields) then 200 else 20000 end;
    input:=case when field=any(money_fields) then repeat('0',max_length-4)||'1.00' else repeat('x',max_length) end;
    execute format('update public.hq_end_of_day set %I=$1 where id=$2 returning *',field) into r using input,partial_id;
    if char_length(to_jsonb(r)->>field)<>max_length then raise exception 'Field % limit lost text.',field; end if;
    begin
      input:=case when field=any(money_fields) then repeat('0',max_length-3)||'1.00' else repeat('x',max_length+1) end;
      execute format('update public.hq_end_of_day set %I=$1 where id=$2',field) using input,partial_id;
      raise exception 'Field % accepted too much text.',field;
    exception when check_violation then null; end;
  end loop;
  begin insert into public.hq_end_of_day(id,entry_date,notes) values(gen_random_uuid(),c.fixture_day+40,E' \t\r\n ');
    raise exception 'A whitespace-only day was accepted.'; exception when check_violation then null; end;
  for input,expected in select * from (values
    ('0',0::numeric),(' .50 ',.50),('40.',40),('$1,234.50',1234.50),('-$12.34',-12.34),('$-12.34',-12.34),
    ('+$12.34',12.34),('$+12.34',12.34),('($1,234.50)',-1234.50),('( $12.34 )',-12.34),('999999999.99',999999999.99),('-999999999.99',-999999999.99)) valid(value,amount)
  loop
    update public.hq_end_of_day set cash_received=input where id=c.entry returning * into r;
    if r.cash_received is distinct from input or public.hq_end_of_day_money(r.cash_received) is distinct from expected then
      raise exception 'Accepted money format lost raw text or exact cents.';
    end if;
  end loop;
  foreach input in array array['1.234','1,23','1,0000','1,,000','1e3','NaN','Infinity','$'||'$12','-$-12','(-12)','(+12)','$ 12','12 dollars','1000000000','-1000000000','()','(12','12)','++12'] loop
    begin
      update public.hq_end_of_day set cash_received=input where id=c.entry;
      raise exception 'An invalid money value was accepted.';
    exception when invalid_parameter_value then null; end;
    begin
      insert into public.hq_end_of_day(id,entry_date,cash_received) values(gen_random_uuid(),c.fixture_day+40,input);
      raise exception 'An invalid inserted money value was accepted.';
    exception when invalid_parameter_value then null; end;
  end loop;
  -- The sum may exceed the individual-input limit, and protected totals remain valid.
  update public.hq_end_of_day set bills_100='999999999.99',bills_50='999999999.99',bills_20='999999999.99',bills_10='999999999.99',bills_5='999999999.99',bills_1='999999999.99',quarters='999999999.99',dimes='999999999.99',nickels='999999999.99',pennies='999999999.99',cash_deposit='999999999.99',check_deposit='999999999.99' where id=c.entry returning * into r;
  if r.drawer_total<>'9999999999.90' or r.total_deposit<>'1999999999.98' then raise exception 'Valid large totals were rejected or rounded.'; end if;
  update public.hq_end_of_day set bills_100='',bills_50='',bills_20='',bills_10='',bills_5='',bills_1='',quarters='',dimes='',nickels='',pennies='',cash_deposit='',check_deposit='' where id=c.entry returning * into r;
  if r.drawer_total<>'' or r.total_deposit<>'' then raise exception 'Fully blank components did not yield blank totals.'; end if;
  update public.hq_end_of_day set bills_100='100.00',pennies='.01',cash_deposit='.10' where id=c.entry returning * into r;
  if r.drawer_total<>'100.01' or r.total_deposit<>'0.10' then raise exception 'Blank-as-zero or cent arithmetic failed.'; end if;
  update public.hq_end_of_day set cash_deposit='.1',check_deposit='.20',bills_100='0',pennies='.1',dimes='.20' where id=c.entry returning * into r;
  if r.drawer_total<>'0.30' or r.total_deposit<>'0.30' then raise exception 'Exact decimal arithmetic failed.'; end if;
end $$;

select set_config('request.jwt.claim.sub',outsider::text,true),
set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true)
from pg_temp.end_of_day_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.end_of_day_check_context;
  if exists(select 1 from public.hq_end_of_day) then raise exception 'Nonstaff read End Of Day data.'; end if;
  update public.hq_end_of_day set notes='Unauthorized' where id=c.entry;get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Nonstaff updated a daily entry.'; end if;
  begin insert into public.hq_end_of_day(id,entry_date,notes) values(gen_random_uuid(),c.fixture_day+40,'Unauthorized');
    raise exception 'Nonstaff inserted a daily entry.'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.hq_tour_staff set active=false where user_id=(select actor from pg_temp.end_of_day_check_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),
set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true)
from pg_temp.end_of_day_check_context;
do $$ declare c record; affected integer;
begin
  select * into c from pg_temp.end_of_day_check_context;
  if exists(select 1 from public.hq_end_of_day) then raise exception 'Inactive staff read End Of Day data.'; end if;
  update public.hq_end_of_day set notes='Unauthorized' where id=c.entry;get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Inactive staff updated a daily entry.'; end if;
  begin insert into public.hq_end_of_day(id,entry_date,notes) values(gen_random_uuid(),c.fixture_day+40,'Unauthorized');
    raise exception 'Inactive staff inserted a daily entry.'; exception when insufficient_privilege then null; end;
end $$;
reset role;set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.hq_end_of_day;raise exception 'Anonymous read allowed.';exception when insufficient_privilege then null;end;
  begin insert into public.hq_end_of_day(id,entry_date,notes) values(gen_random_uuid(),date '5500-01-01','Unauthorized');
    raise exception 'Anonymous insert allowed.';exception when insufficient_privilege then null;end;
  begin update public.hq_end_of_day set notes='Unauthorized';raise exception 'Anonymous update allowed.';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: unique immutable dates, approved account CRUD, literal partial entries, money formats and cents, selective protected totals, audit/revisions/source controls, reversible deletion, and anonymous/nonstaff/inactive isolation.' as result;
rollback;
