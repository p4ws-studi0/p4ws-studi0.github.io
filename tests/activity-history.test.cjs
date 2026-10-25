/* Read-only History behavior, using synthetic records and a Supabase-shaped fixture. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'history.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/activity-history.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/activity-history.css'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const record=(id=1,extra={})=>({id:String(id),occurred_at:'2026-10-25T14:30:00Z',actor_name:'Fixture Member',action:'update',section:'end-of-day',record_label:'Oct 25, 2026',changed_fields:['notes'],page_path:null,...extra});
function deferred(){let resolve;const promise=new Promise(fn=>{resolve=fn;});return {promise,resolve};}
async function until(check){for(let i=0;i<500&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
function environment({records=[record()],session={user:{id:'fixture-user'}},accessError=null,intercept=null,info={started_at:'2026-10-25T12:00:00Z',version:1,best_effort:true},now='2026-10-25T16:00:00Z'}={}){
  const api={records:clone(records),session,accessError,intercept,info,calls:[],accessCalls:[],callbacks:[],authError:null};
  const nodes=new Map(),timers=new Map();let timer=0;
  function eventTarget(extra={}){return {...extra,events:{},addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);}};}
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    assert.ok(!nodes.has(match[1]),'unique HTML IDs');
    nodes.set(match[1],eventTarget({id:match[1],hidden:/\bhidden\b/.test(match[0]),disabled:/\bdisabled\b/.test(match[0]),value:match[1]==='historyAction'?'all':match[1]==='historyPeriod'?'7':'',textContent:'',innerHTML:''}));
  }
  const document=eventTarget({readyState:'loading',hidden:false,getElementById:id=>nodes.get(id)}),window=eventTarget();
  async function complete(call){
    api.calls.push(clone(call));
    const intercepted=api.intercept?.(call,api);if(intercepted!==undefined)return intercepted;
    if(call.op==='rpc')return {data:clone(api.info),error:null};
    assert.equal(call.table,'hq_activity_history');
    let rows=api.records.filter(row=>call.filters.every(([op,key,value])=>op==='lt'?BigInt(row[key])<BigInt(value):op==='gte'?row[key]>=value:row[key]===value));
    rows.sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:BigInt(a.id)<BigInt(b.id)?1:0);
    return {data:clone(rows.slice(0,call.limit)),error:null};
  }
  const client={auth:{async getSession(){return {data:{session:api.session},error:api.authError};},onAuthStateChange(fn){api.callbacks.push(fn);}},rpc(name){return complete({op:'rpc',name});},from(table){
    const call={op:'select',table,filters:[]};let pending;
    const chain={select(columns){call.columns=columns;return chain;},order(key,options){call.order=[key,options];return chain;},limit(value){call.limit=value;return chain;},lt(key,value){call.filters.push(['lt',key,value]);return chain;},gte(key,value){call.filters.push(['gte',key,value]);return chain;},eq(key,value){call.filters.push(['eq',key,value]);return chain;},or(value){call.or=value;return chain;},then(resolve,reject){pending||=complete(call);return pending.then(resolve,reject);}};
    return chain;
  }};
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({document,window,supabaseClient:client,ensureHqWorkspaceAccess:async session=>{api.accessCalls.push(session.user.id);if(api.accessError)throw api.accessError;return {allowed:true};},Date:TestDate,Intl,console,setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
  const marker="  if(document.readyState==='loading')";assert.equal(source.split(marker).length,2);
  vm.runInContext(source.replace(marker,`  window.hooks={state,init,load,resetAuth,searchFilter,periodStart,rowHtml,recordId};\n${marker}`),context);
  const app=window.hooks,get=id=>nodes.get(id);
  return {app,api,nodes,get,document,window,timers,async start(){app.init();await until(()=>!app.state.loading);},async change(id,value){get(id).value=value;await get(id).emit(id==='historySearch'?'input':'change');},async flush(delay){for(const [id,entry]of [...timers])if(delay===undefined||entry.delay===delay){timers.delete(id);entry.fn();}await until(()=>!app.state.loading);},signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},signIn(id){api.session={user:{id}};for(const fn of api.callbacks)fn('SIGNED_IN',api.session);}};
}
test('History is a read-only Settings page with accessible filters, simple columns and no write controls',()=>{
  assert.match(html,/href="\/settings"/);assert.match(html,/<h1>History<\/h1>/);
  for(const label of ['Who','Action','Item / Page','When'])assert.ok(html.includes(`>${label}</th>`));
  assert.match(html,/historyPeriod[\s\S]*value="7" selected>Last 7 days/);
  assert.match(html,/script\.js\?v=20261025a/);assert.doesNotMatch(html,/id="footer"/);
  assert.doesNotMatch(source,/\.(?:insert|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(html,/>\s*(?:Add row|Delete|Edit|Restore)\s*<\/button>/);
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/var\(--tr-text\)/);
});
test('each History read verifies the session and workspace; defaults to trailing seven Eastern calendar days',async()=>{
  const h=environment();await h.start();
  assert.equal(h.api.accessCalls.length,1);
  const call=h.api.calls.find(call=>call.op==='select');
  assert.equal(call.table,'hq_activity_history');assert.equal(call.limit,50);assert.deepEqual(call.order,['id',{ascending:false}]);
  assert.deepEqual(call.filters,[['gte','occurred_at','2026-10-19T04:00:00.000Z']]);
  assert.equal(call.columns,'id,occurred_at,actor_name,action,section,record_label,changed_fields,page_path');
  assert.equal(h.get('historySearch').disabled,false);assert.match(h.get('historyRows').innerHTML,/Fixture Member/);
  await h.app.load();assert.equal(h.api.accessCalls.length,2);
});
test('anonymous, revoked and unavailable workspace checks never query the table',async()=>{
  for(const options of [{session:null},{accessError:{code:'ACCESS'}},{accessError:{code:'UNAVAILABLE'}}]){
    const h=environment(options);await h.start();assert.equal(h.api.calls.length,0);assert.equal(h.get('historyRows').innerHTML,'');assert.equal(h.get('historySearch').disabled,true);assert.equal(h.get('historyMessage').hidden,false);
  }
});
test('date filters use local calendar boundaries across DST instead of subtracting 24-hour days',()=>{
  const h=environment();
  assert.equal(h.app.periodStart('today',new Date('2026-11-01T18:00:00Z')),'2026-11-01T04:00:00.000Z');
  assert.equal(h.app.periodStart('7',new Date('2026-11-03T18:00:00Z')),'2026-10-28T04:00:00.000Z');
  assert.equal(h.app.periodStart('today',new Date('2026-11-03T18:00:00Z')),'2026-11-03T05:00:00.000Z');
  assert.equal(h.app.periodStart('30',new Date('2026-03-15T16:00:00Z')),'2026-02-14T05:00:00.000Z');
  assert.equal(h.app.periodStart('all'),null);
});
test('action and date filters are applied server-side and reset cursor, without an unnecessary user tier',async()=>{
  const h=environment({records:[record(1),record(2,{action:'create'})]});await h.start();
  await h.change('historyAction','create');await until(()=>!h.app.state.loading);
  assert.equal(h.app.state.rows.length,1);assert.equal(h.app.state.rows[0].id,'2');
  await h.change('historyPeriod','all');await until(()=>!h.app.state.loading);
  const call=h.api.calls.filter(call=>call.op==='select').at(-1);assert.deepEqual(call.filters,[['eq','action','create']]);
  assert.ok(h.api.calls.every(call=>call.op==='rpc'||call.table==='hq_activity_history'));
});
test('search is debounced server-side and quotes grammar punctuation while treating wildcard characters literally',async()=>{
  const h=environment();await h.start();const before=h.api.calls.length;
  await h.change('historySearch','  Doe, ("A") \\ 50%_  ');assert.equal(h.api.calls.length,before);assert.equal(h.get('historyRows').innerHTML,'');
  await h.flush(220);
  const call=h.api.calls.filter(call=>call.op==='select').at(-1),filter=call.or;
  assert.equal(filter,h.app.searchFilter('Doe, ("A") \\ 50%_'));
  assert.equal((filter.match(/\.ilike\./g)||[]).length,3);
  assert.ok(filter.includes('\\"A\\"'));assert.ok(filter.includes('\\\\%'));assert.ok(filter.includes('\\\\_'));assert.ok(filter.includes('\\\\\\\\'));
  assert.equal(h.app.searchFilter('\n\t '),'');
  assert.doesNotMatch(h.app.searchFilter('a\u0000b'),/\u0000/);
});
test('stable ID cursor pages 50 at a time and preserves large decimal string IDs',async()=>{
  const records=Array.from({length:75},(_,i)=>record(String(9007199254740992000n+BigInt(i))));
  const h=environment({records});await h.start();assert.equal(h.app.state.rows.length,50);assert.equal(h.app.state.hasMore,true);
  const cursor=h.app.state.cursor;assert.equal(cursor,'9007199254740992025');
  await h.app.load({append:true});assert.equal(h.app.state.rows.length,75);assert.equal(h.app.state.hasMore,false);
  assert.equal(h.app.state.rows[0].id,'9007199254740992074');assert.equal(h.app.state.rows.at(-1).id,'9007199254740992000');
  const call=h.api.calls.filter(call=>call.op==='select').at(-1);assert.ok(call.filters.some(filter=>filter[0]==='lt'&&filter[1]==='id'&&filter[2]===cursor));
  assert.equal(h.api.accessCalls.length,2);
});
test('duplicate IDs across responses are merged and duplicate Load more clicks do not start extra queries',async()=>{
  const records=Array.from({length:52},(_,i)=>record(i+1)),gate=deferred();let held=false;
  const h=environment({records,intercept(call){if(call.op==='select'&&call.filters.some(filter=>filter[0]==='lt')){held=true;return gate.promise;}}});await h.start();
  const pending=h.app.load({append:true});await until(()=>held);await h.app.load({append:true});
  gate.resolve({data:[record(3),record(2),record(1)],error:null});await pending;
  assert.equal(h.app.state.rows.length,52);assert.equal(new Set(h.app.state.rows.map(row=>row.id)).size,52);
  assert.equal(h.api.calls.filter(call=>call.op==='select').length,2);
});
test('an older filter response cannot replace the latest filter results',async()=>{
  const gate=deferred();let held=false;
  const h=environment({intercept(call){if(call.op==='select'&&call.filters.some(filter=>filter[2]==='create')){held=true;return gate.promise;}}});await h.start();
  await h.change('historyAction','create');await until(()=>held);
  await h.change('historyAction','all');await until(()=>!h.app.state.loading);assert.equal(h.app.state.rows[0].id,'1');
  gate.resolve({data:[record(999,{record_label:'STALE PRIVATE ROW'})],error:null});await Promise.resolve();await Promise.resolve();
  assert.doesNotMatch(h.get('historyRows').innerHTML,/STALE PRIVATE ROW/);assert.equal(h.app.state.rows[0].id,'1');
});
test('search invalidates an in-flight response immediately, before the debounce starts its next request',async()=>{
  const gate=deferred();let held=false;
  const h=environment();await h.start();h.api.intercept=call=>{if(call.op==='select'){held=true;return gate.promise;}};
  const pending=h.app.load();await until(()=>held);await h.change('historySearch','new query');
  gate.resolve({data:[record(99,{record_label:'OLD RESULT'})],error:null});await pending;
  assert.equal(h.get('historyRows').innerHTML,'');assert.equal(h.app.state.loading,true);
  h.api.intercept=null;await h.flush(220);assert.doesNotMatch(h.get('historyRows').innerHTML,/OLD RESULT/);
});
test('metadata shows the real start date, with no implied historical backfill',async()=>{
  const h=environment();await h.start();assert.equal(h.get('historyCoverage').textContent,'History starts Oct 25, 2026. Earlier activity isn’t included.');
  assert.equal(h.api.calls.filter(call=>call.op==='rpc').length,1);await h.app.load();assert.equal(h.api.calls.filter(call=>call.op==='rpc').length,1);
  const array=environment({info:[{started_at:'2026-10-24T18:00:00Z',version:1}]});await array.start();assert.match(array.get('historyCoverage').textContent,/Oct 24, 2026/);
  assert.match(html,/best-effort record/);assert.match(html,/Page visits and sign-ins may be missing/);
});
test('metadata failure is optional and does not discard authorized history',async()=>{
  const h=environment({intercept(call){if(call.op==='rpc')return Promise.reject(new Error('offline'));}});await h.start();
  assert.equal(h.app.state.rows.length,1);assert.equal(h.app.state.error,'');assert.equal(h.get('historyCoverage').textContent,'Earlier activity isn’t included.');
});
test('all record text, paths, actors and field names are escaped; changed fields show names without values',async()=>{
  const h=environment({records:[record(1,{actor_name:'<img onerror="bad()">',record_label:'<script>secret</script>',changed_fields:['notes','staff_name','<svg onload=bad()>','notes'],old_values:{notes:'OLD PRIVATE VALUE'},new_values:{notes:'NEW PRIVATE VALUE'}}),record(2,{record_label:'',page_path:'/kb/<script>',action:'<img>',section:'<script>'})]});await h.start();
  const markup=h.get('historyRows').innerHTML;assert.doesNotMatch(markup,/<(?:img|script|svg onload)/);assert.match(markup,/&lt;script&gt;secret/);assert.match(markup,/&lt;Svg Onload=Bad\(\)&gt;/);
  assert.match(markup,/Fields changed \(3\)/);assert.match(markup,/Staff name/);assert.doesNotMatch(markup,/OLD PRIVATE VALUE|NEW PRIVATE VALUE/);
  assert.doesNotMatch(markup,/href=/);assert.match(markup,/Activity/);assert.match(markup,/EDT/);
});
test('empty filters have a clear empty state without fabricated entries',async()=>{
  const h=environment({records:[]});await h.start();assert.equal(h.get('historyEmpty').hidden,false);assert.equal(h.get('historyTable').hidden,true);assert.equal(h.get('loadMoreHistory').hidden,true);
  assert.equal(h.get('historyEmptyTitle').textContent,'No activity in this date range.');
  await h.change('historyAction','delete');await until(()=>!h.app.state.loading);assert.equal(h.get('historyEmptyTitle').textContent,'No matching activity.');
});
test('read errors, invalid responses and permission errors clear previously displayed private rows',async()=>{
  for(const response of [{data:null,error:{code:'NETWORK',message:'PRIVATE SERVER ERROR'}},{data:[record(1,{id:Number.MAX_SAFE_INTEGER+1})],error:null},{data:null,error:{code:'42501'}}]){
    const h=environment();await h.start();h.api.intercept=call=>call.op==='select'?response:undefined;await h.app.load();
    assert.equal(h.get('historyRows').innerHTML,'');assert.equal(h.get('historyTable').hidden,true);assert.equal(h.get('historyMessage').hidden,false);assert.equal(h.get('loadMoreHistory').hidden,true);assert.doesNotMatch(h.get('historyMessage').textContent,/PRIVATE SERVER ERROR/);
    h.api.intercept=null;await h.app.load();assert.equal(h.app.state.rows.length,1);
  }
});
test('a failed later page clears the prior private rows and is retryable from the beginning',async()=>{
  const h=environment({records:Array.from({length:55},(_,i)=>record(i+1))});await h.start();
  h.api.intercept=call=>call.op==='select'?{data:null,error:{code:'NETWORK'}}:undefined;await h.app.load({append:true});assert.equal(h.app.state.rows.length,0);assert.equal(h.app.state.cursor,null);
  h.api.intercept=null;await h.app.load();assert.equal(h.app.state.rows.length,50);assert.equal(h.app.state.hasMore,true);
});
test('sign-out clears every private row and pending search; stale results cannot reappear',async()=>{
  const gate=deferred();let held=false;const h=environment();await h.start();h.api.intercept=call=>{if(call.op==='select'){held=true;return gate.promise;}};
  const pending=h.app.load();await until(()=>held);h.signOut();
  assert.equal(h.get('historyRows').innerHTML,'');assert.equal(h.get('historySearch').disabled,true);assert.equal(h.app.state.startedAt,null);
  gate.resolve({data:[record(88)],error:null});await pending;assert.equal(h.app.state.rows.length,0);
  await h.app.load();assert.match(h.get('historyMessage').textContent,/Sign in/);
});
test('account switches and revocation immediately remove content, including an open changed-field disclosure',async()=>{
  const h=environment();await h.start();assert.match(h.get('historyRows').innerHTML,/<details/);
  await h.change('historySearch','fixture');h.signIn('different-fixture-user');assert.equal(h.get('historyRows').innerHTML,'');assert.equal(h.get('historySearch').value,'');assert.equal(h.timers.size,1);
  await h.flush(0);assert.equal(h.api.accessCalls.at(-1),'different-fixture-user');assert.equal(h.app.state.rows.length,1);
  await h.window.emit('paws-access-revoked');assert.equal(h.app.state.rows.length,0);assert.equal(h.app.state.startedAt,null);assert.equal(h.get('historySearch').disabled,true);assert.match(h.get('historyMessage').textContent,/workspace access/);
});
test('back-forward cache stores no private rows and rechecks access when restored',async()=>{
  const h=environment();await h.start();await h.window.emit('pagehide');assert.equal(h.get('historyRows').innerHTML,'');
  await h.window.emit('pageshow',{persisted:true});await until(()=>!h.app.state.loading);assert.equal(h.api.accessCalls.length,2);assert.equal(h.app.state.rows.length,1);
});
