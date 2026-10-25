// Synthetic in-memory PostgreSQL tests. No production data, tokens or network.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {PGlite}=await import(process.env.PAWS_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const repo=fileURLToPath(new URL('../',import.meta.url));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const team='T02QW28SR39';
const read=name=>readFile(`${repo}/supabase/${name}`,'utf8');
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const snapshot=async()=>{
 const tables=['auth.users','auth.identities','auth.sessions','auth.refresh_tokens','public.hq_tour_staff','hq_access_private.workspace_access_state','hq_access_private.workspace_access_audit','hq_access_private.slack_sync_revocations','public.hq_activity_history','public.hq_end_of_day','hq_access_private.slack_sync_control','cron.job'];
 return Object.fromEntries(await Promise.all(tables.map(async table=>[table,await query(`select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) as data from ${table} t`)])));
};
const results=(statuses=['active','deactivated','active'])=>[A,B,C].map((id,i)=>({user_id:id,slack_user_id:['UA','UB','UC'][i],status:statuses[i]}));
const start=async()=>{
 const id=(await query('select gen_random_uuid() as id'))[0].id;
 const data=(await query('select public.hq_slack_sync_start($1,clock_timestamp(),$2) as data',[id,team]))[0].data;
 assert.equal(data.accepted,true);return{id,data};
};
const finish=async(id,statuses)=> (await query('select public.hq_slack_sync_finish($1,$2::jsonb) as data',[id,JSON.stringify(results(statuses))]))[0].data;
const run=async id=>(await query('select * from hq_access_private.slack_sync_runs where run_id=$1',[id]))[0];
const maintain=async(limit=1000)=>(await query('select hq_access_private.maintain_slack_sync_diagnostics($1) as data',[limit]))[0].data;
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create schema extensions;create schema vault;create schema cron;
 create table auth.users(id uuid primary key,email text);create table auth.identities(id uuid primary key,user_id uuid references auth.users(id),provider text,identity_data jsonb);
 create table auth.sessions(id uuid primary key,user_id uuid);create table auth.refresh_tokens(id bigint primary key,user_id text,token text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,secret text);
 create view vault.decrypted_secrets as select name,secret as decrypted_secret from vault.secrets;
 insert into vault.secrets(name,secret) values('hq_slack_access_sync_trigger',repeat('a',64));
 create function vault.create_secret(secret text,name text,description text) returns uuid language sql as $$select gen_random_uuid()$$;
 create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true);
 create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$declare n bigint;begin insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid into n;return n;end$$;
 insert into auth.users values('${A}','a@fixture.invalid'),('${B}','b@fixture.invalid'),('${C}','c@fixture.invalid');
 insert into auth.identities select gen_random_uuid(),id,'slack_oidc',jsonb_build_object('sub',slack,'provider_id',slack,'custom_claims',jsonb_build_object('https://slack.com/team_id','${team}')) from (values('${A}'::uuid,'UA'),('${B}'::uuid,'UB'),('${C}'::uuid,'UC')) t(id,slack);
 insert into auth.sessions values(gen_random_uuid(),'${A}');insert into auth.refresh_tokens values(1,'${A}','synthetic-token');
 create table public.hq_activity_history(id integer primary key,payload text);insert into public.hq_activity_history values(1,'Synthetic business history');
 create table public.hq_end_of_day(id integer primary key,payload text);insert into public.hq_end_of_day values(1,'Synthetic closing');`);
 await db.exec(await read('tours-setup.sql'));
 await db.exec((await read('slack-access-sync-setup.sql')).replace(/^create extension[^\n]+\n/gm,''));
 await db.exec(await read('workspace-access-setup.sql'));
 await db.exec(await read('workspace-access-sync.sql'));
 await db.query('insert into public.hq_tour_staff(user_id) values($1),($2)',[A,B]);
 await db.exec('update hq_access_private.slack_sync_control set enabled=true,dry_run=true;');

 const legacy={};
 for(const [name,status,days]of[['normalOld','unchanged',8],['failedOld','error',31],['failedRecent','error',20],['normalRecent','unchanged',1],['auditParent','applied',45]]){
  const id=(await query(`insert into hq_access_private.slack_sync_runs(run_id,requested_at,started_at,completed_at,team_id,dry_run,status,candidates,results,changed,error_code)
   values(gen_random_uuid(),clock_timestamp()-$1::int*interval '1 day',clock_timestamp()-$1::int*interval '1 day',clock_timestamp()-$1::int*interval '1 day',$2,false,$3,
   public.hq_slack_sync_candidates($2),$4::jsonb,$5,$6) returning run_id`,[days,team,status,JSON.stringify(results()),name==='auditParent'?1:0,status==='error'?'SLACK_UNAVAILABLE':null]))[0].run_id;
  legacy[name]=id;
 }
 await db.query(`insert into hq_access_private.slack_sync_revocations(run_id,user_id,slack_user_id,team_id) values($1,$2,'UB',$3)`,[legacy.auditParent,B,team]);
 const originalLegacy=await query('select * from hq_access_private.slack_sync_runs order by run_id');
 const unaffected=await snapshot();
 const setup=await read('slack-sync-retention-setup.sql');
 await db.exec(setup);await db.exec(setup);
 for(const old of originalLegacy){const fresh=await run(old.run_id);for(const key of Object.keys(old))assert.deepEqual(fresh[key],old[key],`install changed existing ${key}`);}
 assert.deepEqual(await snapshot(),unaffected);
 assert.deepEqual(await maintain(),{enabled:false,compacted:0,pruned:0});
 const preview=await db.exec(await read('slack-sync-retention-preview.sql'));
 assert.equal(Number(preview[0].rows[0].total_runs),5);
 assert.equal(Number(preview[0].rows[0].expired_summary_rows_to_prune),2);
 assert.equal(Number(preview[0].rows[0].retained_completed_payloads_to_compact),3);
 assert.equal(preview[2].rows.length,1);assert.equal(preview[3].rows[0].schedule,'*/5 * * * *');
 console.log('PASS: rerunnable install leaves all old payloads, Auth/session/member/audit/business data and five-minute Cron unchanged; retention disabled.');

 let request=await start();assert.equal((await run(request.id)).candidates.length,3);
 assert.equal((await query('select public.hq_slack_sync_start($1,clock_timestamp(),$2) as data',[request.id,team]))[0].data.reason,'replay');
 const busy=await query('select public.hq_slack_sync_start(gen_random_uuid(),clock_timestamp(),$1) as data',[team]);assert.equal(busy[0].data.reason,'busy');
 await assert.rejects(()=>query('select public.hq_slack_sync_finish($1,$2::jsonb)',[request.id,JSON.stringify(results().slice(0,2))]),e=>e.code==='22023');
 assert.equal((await run(request.id)).candidates.length,3);
 assert.equal((await finish(request.id)).status,'dry_run');
 let summary=await run(request.id);
 assert.deepEqual(summary.candidates,[]);assert.deepEqual(summary.results,[]);
 assert.equal(summary.candidate_count,3);assert.equal(summary.checked_count,3);assert.equal(summary.active_count,2);assert.equal(summary.deactivated_count,1);assert.equal(summary.unknown_count,0);
 assert.equal((await query('select active from public.hq_tour_staff where user_id=$1',[B]))[0].active,true);
 await db.exec('update hq_access_private.slack_sync_control set dry_run=false;');
 request=await start();const applied=await finish(request.id);assert.equal(applied.status,'applied');assert.equal(applied.changed,1);assert.equal(applied.enrolled,1);
 assert.equal((await query('select active from public.hq_tour_staff where user_id=$1',[B]))[0].active,false);
 assert.equal((await query('select active from public.hq_tour_staff where user_id=$1',[C]))[0].active,true);
 summary=await run(request.id);assert.deepEqual(summary.candidates,[]);assert.deepEqual(summary.results,[]);assert.equal(summary.changed,1);assert.equal(summary.enrolled,1);
 console.log('PASS: real dry-run/verified revocation/enrollment behavior, pending snapshot, replay/busy/malformed protections unchanged; completed diagnostics contain counts only.');

 request=await start();assert.equal((await finish(request.id,['active','unknown','active'])).status,'unchanged');assert.equal((await run(request.id)).unknown_count,1);
 request=await start();await db.exec('update hq_access_private.slack_sync_control set enabled=false;');
 assert.equal((await finish(request.id)).status,'disabled');assert.deepEqual((await run(request.id)).candidates,[]);assert.equal((await run(request.id)).checked_count,null);
 await db.exec('update hq_access_private.slack_sync_control set enabled=true;');
 request=await start();await query("select public.hq_slack_sync_fail($1,'unknown unsafe detail')",[request.id]);
 assert.deepEqual((await run(request.id)).candidates,[]);assert.equal((await run(request.id)).error_code,'SYNC_UNAVAILABLE');assert.equal((await run(request.id)).checked_count,null);
 request=await start();await query("update hq_access_private.slack_sync_runs set started_at=clock_timestamp()-interval '3 minutes' where run_id=$1",[request.id]);
 const abandoned=request.id;request=await start();assert.equal((await run(abandoned)).error_code,'ABANDONED_RUN');assert.deepEqual((await run(abandoned)).candidates,[]);
 await finish(request.id,['active','unknown','active']);
 await db.query('update public.hq_tour_staff set active=true where user_id=$1',[B]);
 await db.exec('update hq_access_private.slack_sync_control set max_revocations=1;');
 request=await start();const membersBefore=await query('select * from public.hq_tour_staff order by user_id');
 assert.equal((await finish(request.id,['active','deactivated','deactivated'])).status,'blocked');assert.deepEqual(await query('select * from public.hq_tour_staff order by user_id'),membersBefore);assert.deepEqual((await run(request.id)).results,[]);
 request=await start();assert.equal((await finish(request.id,['deactivated','deactivated','deactivated'])).status,'blocked');assert.deepEqual(await query('select * from public.hq_tour_staff order by user_id'),membersBefore);
 request=await start();await query("update auth.identities set identity_data=jsonb_set(identity_data,'{sub}','\"UCHANGED\"'::jsonb) where user_id=$1",[B]);
 assert.equal((await finish(request.id)).status,'blocked');assert.deepEqual(await query('select * from public.hq_tour_staff order by user_id'),membersBefore);
 await query("update auth.identities set identity_data=jsonb_set(identity_data,'{sub}','\"UB\"'::jsonb) where user_id=$1",[B]);
 console.log('PASS: unknown/disabled/failure/abandoned/safety-limit/zero-active/identity-race branches preserve existing access decisions and compact all terminal outcomes.');

 // Prove summary failure cannot retain full JSON or break a valid membership check.
 await db.exec(`create or replace function hq_access_private.slack_sync_run_summary(r hq_access_private.slack_sync_runs) returns hq_access_private.slack_sync_runs language plpgsql immutable set search_path='' as $$begin raise exception 'Synthetic summary unavailable';end;$$;`);
 request=await start();assert.equal((await finish(request.id,['active','unknown','active'])).status,'unchanged');
 summary=await run(request.id);assert.deepEqual(summary.candidates,[]);assert.deepEqual(summary.results,[]);assert.equal(summary.checked_count,null);assert.equal(summary.candidate_count,3);
 await db.exec(setup);

 // Approval boundary: only this separate activation file may remove old details.
 request=await start();const pending=await run(request.id);const beforeCleanup=await snapshot();
 await db.exec(await read('slack-sync-retention-activate.sql'));
 assert.deepEqual(await snapshot(),beforeCleanup);
 assert.deepEqual(await run(request.id),pending,'cleanup changed a running verification snapshot');
 assert.equal(await run(legacy.normalOld),undefined);assert.equal(await run(legacy.failedOld),undefined);
 for(const key of ['normalRecent','failedRecent','auditParent']){const row=await run(legacy[key]);assert.ok(row);assert.deepEqual(row.candidates,[]);assert.deepEqual(row.results,[]);assert.equal(row.checked_count,3);}
 assert.equal((await run(legacy.auditParent)).changed,1);
 assert.equal((await finish(request.id,['active','unknown','active'])).status,'unchanged');
 console.log('PASS: explicit activation prunes only expired unreferenced diagnostics, compacts retained payloads, preserves failed 30-day window/FK parents/running work and all unrelated data.');

 // A future unrecognized FK must prevent deletion normally, while the start
 // RPC still returns its full snapshot and the membership check can finish.
 await db.exec('begin;');
 const protectedByNewFK=(await query(`insert into hq_access_private.slack_sync_runs(run_id,requested_at,started_at,completed_at,team_id,dry_run,status,candidates,results)
 values(gen_random_uuid(),clock_timestamp()-interval '20 days',clock_timestamp()-interval '20 days',clock_timestamp()-interval '20 days',$1,false,'unchanged','[]','[]') returning run_id`,[team]))[0].run_id;
 await db.exec('create table hq_access_private.synthetic_new_reference(run_id uuid references hq_access_private.slack_sync_runs(run_id));');
 await db.query('insert into hq_access_private.synthetic_new_reference values($1)',[protectedByNewFK]);
 request=await start();assert.equal((await run(request.id)).candidates.length,3);assert.ok(await run(protectedByNewFK));
 assert.equal((await finish(request.id,['active','unknown','active'])).status,'unchanged');await db.exec('rollback;');
 for(const bad of [0,1001,null])await assert.rejects(()=>maintain(bad),e=>e.code==='22023');

 // Bound cleanup work and test the latest expired summary protection in rollback fixtures.
 await db.exec('begin;');
 await db.exec(`insert into hq_access_private.slack_sync_runs(run_id,requested_at,started_at,completed_at,team_id,dry_run,status,candidates,results)
 select gen_random_uuid(),clock_timestamp()-interval '20 days',clock_timestamp()-interval '20 days',clock_timestamp()-interval '20 days','${team}',false,'unchanged','[]','[]' from generate_series(1,1001);`);
 assert.equal((await maintain()).pruned,1000);assert.equal((await maintain()).pruned,1);await db.exec('rollback;');
 await db.exec('begin;');
 await db.exec("update hq_access_private.slack_sync_runs set started_at=clock_timestamp()-interval '60 days',completed_at=clock_timestamp()-interval '60 days' where status<>'running';");
 const latest=(await query(`insert into hq_access_private.slack_sync_runs(run_id,requested_at,started_at,completed_at,team_id,dry_run,status,candidates,results)
 values(gen_random_uuid(),clock_timestamp()-interval '40 days',clock_timestamp()-interval '40 days',clock_timestamp()-interval '40 days',$1,false,'unchanged','[]','[]') returning run_id`,[team]))[0].run_id;
 await maintain();assert.ok(await run(latest));assert.ok(await run(legacy.auditParent));await db.exec('rollback;');
 for(const role of ['anon','authenticated','service_role']){
  const acl=(await query("select has_function_privilege($1,'hq_access_private.maintain_slack_sync_diagnostics(integer)','execute') as allowed",[role]))[0];assert.equal(acl.allowed,false);
 }
 const finalState=await snapshot();await db.exec(setup);assert.deepEqual(await snapshot(),finalState);
 assert.equal((await query('select enabled from hq_access_private.slack_sync_retention'))[0].enabled,true);
 console.log('PASS: 1000-row batch cap, expired latest-run/FK protection, private helper ACLs and activation-preserving reruns.');
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code,position:error.position,where:error.where}));process.exitCode=1;}
finally{await db.close();}
