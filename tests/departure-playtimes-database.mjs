// Offline PostgreSQL/RLS checks with fictional data only. No Supabase/Gingr calls.
// PAWS_PGLITE_MODULE may name an installed @electric-sql/pglite module.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PAWS_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const migration=await readFile(new URL('../supabase/departure-playtimes-setup.sql',import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const staff=uid(1),guest=uid(2),inactive=uid(3),outsider=uid(4);
let checks=0,request=100;
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const scalar=async(sql,args=[])=> Object.values((await query(sql,args))[0])[0];
const count=table=>scalar(`select count(*)::int from ${table}`);
const code=expected=>error=>error.code===expected;
async function as(role,actor,sql,args=[]) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor||'']);
    if(role)await db.exec(`set local role ${role}`);
    const rows=await query(sql,args);await db.exec('commit');return rows;
  }catch(error){await db.exec('rollback');throw error;}
}
const rpc=async(role,actor,name,args=[])=>Object.values((await as(role,actor,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args))[0])[0];
const day=actor=>rpc('authenticated',actor,'hq_departure_playtimes_day',['1']);
const claim=()=>rpc('service_role',null,'hq_departure_playtimes_claim_refresh',['1']);
const history=actor=>rpc('authenticated',actor,'hq_departure_playtimes_history',['1',60]);
const skip=(actor,key,value,revision,version,id=uid(++request))=>rpc('authenticated',actor,'hq_departure_playtimes_set_skip',[id,key,value,revision,version]);
const note=(actor,key,value,revision,id=uid(++request))=>rpc('authenticated',actor,'hq_departure_playtimes_save_note',[id,key,value,revision]);
async function check(name,run){await run();checks++;console.log(`PASS ${name}`);}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;grant usage on schema auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create table auth.identities(id uuid primary key,user_id uuid references auth.users(id),provider text,identity_data jsonb);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.hq_tour_staff(user_id uuid primary key references auth.users(id) on delete cascade,active boolean not null);
    alter table public.hq_tour_staff enable row level security;grant select on public.hq_tour_staff to authenticated;
    create policy own_membership on public.hq_tour_staff for select to authenticated using(user_id=auth.uid());
    create table public.invoice_sentinel(id int primary key,amount int,status text);
    insert into public.invoice_sentinel values(1,12345,'untouched');`);
  for(const [n,name,active] of [[1,'Fixture Staff',true],[2,'Fixture Guest',true],[3,'Inactive Fixture',false],[4,'Outside Fixture',null]]) {
    await query('insert into auth.users values($1,$2)',[uid(n),JSON.stringify({full_name:'FORGED PROFILE NAME',admin:true})]);
    await query("insert into auth.identities values($1,$1,'slack_oidc',$2)",[uid(n),JSON.stringify({name,is_restricted:n===2})]);
    await query('insert into auth.sessions values($1,$1)',[uid(n)]);
    if(active!==null)await query('insert into public.hq_tour_staff values($1,$2)',[uid(n),active]);
  }
  const authBefore=await query('select * from auth.users order by id'),sessionsBefore=await query('select * from auth.sessions order by id'),membersBefore=await query('select * from public.hq_tour_staff order by user_id');
  const invoiceBefore=await query('select * from public.invoice_sentinel');
  await check('migration installs and reruns without changing accounts, sessions, memberships, invoices, or seeding pets',async()=>{
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual(await query('select * from auth.users order by id'),authBefore);assert.deepEqual(await query('select * from auth.sessions order by id'),sessionsBefore);assert.deepEqual(await query('select * from public.hq_tour_staff order by user_id'),membersBefore);
    assert.equal(await count('hq_departure_private.source_cache'),0);assert.equal(await count('public.hq_departure_playtime_audit'),0);assert.deepEqual(await query('select * from public.invoice_sentinel'),invoiceBefore);
  });
  const today=await scalar("select (clock_timestamp() at time zone 'America/New_York')::date::text");
  const yesterday=await scalar("select ((clock_timestamp() at time zone 'America/New_York')::date-1)::text");
  const version='a'.repeat(64),nextVersion='b'.repeat(64);
  const serviceKey=`1:101:201:551.${today}`,petKey=`departure:1:101:201:${today}`,catKey=`departure:1:102:202:${today}`;
  const makeView=()=>({businessDate:today,locationId:'1',timezone:'America/New_York',fetchedAt:new Date().toISOString(),scheduleVersion:version,sourceComplete:true,
    departures:[{reservationId:'101',animalId:'201',dogName:'Synthetic pet',ownerLast:'Fixture',species:'dog',departureAt:`${today}T20:00:00Z`,checkedOutAt:null,cancelled:false,noteKey:petKey,services:[{key:serviceKey,occurrenceId:`551.${today}`,serviceId:'booked.551',serviceName:'Synthetic booked package',serviceDate:today,quantity:1,verified:false}]},
      {reservationId:'102',animalId:'202',dogName:'Synthetic cat',ownerLast:'Fixture',species:'cat',departureAt:`${today}T21:00:00Z`,checkedOutAt:null,cancelled:false,noteKey:catKey,services:[]}],summary:{pets:999}});
  async function forceDue(){await db.exec("update hq_departure_private.source_cache set fetched_at=clock_timestamp()-interval '61 seconds',retry_after=null,lease_token=null,lease_until=null where location_id='1'");}
  async function publish(view=makeView()) {await forceDue();const lease=await claim();assert.equal(lease.claimed,true);return rpc('service_role',null,'hq_departure_playtimes_publish',['1',lease.leaseToken,JSON.stringify(view)]);}

  await check('anonymous, inactive, unenrolled and direct clients cannot read private source or publish schedules',async()=>{
    for(const actor of [null,inactive,outsider])await assert.rejects(()=>day(actor),code('42501'));
    await assert.rejects(()=>rpc('anon',null,'hq_departure_playtimes_day',['1']),code('42501'));
    await assert.rejects(()=>rpc('authenticated',staff,'hq_departure_playtimes_claim_refresh',['1']),code('42501'));
    await assert.rejects(()=>as('authenticated',staff,'select * from hq_departure_private.source_cache'),code('42501'));
    await assert.rejects(()=>as('service_role',null,'select * from hq_departure_private.source_cache'),code('42501'));
    const empty=await day(staff);assert.equal(empty.source,null);assert.equal(empty.stale,true);assert.equal(empty.refreshDue,true);
  });
  let firstLease;
  await check('one global refresh lease coalesces source reads and clean publication creates no fake services',async()=>{
    firstLease=await claim();assert.equal(firstLease.claimed,true);assert.equal(firstLease.businessDate,today);
    const duplicate=await claim();assert.equal(duplicate.claimed,false);assert.equal(duplicate.refreshing,true);
    const polluted=makeView();polluted.secret='PROVIDER_SECRET_SENTINEL';polluted.departures[0].services[0].note='FAKE_SAMPLE_NOTE';polluted.departures[0].services[0].priceCents=99999;
    const published=await rpc('service_role',null,'hq_departure_playtimes_publish',['1',firstLease.leaseToken,JSON.stringify(polluted)]);assert.equal(published.published,true);
    const current=await day(guest);assert.equal(current.source.summary.pets,2);assert.equal(current.source.summary.dogs,1);assert.equal(current.source.summary.cats,1);assert.equal(current.source.summary.playtimes,1);assert.equal(current.source.departures[1].services.length,0);
    assert.equal(current.source.departures[1].noteKey,catKey);assert.equal(current.source.departures[0].services[0].serviceId,'booked.551');assert.equal(current.source.departures[0].services[0].verified,false);
    assert.equal(current.stale,false);assert.equal(current.refreshDue,false);assert.doesNotMatch(JSON.stringify(current),/PROVIDER_SECRET_SENTINEL|FAKE_SAMPLE_NOTE|priceCents|expectedCharges/);
    assert.equal((await claim()).claimed,false);assert.equal(await count('hq_departure_private.source_cache'),1);assert.equal(await count('hq_departure_private.targets'),3);assert.equal(await count('public.hq_departure_playtime_audit'),0);
  });
  await check('skip and undo are shared, independently revisioned, server attributed and never claim verification',async()=>{
    const skipped=await skip(guest,serviceKey,true,0,version);assert.equal(skipped.service.skipped,true);assert.equal(skipped.service.revision,1);assert.equal(skipped.service.skippedBy.id,guest);assert.equal(skipped.service.skippedBy.name,'Fixture Guest');
    const seen=await day(staff);assert.equal(seen.states[0].skipped,true);assert.equal(seen.source.departures[0].services[0].verified,false);
    const undone=await skip(staff,serviceKey,false,1,version);assert.equal(undone.service.skipped,false);assert.equal(undone.service.revision,2);assert.equal(undone.service.skippedBy,null);
    const events=await history(guest);assert.deepEqual(events.map(e=>e.action),['undo','skip']);assert.equal(events[1].actor.name,'Fixture Guest');assert.doesNotMatch(JSON.stringify(events),/FORGED PROFILE/);
  });
  await check('same UUID retries do not replay older status; cross-actor and cross-kind UUID reuse is rejected',async()=>{
    const id=uid(++request),first=await skip(staff,serviceKey,true,2,version,id);await skip(guest,serviceKey,false,3,version);
    const before=await count('public.hq_departure_playtime_audit'),retried=await skip(staff,serviceKey,true,2,version,id);
    assert.equal(retried.idempotent,true);assert.equal(retried.service.revision,first.service.revision);assert.equal((await day(staff)).states[0].skipped,false);assert.equal(await count('public.hq_departure_playtime_audit'),before);
    await assert.rejects(()=>skip(guest,serviceKey,true,2,version,id),code('23505'));await assert.rejects(()=>note(staff,serviceKey,'same UUID',0,id),code('23505'));
    const size=await scalar("select max(octet_length(result::text))::int from hq_departure_private.action_requests");assert.ok(size<1500,'idempotency results must not duplicate the full source view');
  });
  await check('stale status revisions, source versions, no-service keys and browser table writes are rejected',async()=>{
    await assert.rejects(()=>skip(staff,serviceKey,true,0,version),code('40001'));await assert.rejects(()=>skip(staff,serviceKey,true,4,nextVersion),code('40001'));await assert.rejects(()=>skip(staff,catKey,true,0,version),code('55000'));
    for(const table of ['hq_departure_playtime_overrides','hq_departure_playtime_notes','hq_departure_playtime_audit'])await assert.rejects(()=>as('authenticated',staff,`delete from public.${table}`),code('42501'));
    await assert.rejects(()=>db.exec('delete from public.hq_departure_playtime_audit'),code('42501'));
    for(const actor of [inactive,outsider])assert.equal((await as('authenticated',actor,'select * from public.hq_departure_playtime_audit')).length,0);
  });
  await check('service and no-service cat notes save, clear and normalize without changing skip revisions',async()=>{
    const first=await note(staff,serviceKey,' \r\n2 of 3 completed\r\n ',0);assert.equal(first.service.note,'2 of 3 completed');assert.equal(first.service.noteRevision,1);
    const cat=await note(guest,catKey,'Cat departure context',0);assert.equal(cat.service.noteRevision,1);assert.equal(cat.service.noteUpdatedBy.name,'Fixture Guest');
    const current=await day(staff);assert.equal(current.notes.length,2);assert.equal(current.states[0].revision,4);assert.equal(current.source.summary.playtimes,1);assert.equal(current.source.departures[1].services.length,0);
    await assert.rejects(()=>note(staff,catKey,'stale draft',0),code('40001'));
    const cleared=await note(guest,catKey,'',1);assert.equal(cleared.service.note,'');assert.equal(cleared.service.noteRevision,2);
    const auditBefore=await count('public.hq_departure_playtime_audit');assert.equal((await note(guest,catKey,'',2)).changed,false);assert.equal(await count('public.hq_departure_playtime_audit'),auditBefore);
    await assert.rejects(()=>note(staff,catKey,'x'.repeat(1001),2),code('22023'));await assert.rejects(()=>note(staff,catKey,'bad\u0007control',2),code('22023'));
  });
  await check('source updates retain notes and exceptions while removed services cannot be changed',async()=>{
    const moved=makeView();moved.scheduleVersion=nextVersion;moved.departures[0].departureAt=`${today}T22:00:00Z`;await publish(moved);
    let current=await day(staff);assert.equal(current.notes.find(n=>n.key===serviceKey).note,'2 of 3 completed');assert.equal(current.states[0].revision,4);
    const removed=makeView();removed.scheduleVersion=nextVersion;removed.departures[0].services=[];await publish(removed);
    await assert.rejects(()=>note(staff,serviceKey,'removed',1),code('55000'));await assert.rejects(()=>skip(staff,serviceKey,true,4,nextVersion),code('55000'));
    assert.ok((await history(staff)).some(event=>event.key===serviceKey));await publish();current=await day(staff);assert.equal(current.notes.find(n=>n.key===serviceKey).note,'2 of 3 completed');
  });
  await check('source failures keep last-good data visible but block edits and apply bounded retry backoff',async()=>{
    await forceDue();const lease=await claim();assert.equal((await day(staff)).stale,false);
    const failed=await rpc('service_role',null,'hq_departure_playtimes_fail_refresh',['1',lease.leaseToken,'PROVIDER_SECRET_SENTINEL']);assert.equal(failed.recorded,true);
    const broken=await day(staff);assert.equal(broken.source.summary.playtimes,1);assert.equal(broken.sourceError,'SOURCE_UNAVAILABLE');assert.equal(broken.stale,true);assert.equal(broken.refreshDue,false);
    await assert.rejects(()=>skip(staff,serviceKey,true,4,version),code('55000'));await assert.rejects(()=>note(staff,petKey,'offline',0),code('55000'));assert.equal((await claim()).claimed,false);
    await db.exec("update hq_departure_private.source_cache set retry_after=clock_timestamp()-interval '1 second'");
    const recovery=await claim();assert.equal(recovery.claimed,true);await rpc('service_role',null,'hq_departure_playtimes_publish',['1',recovery.leaseToken,JSON.stringify(makeView())]);assert.equal((await day(staff)).stale,false);
  });
  await check('expired/superseded refreshes cannot overwrite a newer publication or newer failure',async()=>{
    await forceDue();const old=await claim();await db.exec("update hq_departure_private.source_cache set lease_until=clock_timestamp()-interval '1 second'");const newer=await claim();assert.equal(newer.claimed,true);
    assert.equal((await rpc('service_role',null,'hq_departure_playtimes_publish',['1',old.leaseToken,JSON.stringify(makeView())])).published,false);
    const fresh=makeView();fresh.scheduleVersion=nextVersion;await rpc('service_role',null,'hq_departure_playtimes_publish',['1',newer.leaseToken,JSON.stringify(fresh)]);
    assert.equal((await rpc('service_role',null,'hq_departure_playtimes_fail_refresh',['1',old.leaseToken,'SOURCE_UNAVAILABLE'])).recorded,false);assert.equal((await day(staff)).source.scheduleVersion,nextVersion);
  });
  await check('missing fields, reused undated occurrence IDs, future stamps and conflicting keys cannot publish',async()=>{
    for(const mutate of [v=>delete v.scheduleVersion,v=>delete v.departures,v=>v.departures[0].species=null,v=>v.departures[0].services[0].occurrenceId='551',v=>v.departures[0].services[0].verified=true,v=>v.departures[0].services.push({...v.departures[0].services[0]}),v=>v.fetchedAt=new Date(Date.now()+20000).toISOString()]){
      await forceDue();const lease=await claim(),bad=makeView();mutate(bad);await assert.rejects(()=>rpc('service_role',null,'hq_departure_playtimes_publish',['1',lease.leaseToken,JSON.stringify(bad)]));
      assert.equal((await day(staff)).source.scheduleVersion,nextVersion,'a rejected publication rolls back target retirement');
    }
    await publish();
  });
  await check('Eastern day rollover never returns yesterday; old human history remains while source projections stay bounded',async()=>{
    await db.query('update hq_departure_private.source_cache set business_date=$1',[yesterday]);
    const before=await count('public.hq_departure_playtime_audit'),empty=await day(staff);assert.equal(empty.source,null);assert.equal(empty.stale,true);assert.equal(empty.refreshDue,true);
    const lease=await claim();assert.equal(lease.claimed,true);await rpc('service_role',null,'hq_departure_playtimes_publish',['1',lease.leaseToken,JSON.stringify(makeView())]);
    const onlyEmpty=makeView();onlyEmpty.departures=[];await publish(onlyEmpty);assert.equal((await day(guest)).source.summary.pets,0);assert.equal((await day(guest)).stale,false);
    assert.equal(await count('public.hq_departure_playtime_audit'),before);assert.equal(await count('hq_departure_private.source_cache'),1);assert.ok(await count('hq_departure_private.targets')<=3);
    await db.exec(migration);assert.equal(await count('public.hq_departure_playtime_audit'),before);assert.deepEqual(await query('select * from auth.sessions order by id'),sessionsBefore);assert.deepEqual(await query('select * from public.invoice_sentinel'),invoiceBefore);
  });
  console.log(`Departure production database checks PASS: ${checks} offline scenarios; no live calls or deployment.`);
}finally{await db.close();}
