/* Read-only History behavior, using synthetic records and a Supabase-shaped fixture. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'history.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/activity-history.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/activity-history.css'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const photo=n=>`https://avatars.slack-edge.com/2026-10-25/fixture${n}_72.png`;
const record=(id=1,extra={})=>({id:String(id),occurred_at:'2026-10-25T14:30:00Z',actor_id:uuid(900),actor_name:'Fixture Member',action:'update',section:'end-of-day',record_label:'Oct 25, 2026',changed_fields:['notes'],page_path:null,...extra});
function deferred(){let resolve;const promise=new Promise(fn=>{resolve=fn;});return {promise,resolve};}
async function until(check){for(let i=0;i<500&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
function environment({records=[record()],avatars=[],session={user:{id:'fixture-user'}},accessError=null,intercept=null,info={started_at:'2026-10-25T12:00:00Z',version:1,best_effort:true},now='2026-10-25T16:00:00Z'}={}){
  const api={records:clone(records),avatars:clone(avatars),session,accessError,intercept,info,calls:[],accessCalls:[],callbacks:[],authError:null,imageRequests:[]};
  const nodes=new Map(),timers=new Map();let timer=0;
  function eventTarget(extra={}){return {...extra,events:{},addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);}};}
  function node(extra={}){
    const n=eventTarget({dataset:{},children:[],avatars:[],classes:new Set(),isConnected:true,writeCount:0,...extra});
    n.classList={add(...values){values.forEach(value=>n.classes.add(value));},remove(...values){values.forEach(value=>n.classes.delete(value));},contains(value){return n.classes.has(value);}};
    n.querySelector=selector=>selector==='img'?n.children.find(child=>child.tagName==='IMG')||null:null;
    n.querySelectorAll=selector=>selector==='[data-avatar-actor]'?n.avatars:[];
    n.append=child=>{n.children.push(child);child.parentNode=n;child.isConnected=n.isConnected;};
    n.remove=()=>{if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(child=>child!==n);n.isConnected=false;};
    n.removeAttribute=key=>{if(key==='src')n.imageSource='';};
    Object.defineProperty(n,'src',{get(){return n.imageSource;},set(value){n.imageSource=value;api.imageRequests.push(value);}});
    let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;n.writeCount++;if(n.id==='historyRows'){
      for(const avatar of n.avatars){avatar.isConnected=false;for(const child of avatar.children)child.isConnected=false;}
      n.avatars=[...value.matchAll(/data-avatar-actor="([^"]+)"/g)].map(match=>node({dataset:{avatarActor:match[1]}}));
    }}});
    return n;
  }
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    assert.ok(!nodes.has(match[1]),'unique HTML IDs');
    nodes.set(match[1],node({id:match[1],hidden:/\bhidden\b/.test(match[0]),disabled:/\bdisabled\b/.test(match[0]),value:match[1]==='historyAction'?'all':match[1]==='historyPeriod'?'7':'',textContent:''}));
  }
  const document=eventTarget({readyState:'loading',hidden:false,getElementById:id=>nodes.get(id),createElement:tag=>node({tagName:tag.toUpperCase()})}),window=eventTarget();
  async function complete(call){
    api.calls.push(clone(call));
    const intercepted=api.intercept?.(call,api);if(intercepted!==undefined)return intercepted;
    if(call.op==='rpc')return {data:clone(call.name==='hq_activity_history_info'?api.info:api.avatars.filter(row=>call.params.p_actor_ids.includes(row.actor_id))),error:null};
    assert.equal(call.table,'hq_activity_history');
    let rows=api.records.filter(row=>call.filters.every(([op,key,value])=>op==='lt'?BigInt(row[key])<BigInt(value):op==='gte'?row[key]>=value:op==='neq'?row[key]!==value:row[key]===value));
    rows.sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:BigInt(a.id)<BigInt(b.id)?1:0);
    return {data:clone(rows.slice(0,call.limit)),error:null};
  }
  const client={auth:{async getSession(){return {data:{session:api.session},error:api.authError};},onAuthStateChange(fn){api.callbacks.push(fn);}},rpc(name,params){return complete({op:'rpc',name,params});},from(table){
    const call={op:'select',table,filters:[]};let pending;
    const chain={select(columns){call.columns=columns;return chain;},order(key,options){call.order=[key,options];return chain;},limit(value){call.limit=value;return chain;},lt(key,value){call.filters.push(['lt',key,value]);return chain;},gte(key,value){call.filters.push(['gte',key,value]);return chain;},eq(key,value){call.filters.push(['eq',key,value]);return chain;},neq(key,value){call.filters.push(['neq',key,value]);return chain;},or(value){call.or=value;return chain;},then(resolve,reject){pending||=complete(call);return pending.then(resolve,reject);}};
    return chain;
  }};
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({document,window,supabaseClient:client,ensureHqWorkspaceAccess:async session=>{api.accessCalls.push(session.user.id);if(api.accessError)throw api.accessError;return {allowed:true};},Date:TestDate,Intl,URL,console,setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
  const marker="  if(document.readyState==='loading')";assert.equal(source.split(marker).length,2);
  vm.runInContext(source.replace(marker,`  window.hooks={state,init,load,resetAuth,searchFilter,periodStart,rowHtml,recordId,actorId,avatarUrl,loadAvatars,paintAvatars};\n${marker}`),context);
  const app=window.hooks,get=id=>nodes.get(id);
  return {app,api,nodes,get,document,window,timers,async start(){app.init();await until(()=>!app.state.loading);},async change(id,value){get(id).value=value;await get(id).emit(id==='historySearch'?'input':'change');},async flush(delay){for(const [id,entry]of [...timers])if(delay===undefined||entry.delay===delay){timers.delete(id);entry.fn();}await until(()=>!app.state.loading);},signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},signIn(id){api.session={user:{id}};for(const fn of api.callbacks)fn('SIGNED_IN',api.session);}};
}
test('History is a read-only menu page with a Home link, accessible filters and no write controls',()=>{
  assert.match(html,/href="\/"[^>]*>[\s\S]*?<\/svg>Home<\/a>/);assert.doesNotMatch(html,/\/settings|>Settings</);assert.match(html,/<h1>History<\/h1>/);
  for(const label of ['Who','Action','Item','When'])assert.ok(html.includes(`>${label}</th>`));
  assert.match(html,/historyPeriod[\s\S]*value="7" selected>Last 7 days/);
  assert.match(html,/script\.js\?v=20261025b/);assert.match(html,/activity-history\.(?:js|css)\?v=20261025b/);assert.doesNotMatch(html,/id="footer"/);
  assert.doesNotMatch(source,/\.(?:insert|update|upsert)\s*\(/); // Map.delete is used only by the in-memory photo cache.
  assert.doesNotMatch(html,/>\s*(?:Add row|Delete|Edit|Restore)\s*<\/button>/);
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/var\(--tr-text\)/);
});
test('each History read verifies the session and workspace; defaults to trailing seven Eastern calendar days',async()=>{
  const h=environment();await h.start();
  assert.equal(h.api.accessCalls.length,1);
  const call=h.api.calls.find(call=>call.op==='select');
  assert.equal(call.table,'hq_activity_history');assert.equal(call.limit,50);assert.deepEqual(call.order,['id',{ascending:false}]);
  assert.deepEqual(call.filters,[['neq','action','page_view'],['gte','occurred_at','2026-10-19T04:00:00.000Z']]);
  assert.equal(call.columns,'id,occurred_at,actor_id,actor_name,action,section,record_label,changed_fields,page_path');
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
  const call=h.api.calls.filter(call=>call.op==='select').at(-1);assert.deepEqual(call.filters,[['neq','action','page_view'],['eq','action','create']]);
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
  assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_info').length,1);await h.app.load();assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_info').length,1);
  const array=environment({info:[{started_at:'2026-10-24T18:00:00Z',version:1}]});await array.start();assert.match(array.get('historyCoverage').textContent,/Oct 24, 2026/);
  assert.match(html,/best-effort record/);assert.match(html,/Sign-ins may be missing/);assert.doesNotMatch(html,/Page visits|Viewed page|value="page_view"/);
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
test('viewed-page events are excluded server-side and never offered in the action menu',async()=>{
  const h=environment({records:[record(1),record(2,{action:'page_view',record_label:'HIDDEN PAGE VISIT'})]});await h.start();
  assert.deepEqual(clone(h.app.state.rows.map(row=>row.id)),['1']);
  assert.ok(h.api.calls.find(call=>call.op==='select').filters.some(filter=>filter[0]==='neq'&&filter[1]==='action'&&filter[2]==='page_view'));
  assert.doesNotMatch(h.get('historyRows').innerHTML,/HIDDEN PAGE VISIT/);assert.doesNotMatch(html,/Viewed page|page visits|value="page_view"/i);
});
test('a stale backend response cannot display viewed-page rows or request their author photos',async()=>{
  const h=environment({intercept(call){if(call.op==='select')return {data:[record(9,{action:'page_view',actor_id:uuid(999),record_label:'HIDDEN PAGE VISIT'}),record(8)],error:null};}});await h.start();
  await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.app.state.rows.length,1);assert.equal(h.app.state.rows[0].id,'8');assert.doesNotMatch(h.get('historyRows').innerHTML,/HIDDEN PAGE VISIT/);
  assert.deepEqual(h.api.calls.find(call=>call.name==='hq_activity_history_avatars').params,{p_actor_ids:[uuid(900)]});
});
test('hidden viewed-page rows still advance the raw cursor without appearing as activities',async()=>{
  let first=true;const h=environment({intercept(call){if(call.op==='select'&&first){first=false;return {data:Array.from({length:50},(_,i)=>record(50-i,{action:'page_view'})),error:null};}}});await h.start();
  assert.equal(h.app.state.rows.length,0);assert.equal(h.app.state.cursor,'1');assert.equal(h.app.state.hasMore,true);assert.equal(h.get('loadMoreHistory').hidden,false);
  assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_avatars').length,0);
  await h.app.load({append:true});assert.equal(h.app.state.hasMore,false);
});
test('author photos resolve once per unique actor in a batch, after history is already readable',async()=>{
  const gate=deferred();let held=false;
  const h=environment({records:[record(3),record(2,{actor_id:uuid(901),actor_name:'Second Member'}),record(1)],intercept(call){if(call.name==='hq_activity_history_avatars'){held=true;return gate.promise;}}});await h.start();await until(()=>held);
  assert.equal(h.get('historyTable').hidden,false);assert.equal(h.app.state.loading,false);assert.match(h.get('historyRows').innerHTML,/Fixture Member/);
  assert.doesNotMatch(h.get('historyRows').innerHTML,/>FM<|>SM<|onerror=|onload=/);
  const tbody=h.get('historyRows'),writes=tbody.writeCount,avatar=tbody.avatars[0];avatar.preservedDisclosure={open:true};
  assert.deepEqual(h.api.calls.find(call=>call.name==='hq_activity_history_avatars').params,{p_actor_ids:[uuid(900),uuid(901)]});
  gate.resolve({data:[{actor_id:uuid(900),avatar_url:photo(900)},{actor_id:uuid(901),avatar_url:photo(901)}],error:null});await until(()=>!h.app.state.avatarPending.size);
  assert.equal(tbody.writeCount,writes,'photo arrival must not rebuild the table or close field disclosures');assert.equal(tbody.avatars[0],avatar);assert.equal(avatar.preservedDisclosure.open,true);
  assert.deepEqual(tbody.avatars.map(node=>node.querySelector('img').src),[photo(900),photo(901),photo(900)]);
  const image=avatar.querySelector('img');assert.equal(image.alt,'');assert.equal(image.referrerPolicy,'no-referrer');assert.equal(image.decoding,'async');assert.equal(avatar.classList.contains('has-photo'),false);
  await image.emit('load');assert.equal(avatar.classList.contains('has-photo'),true);
});
test('photo URLs accept only exact HTTPS Slack CDN or a constrained provider Gravatar URL',()=>{
  const h=environment(),hash='0'.repeat(32);
  for(const url of [photo(1),'https://a.slack-edge.com/fixture/avatar.png',`https://secure.gravatar.com/avatar/${hash}?s=72&d=404`])assert.equal(h.app.avatarUrl(url),url);
  for(const url of ['http://avatars.slack-edge.com/avatar.png','//avatars.slack-edge.com/avatar.png','data:image/png;base64,AA','javascript:alert(1)','https://avatars.slack-edge.com.evil.test/a','https://avatars.slack-edge.com@evil.test/a','https://user@avatars.slack-edge.com/a','https://avatars.slack-edge.com:443/a','https://avatars.slack-edge.com:8443/a','https://avatars.slack-edge.com/a#x','https://avatars.slack-edge.com/a#','https://avatars.slack-edge.com/a b','https://avatars.slack-edge.com/\\evil.test/a','https://avatars.slack-edge.com/\na',`https://secure.gravatar.com/avatar/${hash}/extra`,`https://secure.gravatar.com/avatar/${hash}.png`,'https://secure.gravatar.com/avatar/no-hash','https://secure.gravatar.com/other/abc','https://gravatar.com/avatar/'+hash])assert.equal(h.app.avatarUrl(url),null,url);
});
test('unsafe, unsolicited and malformed photo rows use generic icons without network image requests',async()=>{
  const h=environment({records:[record(1),record(2,{actor_id:uuid(901)}),record(3,{actor_id:'bad-id'}),record(4,{actor_id:null})],intercept(call){if(call.name==='hq_activity_history_avatars')return {data:[{actor_id:uuid(900),avatar_url:'https://evil.test/tracker.png'},{actor_id:uuid(901),avatar_url:'https://avatars.slack-edge.com:443/avatar.png'},{actor_id:uuid(999),avatar_url:photo(999)},{actor_id:'bad-id',avatar_url:photo(1)}],error:null};}});await h.start();await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.api.imageRequests.length,0);assert.equal(h.app.state.avatarCache.has(uuid(999)),false);assert.equal(h.app.state.avatarCache.size,2);
  assert.match(h.get('historyRows').innerHTML,/<circle cx="12" cy="8"/);assert.doesNotMatch(h.get('historyRows').innerHTML,/>FM<|data-avatar-actor="bad-id"/);
  assert.doesNotMatch(css,/\.ah-avatar\{display:none/,'profile photos remain visible at tablet and mobile widths');
});
test('successful and missing photos are cached only in memory and reused across refresh and pagination',async()=>{
  const h=environment({records:Array.from({length:60},(_,i)=>record(i+1,{actor_id:i%2?uuid(900):uuid(901)})),avatars:[{actor_id:uuid(900),avatar_url:photo(900)}]});await h.start();await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_avatars').length,1);assert.equal(h.app.state.avatarCache.get(uuid(901)).url,null);
  await h.app.load({append:true});await h.app.load();await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_avatars').length,1);assert.ok(h.api.imageRequests.every(url=>url===photo(900)));
  assert.doesNotMatch(source,/localStorage|sessionStorage/);
  h.app.state.avatarCache.get(uuid(900)).expires=0;h.api.avatars=[{actor_id:uuid(900),avatar_url:photo('updated')}];await h.app.load();await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_avatars').length,2);assert.equal(h.app.state.avatarCache.get(uuid(900)).url,photo('updated'));
});
test('photo RPC batches are bounded and duplicate pending actor lookups are not repeated',async()=>{
  const gate=deferred();let held=false;
  const h=environment({intercept(call){if(call.name==='hq_activity_history_avatars'){held=true;return gate.promise;}}});await h.start();await until(()=>held);
  await h.app.loadAvatars();assert.equal(h.api.calls.filter(call=>call.name==='hq_activity_history_avatars').length,1);
  gate.resolve({data:[],error:null});await until(()=>!h.app.state.avatarPending.size);
  h.api.intercept=null;h.app.state.rows=Array.from({length:150},(_,i)=>record(i+1,{actor_id:uuid(i+1)}));
  await h.app.loadAvatars();await until(()=>h.app.state.avatarPending.size===0&&h.app.state.avatarCache.size===151);
  const batches=h.api.calls.filter(call=>call.name==='hq_activity_history_avatars');assert.deepEqual(batches.map(call=>call.params.p_actor_ids.length),[1,100,50]);assert.ok(batches.every(call=>new Set(call.params.p_actor_ids).size===call.params.p_actor_ids.length));
});
test('a failed image restores the generic person icon without rebuilding rows or reopening network requests',async()=>{
  const h=environment({avatars:[{actor_id:uuid(900),avatar_url:photo(900)}]});await h.start();await until(()=>!h.app.state.avatarPending.size);
  const tbody=h.get('historyRows'),avatar=tbody.avatars[0],image=avatar.querySelector('img'),writes=tbody.writeCount;
  await image.emit('load');assert.equal(avatar.classList.contains('has-photo'),true);await image.emit('error');
  assert.equal(avatar.querySelector('img'),null);assert.equal(avatar.classList.contains('has-photo'),false);assert.equal(tbody.writeCount,writes);assert.equal(h.app.state.avatarCache.get(uuid(900)).url,null);
  await h.app.load();assert.equal(h.api.imageRequests.length,1);
});
test('an unavailable photo RPC keeps history readable and retries after the next refresh',async()=>{
  const h=environment({intercept(call){if(call.name==='hq_activity_history_avatars')return {data:null,error:{code:'PGRST202'}};}});await h.start();await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.app.state.rows.length,1);assert.equal(h.app.state.error,'');assert.equal(h.app.state.avatarCache.size,0);assert.equal(h.get('historyTable').hidden,false);
  h.api.intercept=null;h.api.avatars=[{actor_id:uuid(900),avatar_url:photo(900)}];await h.app.load();await until(()=>!h.app.state.avatarPending.size);assert.equal(h.app.state.avatarCache.get(uuid(900)).url,photo(900));
});
test('photo permission failures remove the private history and all cached images',async()=>{
  const h=environment({intercept(call){if(call.name==='hq_activity_history_avatars')return {data:null,error:{code:'42501'}};}});await h.start();await until(()=>Boolean(h.app.state.error));
  assert.equal(h.app.state.rows.length,0);assert.equal(h.app.state.authorized,false);assert.equal(h.app.state.avatarCache.size,0);assert.equal(h.get('historyRows').innerHTML,'');assert.match(h.get('historyMessage').textContent,/workspace access/);
});
test('logout, revocation, pagehide and read errors clear the current account photo cache',async()=>{
  for(const kind of ['logout','revocation','pagehide','read-error']){
    const h=environment({avatars:[{actor_id:uuid(900),avatar_url:photo(900)}]});await h.start();await until(()=>!h.app.state.avatarPending.size);assert.equal(h.app.state.avatarCache.size,1);
    if(kind==='logout')h.signOut();else if(kind==='revocation')await h.window.emit('paws-access-revoked');else if(kind==='pagehide')await h.window.emit('pagehide');else{h.api.intercept=call=>call.op==='select'?{data:null,error:{code:'NETWORK'}}:undefined;await h.app.load();}
    assert.equal(h.app.state.avatarCache.size,0,kind);assert.equal(h.app.state.avatarPending.size,0,kind);assert.equal(h.get('historyRows').avatars.length,0,kind);
  }
});
test('late photos after an account switch cannot replace the new account photo cache or DOM',async()=>{
  const gate=deferred();let first=true;
  const h=environment({avatars:[{actor_id:uuid(900),avatar_url:photo('new-account')}],intercept(call){if(call.name==='hq_activity_history_avatars'&&first){first=false;return gate.promise;}}});await h.start();
  h.signIn('different-fixture-user');await h.flush(0);await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.app.state.avatarCache.get(uuid(900)).url,photo('new-account'));
  gate.resolve({data:[{actor_id:uuid(900),avatar_url:photo('old-account')}],error:null});await Promise.resolve();await Promise.resolve();
  assert.equal(h.app.state.avatarCache.get(uuid(900)).url,photo('new-account'));assert.equal(h.get('historyRows').avatars[0].querySelector('img').src,photo('new-account'));assert.ok(!h.api.imageRequests.includes(photo('old-account')));
});
test('stale photo responses from an old filter do not add actors or change the new filter rows',async()=>{
  const gate=deferred();let first=true;
  const h=environment({records:[record(2),record(1,{action:'create',actor_id:uuid(901)})],avatars:[{actor_id:uuid(901),avatar_url:photo(901)}],intercept(call){if(call.name==='hq_activity_history_avatars'&&first){first=false;return gate.promise;}}});await h.start();
  await h.change('historyAction','create');await until(()=>!h.app.state.loading);assert.equal(h.app.state.rows[0].actor_id,uuid(901));
  gate.resolve({data:[{actor_id:uuid(900),avatar_url:photo('stale')}],error:null});await until(()=>!h.app.state.avatarPending.size);
  assert.equal(h.app.state.avatarCache.has(uuid(900)),false);assert.equal(h.app.state.avatarCache.get(uuid(901)).url,photo(901));assert.equal(h.get('historyRows').avatars[0].querySelector('img').src,photo(901));assert.ok(!h.api.imageRequests.includes(photo('stale')));
});
