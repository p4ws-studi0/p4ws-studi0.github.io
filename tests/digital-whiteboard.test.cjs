const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/digital-whiteboard.js'), 'utf8');
const helpers = require('../assets/digital-whiteboard.js');
const NOW = Date.parse('2026-10-13T15:00:00Z');
const seconds = milliseconds => milliseconds / 1000;
const row = (patch = {}) => ({id:'101',a_first:'Maple',o_last:'Example',type_id:'1',type:'Full Day',start_date:seconds(NOW + 1800000),end_date:seconds(NOW + 7200000),event_time:seconds(NOW + 1800000),check_in_stamp:null,check_out_stamp:null,run_name:'Oak 4',area_name:'East',belonging_count:0,belonging_area:null,status_string:'Checking In Soon',...patch});
const board = (patch = {}) => ({checking_in:[row()],checking_out:[],updated_at:new Date(NOW).toISOString(),full_day:true,mins_future:null,timezone:'America/New_York',gingr_url:'https://pawspet.gingrapp.com',...patch});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;});return {promise,resolve};};
const response = (payload, status = 200) => new Response(JSON.stringify(payload), {status, headers:{'Content-Type':'application/json'}});
async function flush() {for(let i = 0; i < 20; i++) await Promise.resolve();await new Promise(setImmediate);}
function harness({payload=board(),handler,session={user:{id:'staff-fixture'},access_token:'fixture-jwt'}} = {}) {
  const nodes = new Map(), listeners = {}, auth = [], timers = new Map(), intervals = [];
  const api = {payload,handler,session,now:NOW,requests:[]};
  const document = {hidden:false,activeElement:null,getElementById:node,addEventListener(name,fn){listeners['document:'+name]=fn;}};
  function node(id) {
    if(nodes.has(id)) return nodes.get(id);
    const events = {}, classes = new Set();
    const n = {id,events,dataset:{},attributes:{},value:id==='wbWindow'?'today':'',checked:false,hidden:false,disabled:false,open:false,innerHTML:'',textContent:'',
      classList:{toggle(name,on){if(on) classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},
      setAttribute(name,value){n.attributes[name]=value;},
      addEventListener(name,fn){(events[name]??=[]).push(fn);},
      focus(){document.activeElement=n;},showModal(){n.open=true;},close(){n.open=false;},querySelectorAll(){return [];}
    };nodes.set(id,n);return n;
  }
  document.body = node('body');
  const window = {addEventListener(name,fn){listeners['window:'+name]=fn;}};
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[api.now]));}static now(){return api.now;}}
  let timerId=0;
  const context=vm.createContext({document,window,Intl,Date:TestDate,AbortController,console,
    supabaseClient:{auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){auth.push(fn);}}},
    fetch:async(url,options)=>{const request={url,...options,parsedBody:JSON.parse(options.body)};api.requests.push(request);return api.handler?api.handler(request):response(api.payload);},
    setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},setInterval(fn,delay){intervals.push({fn,delay});}
  });
  vm.runInContext(source.replace("  $('wbRefresh').addEventListener", "  globalThis.__board={state,refresh,render,showDetails};\n  $('wbRefresh').addEventListener"),context);
  return {api,document,listeners,intervals,timers,get:node,app:context.__board,
    async settle(){await flush();assert.equal(context.__board.state.loading,false);},
    async event(id,name,event={}){for(const fn of node(id).events[name]||[])await fn(event);await flush();},
    signOut(){api.session=null;auth.forEach(fn=>fn('SIGNED_OUT',null));}
  };
}

test('whiteboard dates accept seconds and reject absent timestamps; completion is lane-specific',()=>{
  for(const value of [null,undefined,'',0,'0','invalid',-1]) assert.equal(helpers.stamp(value),null);
  assert.equal(helpers.stamp(String(seconds(NOW))),NOW);
  const reservation=row({check_in_stamp:seconds(NOW),check_out_stamp:null});
  assert.equal(helpers.finished(reservation,'arrival'),true);
  assert.equal(helpers.finished(reservation,'departure'),false);
  assert.equal(helpers.scheduled(row({event_time:null}),'departure'),NOW+7200000);
});
test('whiteboard order keeps pending events first, missing times last, and completed events last',()=>{
  const rows=[row({id:'done',event_time:seconds(NOW-10000),check_in_stamp:seconds(NOW)}),row({id:'later'}),row({id:'missing',event_time:null,start_date:null}),row({id:'earlier',event_time:seconds(NOW)})];
  assert.deepEqual(helpers.sortRows(rows,'arrival').map(r=>r.id),['earlier','later','missing','done']);
  assert.equal(rows[0].id,'done');
});
test('whiteboard search is case/accent insensitive across pet, owner, service and run; time notices distinguish completed',()=>{
  const reservation=row({a_first:'Éclair'});
  assert.equal(helpers.matches(reservation,'ECLAIR example oak','1'),true);
  assert.equal(helpers.matches(reservation,'eclair','2'),false);
  assert.equal(helpers.status(row({event_time:seconds(NOW-1)}),'arrival',NOW).kind,'past');
  assert.equal(helpers.status(row({event_time:seconds(NOW)}),'arrival',NOW).text,'Due now');
  assert.equal(helpers.status(row(),'arrival',NOW).text,'Due in 30m');
  assert.equal(helpers.status(row({check_in_stamp:seconds(NOW)}),'arrival',NOW).text,'Checked in');
});
test('default request uses authenticated server proxy, today window, no URL token, and minute polling',async()=>{
  const h=harness();await h.settle();const request=h.api.requests[0];
  assert.deepEqual(request.parsedBody,{full_day:true});
  assert.equal(request.method,'POST');assert.equal(request.headers.Authorization,'Bearer fixture-jwt');
  assert.equal(request.cache,'no-store');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');
  assert.match(request.url,/supabase\.co\/functions\/v1\/hq-gingr-whiteboard$/);assert.equal(request.url.includes('fixture-jwt'),false);
  assert.match(h.get('wbArrivals').innerHTML,/Maple/);assert.equal(h.get('wbConnection').textContent,'Live from Gingr');
  assert.equal(h.intervals.some(item=>item.delay===60000),true);
  await h.app.refresh({automatic:true});assert.equal(h.api.requests.length,1);
  h.api.now+=60000;h.document.hidden=true;await h.app.refresh({automatic:true});assert.equal(h.api.requests.length,1);
  h.document.hidden=false;await h.app.refresh({automatic:true});assert.equal(h.api.requests.length,2);
});
test('same reservation can appear in both lanes and completion only hides its finished lane',async()=>{
  const same=row({check_in_stamp:seconds(NOW-60000)}),h=harness({payload:board({checking_in:[same],checking_out:[same]})});await h.settle();
  assert.doesNotMatch(h.get('wbArrivals').innerHTML,/data-reservation="arrival:101"/);
  assert.match(h.get('wbDepartures').innerHTML,/data-reservation="departure:101"/);
  h.get('wbCompleted').checked=true;h.app.render();assert.match(h.get('wbArrivals').innerHTML,/data-reservation="arrival:101"/);
  assert.match(h.get('wbDepartures').innerHTML,/data-reservation="departure:101"/);
});
test('empty day, failed connection and unavailable service have distinct states',async()=>{
  const empty=harness({payload:board({checking_in:[],checking_out:[]})});await empty.settle();assert.equal(empty.get('wbBoard').hidden,false);assert.match(empty.get('wbArrivals').innerHTML,/No pending arrivals/);
  const setup=harness({handler:()=>response({error:{code:'CONNECTION_REQUIRED'}},503)});await setup.settle();assert.equal(setup.get('wbBoard').hidden,true);assert.match(setup.get('wbEmptyTitle').textContent,/Connecting your Gingr/);
  const failure=harness({handler:()=>response({error:{code:'GINGR_UNAVAILABLE'}},502)});await failure.settle();assert.match(failure.get('wbEmptyTitle').textContent,/Couldn’t load/);
});
test('temporary update failure preserves visibly stale records; lost access clears them',async()=>{
  const h=harness();await h.settle();h.api.handler=()=>{throw new Error('sensitive upstream contents');};await h.app.refresh();
  assert.match(h.get('wbArrivals').innerHTML,/Maple/);assert.equal(h.app.state.stale,true);assert.equal(h.get('wbNotice').hidden,false);assert.match(h.get('wbNotice').textContent,/saved results/);assert.doesNotMatch(h.get('wbNotice').textContent,/sensitive/);
  h.api.handler=()=>response({error:{code:'ACCESS_DENIED'}},403);await h.app.refresh();assert.equal(h.get('wbArrivals').innerHTML,'');assert.equal(h.get('wbBoard').hidden,true);assert.equal(h.app.state.data,null);
});
test('switching time window clears previous records and ignores a late response for the old window',async()=>{
  const old=deferred(),current=deferred();let n=0;const h=harness({handler:()=>++n===1?old.promise:current.promise});await flush();
  h.get('wbWindow').value='120';const refresh=h.app.refresh({replace:true});await flush();assert.equal(h.api.requests[0].signal.aborted,true);assert.equal(h.get('wbBoard').hidden,true);
  assert.deepEqual(h.api.requests[1].parsedBody,{mins_future:120});
  current.resolve(response(board({checking_in:[row({a_first:'Current window'})],full_day:false,mins_future:120})));await refresh;
  old.resolve(response(board({checking_in:[row({a_first:'Old window'})]})));await flush();assert.match(h.get('wbArrivals').innerHTML,/Current window/);assert.doesNotMatch(h.get('wbArrivals').innerHTML,/Old window/);
});
test('failed window change never labels the previous window as current results',async()=>{
  const h=harness();await h.settle();h.api.handler=()=>response({error:{code:'GINGR_UNAVAILABLE'}},502);h.get('wbWindow').value='60';await h.app.refresh({replace:true});
  assert.equal(h.app.state.data,null);assert.equal(h.get('wbBoard').hidden,true);assert.equal(h.get('wbArrivals').innerHTML,'');
});
test('logout clears details and cards and suppresses late records; signed-out users make no provider requests',async()=>{
  const h=harness();await h.settle();h.app.showDetails('arrival:101');assert.equal(h.get('wbDialog').open,true);
  const late=deferred();h.api.handler=()=>late.promise;const refresh=h.app.refresh();await flush();h.signOut();late.resolve(response(board({checking_in:[row({a_first:'Private late record'})]})));await refresh;
  assert.equal(h.get('wbDialog').open,false);assert.equal(h.get('wbDialogBody').innerHTML,'');assert.equal(h.get('wbArrivals').innerHTML,'');assert.equal(h.app.state.data,null);assert.equal(h.get('wbBoard').hidden,true);
  const signedOut=harness({session:null});await signedOut.settle();assert.equal(signedOut.api.requests.length,0);assert.match(signedOut.get('wbEmptyTitle').textContent,/Sign in/);
});
test('provider text is escaped in cards, options and details, including markup-looking names',async()=>{
  const h=harness({payload:board({checking_in:[row({a_first:'<img src=x onerror=alert(1)>',o_last:'O"Example',type:'<script>service</script>',run_name:'<svg onload=alert(1)>'})]})});await h.settle();
  h.app.showDetails('arrival:101');for(const id of ['wbArrivals','wbService','wbDialogBody'])assert.doesNotMatch(h.get(id).innerHTML,/<(?:script|img|svg)(?:[ >])/);
  assert.match(h.get('wbArrivals').innerHTML,/&lt;img/);assert.match(h.get('wbService').innerHTML,/&lt;script/);
});
test('reservation details retain zero belongings as a real count',async()=>{
  const h=harness();await h.settle();h.app.showDetails('arrival:101');assert.match(h.get('wbDialogBody').innerHTML,/<dt>Belongings<\/dt><dd>0<\/dd>/);
});
