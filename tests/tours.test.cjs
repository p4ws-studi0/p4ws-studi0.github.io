const test=require('node:test');
const {assert,files,read,row,deferred,until,flush,environment}=require('./tour-test-helpers.cjs');
function harness(options={}){
  const h=environment({html:read(files.toursHtml),...options});const actions=[];let callbacks;
  const editor={busy:false,opened:false,isBusy(){return this.busy;},isOpen(){return this.opened;},
    open(value){actions.push(['open',value]);},confirmDelete(value){actions.push(['delete',value]);},restore(value){actions.push(['restore',value]);},
    reset(){actions.push(['reset']);this.busy=false;this.opened=false;}};
  h.window.createTourEditor=options=>{callbacks=options;return editor;};
  const source=read(files.tours),anchor="  if (document.readyState === 'loading')";assert.ok(source.includes(anchor));
  h.evaluate(source.replace(anchor,'  globalThis.__tours = {state,sortTours,category,localNow,render,refresh,init};\n'+anchor),'tours.js');
  const app=h.context.__tours;app.init();
  return Object.assign(h,{app,editor,actions,callbacks,async settle(){await until(()=>!app.state.loading);},
    async action(action,id){await this.click('tourList',{target:{closest(){return {dataset:{action,id}};}}});}});
}
test('full schedule sorts across year and time boundaries and categories use Eastern time',async()=>{
  const h=harness({at:'2027-01-01T00:05:00Z'});await h.settle();
  const rows=[row({id:'jan',tour_date:'2027-01-01'}),row({id:'late',tour_date:'2026-12-31',tour_time:'15:00:00'}),row({id:'early',tour_date:'2026-12-31',tour_time:'10:30:00'})];
  assert.deepEqual(Array.from(h.app.sortTours(rows),r=>r.id),['early','late','jan']);assert.equal(h.app.localNow().date,'2026-12-31');
  assert.equal(h.app.category(rows[0]),'upcoming');assert.equal(h.app.category(rows[1]),'past');
  assert.equal(h.app.category(row({deleted_at:'2026-01-01T00:00:00Z'})),'deleted');
});
test('full schedule escapes customer content and displays legacy tentative as unknown',async()=>{
  const h=harness({rows:[row({tour_date:'2030-01-01',customer_name:'<script>bad</script>',customer_info:'<img onerror="bad">',booking_status:'tentative'})]});await h.settle();
  const html=h.get('tourList').innerHTML;assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.ok(!html.includes('<img'));assert.match(html,/Booking unknown/);assert.ok(!html.includes('Tentative'));
});
test('full schedule delegates editing/deletion/restoration and saves select the matching view',async()=>{
  const h=harness({rows:[row({id:'active',tour_date:'2030-01-01'}),row({id:'deleted',deleted_at:'2026-09-29T00:00:00Z'})]});await h.settle();
  await h.click('addTour');await h.action('edit','active');await h.action('delete','active');await h.action('restore','deleted');
  assert.deepEqual(h.actions.map(action=>action[0]),['open','open','delete','restore']);
  const past=row({id:'active',tour_date:'2026-09-28',revision:2});h.callbacks.onChange(past);h.get('tourSearch').value='old search';h.callbacks.onSaved(past);
  assert.equal(h.app.state.rows.find(r=>r.id==='active').revision,2);assert.equal(h.app.state.view,'past');assert.equal(h.get('tourSearch').value,'');
});
test('full schedule paginates beyond 500 and denies unapproved staff',async()=>{
  const h=harness({rows:Array.from({length:501},(_,i)=>row({id:String(i)}))});await h.settle();assert.equal(h.app.state.rows.length,501);
  assert.deepEqual(h.api.calls.filter(c=>c.table==='hq_tours').map(c=>c.range),[[0,499],[500,999]]);
  const denied=harness({active:false});await denied.settle();assert.equal(denied.api.calls.some(c=>c.table==='hq_tours'),false);assert.equal(denied.app.state.ready,false);
});
test('full schedule logout resets controller and ignores a delayed response',async()=>{
  const pending=deferred(),h=harness({intercept:c=>c.table==='hq_tours'?pending.promise:undefined});
  await until(()=>h.api.calls.some(c=>c.table==='hq_tours'));h.signOut();pending.resolve({data:[row({customer_name:'Private old session'})],error:null});await flush();
  assert.equal(h.actions.at(-1)[0],'reset');assert.equal(h.app.state.rows.length,0);assert.equal(h.app.state.ready,false);
  assert.ok(!h.get('tourList').innerHTML.includes('Private old session'));assert.match(h.get('pageMessage').textContent,/Sign in/);
});
