const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {cleanPath,createLogger}=require('../assets/activity-logger.js');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function harness(options={}) {
  const listeners={},auth=[],timers=new Map(),calls=[];let timer=0;
  const state={session:{user:{id:'staff-a'}},allowed:true,failure:false,...options};
  const win={location:{pathname:state.path||'/tours'},addEventListener:(type,fn)=>{listeners[type]=fn;}};
  const doc={hidden:false,addEventListener:(type,fn)=>{listeners[type]=fn;}};
  const client={auth:{getSession:async()=>state.pending||{data:{session:state.session}},onAuthStateChange:fn=>auth.push(fn)},rpc:async(name,body)=>{calls.push({name,body});if(state.failure)throw Error('private details');return {data:true,error:null};}};
  const logger=createLogger({client,win,doc,signIn:state.signIn,ensureAccess:async()=>{if(!state.allowed)throw Error('Access denied');},schedule:fn=>{timers.set(++timer,fn);return timer;},cancel:id=>timers.delete(id)});
  logger.start();
  return {state,win,doc,calls,logger,listeners,timers,auth,async run(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());await flush();},async event(type,event={}){listeners[type]?.(event);await flush();}};
}
test('activity paths omit query strings, OAuth codes and anchors and reject foreign/control paths',()=>{
  assert.equal(cleanPath('/tours.html?code=private#secret'),'/tours');assert.equal(cleanPath('/kb/index.html'),'/kb/');
  assert.equal(cleanPath('/kb/other/Pet%20Care.html'),'/kb/other/Pet Care');
  for(const path of ['https://evil.example/','//evil.example/a','/bad\\path','/bad\u0000path','/%2fexample','/%2e%2e/settings','/%00secret','/bad%3fquery','/bad%zz'])assert.equal(cleanPath(path),'');
});
test('only the authenticated canonical page/action are sent and repeated visibility does not duplicate them',async()=>{
  const h=harness({path:'/tours.html?customer=private#secret'});assert.equal(h.calls.length,0);await h.run();
  assert.deepEqual(h.calls,[{name:'hq_activity_record_visit',body:{p_path:'/tours',p_action:'page_view'}}]);
  await h.event('visibilitychange');await h.run();await h.logger.record('page_view');assert.equal(h.calls.length,1);
  assert.ok(!JSON.stringify(h.calls).includes('private'));assert.ok(!JSON.stringify(h.calls).includes('staff-a'));
});
test('ordinary persisted sessions never produce sign-in events; OAuth returns may do so',async()=>{
  const ordinary=harness();await ordinary.run();assert.equal(ordinary.calls.filter(c=>c.body.p_action==='sign_in').length,0);
  const returned=harness({signIn:true});await returned.run();assert.deepEqual(returned.calls.map(c=>c.body.p_action).sort(),['page_view','sign_in']);
});
test('anonymous, denied, hidden and utility pages do not write history',async()=>{
  for(const config of [{session:null},{allowed:false},{path:'/login'},{path:'/404.html'},{path:'/report-loading'}]){const h=harness(config);await h.run();assert.equal(h.calls.length,0);}
  const hidden=harness();hidden.doc.hidden=true;await hidden.run();assert.equal(hidden.calls.length,0);hidden.doc.hidden=false;await hidden.event('visibilitychange');await hidden.run();assert.equal(hidden.calls.length,1);
});
test('revocation and page exit suppress pending writes; restoration rechecks access',async()=>{
  const pending=deferred(),h=harness({pending:pending.promise});await h.run();await h.event('paws-access-revoked');pending.resolve({data:{session:h.state.session}});await flush();assert.equal(h.calls.length,0);
  h.state.pending=null;await h.event('paws-access-restored');await h.run();assert.equal(h.calls.length,1);
  const exited=harness();await exited.event('pagehide');await exited.run();assert.equal(exited.calls.length,0);
  await exited.event('pageshow',{persisted:true});await exited.run();assert.equal(exited.calls.length,1);
});
test('unavailable logging stays silent and a changed identity gets a fresh self-attributed event',async()=>{
  const h=harness({failure:true});await h.run();assert.equal(h.calls.length,1);h.state.failure=false;await h.event('visibilitychange');await h.run();assert.equal(h.calls.length,2);
  h.state.session={user:{id:'staff-b'}};h.auth[0]('SIGNED_IN',h.state.session);await h.run();assert.equal(h.calls.length,3);
  assert.ok(h.calls.every(c=>Object.keys(c.body).sort().join(',')==='p_action,p_path'));
});
test('shared logging never creates another auth client or changes sessions or storage',()=>{
  const source=fs.readFileSync(require.resolve('../assets/activity-logger.js'),'utf8');
  for(const forbidden of ['createClient','signOut(','localStorage','sessionStorage','access_token:','p_user_id'])assert.ok(!source.includes(forbidden),forbidden);
  const shared=fs.readFileSync(require.resolve('../script.js'),'utf8');assert.ok(shared.includes("loadHqSharedScript('/assets/activity-logger.js'"));
});
