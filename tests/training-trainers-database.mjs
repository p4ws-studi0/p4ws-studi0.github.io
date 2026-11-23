// Synthetic PostgreSQL checks only. Set PAWS_PGLITE_MODULE to a local PGlite module when needed.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PAWS_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const read=name=>readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333',U='44444444-4444-4444-8444-444444444444';
const D='55555555-5555-4555-8555-555555555555',E='66666666-6666-4666-8666-666666666666';
const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
const code=expected=>error=>error.code===expected;
const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);if(id)await db.exec('set role authenticated');};
const addLog=async(trainer,dog=D)=> (await q('insert into public.hq_training_logs(id,dog_id,trainer,notes) values(gen_random_uuid(),$1,$2,$3) returning *',[dog,trainer,'Synthetic training context']))[0];
try {
  await db.exec(`create role anon nologin;create role authenticated nologin;
    create schema auth;create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid);create table auth.refresh_tokens(id integer primary key,user_id uuid,token text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${A}'),('${B}'),('${C}'),('${U}');
    insert into auth.sessions values(gen_random_uuid(),'${A}');insert into auth.refresh_tokens values(1,'${A}','synthetic-only');
    create table public.hq_tour_staff(user_id uuid primary key references auth.users(id),active boolean not null default true);
    insert into public.hq_tour_staff values('${A}',true),('${B}',true),('${C}',false);
    alter table public.hq_tour_staff enable row level security;grant select on public.hq_tour_staff to authenticated;
    create policy own_membership on public.hq_tour_staff for select to authenticated using(user_id=auth.uid());`);
  await db.exec(await read('training-setup.sql'));
  await as(A);
  await q('insert into public.hq_training_dogs(id,name) values($1,$2),($3,$4)',[D,'Synthetic active pet',E,'Synthetic archived pet']);
  const shared=await addLog(' alice  SMITH & bob '),second=await addLog('Alice Smith and Bob');
  const legacy=await addLog('Legacy, Unknown');
  const retired=await addLog('Retired Person',E);
  await q('update public.hq_training_dogs set deleted_at=now() where id=$1',[E]);
  const originalLogs=await q('select * from public.hq_training_logs order by id');
  const originalDogs=await q('select * from public.hq_training_dogs order by id');
  await as(null);
  const authBefore=await q('select to_jsonb(u) as data from auth.users u order by id');
  const sessionsBefore=await q('select to_jsonb(s) as data from auth.sessions s order by id');
  const tokensBefore=await q('select to_jsonb(t) as data from auth.refresh_tokens t order by id');
  const membershipBefore=await q('select * from public.hq_tour_staff order by user_id');
  const setup=await read('training-trainers-setup.sql');await db.exec(setup);await db.exec(setup);
  assert.deepEqual(await q('select * from public.hq_training_logs order by id'),originalLogs);
  assert.deepEqual(await q('select * from public.hq_training_dogs order by id'),originalDogs);
  assert.deepEqual(await q('select to_jsonb(u) as data from auth.users u order by id'),authBefore);
  assert.deepEqual(await q('select to_jsonb(s) as data from auth.sessions s order by id'),sessionsBefore);
  assert.deepEqual(await q('select to_jsonb(t) as data from auth.refresh_tokens t order by id'),tokensBefore);
  assert.deepEqual(await q('select * from public.hq_tour_staff order by user_id'),membershipBefore);
  assert.deepEqual((await q('select lower(name) as name from public.hq_training_trainers order by lower(name)')).map(r=>r.name),['alice smith','bob','retired person']);
  console.log('PASS: rerunnable migration seeds canonical individual choices, includes archived-pet history, and leaves every legacy cell, pet, account, session and membership untouched.');

  await db.exec('set role anon');
  await assert.rejects(()=>q('select * from public.hq_training_trainers'),code('42501'));
  await db.exec('reset role');
  for(const id of [C,U]){
    await as(id);assert.equal((await q('select * from public.hq_training_trainers')).length,0);
    await assert.rejects(()=>q("insert into public.hq_training_trainers(name) values('Not allowed')"),code('42501'));
  }
  await as(A);
  const roster=await q('select * from public.hq_training_trainers order by name');assert.equal(roster.length,3);
  const added=(await q("insert into public.hq_training_trainers(name) values('  New   Trainer  ') returning *"))[0];
  assert.equal(added.name,'New Trainer');assert.equal(added.created_by,A);assert.equal(added.updated_by,A);assert.equal(added.revision,1);
  await assert.rejects(()=>q("insert into public.hq_training_trainers(name) values('new trainer')"),code('23505'));
  for(const name of ['', '  ', 'A and B', 'A & B', 'A/B', 'A+B', 'A;B', 'A,B', 'Bad\tName', 'Bad\nName', 'x'.repeat(121)])
    await assert.rejects(()=>q('insert into public.hq_training_trainers(name) values($1)',[name]),code('23514'));
  await assert.rejects(()=>q('delete from public.hq_training_trainers where id=$1',[added.id]),code('42501'));
  await as(B);
  assert.equal((await q('select * from public.hq_training_trainers')).length,4);
  const changed=(await q('update public.hq_training_trainers set active=false where id=$1 and revision=1 returning *',[added.id]))[0];
  assert.equal(changed.updated_by,B);assert.equal(changed.revision,2);assert.equal(changed.created_by,A);
  assert.equal((await q('update public.hq_training_trainers set active=true where id=$1 and revision=1 returning *',[added.id])).length,0);
  const restored=(await q('update public.hq_training_trainers set active=true where id=$1 and revision=2 returning *',[added.id]))[0];
  assert.equal(restored.revision,3);assert.equal(restored.active,true);
  await assert.rejects(()=>q('update public.hq_training_trainers set created_by=$1 where id=$2',[B,added.id]),code('23514'));
  console.log('PASS: only active workspace members share the private roster; names deduplicate and reject lists/invalid input; CAS, actor stamps, deactivation and restoration work without hard deletion.');

  for(const trainer of ['Alice Smith','Bob','New Trainer','Alice Smith and Bob',' bob &  ALICE   smith ','Bob/Alice Smith','Bob+Alice Smith','Bob;Alice Smith','']) {
    const log=await addLog(trainer);assert.equal(log.trainer,trainer,'validation must not rewrite a supplied legacy-compatible spelling');
  }
  for(const trainer of ['Ailce Smith','Alice Smith and Ailce Smith','Alice Smith and Alice Smith','Alice Smith &','& Bob','Alice Smith\nand Bob','Legacy, Unknown'])
    await assert.rejects(()=>addLog(trainer),code('23514'));
  const oldStamp=legacy.revision;
  const safe=(await q('update public.hq_training_logs set notes=$1 where id=$2 returning *',['New note only',legacy.id]))[0];
  assert.equal(safe.trainer,legacy.trainer);assert.equal(safe.revision,oldStamp+1);
  await q('update public.hq_training_logs set trainer=trainer where id=$1',[legacy.id]);
  await assert.rejects(()=>q('update public.hq_training_logs set trainer=$1 where id=$2',['Ailce Smith',shared.id]),code('23514'));
  const bob=(await q("select * from public.hq_training_trainers where lower(name)='bob'"))[0];
  await q('update public.hq_training_trainers set active=false where id=$1',[bob.id]);
  await assert.rejects(()=>addLog('Bob'),code('23514'));
  await assert.rejects(()=>q('update public.hq_training_logs set trainer=$1 where id=$2',['Bob',second.id]),code('23514'));
  const historical=(await q('update public.hq_training_logs set notes=$1 where id=$2 returning *',['Keep the retired name',second.id]))[0];
  assert.equal(historical.trainer,second.trainer);
  assert.equal((await q('select trainer from public.hq_training_logs where id=$1',[retired.id]))[0].trainer,'Retired Person');
  console.log('PASS: new trainer typos and duplicates fail server validation, shared/cached-UI spellings work, and unchanged historical or inactive trainer text remains editable in other cells.');

  await as(null);
  const before=await q('select * from public.hq_training_trainers order by id');
  await db.exec(setup);assert.deepEqual(await q('select * from public.hq_training_trainers order by id'),before);
  assert.equal((await q('select active from public.hq_training_trainers where id=$1',[bob.id]))[0].active,false);
  console.log('PASS: rerunning setup does not reactivate roster entries or duplicate names.');
} catch(error) {
  console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;
} finally {await db.close();}
