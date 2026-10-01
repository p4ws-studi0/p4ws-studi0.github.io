/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.TRAINING_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'training.html'),'utf8');
const source=fs.readFileSync(path.join(root,fs.existsSync(path.join(root,'assets/training.js'))?'assets/training.js':'training.js'),'utf8');
const fields=['day_label','date_label','session_label','time_label','trainer','work_detail','notes'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dog=(extra={})=>({id:uuid(1),name:'Fixture dog',revision:1,...extra});
const log=(extra={})=>({id:uuid(11),dog_id:uuid(1),day_label:'1',date_label:'4/5',session_label:'1/3',time_label:'9ish',trainer:'Coach',work_detail:'Practice',notes:'',position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<400&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({dogs=[dog()],logs=[log()],active=true,intercept=null}={}) {
 const api={dogs:clone(dogs),logs:clone(logs),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
 const nodes=new Map(),rows=new Map(),errors=new Map(),timers=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelector(selector){const m=selector.match(/\[data-(row|error)-id="([^"]+)"\]/);return m?(m[1]==='row'?rows:errors).get(m[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,classes:new Set(),children:[],
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
   setAttribute(){},matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},
   closest(selector){if(selector==='#trainingRows')return this.row?nodes.get('trainingRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='trainingRows')parseRows(value);}});return n;
 }
 function parseRows(markup){rows.clear();errors.clear();for(const match of markup.matchAll(/<tr class="tr-row" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)){
  const row=node();row.dataset.rowId=match[1];row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;
  for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){const input=node();input.dataset.field=m[1];input.value=decode(m[2]).replace(/\r\n?/g,'\n');input.row=row;row.children.push(input);}
  rows.set(match[1],row);const err=node();err.button=node();err.button.dataset.id=match[1];err.button.dataset.action='retry';err.errorText=node();errors.set(match[1],err);
 }}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],n);}
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  const list=call.table==='hq_training_dogs'?api.dogs:api.logs;
  const matches=r=>call.filters.every(([k,v])=>r[k]===v);
  if(call.op==='insert'){
   if(list.some(r=>r.id===call.payload.id))return {data:null,error:{code:'23505'}};
   const row=call.table==='hq_training_dogs'?dog(call.payload):log({...call.payload,position:String(Math.max(0,...api.logs.map(r=>Number(r.position)))+1)});list.push(row);return {data:clone(row),error:null};
  }
  if(call.op==='update'){const i=list.findIndex(matches);if(i<0)return {data:null,error:null};list[i]={...list[i],...call.payload,revision:list[i].revision+1};return {data:clone(list[i]),error:null};}
  let data=list.filter(matches);data.sort((a,b)=>String(a.id).localeCompare(String(b.id)));if(call.range)data=data.slice(call.range[0],call.range[1]+1);
  return {data:call.range?clone(data):clone(data[0]||null),error:null};
 }
 const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){api.callbacks.push(fn);}},from(table){
  const call={table,op:'select',filters:[]};const run=()=>complete(call);const chain={select(){return chain;},eq(k,v){call.filters.push([k,v]);return chain;},order(){return chain;},range(a,b){call.range=[a,b];return run();},update(p){call.op='update';call.payload=clone(p);return chain;},insert(p){call.op='insert';call.payload=clone(p);return chain;},single:run,maybeSingle:run};return chain;
 }};
 const window={events:{},addEventListener(type,fn){(this.events[type]||=[]).push(fn);}};
 class TestDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-01T14:00:00Z']));}static now(){return Date.parse('2026-10-01T14:00:00Z');}}
 const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,console,crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
 const marker="  if (document.readyState==='loading')";
 assert.equal(source.split(marker).length,2);
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,parseDateLabel,sortLogs,renderRows,selectDog,addRow,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty,saveDog};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,errors,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  input(id,key,value){const input=rows.get(id).children.find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},
  runTimers(delay){for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}}
 };
}
test('compact table exposes exactly seven editable cells and direct add/delete controls',async()=>{
 const h=environment();await h.start();assert.equal(h.rows.get(uuid(11)).children.length,7);assert.ok(h.get('addRow'));assert.equal(h.get('sessionDialog'),undefined);assert.equal(h.get('logSearch'),undefined);
});
test('editing one cell preserves all untouched literal values and source metadata',async()=>{
 const original=log({day_label:' 6\r\n',date_label:'',time_label:'after lunch',notes:'Note\r\nnext  ',source_values:['original']});const h=environment({logs:[original]});await h.start();
 h.input(original.id,'trainer','New coach');await h.save(original.id);const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='trainer'?'New coach':original[key]);assert.deepEqual(saved.source_values,['original']);
 assert.deepEqual(h.api.calls.find(c=>c.op==='update').payload,{trainer:'New coach'});
});
test('no-op normalized textarea values do not rewrite imported CRLF or whitespace',async()=>{
 const h=environment({logs:[log({notes:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'notes','Line\nTwo  ');await h.save(uuid(11));assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].notes,'Line\r\nTwo  ');
});
test('date sorting is deterministic across formats, blank rows, invalid labels and future entries',async()=>{
 const h=environment();const rows=[log({id:uuid(11),position:'1',date_label:''}),log({id:uuid(12),position:'2',date_label:'9/29'}),log({id:uuid(13),position:'3',date_label:''}),log({id:uuid(14),position:'4',date_label:'2026-10-01'}),log({id:uuid(15),position:'5',date_label:'9/28/26'}),log({id:uuid(16),position:'6',date_label:'2/30'})];
 assert.deepEqual(Array.from(h.app.sortLogs(rows),r=>r.id),[uuid(14),uuid(13),uuid(12),uuid(11),uuid(16),uuid(15)]);
 const future=log({id:uuid(17),position:'7',date_label:'1/1/2027'});assert.deepEqual(Array.from(h.app.sortLogs([...rows,future]),r=>r.id),[uuid(17),uuid(14),uuid(13),uuid(12),uuid(11),uuid(16),uuid(15)]);
 assert.equal(h.app.parseDateLabel('2/30/2026'),null);assert.equal(h.app.parseDateLabel('tomorrow'),null);assert.equal(h.app.parseDateLabel('Oct 1, 2026').month,10);
 assert.deepEqual(rows.map(r=>r.date_label),['','9/29','','2026-10-01','9/28/26','2/30']);
});
test('new partial row accepts flexible values and repeated saves append only one row',async()=>{
 const h=environment();await h.start();h.app.addRow();const fresh=[...h.app.state.editors.values()].find(e=>!e.base);h.input(fresh.id,'date_label','');h.input(fresh.id,'time_label','after lunch, about 20 min');await h.save(fresh.id);h.input(fresh.id,'notes','partial entry');await h.save(fresh.id);assert.equal(h.api.logs.length,2);assert.equal(h.api.logs[1].date_label,'');assert.equal(h.api.logs[1].time_label,'after lunch, about 20 min');
});
test('blur saves cell while tabbing to the next cell without replacing focus or newer text',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'trainer','Changed');const next=h.rows.get(uuid(11)).children.find(i=>i.dataset.field==='notes');next.focus();await h.get('trainingRows').emit('focusout',{target:first});h.runTimers(0);await until(()=>h.api.logs[0].trainer==='Changed');assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children.find(i=>i.dataset.field==='notes'),next);
});
test('edits made while a row saves queue behind the returned revision without loss',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();h.input(uuid(11),'trainer','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'notes','Typed during save');h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;assert.equal(h.api.logs[0].notes,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children.find(i=>i.dataset.field==='notes').value,'Typed during save');
});
test('lost insert response recovers the same UUID and preserves newer draft text',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='insert'&&call.table==='hq_training_logs'&&fail){fail=false;api.logs.push(log({...call.payload,position:'2'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.app.addRow();const e=[...h.app.state.editors.values()].find(e=>!e.base);h.input(e.id,'notes','First');await h.save(e.id);assert.ok(e.error);h.input(e.id,'notes','Second');await h.save(e.id);assert.equal(h.api.logs.filter(r=>r.id===e.id).length,1);assert.equal(h.api.logs.find(r=>r.id===e.id).notes,'Second');
});
test('teammate edits to another cell merge; same-cell conflicts keep the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'notes','Local');h.api.logs[0]={...h.api.logs[0],trainer:'Remote',revision:2};await h.save(uuid(11));assert.equal(h.api.logs[0].trainer,'Remote');assert.equal(h.api.logs[0].notes,'Local');
 h.input(uuid(11),'notes','New local');h.api.logs[0]={...h.api.logs[0],notes:'New remote',revision:4};await h.save(uuid(11));const e=h.app.state.editors.get(uuid(11));assert.ok(e.conflict);assert.equal(e.values.notes,'New local');assert.equal(h.api.logs[0].notes,'New remote');
});
test('clearing the final value during an in-flight save reports the unsaved empty row',async()=>{
 const gate=deferred();let call;const blank=Object.fromEntries(fields.map(k=>[k,'']));const h=environment({logs:[log({...blank,notes:'Start'})],intercept(c){if(c.op==='update'){call=c;return gate.promise;}}});await h.start();h.input(uuid(11),'notes','First');const save=h.save(uuid(11));await until(()=>call);h.input(uuid(11),'notes','');h.api.logs[0]={...h.api.logs[0],...call.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;assert.match(h.app.state.editors.get(uuid(11)).error,/empty/);assert.equal(h.get('saveStatus').textContent,'Some changes are not saved');
});
test('refresh never replaces focused or unsaved cells and disables inputs while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'notes','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);assert.equal(h.rows.get(uuid(11)).children[6].value,'Draft');await h.save(uuid(11));h.document.activeElement=null;
 h.api.intercept=c=>{if(c.table==='hq_training_logs'&&c.op==='select'&&c.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);assert.ok(h.rows.get(uuid(11)).children[0].disabled);gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children[6].value,'Draft');
});
test('delete is reversible and a failed-delete retry cannot strand editable cells',async()=>{
 let fail=true;const h=environment({intercept(c,api){if(c.op==='update'&&c.payload.deleted_at&&fail){fail=false;api.logs[0]={...api.logs[0],...c.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();const e=h.app.state.editors.get(uuid(11));await h.app.deleteRow(e);assert.ok(e.error);assert.ok(h.rows.get(uuid(11)).children[0].disabled);assert.equal(h.errors.get(uuid(11)).button.dataset.action,'delete');await h.app.deleteRow(e);assert.equal(h.rows.size,0);await h.app.undoDelete();assert.equal(h.api.logs[0].deleted_at,null);assert.equal(h.rows.size,1);
});
test('restore blocks a simultaneous refresh and second restore',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));h.api.intercept=c=>{if(c.op==='update'&&c.payload.deleted_at===null){held=true;return gate.promise;}};const restore=h.app.undoDelete();await until(()=>held);const count=h.api.calls.length;await h.app.refresh();await h.app.undoDelete();assert.equal(h.api.calls.length,count);h.api.logs[0]={...h.api.logs[0],deleted_at:null,revision:3};gate.resolve({data:clone(h.api.logs[0]),error:null});await restore;assert.equal(h.rows.size,1);
});
test('unapproved users never fetch records and logout rejects delayed save completion',async()=>{
 const denied=environment({active:false});await denied.start();assert.equal(denied.api.calls.filter(c=>c.table.startsWith('hq_training')).length,0);
 const gate=deferred();let held=false;const h=environment({intercept(c){if(c.op==='update'){held=true;return gate.promise;}}});await h.start();h.input(uuid(11),'notes','Draft');const save=h.save(uuid(11));await until(()=>held);h.signOut();gate.resolve({data:log({notes:'Draft',revision:2}),error:null});await save;assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);
});
test('pagination keeps all records and big positions sort without numeric precision loss',async()=>{
 const logs=Array.from({length:1001},(_,i)=>log({id:uuid(100+i),position:String(9007199254740993n+BigInt(i)),date_label:''}));const h=environment({logs});await h.start();assert.equal(h.app.state.logs.length,1001);assert.equal(h.rows.keys().next().value,uuid(1100));
});
test('HTML content in a cell is escaped and never creates additional controls',async()=>{
 const h=environment({logs:[log({notes:'</textarea><script>alert(1)</script>'})]});await h.start();const markup=h.get('trainingRows').innerHTML;assert.match(markup,/&lt;\/textarea&gt;/);assert.doesNotMatch(markup,/<script>/);assert.equal(h.rows.get(uuid(11)).children.length,7);
});

test('leaving the sheet after an earlier save reorders dates without interrupting in-row focus',async()=>{
 const h=environment({logs:[log({id:uuid(11),position:'1',date_label:'6/1'}),log({id:uuid(12),position:'2',date_label:'6/2'})]});await h.start();
 const input=h.input(uuid(11),'date_label','6/3');await h.save(uuid(11));assert.equal(h.rows.keys().next().value,uuid(12));h.document.activeElement=null;await h.get('trainingRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.keys().next().value===uuid(11));
});
test('inline dog creation uses a stable id and recovers a lost response',async()=>{
 let fail=true;const h=environment({intercept(c,api){if(c.table==='hq_training_dogs'&&c.op==='insert'&&fail){fail=false;api.dogs.push(dog(c.payload));return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.get('addDog').emit('click');h.get('dogName').value='New fixture dog';await h.app.saveDog({preventDefault(){}});assert.ok(h.get('dogError').textContent);await h.app.saveDog({preventDefault(){}});assert.equal(h.api.dogs.length,2);assert.equal(h.get('dogForm').hidden,true);
});
