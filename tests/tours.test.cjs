// Isolated regression tests: no network, no live records, no production edits.
// Uses the actual page's IDs and evaluates a temporary instrumented copy of tours.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tours.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/tours.js'), 'utf8');
const hook = 'globalThis.__tours = { state, sortTours, outsideHours, escape, category, localNow, formData, openForm, save, updateRow, remove, restore, refresh, render, init };';
const sourceWithHooks = source.replace("  if (document.readyState === 'loading')", `  ${hook}\n  if (document.readyState === 'loading')`);
assert.notEqual(sourceWithHooks, source, 'test instrumentation anchor exists');
const formIds = ['tourId', 'customerName', 'customerInfo', 'tourDate', 'tourTime', 'hasFile', 'bookingStatus', 'staffInitials', 'outsideHoursConfirmed'];

function fixture(patch = {}) {
  return {id:'00000000-0000-4000-8000-000000000001', customer_name:'Test Customer', customer_info:'Original note',
    tour_date:'2030-01-02', tour_time:'11:00:00', has_file:'yes', booking_status:'tentative',
    staff_initials:'CR', outside_hours_confirmed:false, deleted_at:null, revision:1, ...patch};
}

function harness({at = '2026-12-31T23:59:00Z'} = {}) {
  const nodes = new Map();
  const makeNode = id => ({id, value:'', textContent:'', innerHTML:'', hidden:false, disabled:false, checked:false,
    required:false, open:false, dataset:{}, listeners:{}, attributes:{},
    classList:{toggle(){}, add(){}, remove(){}},
    addEventListener(name, fn){ this.listeners[name] = fn; },
    setAttribute(name, value){ this.attributes[name] = value; },
    focus(){}, showModal(){this.open=true;}, close(){this.open=false;},
    querySelectorAll(){return [];}, reset(){}
  });
  for (const [,id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id,makeNode(id));
  const get = id => { assert.ok(nodes.has(id), `page contains required element #${id}`); return nodes.get(id); };
  const views = ['upcoming','past','deleted'].map(view => Object.assign(makeNode(view+'Tab'), {dataset:{view}}));
  get('tourForm').querySelectorAll = () => formIds.map(get);
  get('tourForm').reset = () => formIds.forEach(id => {get(id).value=''; get(id).checked=false;});
  const api = {calls:[], authCallback:null, session:{user:{id:'approved-user'}}, active:true,
    handle(call){
      if (call.table==='hq_tour_staff') return {data:api.active ? {user_id:'approved-user',active:true} : null,error:null};
      if (call.operation==='select') return {data:call.terminal==='range' ? [] : null,error:null};
      throw new Error('Unexpected database mutation: '+JSON.stringify(call));
    }
  };
  const client = {
    auth:{async getSession(){return {data:{session:api.session},error:null};},
      onAuthStateChange(fn){api.authCallback=fn;return {data:{subscription:{unsubscribe(){}}}};}},
    from(table){
      const call = {table,operation:'select',filters:[]};
      const finish = terminal => {call.terminal=terminal; api.calls.push(call); return Promise.resolve(api.handle(call));};
      const chain = {
        select(fields){call.fields=fields;return chain;},
        insert(payload){call.operation='insert';call.payload=payload;return chain;},
        update(payload){call.operation='update';call.payload=payload;return chain;},
        eq(name,value){call.filters.push([name,value]);return chain;},
        order(field){call.order=field;return chain;},
        range(start,end){call.range=[start,end];return finish('range');},
        single(){return finish('single');},maybeSingle(){return finish('maybeSingle');}
      }; return chain;
    }
  };
  class FixedDate extends Date { constructor(...args){super(...(args.length ? args : [at]));} static now(){return Date.parse(at);} }
  const document = {readyState:'loading',hidden:false,getElementById:get,
    querySelectorAll(selector){return selector==='[data-view]' ? views : [];},addEventListener(){}};
  const context = vm.createContext({document,window:{addEventListener(){}},supabaseClient:client,
    crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000099'},Date:FixedDate,
    setInterval(){return 1;},clearInterval(){},console});
  vm.runInContext(sourceWithHooks,context,{filename:'tours.js'});
  const app = context.__tours;
  return {app,get,api,signOut(){api.session=null;assert.ok(api.authCallback);api.authCallback('SIGNED_OUT');}};
}
function fill(h,patch={}) {
  h.app.state.ready=true;
  h.app.openForm();
  const values={customerName:'Test Customer',customerInfo:'Draft note',tourDate:'2030-01-02',tourTime:'11:00',staffInitials:'cr',...patch};
  for(const [name,value] of Object.entries(values)) h.get(name).value=value;
}
const submit={preventDefault(){}};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(predicate){for(let i=0;i<30 && !predicate();i++) await Promise.resolve();assert.ok(predicate(),'async operation reached expected stage');}

test('soonest sorting handles month/year boundaries and times without mutating input',()=>{
  const {app}=harness();
  const rows=[fixture({id:'later',tour_date:'2030-01-01',tour_time:'10:30:00'}),
    fixture({id:'late-dec',tour_date:'2029-12-31',tour_time:'14:00:00'}),
    fixture({id:'early-dec',tour_date:'2029-12-31',tour_time:'10:30:00'}),
    fixture({id:'nov',tour_date:'2029-11-30',tour_time:'15:00:00'})];
  assert.deepEqual(Array.from(app.sortTours(rows),r=>r.id),['nov','early-dec','late-dec','later']);
  assert.equal(rows[0].id,'later');
});

test('tour hours include exact endpoints and require confirmation outside them',()=>{
  const h=harness();
  for(const time of ['10:30','11:00','15:00']) assert.equal(h.app.outsideHours(time),false);
  for(const time of ['00:00','10:29','15:01','23:59']) assert.equal(h.app.outsideHours(time),true);
  fill(h,{tourTime:'15:01'});
  assert.throws(()=>h.app.formData(),/personally lead/);
  h.get('outsideHoursConfirmed').checked=true;
  assert.equal(h.app.formData().outside_hours_confirmed,true);
  assert.equal(h.app.formData().staff_initials,'CR');
});

test('invalid form displays validation rather than throwing or contacting database',async()=>{
  const h=harness();fill(h,{customerName:'   '});
  await h.app.save(submit);
  assert.equal(h.get('formError').hidden,false);
  assert.match(h.get('formError').textContent,/customer name/);
  assert.equal(h.api.calls.length,0);
  assert.equal(h.get('tourDialog').open,true);
});

test('past/upcoming classification crosses New Year and uses Eastern date',()=>{
  const {app}=harness({at:'2027-01-01T00:05:00Z'});
  assert.equal(app.localNow().date,'2026-12-31');
  assert.equal(app.localNow().time,'19:05');
  const now={date:'2027-01-01',time:'00:00'};
  assert.equal(app.category(fixture({tour_date:'2026-12-31',tour_time:'23:59:00'}),now),'past');
  assert.equal(app.category(fixture({tour_date:'2027-01-01',tour_time:'00:00:00'}),now),'upcoming');
  assert.equal(app.category(fixture({tour_date:'2027-01-02',tour_time:'00:00:00'}),now),'upcoming');
  assert.equal(app.category(fixture({deleted_at:'2026-01-01T00:00:00Z'}),now),'deleted');
});

test('customer text is escaped in card text and attribute contexts',()=>{
  const h=harness();
  assert.equal(h.app.escape(`<img src=x onerror="alert(1)">&'`),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  h.app.state.ready=true;
  h.app.state.rows=[fixture({customer_name:'<script>bad</script>',customer_info:'<img onerror="bad">',staff_initials:'<&'})];
  h.app.render();
  const rendered=h.get('tourList').innerHTML;
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('<img'));
  assert.match(rendered,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(rendered,/&lt;img onerror=&quot;bad&quot;&gt;/);
});

test('stale revision rejects update and preserves the unsaved draft',async()=>{
  const h=harness(), row=fixture();
  h.app.state.ready=true;h.app.state.rows=[row];h.app.openForm(row);
  h.get('customerInfo').value='Do not discard this edit';
  const fallback=h.api.handle;
  h.api.handle=call=>call.operation==='update' ? {data:null,error:null} : fallback(call);
  await h.app.save(submit);
  const update=h.api.calls.find(c=>c.operation==='update');
  assert.deepEqual(Array.from(update.filters,p=>Array.from(p)),[['id',row.id],['revision',1]]);
  assert.equal(h.get('tourDialog').open,true);
  assert.equal(h.get('customerInfo').value,'Do not discard this edit');
  assert.match(h.get('formError').textContent,/Someone else changed/);
  assert.equal(h.app.state.rows[0].customer_info,'Original note');
});

test('lost insert response retry reuses UUID and preserves subsequently changed draft',async()=>{
  const h=harness();fill(h);
  const id=h.get('tourId').value, saved=fixture({id,customer_info:'Draft note'});
  let insertCount=0;
  const fallback=h.api.handle;
  h.api.handle=call=>{
    if(call.operation==='insert') return {data:null,error:{code:++insertCount===1 ? 'NETWORK' : '23505'}};
    if(call.table==='hq_tours' && call.operation==='select') return {data:saved,error:null};
    if(call.operation==='update') return {data:{...saved,...call.payload,revision:2},error:null};
    return fallback(call);
  };
  await h.app.save(submit);
  assert.equal(h.get('tourDialog').open,true);
  h.get('customerInfo').value='New note after uncertain save';
  await h.app.save(submit);
  assert.deepEqual(h.api.calls.filter(c=>c.operation==='insert').map(c=>c.payload.id),[id,id]);
  assert.equal(h.get('tourDialog').open,true);
  assert.equal(h.get('customerInfo').value,'New note after uncertain save');
  assert.equal(h.app.state.editing.revision,1);
  assert.equal(h.app.state.rows.length,1);
  assert.equal(h.app.state.rows[0].customer_info,'Draft note');
  assert.match(h.get('formError').textContent,/earlier save succeeded/);
  await h.app.save(submit);
  assert.equal(h.get('tourDialog').open,false);
  assert.equal(h.app.state.rows.length,1);
  assert.equal(h.app.state.rows[0].customer_info,'New note after uncertain save');
  assert.equal(h.app.state.rows[0].revision,2);
});

test('refresh loads records past first Supabase page',async()=>{
  const h=harness();
  const all=Array.from({length:501},(_,i)=>fixture({id:String(i).padStart(4,'0')}));
  const fallback=h.api.handle;
  h.api.handle=call=>call.terminal==='range' ? {data:all.slice(call.range[0],call.range[1]+1),error:null} : fallback(call);
  await h.app.refresh();
  assert.equal(h.app.state.rows.length,501);
  assert.equal(h.app.state.rows[500].id,'0500');
  assert.deepEqual(h.api.calls.filter(c=>c.terminal==='range').map(c=>c.range),[[0,499],[500,999]]);
});

test('delete and undo restore both use the latest returned revision',async()=>{
  const h=harness(), original=fixture();
  h.app.state.ready=true;h.app.state.rows=[original];h.app.state.deleting=original;
  h.get('deleteDialog').showModal();
  const fallback=h.api.handle;
  let stored=original;
  h.api.handle=call=>{
    if(call.operation==='update') {stored={...stored,...call.payload,revision:stored.revision+1};return {data:stored,error:null};}
    return fallback(call);
  };
  await h.app.remove();
  assert.equal(h.app.state.undo.revision,2);
  assert.ok(h.app.state.rows[0].deleted_at);
  assert.equal(h.get('deleteDialog').open,false);
  await h.app.restore(h.app.state.undo);
  const updates=h.api.calls.filter(c=>c.operation==='update');
  assert.deepEqual(updates.map(c=>c.filters.find(([name])=>name==='revision')[1]),[1,2]);
  assert.equal(h.app.state.rows[0].deleted_at,null);
  assert.equal(h.app.state.rows[0].revision,3);
});

test('sign-out discards a delayed refresh response instead of revealing prior records',async()=>{
  const h=harness(), pending=deferred();
  const fallback=h.api.handle;
  h.api.handle=call=>call.terminal==='range' ? pending.promise : fallback(call);
  h.app.init();
  await until(()=>h.api.calls.some(c=>c.terminal==='range'));
  h.signOut();
  pending.resolve({data:[fixture({customer_name:'Private old-session customer'})],error:null});
  await until(()=>!h.app.state.loading);
  assert.equal(h.app.state.ready,false);
  assert.equal(h.app.state.rows.length,0);
  assert.ok(!h.get('tourList').innerHTML.includes('Private old-session customer'));
  assert.match(h.get('pageMessage').textContent,/Sign in/);
});

test('sign-out discards a delayed save response and keeps the closed cleared form',async()=>{
  const h=harness();
  h.app.init();await until(()=>!h.app.state.loading);
  fill(h);
  const pending=deferred(),fallback=h.api.handle;
  h.api.handle=call=>call.operation==='insert' ? pending.promise : fallback(call);
  const save=h.app.save(submit);
  await until(()=>h.api.calls.some(c=>c.operation==='insert'));
  h.signOut();
  pending.resolve({data:fixture(),error:null});
  await save;
  assert.equal(h.app.state.ready,false);
  assert.equal(h.app.state.rows.length,0);
  assert.equal(h.get('tourDialog').open,false);
  assert.equal(h.get('customerName').value,'');
  assert.equal(h.get('toast').hidden,true);
});

test('an unapproved signed-in account never reads the tour table',async()=>{
  const h=harness();h.api.active=false;
  await h.app.refresh();
  assert.equal(h.app.state.ready,false);
  assert.equal(h.api.calls.some(c=>c.table==='hq_tours'),false);
  assert.match(h.get('pageMessage').textContent,/does not have Tours access/);
});
