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
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(){return [];},querySelector(selector){const m=selector.match(/\[data-(row|error)-id="([^"]+)"\]/);return m?(m[1]==='row'?rows:errors).get(m[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,readOnly:false,hidden:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,classes:new Set(),children:[],attributes:new Map(),
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
   setAttribute(key,value){this.attributes.set(key,String(value));},getAttribute(key){return this.attributes.get(key)||null;},matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},
   closest(selector){if(selector==='#trainingRows')return this.row?nodes.get('trainingRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='trainingRows')parseRows(value);}});return n;
 }
 function parseRows(markup){rows.clear();errors.clear();for(const match of markup.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)){
  const id=match[1].match(/\bdata-row-id="([^"]+)"/)?.[1];if(!id)continue;
  const row=node();row.dataset.rowId=id;row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;row.markup=match[2];row.button.disabled=/<button\b[^>]*data-action="delete"[^>]*\bdisabled\b/.test(match[2]);
  for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){const input=node(),attrs=m[0].slice(0,m[0].indexOf('>'));input.dataset.field=m[1];input.value=decode(m[2]).replace(/\r\n?/g,'\n');input.readOnly=/\breadonly\b/.test(attrs);input.disabled=/\bdisabled\b/.test(attrs);input.row=row;row.children.push(input);}
  rows.set(id,row);const err=node();err.button=node();err.button.dataset.id=id;err.button.dataset.action='retry';err.errorText=node();errors.set(id,err);
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
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,parseDateLabel,sortLogs,renderRows,selectDog,addRow,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty,saveDog,openDog,setDogDeleted,...(typeof applyFilters==='function'?{applyFilters,normalizeTrainer}:{})};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,errors,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  input(id,key,value){const input=rows.get(id).children.find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  async filter(id,value){const input=nodes.get(id);assert.ok(input,`filter ${id} exists`);input.value=value;input.focus();await input.emit('change',{target:input});},
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

test('deleted dogs have their own escaped section and are excluded from the active selector',async()=>{
 const h=environment({dogs:[dog(),dog({id:uuid(2),name:'<Deleted dog>',deleted_at:'2026-10-01T12:00:00Z'})],logs:[log(),log({id:uuid(12),dog_id:uuid(2)})]});await h.start();
 assert.equal(h.get('deletedDogCount').textContent,1);assert.doesNotMatch(h.get('dogSelect').innerHTML,/Deleted dog/);assert.match(h.get('deletedDogList').innerHTML,/&lt;Deleted dog&gt;/);assert.match(h.get('deletedDogList').innerHTML,/1 training row kept/);
 h.app.selectDog(uuid(2));assert.equal(h.app.state.selectedDog,uuid(1));
});
test('rename updates only the dog name with revision protection and keeps all rows',async()=>{
 const h=environment();await h.start();const before=clone(h.api.logs);h.app.openDog(h.app.state.dogs[0]);h.get('dogName').value='Renamed fixture dog';await h.app.saveDog({preventDefault(){}});
 assert.equal(h.api.dogs[0].name,'Renamed fixture dog');assert.equal(h.api.dogs[0].revision,2);assert.deepEqual(h.api.logs,before);assert.equal(h.get('dogForm').hidden,true);
 const call=h.api.calls.find(c=>c.table==='hq_training_dogs'&&c.op==='update');assert.deepEqual(call.payload,{name:'Renamed fixture dog'});assert.ok(call.filters.some(([key,value])=>key==='revision'&&value===1));
});
test('a stale dog rename keeps the draft and does not overwrite another name',async()=>{
 const h=environment();await h.start();h.app.openDog(h.app.state.dogs[0]);h.get('dogName').value='Local name';h.api.dogs[0]={...h.api.dogs[0],name:'Remote name',revision:2};await h.app.saveDog({preventDefault(){}});
 assert.equal(h.api.dogs[0].name,'Remote name');assert.equal(h.get('dogName').value,'Local name');assert.equal(h.get('dogForm').hidden,false);assert.match(h.get('dogError').textContent,/changed elsewhere/);
});
test('a lost rename response recovers its applied name without a second update',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.table==='hq_training_dogs'&&call.op==='update'&&fail){fail=false;api.dogs[0]={...api.dogs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.app.openDog(h.app.state.dogs[0]);h.get('dogName').value='Recovered name';await h.app.saveDog({preventDefault(){}});
 assert.equal(h.api.dogs[0].name,'Recovered name');assert.equal(h.app.state.dogs[0].name,'Recovered name');assert.equal(h.get('dogForm').hidden,true);assert.equal(h.api.calls.filter(c=>c.table==='hq_training_dogs'&&c.op==='update').length,1);
});
test('dog deletion and restoration preserve every training row including individually deleted rows',async()=>{
 const h=environment({dogs:[dog(),dog({id:uuid(2),name:'Second dog'})],logs:[log(),log({id:uuid(12),deleted_at:'2026-09-30'})]});await h.start();const before=clone(h.api.logs);await h.app.setDogDeleted(h.app.state.dogs.find(d=>d.id===uuid(1)),true);
 assert.ok(h.api.dogs[0].deleted_at);assert.equal(h.app.state.selectedDog,uuid(2));assert.equal(h.get('deletedDogsSection').open,true);assert.equal(h.get('deletedDogCount').textContent,1);assert.deepEqual(h.api.logs,before);
 await h.app.setDogDeleted(h.app.state.dogs.find(d=>d.id===uuid(1)),false);assert.equal(h.api.dogs[0].deleted_at,null);assert.equal(h.app.state.selectedDog,uuid(1));assert.equal(h.rows.size,1);assert.deepEqual(h.api.logs,before);
});
test('deleting the last active dog shows a restore path and disables adding rows',async()=>{
 const h=environment();await h.start();await h.app.setDogDeleted(h.app.state.dogs[0],true);assert.equal(h.app.state.selectedDog,null);assert.equal(h.rows.size,0);assert.equal(h.get('addRow').disabled,true);assert.match(h.get('emptyState').textContent,/restore/);
 h.app.addRow();assert.equal(h.app.state.editors.size,0);
});
test('unsaved cells and in-flight saves block dog deletion without discarding anything',async()=>{
 const gate=deferred();let held=false;const h=environment({intercept(c){if(c.table==='hq_training_logs'&&c.op==='update'){held=true;return gate.promise;}}});await h.start();h.input(uuid(11),'notes','Keep this draft');await h.app.setDogDeleted(h.app.state.dogs[0],true);assert.equal(h.api.dogs[0].deleted_at,undefined);assert.equal(h.get('deleteDog').disabled,true);
 const save=h.save(uuid(11));await until(()=>held);await h.app.setDogDeleted(h.app.state.dogs[0],true);assert.equal(h.api.calls.filter(c=>c.table==='hq_training_dogs'&&c.op==='update').length,0);gate.resolve({data:log({notes:'Keep this draft',revision:2}),error:null});await save;
});
test('stale dog deletion fails safely while a lost successful deletion is recoverable',async()=>{
 const h=environment();await h.start();h.api.dogs[0]={...h.api.dogs[0],name:'Teammate rename',revision:2};await h.app.setDogDeleted(h.app.state.dogs[0],true);assert.equal(h.api.dogs[0].deleted_at,undefined);assert.match(h.get('pageMessage').textContent,/changed elsewhere/);
 const lost=environment({intercept(c,api){if(c.table==='hq_training_dogs'&&c.op==='update'){api.dogs[0]={...api.dogs[0],...c.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await lost.start();await lost.app.setDogDeleted(lost.app.state.dogs[0],true);assert.equal(lost.app.state.selectedDog,null);assert.equal(lost.get('deletedDogCount').textContent,1);
});
test('sign-out discards late dog rename and deletion responses',async()=>{
 for(const mode of ['rename','delete']){
  const gate=deferred();let held=false;const h=environment({intercept(c){if(c.table==='hq_training_dogs'&&c.op==='update'){held=true;return gate.promise;}}});await h.start();
  let mutation;if(mode==='rename'){h.app.openDog(h.app.state.dogs[0]);h.get('dogName').value='Late name';mutation=h.app.saveDog({preventDefault(){}});}else mutation=h.app.setDogDeleted(h.app.state.dogs[0],true);
  await until(()=>held);h.signOut();gate.resolve({data:dog({name:'Late name',deleted_at:mode==='delete'?'2026-10-01':null,revision:2}),error:null});await mutation;
  assert.equal(h.app.state.dogs.length,0);assert.equal(h.rows.size,0);assert.equal(h.app.state.editingDog,null);assert.equal(h.get('dogName').value,'');assert.equal(h.get('deletedDogCount').textContent,0);
 }
});

test('payroll filters start unrestricted while preserving the existing default dog view',async()=>{
 const h=environment({dogs:[dog({name:'Alpha'}),dog({id:uuid(2),name:'Beta'})],logs:[log(),log({id:uuid(12),dog_id:uuid(2)})]});await h.start();
 assert.equal(h.app.state.selectedDog,uuid(1));assert.deepEqual(clone(h.app.state.filters),{from:'',through:'',trainer:''});assert.equal(h.get('filterFrom').value,'');assert.equal(h.get('filterThrough').value,'');assert.equal(h.get('filterTrainer').value,'');assert.match(h.get('filterTrainer').innerHTML,/All trainers/);assert.match(h.get('dogSelect').innerHTML,/<option value="all">All dogs<\/option>/);assert.equal(h.get('clearFilters').disabled,true);assert.deepEqual([...h.rows.keys()],[uuid(11)]);assert.equal(h.rows.get(uuid(11)).children.length,7);assert.equal(h.get('dogHeading').hidden,true);
 assert.match(html,/<input[^>]*id="filterFrom"[^>]*type="date"/);assert.match(html,/<input[^>]*id="filterThrough"[^>]*type="date"/);
});

test('payroll date ranges include both endpoints and support either date on its own',async()=>{
 const dates=['09/29/2026','9/30/26','2026-10-01','Oct 2, 2026','10/03/2026'],logs=dates.map((date_label,index)=>log({id:uuid(11+index),position:String(index+1),date_label}));const h=environment({logs});await h.start();const ids=()=>[...h.rows.keys()].sort();
 await h.filter('filterFrom','2026-09-30');await h.filter('filterThrough','2026-10-02');assert.deepEqual(ids(),[uuid(12),uuid(13),uuid(14)]);
 await h.filter('filterThrough','');await h.filter('filterFrom','2026-10-02');assert.deepEqual(ids(),[uuid(14),uuid(15)]);
 await h.filter('filterFrom','');await h.filter('filterThrough','2026-09-30');assert.deepEqual(ids(),[uuid(11),uuid(12)]);
 assert.deepEqual(h.api.logs.map(row=>row.date_label),dates);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('active date filters never guess years and explain excluded blank or invalid dates',async()=>{
 const labels=['9/30','Oct 1','','2/30/2026','tomorrow','2026-09-30'],logs=labels.map((date_label,index)=>log({id:uuid(30+index),position:String(index+1),date_label,created_at:index===1?'2025-01-01T12:00:00Z':'2026-09-30T12:00:00Z'}));const h=environment({logs});await h.start();assert.equal(h.rows.size,6);
 await h.filter('filterTrainer','name:coach');assert.equal(h.rows.size,6,'trainer filtering alone must preserve yearless and invalid literal dates');
 await h.filter('filterFrom','2026-09-01');await h.filter('filterThrough','2026-10-31');assert.deepEqual([...h.rows.keys()],[uuid(35)]);assert.equal(h.get('filterHint').hidden,false);assert.match(h.get('filterHint').textContent,/5 rows.*no full, valid date/i);assert.match(h.get('filterHint').textContent,/Clear dates/i);
 await h.get('clearFilters').emit('click');assert.equal(h.rows.size,6);assert.equal(h.get('filterHint').hidden,true);assert.deepEqual(h.api.logs.map(row=>row.date_label),labels);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('trainer filtering normalizes display matching without rewriting names and supports unassigned rows',async()=>{
 const names=['  Alex   Smith  ','alex smith','',' \t ','Coach <Admin>','Other'],logs=names.map((trainer,index)=>log({id:uuid(40+index),position:String(index+1),date_label:'10/01/2026',trainer}));const h=environment({logs});await h.start();
 assert.equal(h.app.normalizeTrainer('  ALEX \t Smith  '),'alex smith');const options=h.get('filterTrainer').innerHTML;assert.equal([...options.matchAll(/value="name:alex smith"/g)].length,1);assert.equal([...options.matchAll(/value="unassigned"/g)].length,1);assert.match(options,/Coach &lt;Admin&gt;/);assert.doesNotMatch(options,/<Admin>/);
 await h.filter('filterTrainer','name:alex smith');assert.deepEqual([...h.rows.keys()].sort(),[uuid(40),uuid(41)]);await h.filter('filterTrainer','unassigned');assert.deepEqual([...h.rows.keys()].sort(),[uuid(42),uuid(43)]);assert.deepEqual(h.api.logs.map(row=>row.trainer),names);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('All dogs combines trainer and date filters across active and deleted dogs while excluding orphan and deleted rows',async()=>{
 const dogs=[dog({name:'Alpha <Paws>'}),dog({id:uuid(2),name:'Beta'}),dog({id:uuid(3),name:'Archived & Dog',deleted_at:'2026-10-01T12:00:00Z'})];
 const logs=[log({date_label:'10/01/2026',trainer:' Coach '}),log({id:uuid(12),dog_id:uuid(2),date_label:'10/02/2026',trainer:'COACH'}),log({id:uuid(13),dog_id:uuid(3),date_label:'10/02/2026',trainer:'Coach'}),log({id:uuid(14),dog_id:uuid(999),date_label:'10/01/2026',trainer:'Coach'}),log({id:uuid(15),dog_id:uuid(2),date_label:'10/01/2026',trainer:'Coach',deleted_at:'2026-10-01T12:00:00Z'}),log({id:uuid(16),dog_id:uuid(2),date_label:'10/03/2026',trainer:'Other'})];
 const h=environment({dogs,logs});await h.start();h.app.selectDog('all');await h.filter('filterFrom','2026-10-01');await h.filter('filterThrough','2026-10-02');await h.filter('filterTrainer','name:coach');assert.deepEqual([...h.rows.keys()].sort(),[uuid(11),uuid(12),uuid(13)]);assert.equal(h.get('dogHeading').hidden,false);assert.equal(h.get('dogColumn').hidden,false);assert.match(h.rows.get(uuid(11)).markup,/Alpha &lt;Paws&gt;/);assert.match(h.rows.get(uuid(13)).markup,/Archived &amp; Dog/);assert.match(h.rows.get(uuid(13)).markup,/Deleted dog.*read only/i);
 assert.equal(h.get('addRow').disabled,true);assert.equal(h.get('renameDog').disabled,true);assert.equal(h.get('deleteDog').disabled,true);const before=h.app.state.editors.size;h.app.addRow();assert.equal(h.app.state.editors.size,before);
 h.input(uuid(12),'notes','Payroll reviewed');await h.save(uuid(12));assert.equal(h.api.logs.find(row=>row.id===uuid(12)).dog_id,uuid(2));const update=h.api.calls.find(call=>call.op==='update');assert.deepEqual(update.payload,{notes:'Payroll reviewed'});
 await h.get('clearFilters').emit('click');assert.equal(h.app.state.selectedDog,'all');assert.deepEqual(clone(h.app.state.filters),{from:'',through:'',trainer:''});assert.deepEqual([...h.rows.keys()].sort(),[uuid(11),uuid(12),uuid(13),uuid(16)]);
});

test('archived training rows remain available for payroll but cannot be changed or deleted from All dogs',async()=>{
 for(const active of [true,false]){
  const archived=dog({id:uuid(3),name:'Archived',deleted_at:'2026-10-01T12:00:00Z'}),entry=log({dog_id:uuid(3),date_label:'2026-10-01'});const h=environment({dogs:active?[dog(),archived]:[archived],logs:[entry]});await h.start();h.app.selectDog('all');assert.equal(h.app.state.selectedDog,'all');assert.equal(h.get('dogSelect').disabled,false);assert.equal(h.rows.size,1);assert.ok(h.rows.get(entry.id).children.every(input=>input.readOnly));assert.equal(h.rows.get(entry.id).button.disabled,true);
  const before=clone(h.api.logs);h.input(entry.id,'notes','Forbidden archived edit');assert.equal(h.app.state.editors.get(entry.id).values.notes,'');await h.save(entry.id);await h.app.deleteRow(h.app.state.editors.get(entry.id));assert.deepEqual(h.api.logs,before);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
 }
});

test('filters retain dirty, failed and new rows within the chosen dog without hiding their drafts',async()=>{
 const logs=[log({date_label:'2026-09-30'}),log({id:uuid(12),date_label:'2026-09-30',trainer:'Coach'})];const h=environment({logs});await h.start();h.input(uuid(11),'date_label','2026-10-02');const failed=h.app.state.editors.get(uuid(12));failed.error='Synthetic network failure';
 await h.filter('filterFrom','2026-09-01');await h.filter('filterThrough','2026-09-30');await h.filter('filterTrainer','name:other');assert.deepEqual([...h.rows.keys()].sort(),[uuid(11),uuid(12)]);assert.equal(h.rows.get(uuid(11)).children.find(input=>input.dataset.field==='date_label').value,'2026-10-02');assert.match(h.get('filterHint').textContent,/unfinished.*kept visible/i);
 await h.save(uuid(11));h.app.renderRows();assert.deepEqual([...h.rows.keys()],[uuid(12)]);assert.equal(h.api.logs.find(row=>row.id===uuid(11)).date_label,'2026-10-02');assert.equal(h.app.state.editors.get(uuid(12)).error,'Synthetic network failure');
 h.app.addRow();const fresh=[...h.app.state.editors.values()].find(editor=>!editor.base);assert.ok(fresh);assert.ok(h.rows.has(fresh.id),'a new row must remain visible even when its default date/trainer does not match the payroll filters');assert.equal(fresh.dog_id,uuid(1));
});

test('a filter change before the queued blur save preserves the edited row through save completion',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({date_label:'2026-10-01'})],intercept(call){if(call.table==='hq_training_logs'&&call.op==='update'){pending=call;return gate.promise;}}});await h.start();const input=h.input(uuid(11),'trainer','Changed coach');h.get('filterTrainer').focus();await h.get('trainingRows').emit('focusout',{target:input,relatedTarget:h.get('filterTrainer')});
 const filtering=h.filter('filterTrainer','name:unrelated');h.runTimers(0);await until(()=>pending);assert.ok(h.rows.has(uuid(11)));assert.equal(h.app.state.editors.get(uuid(11)).values.trainer,'Changed coach');assert.ok(h.app.state.editors.get(uuid(11)).saving);
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await filtering;await until(()=>!h.app.state.editors.get(uuid(11)).saving);h.app.renderRows();assert.equal(h.api.logs[0].trainer,'Changed coach');assert.equal(h.rows.size,0);assert.deepEqual(pending.payload,{trainer:'Changed coach'});
});

test('an inverted date range reports an error without discarding unfinished rows and Clear filters keeps dog scope',async()=>{
 const h=environment({dogs:[dog({name:'Alpha'}),dog({id:uuid(2),name:'Beta'})],logs:[log({dog_id:uuid(2),date_label:'2026-10-01'}),log({id:uuid(12),dog_id:uuid(2),date_label:'2026-10-02'})]});await h.start();h.app.selectDog(uuid(2));h.input(uuid(11),'notes','Keep this unfinished note');
 await h.filter('filterFrom','2026-10-03');await h.filter('filterThrough','2026-10-01');assert.equal(h.get('filterError').hidden,false);assert.match(h.get('filterError').textContent,/From.*on or before.*Through/i);assert.equal(h.get('filterFrom').getAttribute('aria-invalid'),'true');assert.equal(h.get('filterThrough').getAttribute('aria-invalid'),'true');assert.deepEqual([...h.rows.keys()],[uuid(11)]);assert.equal(h.app.state.editors.get(uuid(11)).values.notes,'Keep this unfinished note');
 await h.get('clearFilters').emit('click');assert.equal(h.app.state.selectedDog,uuid(2));assert.equal(h.get('filterError').hidden,true);assert.equal(h.get('filterFrom').getAttribute('aria-invalid'),'false');assert.deepEqual([...h.rows.keys()].sort(),[uuid(11),uuid(12)]);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('sign-out clears payroll filters and trainer options along with the training records',async()=>{
 const h=environment({logs:[log({date_label:'2026-10-01',trainer:'Private coach'})]});await h.start();h.app.selectDog('all');await h.filter('filterFrom','2026-10-01');await h.filter('filterThrough','2026-10-02');await h.filter('filterTrainer','name:private coach');h.signOut();
 assert.deepEqual(clone(h.app.state.filters),{from:'',through:'',trainer:''});assert.equal(h.get('filterFrom').value,'');assert.equal(h.get('filterThrough').value,'');assert.equal(h.get('filterTrainer').value,'');assert.doesNotMatch(h.get('filterTrainer').innerHTML,/Private coach|private coach/);assert.equal(h.get('filterHint').hidden,true);assert.equal(h.get('filterError').hidden,true);assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.selectedDog,null);
});
