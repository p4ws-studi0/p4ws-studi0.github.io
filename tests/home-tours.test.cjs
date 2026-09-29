// Offline widget regressions: actual JS/HTML, minimal DOM and a query-aware Supabase fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../assets/home-tours.js'), 'utf8');
const anchor = '  updateDate();\n  refresh();\n})();';
assert.ok(source.includes(anchor), 'widget initialization anchor exists');
const instrumented = source.replace(anchor, '  globalThis.__homeTours = {state,today,refresh};\n' + anchor);

function row(patch = {}) {
  return {id:'tour-1',customer_name:'Test Customer',customer_info:'Test note',tour_date:'2026-09-29',
    tour_time:'11:00:00',has_file:'yes',booking_status:'tentative',staff_initials:'CR',deleted_at:null,...patch};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(predicate){for(let i=0;i<100&&!predicate();i++) await Promise.resolve();assert.ok(predicate(),'operation reached expected state');}

function harness({at='2026-09-29T23:00:00Z', rows=[], active=true, intercept=null}={}) {
  let now=at;
  const nodes=new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g),([,id])=>[id,{
    id,textContent:'',innerHTML:'',disabled:false,attributes:{},events:{},classes:new Set(),
    setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(name,callback){this.events[name]=callback;}
  }]));
  nodes.forEach(node=>node.classList={toggle(name,on){if(on)node.classes.add(name);else node.classes.delete(name);}});
  const get=id=>{assert.ok(nodes.has(id),'widget contains #'+id);return nodes.get(id);};
  const timers=[];
  const api={rows,active,calls:[],session:{user:{id:'staff-1'}},authCallback:null,intercept};
  function complete(call) {
    api.calls.push(call);
    const intercepted=api.intercept?.(call);
    if(intercepted!==undefined)return Promise.resolve(intercepted);
    if(call.table==='hq_tour_staff') return Promise.resolve({data:api.active?{user_id:'staff-1',active:true}:null,error:null});
    let data=api.rows.filter(record=>call.filters.every(([,field,value])=>record[field]===value));
    data.sort((a,b)=>{
      for(const [field,ascending] of call.orders){const order=String(a[field]).localeCompare(String(b[field]));if(order)return ascending?order:-order;}
      return 0;
    });
    data=data.slice(call.range[0],call.range[1]+1);
    // Supabase only returns selected fields; deleted_at is not part of the payload.
    data=data.map(record=>Object.fromEntries(call.fields.split(',').map(field=>[field,record[field]])));
    return Promise.resolve({data,error:null});
  }
  const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){api.authCallback=fn;}},
    from(table){
      const call={table,filters:[],orders:[],fields:''};
      const query={select(fields){call.fields=fields;return query;},
        eq(field,value){call.filters.push(['eq',field,value]);return query;},
        is(field,value){call.filters.push(['is',field,value]);return query;},
        order(field,{ascending=true}={}){call.orders.push([field,ascending]);return query;},
        range(start,end){call.range=[start,end];return complete(call);},
        maybeSingle(){return complete(call);}};
      return query;
    }};
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({document:{getElementById:get,hidden:false,addEventListener(){}},
    window:{addEventListener(){}},supabaseClient:client,Date:ClockDate,
    setInterval(){return 1;},setTimeout(callback){timers.push(callback);return timers.length;}});
  vm.runInContext(instrumented,context,{filename:'home-tours.js'});
  const app=context.__homeTours;
  return {app,api,get,timers,setNow(value){now=value;},
    async settle(){await until(()=>!app.state.loading);},
    signOut(){api.session=null;api.authCallback('SIGNED_OUT',null);},
    runTimers(){for(const callback of timers.splice(0))callback();}};
}

test('shows all of Eastern today, including earlier times; excludes deleted and other days; orders soonest first',async()=>{
  const h=harness({rows:[row({id:'late',customer_name:'Afternoon',tour_time:'14:00:00'}),
    row({id:'early',customer_name:'Morning',tour_time:'10:30:00'}),
    row({id:'otherday',customer_name:'Tomorrow',tour_date:'2026-09-30'}),
    row({id:'deleted',customer_name:'Removed',deleted_at:'2026-09-29T00:00:00Z'}),
    row({id:'prior',customer_name:'Yesterday',tour_date:'2026-09-28'})]});
  await h.settle();
  assert.deepEqual(Array.from(h.app.state.rows,r=>r.id),['early','late']);
  assert.equal(h.get('homeToursCount').textContent,'2');
  const list=h.get('homeToursList').innerHTML;
  assert.ok(list.indexOf('Morning')<list.indexOf('Afternoon'));
  for(const excluded of ['Tomorrow','Removed','Yesterday'])assert.ok(!list.includes(excluded));
  const query=h.api.calls.find(c=>c.table==='hq_tours');
  assert.deepEqual(query.filters,[['eq','tour_date','2026-09-29'],['is','deleted_at',null]]);
});

test('UTC midnight does not prematurely switch the Eastern calendar date',async()=>{
  const h=harness({at:'2026-09-30T03:59:00Z',rows:[row()]});
  await h.settle();
  assert.equal(h.app.today(),'2026-09-29');
  assert.equal(h.get('homeToursCount').textContent,'1');
  h.setNow('2026-09-30T04:00:00Z');
  await h.app.refresh();
  assert.equal(h.app.today(),'2026-09-30');
  assert.equal(h.get('homeToursCount').textContent,'0');
  assert.match(h.get('homeToursList').innerHTML,/No Tours Scheduled for Today/);
});

test('request crossing Eastern midnight discards yesterday and automatically fetches new day',async()=>{
  const pending=deferred();let held=true;
  const h=harness({at:'2026-09-30T03:59:59Z',rows:[row({id:'today',customer_name:'New day customer',tour_date:'2026-09-30'})],
    intercept:call=>call.table==='hq_tours'&&held?pending.promise:undefined});
  await until(()=>h.api.calls.some(c=>c.table==='hq_tours'));
  h.setNow('2026-09-30T04:00:01Z');held=false;
  pending.resolve({data:[row({customer_name:'Yesterday response'})],error:null});
  await h.settle();
  assert.ok(!h.get('homeToursList').innerHTML.includes('Yesterday response'));
  assert.equal(h.get('homeToursCount').textContent,'—');
  assert.equal(h.timers.length,1);
  h.runTimers();await h.settle();
  assert.equal(h.app.state.loadedDate,'2026-09-30');
  assert.equal(h.get('homeToursCount').textContent,'1');
  assert.match(h.get('homeToursList').innerHTML,/New day customer/);
});

test('a failed load is unavailable, never a misleading empty schedule; refresh error labels retained data',async()=>{
  const h=harness({rows:[row()],intercept:call=>call.table==='hq_tours'?{data:null,error:{code:'NETWORK'}}:undefined});
  await h.settle();
  assert.equal(h.get('homeToursCount').textContent,'—');
  assert.ok(!h.get('homeToursList').innerHTML.includes('No Tours Scheduled for Today'));
  assert.match(h.get('homeToursStatus').textContent,/Could not load/);
  assert.ok(h.get('homeToursStatus').classes.has('is-error'));
  h.api.intercept=null;await h.app.refresh();
  assert.equal(h.get('homeToursCount').textContent,'1');
  h.api.intercept=call=>call.table==='hq_tours'?{data:null,error:{code:'NETWORK'}}:undefined;
  await h.app.refresh({silent:true});
  assert.equal(h.get('homeToursCount').textContent,'1');
  assert.match(h.get('homeToursStatus').textContent,/Showing the last loaded schedule/);
});

test('sign-out suppresses delayed records and denied staff never fetch tour data',async()=>{
  const pending=deferred();
  const h=harness({intercept:call=>call.table==='hq_tours'?pending.promise:undefined});
  await until(()=>h.api.calls.some(c=>c.table==='hq_tours'));
  h.signOut();pending.resolve({data:[row({customer_name:'Private customer'})],error:null});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(h.app.state.rows.length,0);
  assert.equal(h.get('homeToursCount').textContent,'—');
  assert.ok(!h.get('homeToursList').innerHTML.includes('Private customer'));
  assert.match(h.get('homeToursStatus').textContent,/Sign in/);
  const denied=harness({active:false});await denied.settle();
  assert.equal(denied.api.calls.filter(c=>c.table==='hq_tours').length,0);
  assert.equal(denied.get('homeToursCount').textContent,'—');
  assert.match(denied.get('homeToursStatus').textContent,/access/);
});

test('pagination includes every record and customer markup renders as text',async()=>{
  const rows=Array.from({length:501},(_,i)=>row({id:String(i).padStart(4,'0'),customer_name:i===500?'<script>customer</script>':'Customer '+i}));
  const h=harness({rows});await h.settle();
  assert.equal(h.get('homeToursCount').textContent,'501');
  assert.deepEqual(h.api.calls.filter(c=>c.table==='hq_tours').map(c=>c.range),[[0,499],[500,999]]);
  const list=h.get('homeToursList').innerHTML;
  assert.ok(!list.includes('<script>'));
  assert.match(list,/&lt;script&gt;customer&lt;\/script&gt;/);
});
