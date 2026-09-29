const test=require('node:test');
const {assert,files,read,row,deferred,until,flush,environment}=require('./tour-test-helpers.cjs');
function harness(options={}){
  const h=environment({html:read(files.homeHtml),...options});
  const actions=[];let callbacks;
  const editor={busy:false,opened:false,isBusy(){return this.busy;},isOpen(){return this.opened;},
    open(value){actions.push(['open',value]);this.opened=true;},confirmDelete(value){actions.push(['delete',value]);this.opened=true;},
    restore(value){actions.push(['restore',value]);},reset(){actions.push(['reset']);this.busy=false;this.opened=false;}};
  h.window.createTourEditor=options=>{callbacks=options;return editor;};
  const source=read(files.home),anchor='  updateDate();\n  refresh();\n})();';assert.ok(source.includes(anchor));
  h.evaluate(source.replace(anchor,'  globalThis.__home = {state,today,localNow,refresh,render};\n'+anchor),'home-tours.js');
  return Object.assign(h,{app:h.context.__home,editor,actions,callbacks,async settle(){await until(()=>!this.app.state.loading);},
    async action(action,id){await this.click('homeToursList',{target:{closest(){return {dataset:{tourAction:action,id}};}}});}});
}
test('homepage includes earlier tours today, excludes other days/deleted, and sorts chronologically',async()=>{
  const h=harness({rows:[row({id:'late',tour_time:'14:00:00'}),row({id:'early',tour_time:'10:30:00'}),
    row({id:'tomorrow',tour_date:'2026-09-30'}),row({id:'removed',deleted_at:'2026-09-29T00:00:00Z'})]});await h.settle();
  assert.deepEqual(Array.from(h.app.state.rows,r=>r.id),['early','late']);assert.equal(h.get('homeToursCount').textContent,'2');
  assert.deepEqual(h.api.calls.find(c=>c.table==='hq_tours').filters,[['eq','tour_date','2026-09-29'],['is','deleted_at',null]]);
});
test('passed notice uses strictly earlier Eastern wall-clock minute and legacy booking is unknown',async()=>{
  const h=harness({at:'2026-09-29T16:00:00Z',rows:[row({id:'earlier',customer_name:'Earlier',tour_time:'11:59:00',booking_status:'tentative'}),
    row({id:'equal',customer_name:'Exact time',tour_time:'12:00:00'}),row({id:'later',customer_name:'Later',tour_time:'12:01:00'})]});await h.settle();
  const rendered=h.get('homeToursList').innerHTML;
  assert.equal((rendered.match(/Time passed/g)||[]).length,1);assert.match(rendered,/Booking unknown/);assert.ok(!rendered.includes('Tentative'));
  const items=rendered.split('<li class="home-tours-row">').slice(1);
  assert.ok(items[0].includes('Time passed'));assert.ok(!items[1].includes('Time passed'));assert.ok(!items[2].includes('Time passed'));
});
test('confirmed empty is compact; unavailable data never becomes a false empty schedule',async()=>{
  const empty=harness();await empty.settle();assert.ok(empty.get('homeToursWidget').classes.has('is-empty'));
  assert.match(empty.get('homeToursList').innerHTML,/No Tours Scheduled for Today/);
  const failure=harness({intercept:c=>c.table==='hq_tours'?{data:null,error:{code:'NETWORK'}}:undefined});await failure.settle();
  assert.equal(failure.get('homeToursCount').textContent,'—');assert.ok(!failure.get('homeToursWidget').classes.has('is-empty'));
  assert.ok(!failure.get('homeToursList').innerHTML.includes('No Tours Scheduled for Today'));assert.match(failure.get('homeToursStatus').textContent,/Could not load/);
  assert.equal(failure.get('homeToursAdd').disabled,true);
});
test('homepage add/edit/delete delegates to editor; applied rows immediately re-sort and re-filter',async()=>{
  const h=harness({rows:[row({id:'one'}),row({id:'two',tour_time:'12:00:00'})]});await h.settle();
  await h.click('homeToursAdd');assert.equal(h.actions.at(-1)[0],'open');assert.equal(h.actions.at(-1)[1],undefined);h.editor.opened=false;
  await h.action('edit','one');assert.equal(h.actions.at(-1)[0],'open');assert.equal(h.actions.at(-1)[1].id,'one');h.editor.opened=false;
  await h.action('delete','two');assert.equal(h.actions.at(-1)[0],'delete');assert.equal(h.actions.at(-1)[1].id,'two');h.editor.opened=false;
  h.callbacks.onChange(row({id:'two',tour_time:'10:30:00',revision:2}));assert.deepEqual(Array.from(h.app.state.rows,r=>r.id),['two','one']);
  h.callbacks.onChange(row({id:'one',tour_date:'2026-09-30',revision:2}));assert.deepEqual(Array.from(h.app.state.rows,r=>r.id),['two']);
  h.callbacks.onChange(row({id:'two',deleted_at:'2026-09-29T16:00:00Z',revision:3}));assert.equal(h.app.state.rows.length,0);assert.ok(h.get('homeToursWidget').classes.has('is-empty'));
  h.callbacks.onChange(row({id:'two',revision:4}));assert.equal(h.app.state.rows.length,1);assert.ok(!h.get('homeToursWidget').classes.has('is-empty'));
});
test('editing blocks background refresh and loading blocks editor actions',async()=>{
  const h=harness({rows:[row()]});await h.settle();
  h.editor.opened=true;const before=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,before);
  h.editor.opened=false;const pending=deferred();h.api.intercept=c=>c.table==='hq_tours'?pending.promise:undefined;
  const refresh=h.app.refresh();await until(()=>h.app.state.loading);await h.action('edit',row().id);await h.click('homeToursAdd');
  assert.equal(h.actions.length,0);pending.resolve({data:[row()],error:null});await refresh;
});
test('Eastern midnight discards a request for yesterday and reloads the correct day',async()=>{
  let held=true;const pending=deferred();
  const h=harness({at:'2026-09-30T03:59:59Z',rows:[row({id:'new',tour_date:'2026-09-30'})],intercept:c=>c.table==='hq_tours'&&held?pending.promise:undefined});
  assert.equal(h.app.today(),'2026-09-29');await until(()=>h.api.calls.some(c=>c.table==='hq_tours'));
  h.setNow('2026-09-30T04:00:01Z');held=false;pending.resolve({data:[row({customer_name:'Yesterday response'})],error:null});await h.settle();
  assert.equal(h.get('homeToursCount').textContent,'—');assert.ok(!h.get('homeToursList').innerHTML.includes('Yesterday response'));
  h.runTimers(0);await h.settle();assert.equal(h.app.state.loadedDate,'2026-09-30');assert.equal(h.get('homeToursCount').textContent,'1');
});
test('logout resets editor and suppresses delayed records; denied staff cannot fetch tours',async()=>{
  const pending=deferred();const h=harness({intercept:c=>c.table==='hq_tours'?pending.promise:undefined});
  await until(()=>h.api.calls.some(c=>c.table==='hq_tours'));h.signOut();pending.resolve({data:[row({customer_name:'Private customer'})],error:null});await flush();
  assert.equal(h.actions.at(-1)[0],'reset');assert.equal(h.app.state.rows.length,0);assert.equal(h.app.state.ready,false);
  assert.ok(!h.get('homeToursList').innerHTML.includes('Private customer'));assert.equal(h.get('homeToursAdd').disabled,true);
  const denied=harness({active:false});await denied.settle();assert.equal(denied.api.calls.some(c=>c.table==='hq_tours'),false);
});
test('pagination retains 501 rows, escapes text, and failed refresh labels retained data',async()=>{
  const rows=Array.from({length:501},(_,i)=>row({id:String(i).padStart(4,'0'),customer_name:i===500?'<script>bad</script>':'Customer '+i}));
  const h=harness({rows});await h.settle();assert.equal(h.get('homeToursCount').textContent,'501');
  assert.deepEqual(h.api.calls.filter(c=>c.table==='hq_tours').map(c=>c.range),[[0,499],[500,999]]);
  assert.match(h.get('homeToursList').innerHTML,/&lt;script&gt;bad&lt;\/script&gt;/);assert.ok(!h.get('homeToursList').innerHTML.includes('<script>'));
  h.api.intercept=c=>c.table==='hq_tours'?{data:null,error:{code:'NETWORK'}}:undefined;await h.app.refresh({silent:true});
  assert.equal(h.get('homeToursCount').textContent,'501');assert.match(h.get('homeToursStatus').textContent,/Showing the last loaded schedule/);
});
