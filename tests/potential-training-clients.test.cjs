/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.POTENTIAL_TRAINING_CLIENTS_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'potential-training-clients.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/potential-training-clients.js'),'utf8');
const fields=['owner','dog','phone','initial_conversation','first_contact','follow_up','evaluation','outcome'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const log=(extra={})=>({id:uuid(11),owner:'Fixture owner',dog:'',phone:'',initial_conversation:'',first_contact:'',follow_up:'',evaluation:'',outcome:'Fixture outcome',position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<400&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({logs=[log()],active=true,intercept=null,now='2026-10-01T14:00:00Z'}={}) {
 const api={logs:clone(logs),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
 const nodes=new Map(),rows=new Map(),errors=new Map(),restores=new Map(),timers=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){return selector==='[data-restore-row]'?[...restores.values()]:[];},querySelector(selector){const m=selector.match(/\[data-(row|error)-id="([^"]+)"\]/);return m?(m[1]==='row'?rows:errors).get(m[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,classes:new Set(),children:[],
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
   setAttribute(){},matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},
   closest(selector){if(selector==='#clientRows')return this.row?nodes.get('clientRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='clientRows')parseRows(value);if(id==='deletedList')parseRestores(value);}});return n;
 }
 function parseRows(markup){rows.clear();errors.clear();for(const match of markup.matchAll(/<tr class="tr-row" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)){
  const row=node();row.dataset.rowId=match[1];row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;
  for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){
   const input=node();input.dataset.field=m[1];input.tagName='TEXTAREA';input.value=decode(m[2]).replace(/\r\n?/g,'\n');
   input.row=row;row.children.push(input);
  }
  rows.set(match[1],row);const err=node();err.button=node();err.button.dataset.id=match[1];err.button.dataset.action='retry';err.errorText=node();errors.set(match[1],err);
 }}
 function parseRestores(markup){restores.clear();for(const m of markup.matchAll(/data-restore-row="([^"]+)"/g)){const button=node();button.dataset.restoreRow=decode(m[1]);restores.set(button.dataset.restoreRow,button);}}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],n);}
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  assert.equal(call.table,'hq_potential_training_clients');const list=api.logs;
  const matches=r=>call.filters.every(([k,v])=>r[k]===v);
  if(call.op==='insert'){
   if(list.some(r=>r.id===call.payload.id))return {data:null,error:{code:'23505'}};
   const row=log({...call.payload,position:String(Math.max(0,...api.logs.map(r=>Number(r.position)))+1)});list.push(row);return {data:clone(row),error:null};
  }
  if(call.op==='update'){const i=list.findIndex(matches);if(i<0)return {data:null,error:null};list[i]={...list[i],...call.payload,revision:list[i].revision+1};return {data:clone(list[i]),error:null};}
  let data=list.filter(matches);data.sort((a,b)=>String(a.id).localeCompare(String(b.id)));if(call.range)data=data.slice(call.range[0],call.range[1]+1);
  return {data:call.range?clone(data):clone(data[0]||null),error:null};
 }
 const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){api.callbacks.push(fn);}},from(table){
  const call={table,op:'select',filters:[]};const run=()=>complete(call);const chain={select(){return chain;},eq(k,v){call.filters.push([k,v]);return chain;},order(){return chain;},range(a,b){call.range=[a,b];return run();},update(p){call.op='update';call.payload=clone(p);return chain;},insert(p){call.op='insert';call.payload=clone(p);return chain;},single:run,maybeSingle:run};return chain;
 }};
 const window={events:{},addEventListener(type,fn){(this.events[type]||=[]).push(fn);}};
 class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,console,crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
 const marker="  if (document.readyState==='loading')";
 assert.equal(source.split(marker).length,2);
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,sortLogs,renderRows,addRow,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,errors,restores,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  input(id,key,value){const input=rows.get(id).children.find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},
  runTimers(delay){for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}}
 };
}
test('compact table has all eight free-text editable cells and direct add/delete controls',async()=>{
 const h=environment();await h.start();const cells=h.rows.get(uuid(11)).children;
 assert.deepEqual(cells.map(cell=>cell.dataset.field),fields);
 assert.ok(cells.every(cell=>cell.tagName==='TEXTAREA'));assert.doesNotMatch(h.get('clientRows').innerHTML,/<select/);assert.match(h.get('clientRows').innerHTML,/maxlength="20000"/);
 assert.ok(h.get('addRow'));assert.equal(h.get('dogSelect'),undefined);
});
test('editing an owner name changes only that cell and preserves literal contact details and outcome',async()=>{
 const original=log({first_contact:'  8/19  ',outcome:' First line\r\nSecond line  ',source_file:'Fixture.csv',source_row:4,source_values:['Fixture owner','','','','  8/19  ','','',' First line\r\nSecond line  ']});
 const h=environment({logs:[original]});await h.start();h.input(original.id,'owner','Renamed location');await h.save(original.id);
 const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='owner'?'Renamed location':original[key]);
 assert.deepEqual(saved.source_values,original.source_values);assert.equal(saved.source_row,4);assert.equal(saved.position,'1');
 const call=h.api.calls.find(c=>c.op==='update');assert.deepEqual(call.payload,{owner:'Renamed location'});assert.ok(call.filters.some(([key,value])=>key==='revision'&&value===1));
});
test('normalized textarea no-op preserves original line endings and whitespace',async()=>{
 const h=environment({logs:[log({owner:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'owner','Line\nTwo  ');await h.save(uuid(11));
 assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].owner,'Line\r\nTwo  ');
});
test('contact and outcome cells accept literal mixed text without coercion',async()=>{
 const h=environment({logs:[log({first_contact:'10/1 — left a message',outcome:'Pending — revisit after the weekend.'})]});await h.start();
 for(const key of ['first_contact','outcome'])assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field===key).value,h.api.logs[0][key]);
 h.input(uuid(11),'first_contact','next Thursday, after lunch');await h.save(uuid(11));assert.equal(h.api.logs[0].first_contact,'next Thursday, after lunch');assert.equal(h.api.logs[0].outcome,'Pending — revisit after the weekend.');
});
test('a blank new row stays local and can be removed without a database request',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 await h.save(editor.id);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);assert.equal(h.api.logs.length,0);
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);
});
test('a partial row with only outcome saves and later edits update the same record',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 h.input(editor.id,'outcome','  AB / CD  ');await h.save(editor.id);h.input(editor.id,'owner','Later location');await h.save(editor.id);
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].outcome,'  AB / CD  ');assert.equal(h.api.logs[0].first_contact,'');assert.equal(h.api.logs[0].owner,'Later location');
});
test('blur saves while tabbing to another cell without replacing focus',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'owner','Changed');const next=h.rows.get(uuid(11)).children[1];next.focus();
 await h.get('clientRows').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.logs[0].owner==='Changed');
 assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children[1],next);
});
test('new typing during an in-flight save queues behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'owner','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'outcome','Typed during save');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].outcome,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='outcome').value,'Typed during save');
});
test('lost insert response reuses the UUID and preserves the newer draft',async()=>{
 let fail=true;const h=environment({logs:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.logs.push(log({...call.payload,position:'1'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.app.addRow();const editor=[...h.app.state.editors.values()][0];h.input(editor.id,'owner','First');await h.save(editor.id);assert.ok(editor.error);
 h.input(editor.id,'owner','Second');await h.save(editor.id);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,editor.id);assert.equal(h.api.logs[0].owner,'Second');
});
test('lost update response recovers the saved revision before applying a newer draft',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'owner','First');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.input(uuid(11),'outcome','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].owner,'First');assert.equal(h.api.logs[0].outcome,'CD');assert.equal(h.api.logs[0].revision,3);
});
test('different-cell edits merge while same-cell conflicts retain the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'outcome','Local');h.api.logs[0]={...h.api.logs[0],owner:'Remote location',revision:2};await h.save(uuid(11));
 assert.equal(h.api.logs[0].owner,'Remote location');assert.equal(h.api.logs[0].outcome,'Local');
 h.input(uuid(11),'outcome','New local');h.api.logs[0]={...h.api.logs[0],outcome:'New remote',revision:4};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.outcome,'New local');assert.equal(h.api.logs[0].outcome,'New remote');
 assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');
});
test('clearing the last value during an in-flight save reports an unsaved empty row',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({owner:'Start',first_contact:'',outcome:''})],intercept(call){if(call.op==='update'){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'owner','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'owner','');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.match(h.app.state.editors.get(uuid(11)).error,/empty/);assert.equal(h.get('saveStatus').textContent,'Some changes are not saved');
});
test('focused or unfinished cells block refresh and every field is disabled while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'outcome','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);
 await h.save(uuid(11));await h.app.refresh();assert.equal(h.api.calls.filter(c=>c.range).length,1);h.document.activeElement=null;
 h.api.intercept=call=>{if(call.table==='hq_potential_training_clients'&&call.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);
 assert.ok(h.rows.get(uuid(11)).children.every(cell=>cell.disabled));gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='outcome').value,'Draft');
});
test('Delete avoids an unwanted blur save and soft-deletes the row',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'owner','Local draft'),row=h.rows.get(uuid(11));
 await h.get('clientRows').emit('pointerdown',{target:row.button});
 await h.get('clientRows').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 const mutations=h.api.calls.filter(call=>call.op==='update');assert.equal(mutations.length,1);assert.deepEqual(Object.keys(mutations[0].payload),['deleted_at']);
 assert.equal(h.rows.size,0);assert.equal(h.get('deletedCount').textContent,1);assert.equal(h.get('deletedSection').open,true);
});
test('tabbing from the final How did it go? cell to Delete still autosaves that cell',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'outcome','Call again tomorrow.'),button=h.rows.get(uuid(11)).button;button.focus();
 await h.get('clientRows').emit('focusout',{target:input,relatedTarget:button});h.runTimers(0);await until(()=>h.api.logs[0].outcome==='Call again tomorrow.');
 assert.equal(h.document.activeElement,button);assert.equal(h.api.logs[0].deleted_at,null);
});
test('deleted entries stay restorable after the five-second notice expires and after refresh',async()=>{
 const original=log({source_values:['Fixture owner','','','','','','','Fixture outcome']});const h=environment({logs:[original]});await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.runTimers(5000);assert.equal(h.get('toast').hidden,true);assert.ok(h.restores.has(uuid(11)));await h.app.refresh();assert.ok(h.restores.has(uuid(11)));
 await h.get('deletedList').emit('click',{target:h.restores.get(uuid(11))});await until(()=>!h.app.state.undoSaving);
 assert.equal(h.api.logs[0].deleted_at,null);assert.equal(h.rows.size,1);assert.deepEqual(h.api.logs[0].source_values,original.source_values);assert.equal(h.get('deletedCount').textContent,0);
});
test('lost delete response has a safe retry and supports Undo',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&call.payload.deleted_at&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 const editor=h.app.state.editors.get(uuid(11));await h.app.deleteRow(editor);assert.ok(editor.error);assert.ok(h.rows.get(uuid(11)).children.every(cell=>cell.disabled));assert.equal(h.errors.get(uuid(11)).button.dataset.action,'delete');
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);await h.app.undoDelete();assert.equal(h.api.logs[0].deleted_at,null);assert.equal(h.rows.size,1);
});
test('lost restore response recovers the existing active record',async()=>{
 const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=(call,api)=>{if(call.op==='update'&&call.payload.deleted_at===null){api.logs[0]={...api.logs[0],deleted_at:null,revision:3};return {data:null,error:{code:'NETWORK'}};}};
 await h.app.undoDelete();assert.equal(h.rows.size,1);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toastText').textContent,'Entry restored.');
});
test('restoring while another row is focused preserves that draft and displays the restored row after blur',async()=>{
 const h=environment({logs:[log(),log({id:uuid(12),position:'2',deleted_at:'2026-10-01'})]});await h.start();
 const input=h.input(uuid(11),'outcome','Focused draft');await h.app.undoDelete(h.app.state.logs.find(row=>row.id===uuid(12)));
 assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.logs.find(row=>row.id===uuid(12)).deleted_at,null);
 h.document.activeElement=null;await h.get('clientRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(12)));
 assert.equal(h.api.logs.find(row=>row.id===uuid(11)).outcome,'Focused draft');assert.equal(h.rows.size,2);
});
test('restore blocks simultaneous refresh, Add row, and a second restore',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=call=>{if(call.op==='update'&&call.payload.deleted_at===null){held=true;return gate.promise;}};const restore=h.app.undoDelete();await until(()=>held);
 const count=h.api.calls.length;await h.app.refresh();await h.app.undoDelete();h.app.addRow();assert.equal(h.api.calls.length,count);assert.equal(h.app.state.editors.size,0);assert.ok(h.restores.get(uuid(11)).disabled);
 h.api.logs[0]={...h.api.logs[0],deleted_at:null,revision:3};gate.resolve({data:clone(h.api.logs[0]),error:null});await restore;assert.equal(h.rows.size,1);
});
test('anonymous and unapproved accounts never fetch training client records',async()=>{
 for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_potential_training_clients').length,0);assert.equal(h.rows.size,0);assert.equal(h.get('addRow').disabled,true);}
});
test('sign-out rejects delayed save, delete, restore and fetch responses',async()=>{
 for(const mode of ['save','delete','restore','fetch']){
  const h=environment();await h.start();if(mode==='restore')await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_potential_training_clients'){pending=call;return gate.promise;}};
  let mutation;if(mode==='save'){h.input(uuid(11),'owner','Late location');mutation=h.save(uuid(11));}else if(mode==='delete')mutation=h.app.deleteRow(h.app.state.editors.get(uuid(11)));else if(mode==='restore')mutation=h.app.undoDelete();else mutation=h.app.refresh();
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[log()]:log({owner:'Late location',revision:2}),error:null});await mutation;
  assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toast').hidden,true);
 }
});
test('pagination preserves more than 1,000 entries and sorts large source positions exactly',async()=>{
 const logs=Array.from({length:1001},(_,i)=>log({id:uuid(100+i),position:String(9007199254740993n+BigInt(i))}));const h=environment({logs});await h.start();
 assert.equal(h.app.state.logs.length,1001);assert.equal(h.rows.keys().next().value,uuid(1100));assert.deepEqual(h.api.calls.filter(call=>call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('owner names, contacts and outcome are escaped in active and deleted entries',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='\"><img src=x onerror=alert(1)>';
 const h=environment({logs:[log({owner:payload,first_contact:custom,outcome:payload}),log({id:uuid(12),owner:payload,outcome:custom,deleted_at:'2026-10-01'})]});await h.start();
 assert.doesNotMatch(h.get('clientRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);
 assert.equal(h.rows.get(uuid(11)).children.length,8);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='owner').value,payload);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='first_contact').value,custom);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='outcome').value,payload);
 assert.match(h.get('deletedList').innerHTML,/&lt;\/textarea&gt;/);
});

test('saved clients sort by newest added position while dates, names and created timestamps have no effect',async()=>{
 const logs=[log({id:uuid(11),owner:'Zeta Owner',position:'1',first_contact:'10/01/2099',created_at:'2099-10-01T12:00:00Z'}),log({id:uuid(12),owner:'Alpha Owner',position:'2',first_contact:'1/1/2001',created_at:'2001-01-01T12:00:00Z'}),log({id:uuid(13),owner:'Middle Owner',position:'3',first_contact:'JS - called twice'})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(13),uuid(12),uuid(11)]);assert.deepEqual(h.api.logs,logs);
});

test('position ordering is exact beyond safe numeric integers and ignores source dates and rows',async()=>{
 const logs=[log({id:uuid(11),position:'9007199254740993',source_file:'Fixture.csv',source_row:20}),log({id:uuid(12),position:'9007199254740994',source_file:'Fixture.csv',source_row:2}),log({id:uuid(13),position:'9007199254740995',source_file:'Fixture.csv',source_row:4})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(13),uuid(12),uuid(11)]);
 h.input(uuid(11),'first_contact','10/14, called in the afternoon');await h.save(uuid(11));h.document.activeElement=null;h.app.renderRows();assert.deepEqual([...h.rows.keys()],[uuid(13),uuid(12),uuid(11)]);assert.equal(h.api.logs[0].position,'9007199254740993');
});

test('editing an older row never moves it and newly added drafts stay first without replacing focus',async()=>{
 const h=environment({logs:[log({position:'1'}),log({id:uuid(12),position:'2'})]});await h.start();const input=h.input(uuid(11),'owner','Renamed owner');await h.save(uuid(11));assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(11)]);assert.equal(h.document.activeElement,input);
 h.document.activeElement=null;await h.get('clientRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>!h.app.state.editors.get(uuid(11)).saving);assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(11)]);
 h.app.addRow();const first=[...h.rows.keys()][0];assert.ok(!h.app.state.editors.get(first).base);assert.equal(h.document.activeElement.dataset.field,'owner');h.app.addRow();assert.notEqual([...h.rows.keys()][0],first);assert.equal([...h.rows.keys()][1],first);
});

test('search matches all eight fields without case sensitivity or changing stored text',async()=>{
 const logs=fields.map((key,index)=>log({id:uuid(30+index),position:String(index+1),owner:`Fixture ${index}`,outcome:'',[key]:`  TOKEN-${index}  `}));
 const h=environment({logs});await h.start();
 for(let index=0;index<fields.length;index++){h.get('searchClients').value=`  token-${index} `;await h.get('searchClients').emit('input');assert.deepEqual([...h.rows.keys()],[uuid(30+index)],fields[index]);assert.equal(h.get('rowCount').textContent,'1 of 8 clients');}
 assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);
 h.get('searchClients').value='unmatched';await h.get('searchClients').emit('input');assert.equal(h.rows.size,0);assert.match(h.get('emptyState').textContent,/match/);assert.equal(h.get('emptyState').hidden,false);
 h.get('searchClients').value='';await h.get('searchClients').emit('input');assert.equal(h.rows.size,8);assert.equal([...h.rows.keys()][0],uuid(37));
});

test('Add stays visible and focused when search hides saved rows and blank drafts never insert',async()=>{
 const h=environment();await h.start();h.get('searchClients').value='unmatched';await h.get('searchClients').emit('input');assert.equal(h.rows.size,0);h.app.addRow();
 const draft=[...h.app.state.editors.values()].find(editor=>!editor.base);assert.ok(h.rows.has(draft.id));assert.equal(h.document.activeElement.dataset.field,'owner');assert.equal(h.document.activeElement.row.dataset.rowId,draft.id);
 await h.app.deleteRow(draft);assert.equal(h.rows.size,0);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
});

test('failed saves remain visible across search and Retry updates the same client record',async()=>{
 let fail=true;const h=environment({intercept(call){if(call.op==='update'&&fail){fail=false;return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.input(uuid(11),'follow_up','  JS called 10/14; no reply yet  ');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.document.activeElement=null;h.get('searchClients').value='missing';await h.get('searchClients').emit('input');assert.ok(h.rows.has(uuid(11)));assert.match(h.get('rowCount').textContent,/unsaved rows stay visible/);
 await h.get('clientRows').emit('click',{target:h.errors.get(uuid(11)).button});await until(()=>!h.app.state.editors.get(uuid(11)).saving);assert.equal(h.api.logs[0].follow_up,'  JS called 10/14; no reply yet  ');assert.equal(h.rows.size,0);assert.equal(h.api.logs.length,1);
});

test('all eight fields update independently while original source archive and position stay unchanged',async()=>{
 const literals=['  Fixture Owner  ','Dog A & Dog B','0012345678','AB / ?','10/14','JS 8/10, left message','Not ready; refer elsewhere - AB',' First line\r\nSecond line  '];
 const original=log({...Object.fromEntries(fields.map((key,index)=>[key,literals[index]])),source_file:'Fixture.csv',source_row:7,source_values:literals});const h=environment({logs:[original]});await h.start();
 for(const key of fields){h.input(uuid(11),key,`${original[key]} changed`);await h.save(uuid(11));const call=h.api.calls.filter(call=>call.op==='update').at(-1);assert.deepEqual(Object.keys(call.payload),[key]);}
 for(const key of fields)assert.equal(h.api.logs[0][key],`${original[key]} changed`);assert.deepEqual(h.api.logs[0].source_values,literals);assert.equal(h.api.logs[0].source_row,7);assert.equal(h.api.logs[0].position,'1');
});

test('contact, follow-up and evaluation fields preserve yearless dates, times and prose without interpretation',async()=>{
 const original=log({dog:'? & Second dog',phone:'(001) 234-5678',initial_conversation:'?',first_contact:'8/10',follow_up:'AB 10/14 — called twice',evaluation:'8/27 3;30 — needs more time',outcome:'Lost client / referred elsewhere'});
 const h=environment({logs:[original]});await h.start();for(const key of fields)assert.equal(h.rows.get(uuid(11)).children.find(input=>input.dataset.field===key).value,original[key]);
 h.input(uuid(11),'evaluation','Not a fit; refer to another trainer - AB');await h.save(uuid(11));assert.equal(h.api.logs[0].evaluation,'Not a fit; refer to another trainer - AB');assert.equal(h.api.logs[0].first_contact,'8/10');assert.equal(h.api.logs[0].follow_up,original.follow_up);
 assert.doesNotMatch(h.get('clientRows').innerHTML,/<select|type="(?:number|email|time|date)"/);assert.doesNotMatch(source,/Date\.UTC|Date\.parse|function .*Date\(/);
});

test('phone information embedded in owner text stays there and does not fill the phone field',async()=>{
 const original=log({owner:'Fixture Owner 001-234-5678 ',phone:'',dog:'?'});const h=environment({logs:[original]});await h.start();h.input(uuid(11),'initial_conversation','AB');await h.save(uuid(11));
 assert.equal(h.api.logs[0].owner,original.owner);assert.equal(h.api.logs[0].phone,'');assert.equal(h.api.logs[0].dog,'?');assert.equal(h.rows.get(uuid(11)).children.find(input=>input.dataset.field==='owner').value,original.owner);
});

test('owner-only and evaluation-only partial rows save with all other fields blank',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();let editor=[...h.app.state.editors.values()][0];h.input(editor.id,'owner','  Partial Owner  ');await h.save(editor.id);
 assert.equal(h.api.logs.length,1);for(const key of fields.filter(key=>key!=='owner'))assert.equal(h.api.logs[0][key],'');
 h.app.addRow();editor=[...h.app.state.editors.values()].find(editor=>!editor.base);h.input(editor.id,'evaluation','Awaiting an evaluation');await h.save(editor.id);assert.equal(h.api.logs.length,2);for(const key of fields.filter(key=>key!=='evaluation'))assert.equal(h.api.logs[1][key],'');
});

test('focused long notes expand for reading then collapse and reset scroll on blur',async()=>{
 const h=environment();await h.start();
 for(const key of ['initial_conversation','first_contact','follow_up','evaluation','outcome']){const value='  First line\nSecond line with details  ',input=h.input(uuid(11),key,value);input.scrollHeight=170;await h.get('clientRows').emit('focusin',{target:input});assert.equal(input.style.height,'170px');input.scrollTop=100;input.scrollLeft=80;
  h.document.activeElement=null;await h.get('clientRows').emit('focusout',{target:input});assert.equal(input.style.height,'');assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);h.runTimers(0);await until(()=>h.api.logs[0][key]===value);}
});

test('deleted clients retain all eight values and restore after the five-second notice expires',async()=>{
 const literals=['Fixture Owner','Dog A & Dog B','0012345678','AB','10/14','Called twice ','Refer elsewhere','Full note\nKeep this history  '],original=log({...Object.fromEntries(fields.map((key,index)=>[key,literals[index]])),source_file:'Fixture.csv',source_row:3,source_values:literals});
 const h=environment({logs:[original]});await h.start();h.document.activeElement=null;await h.app.deleteRow(h.app.state.editors.get(uuid(11)));assert.equal(h.rows.size,0);h.runTimers(5000);assert.equal(h.get('toast').hidden,true);await h.app.refresh();await h.get('deletedList').emit('click',{target:h.restores.get(uuid(11))});await until(()=>!h.app.state.undoSaving);
 for(const key of fields)assert.equal(h.api.logs[0][key],original[key]);assert.deepEqual(h.api.logs[0].source_values,literals);assert.equal(h.api.logs[0].deleted_at,null);assert.equal(h.rows.size,1);
});

test('duplicate owner and dog names remain separate leads through update, deletion and restoration',async()=>{
 const logs=[log({owner:'Same owner',dog:'Same dog',position:'1'}),log({id:uuid(12),owner:'Same owner',dog:'Same dog',position:'2',outcome:'Another lead'})];const h=environment({logs});await h.start();h.get('searchClients').value='same';await h.get('searchClients').emit('input');assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(11)]);
 h.input(uuid(11),'outcome','Updated first lead');await h.save(uuid(11));assert.equal(h.api.logs[1].outcome,'Another lead');h.document.activeElement=null;await h.app.deleteRow(h.app.state.editors.get(uuid(11)));assert.equal(h.rows.size,1);await h.app.undoDelete();assert.equal(h.rows.size,2);assert.equal(h.api.logs.length,2);assert.equal(h.api.logs[0].outcome,'Updated first lead');
});

test('all eight field labels and generous text limits match the backend contract',async()=>{
 const h=environment();await h.start();const markup=h.get('clientRows').innerHTML,limits={owner:500,dog:500,phone:200,initial_conversation:2000,first_contact:2000,follow_up:20000,evaluation:20000,outcome:20000};
 for(const [key,limit]of Object.entries(limits))assert.match(markup,new RegExp(`data-field="${key}"[^>]*maxlength="${limit}"`));
 assert.match(markup,/aria-label="How did it go\?"/);assert.match(markup,/colspan="9"/);assert.equal((html.match(/<th scope="col">/g)||[]).length,9);
});

test('new page is linked once beside Dog Training in the sidebar and has clear table instructions',()=>{
 const sidebar=fs.readFileSync(path.join(root,'partials/sidebar.html'),'utf8');assert.equal((sidebar.match(/href="\/potential-training-clients.html"/g)||[]).length,1);assert.ok(sidebar.indexOf('href="/potential-training-clients.html"')>sidebar.indexOf('href="/training.html"'));assert.ok(sidebar.indexOf('href="/potential-training-clients.html"')<sidebar.indexOf('href="/dog-licenses.html"'));
 assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'),/potential-training-clients\.html|potential-training-clients\.js/);
 assert.match(html,/Changes save when you leave a cell/);assert.match(html,/Newest added first/);assert.match(html,/scroll sideways for follow-up and results/);assert.match(html,/scroll horizontally to see all columns/);
});

