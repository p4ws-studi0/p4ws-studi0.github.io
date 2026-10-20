// Install @electric-sql/pglite or set PAWS_PGLITE_MODULE to its absolute entry point.
const {PGlite}=await import(process.env.PAWS_PGLITE_MODULE||'@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(),repo=new URL('../supabase/',import.meta.url);
const readSQL=name=>fs.readFileSync(new URL(name,repo),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema vault;
create table auth.users(id uuid primary key);create table auth.identities(id uuid primary key,user_id uuid references auth.users,provider text,identity_data jsonb);
create table auth.sessions(id uuid primary key,user_id uuid);create table public.hq_tour_staff(user_id uuid primary key references auth.users,active boolean not null default true);
create table vault.secrets(name text primary key,decrypted_secret text);create view vault.decrypted_secrets as select * from vault.secrets;insert into vault.secrets values('hq_slack_access_sync_trigger',repeat('a',64));`);
let old=readSQL('slack-access-sync-setup.sql').replace(/^create extension[^\n]+\n/gm,'').replace(/do \$\$[\s\S]*?\$\$;/,'').replace(/select cron\.schedule\([\s\S]*?\$cron\$\);/,'');
await db.exec(old);
for(let i=0;i<2;i++){await db.exec(readSQL('workspace-access-setup.sql'));await db.exec(readSQL('workspace-access-sync.sql'));}
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),team='T02QW28SR39';
const one=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
async function account(n,sid,workspace=team,approval=null){await db.query('insert into auth.users values($1)',[uid(n)]);await db.query("insert into auth.identities values($1,$1,'slack_oidc',$2)",[uid(n),JSON.stringify({sub:sid,custom_claims:{'https://slack.com/team_id':workspace},is_restricted:true})]);await db.query('insert into auth.sessions values($1,$1)',[uid(n)]);if(approval!==null)await db.query('insert into public.hq_tour_staff values($1,$2)',[uid(n),approval]);}
await account(1,'UACTIVE',team,true);await account(2,'UNEWGUEST');await account(3,'UDELETED',team,false);await account(4,'UUNKNOWN');await account(5,'UFOREIGN','TOTHER');
const sessions=await one("select md5(string_agg(id::text,',' order by id)) from auth.sessions");
const apply=(n,sid,deleted,checked=new Date().toISOString(),workspace=team)=>one('select public.hq_workspace_access_apply($1,$2,$3,$4,$5)',[uid(n),sid,workspace,deleted,checked]);
let a=await apply(2,'UNEWGUEST',false);assert.equal(a.status,'enrolled');assert.equal(a.allowed,true);assert.equal((await apply(2,'UNEWGUEST',false)).changed,false);
await assert.rejects(()=>apply(5,'UFOREIGN',false,new Date().toISOString(),'TOTHER'),/Invalid verified membership/);
await assert.rejects(()=>apply(4,'USPOOF',false),/identity changed or is unverified/);
await db.query('delete from public.hq_tour_staff where user_id=$1',[uid(2)]);
assert.equal((await one('select public.hq_slack_sync_candidates($1)',[team])).length,4);
assert.equal((await one('select public.hq_slack_sync_candidates($1)',[team])).find(x=>x.user_id===uid(2)).staff_active,false);
let run=90;const start=async()=>{const id=uid(run++);assert.equal((await one('select public.hq_slack_sync_start($1,clock_timestamp(),$2)',[id,team])).accepted,true);return id;};
const finish=(id,results)=>one('select public.hq_slack_sync_finish($1,$2)',[id,JSON.stringify(results)]);
const rows=[{user_id:uid(1),slack_user_id:'UACTIVE',status:'active'},{user_id:uid(2),slack_user_id:'UNEWGUEST',status:'active'},{user_id:uid(3),slack_user_id:'UDELETED',status:'deactivated'},{user_id:uid(4),slack_user_id:'UUNKNOWN',status:'unknown'}];
await db.exec('update hq_access_private.slack_sync_control set enabled=true,dry_run=true');
let r=await start();assert.deepEqual(await finish(r,rows),{status:'dry_run',changed:0,enrolled:0});assert.equal(await one('select count(*)::integer from public.hq_tour_staff where user_id=$1',[uid(2)]),0);
await db.exec('update hq_access_private.slack_sync_control set dry_run=false');r=await start();assert.deepEqual(await finish(r,rows),{status:'applied',changed:0,enrolled:1});assert.equal(await one('select active from public.hq_tour_staff where user_id=$1',[uid(2)]),true);assert.equal(await one('select active from public.hq_tour_staff where user_id=$1',[uid(3)]),false);assert.equal(await one('select count(*)::integer from public.hq_tour_staff where user_id=$1',[uid(4)]),0);
const stamp=new Date().toISOString();assert.equal((await apply(3,'UDELETED',false)).status,'reactivated');assert.equal((await apply(3,'UDELETED',true)).status,'revoked');assert.equal((await apply(3,'UDELETED',false,stamp)).status,'superseded');assert.equal(await one('select active from public.hq_tour_staff where user_id=$1',[uid(3)]),false);
// Four already-revoked accounts do not trip the new-revocation cap.
for(let n=6;n<=8;n++)await account(n,'UOLD'+n,team,false);
await db.query('delete from public.hq_tour_staff where user_id=$1',[uid(2)]);
const oldRows=[...rows,...[6,7,8].map(n=>({user_id:uid(n),slack_user_id:'UOLD'+n,status:'deactivated'}))];
r=await start();assert.deepEqual(await finish(r,oldRows),{status:'applied',changed:0,enrolled:1});
// Provider changes block the entire result batch.
r=await start();await db.query("update auth.identities set identity_data=jsonb_set(identity_data,'{sub}','\"UCHANGED\"') where user_id=$1",[uid(2)]);assert.deepEqual(await finish(r,oldRows),{status:'blocked',changed:0,enrolled:0});
// Browser roles cannot call enrollment or inspect private verification state.
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>apply(1,'UACTIVE',false),/permission denied/);await assert.rejects(()=>db.query('select * from hq_access_private.workspace_access_state'),/permission denied/);await db.exec('reset role');}
assert.equal(await one("select md5(string_agg(id::text,',' order by id)) from auth.sessions where user_id in ($1,$2,$3,$4,$5)",[1,2,3,4,5].map(uid)),sessions);
console.log('PGlite workspace checks PASS: idempotence, shared guest enrollment, no foreign/spoofed identity, dry run, missing/inactive population, verified backfill/reactivation, deactivation, stale-response guard, historical-deactivation cap, identity recheck, private RPC/state, unchanged original sessions.');await db.close();
