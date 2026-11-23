/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.TRAINING_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'training.html'),'utf8');
const source=fs.readFileSync(path.join(root,fs.existsSync(path.join(root,'assets/training.js'))?'assets/training.js':'training.js'),'utf8');
const fields=['day_label','date_label','session_label','time_label','trainer','work_detail','notes'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dog=(extra={})=>({id:uuid(1),name:'Fixture dog',revision:1,...extra});
const trainer=(extra={})=>({id:uuid(201),name:'Emily',active:true,revision:1,...extra});
const log=(extra={})=>({id:uuid(11),dog_id:uuid(1),day_label:'1',date_label:'4/5',session_label:'1/3',time_label:'9ish',trainer:'Coach',work_detail:'Practice',notes:'',position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<400&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({dogs=[dog()],logs=[log()],trainers=[trainer(),trainer({id:uuid(202),name:'Jess'}),trainer({id:uuid(203),name:'Mari'})],active=true,intercept=null}={}) {
 const api={dogs:clone(dogs),logs:clone(logs),trainers:clone(trainers),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],downloads:[],blobs:[],intercept};
 const nodes=new Map(),rows=new Map(),errors=new Map(),timers=new Map(),choices=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){return selector.includes('data-trainer-choice')?[...choices.values()].filter(n=>!selector.includes(':checked')||n.checked):[];},createElement:tag=>node(tag),querySelector(selector){if(selector.includes('data-trainer-choice'))return this.querySelectorAll(selector).find(n=>!selector.match(/value="([^"]+)"/)||n.value===selector.match(/value="([^"]+)"/)[1])||null;const m=selector.match(/\[data-(row|error)-id="([^"]+)"\]/);return m?(m[1]==='row'?rows:errors).get(m[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,readOnly:false,hidden:false,open:false,checked:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,classes:new Set(),children:[],attributes:new Map(),
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
   setAttribute(key,value){this.attributes.set(key,String(value));},getAttribute(key){return this.attributes.get(key)||null;},matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field)||selector.includes('data-trainer-choice')&&this.dataset.trainerChoice!==undefined;},
   closest(selector){if(selector==='#trainingRows')return this.row?nodes.get('trainingRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector.includes('data-trainer-open'))return this.dataset.trainerOpen?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},showModal(){this.open=true;},close(){this.open=false;},appendChild(){},remove(){},click(){api.downloads.push({name:this.download,href:this.href});},getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};},
   querySelector(selector){if(selector.includes('data-trainer-open'))return this.trainerButton||null;if(selector.includes('data-trainer-choice'))return this.querySelectorAll(selector)[0]||null;if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(selector=''){if(selector.includes(',')&&selector.includes('data-trainer-open'))return [...this.children,...(this.trainerButton?[this.trainerButton]:[])];if(selector.includes('data-trainer-choice'))return [...choices.values()].filter(n=>!selector.includes(':checked')||n.checked);if(selector.includes('data-trainer-open'))return this.trainerButton?[this.trainerButton]:[];return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='trainingRows')parseRows(value);if(/data-trainer-choice/.test(value))choices.clear();parseChoices(value);}});return n;
 }
 function parseChoices(markup){for(const match of markup.matchAll(/<input\b([^>]*\bdata-trainer-choice[^>]*)>/g)){const attrs=match[1],value=attrs.match(/\bvalue="([^"]+)"/)?.[1]||attrs.match(/data-trainer-choice="([^"]+)"/)?.[1];if(!value)continue;const input=node();input.value=decode(value);input.dataset.trainerChoice=attrs.match(/data-trainer-choice="([^"]*)"/)?.[1]||'';input.checked=/\bchecked\b/.test(attrs);input.disabled=/\bdisabled\b/.test(attrs);choices.set(input.value,input);}}
 function parseRows(markup){rows.clear();errors.clear();for(const match of markup.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)){
  const id=match[1].match(/\bdata-row-id="([^"]+)"/)?.[1];if(!id)continue;
  const row=node();row.dataset.rowId=id;row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;row.markup=match[2];const trainerMatch=match[2].match(/<button\b([^>]*\bdata-trainer-open="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/);if(trainerMatch){row.trainerButton=node();row.trainerButton.row=row;row.trainerButton.dataset.trainerOpen=trainerMatch[2];row.trainerButton.disabled=/\bdisabled\b/.test(trainerMatch[1]);row.trainerButton.textContent=decode(trainerMatch[3].replace(/<[^>]+>/g,''));}row.button.disabled=/<button\b[^>]*data-action="delete"[^>]*\bdisabled\b/.test(match[2]);
  for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){const input=node(),attrs=m[0].slice(0,m[0].indexOf('>'));input.dataset.field=m[1];input.value=decode(m[2]).replace(/\r\n?/g,'\n');input.readOnly=/\breadonly\b/.test(attrs);input.disabled=/\bdisabled\b/.test(attrs);input.row=row;row.children.push(input);}
  rows.set(id,row);const err=node();err.button=node();err.button.dataset.id=id;err.button.dataset.action='retry';err.errorText=node();errors.set(id,err);
 }}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],n);}
 parseChoices(html);document.body=node('body');
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  const list=call.table==='hq_training_dogs'?api.dogs:call.table==='hq_training_trainers'?api.trainers:api.logs;
  const matches=r=>call.filters.every(([k,v])=>r[k]===v);
  if(call.op==='insert'){
   if(list.some(r=>r.id===call.payload.id))return {data:null,error:{code:'23505'}};
   const row=call.table==='hq_training_dogs'?dog(call.payload):call.table==='hq_training_trainers'?trainer({...call.payload,id:call.payload.id||uuid(nextID++)}):log({...call.payload,position:String(Math.max(0,...api.logs.map(r=>Number(r.position)))+1)});list.push(row);return {data:clone(row),error:null};
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
 const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,console,Blob,URL:{createObjectURL(blob){api.blobs.push(blob);return `blob:training-${api.blobs.length}`;},revokeObjectURL(){}},crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
 const marker="  if (document.readyState==='loading')";
 assert.equal(source.split(marker).length,2);
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,parseDateLabel,sortLogs,renderRows,selectDog,addRow,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty,saveDog,openDog,setDogDeleted,...(typeof applyFilters==='function'?{applyFilters,normalizeTrainer}:{}),...(typeof exportModel==='function'?{exportModel,exportCsv,openExport,closeExport,downloadCsv}:{}),...(typeof openTrainer==='function'?{openTrainer,applyTrainerSelection,closeTrainer,saveTrainerName,setTrainerActive}:{})};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,errors,document,timers,choices,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  input(id,key,value){const input=rows.get(id).children.find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  async trainers(id,ids){app.openTrainer(id);for(const input of document.querySelectorAll('[data-trainer-choice]'))input.checked=ids.includes(input.value)||ids.some(id=>api.trainers.find(person=>person.id===input.value)?.name.toLowerCase()===id);if(app.state.trainerEditor)app.state.trainerEditor.changed=true;await app.applyTrainerSelection();},
  async filter(id,value){const input=nodes.get(id);assert.ok(input,`filter ${id} exists`);input.value=value;input.focus();await input.emit('change',{target:input});},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},
  runTimers(delay){for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}}
 };
}
test('compact table exposes exactly seven editable cells and direct add/delete controls',async()=>{
 const h=environment();await h.start();assert.equal(h.rows.get(uuid(11)).children.length,6);assert.ok(h.rows.get(uuid(11)).trainerButton);assert.ok(h.get('addRow'));assert.equal(h.get('sessionDialog'),undefined);assert.equal(h.get('logSearch'),undefined);
});
test('editing one cell preserves all untouched literal values and source metadata',async()=>{
 const original=log({day_label:' 6\r\n',date_label:'',time_label:'after lunch',notes:'Note\r\nnext  ',source_values:['original']});const h=environment({logs:[original]});await h.start();
 h.input(original.id,'work_detail','New work');await h.save(original.id);const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='work_detail'?'New work':original[key]);assert.deepEqual(saved.source_values,['original']);
 assert.deepEqual(h.api.calls.find(c=>c.op==='update').payload,{work_detail:'New work'});
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
 const h=environment();await h.start();const first=h.input(uuid(11),'work_detail','Changed');const next=h.rows.get(uuid(11)).children.find(i=>i.dataset.field==='notes');next.focus();await h.get('trainingRows').emit('focusout',{target:first});h.runTimers(0);await until(()=>h.api.logs[0].work_detail==='Changed');assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children.find(i=>i.dataset.field==='notes'),next);
});
test('edits made while a row saves queue behind the returned revision without loss',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();h.input(uuid(11),'work_detail','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'notes','Typed during save');h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;assert.equal(h.api.logs[0].notes,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children.find(i=>i.dataset.field==='notes').value,'Typed during save');
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
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'notes','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);assert.equal(h.rows.get(uuid(11)).children.find(input=>input.dataset.field==='notes').value,'Draft');await h.save(uuid(11));h.document.activeElement=null;
 h.api.intercept=c=>{if(c.table==='hq_training_logs'&&c.op==='select'&&c.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);assert.ok(h.rows.get(uuid(11)).children[0].disabled);gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children.find(input=>input.dataset.field==='notes').value,'Draft');
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
 const h=environment({logs:[log({notes:'</textarea><script>alert(1)</script>'})]});await h.start();const markup=h.get('trainingRows').innerHTML;assert.match(markup,/&lt;\/textarea&gt;/);assert.doesNotMatch(markup,/<script>/);assert.equal(h.rows.get(uuid(11)).children.length,6);
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


test('Export data is separate from the editing sheet and starts without a pet restriction',async()=>{
 const h=environment({dogs:[dog({name:'Alpha'}),dog({id:uuid(2),name:'Beta'})],logs:[log(),log({id:uuid(12),dog_id:uuid(2)})]});await h.start();
 assert.ok(h.get('exportData'));assert.ok(h.get('trainingExport'));assert.equal(h.get('trainingExport').open,false);assert.equal(h.app.state.selectedDog,uuid(1));
 await h.get('exportData').emit('click');assert.equal(h.get('trainingExport').open,true);assert.equal(h.app.exportModel().rows.length,2);assert.deepEqual([...h.rows.keys()],[uuid(11)]);
 assert.match(html,/<input[^>]*id="filterFrom"[^>]*type="date"/);assert.match(html,/<input[^>]*id="filterThrough"[^>]*type="date"/);
});

test('export date ranges include both endpoints and support either bound without filtering the editing sheet',async()=>{
 const dates=['09/29/2026','9/30/26','2026-10-01','Oct 2, 2026','10/03/2026'],logs=dates.map((date_label,index)=>log({id:uuid(11+index),position:String(index+1),date_label}));const h=environment({logs});await h.start();const originalRows=[...h.rows.keys()],datesShown=()=>Array.from(h.app.exportModel().rows,row=>row.date_label).sort();
 await h.filter('filterFrom','2026-09-30');await h.filter('filterThrough','2026-10-02');assert.deepEqual(datesShown(),['2026-10-01','9/30/26','Oct 2, 2026'].sort());
 await h.filter('filterThrough','');await h.filter('filterFrom','2026-10-02');assert.deepEqual(datesShown(),['10/03/2026','Oct 2, 2026'].sort());
 await h.filter('filterFrom','');await h.filter('filterThrough','2026-09-30');assert.deepEqual(datesShown(),['09/29/2026','9/30/26'].sort());
 assert.deepEqual([...h.rows.keys()],originalRows);assert.deepEqual(h.api.logs.map(row=>row.date_label),dates);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('date exports flag yearless, blank and invalid dates without inventing years',async()=>{
 const labels=['9/30','Oct 1','','2/30/2026','tomorrow','2026-09-30'],logs=labels.map((date_label,index)=>log({id:uuid(30+index),position:String(index+1),date_label,created_at:index===1?'2025-01-01T12:00:00Z':'2026-09-30T12:00:00Z'}));const h=environment({logs});await h.start();assert.equal(h.app.exportModel().rows.length,6);
 await h.filter('filterTrainer','name:coach');assert.equal(h.app.exportModel().rows.length,6);
 await h.filter('filterFrom','2026-09-01');await h.filter('filterThrough','2026-10-31');assert.deepEqual(Array.from(h.app.exportModel().rows,row=>row.date_label),['2026-09-30']);assert.equal(h.app.exportModel().withoutDate,5);assert.equal(h.get('filterHint').hidden,false);assert.match(h.get('filterHint').textContent,/5|full|date/i);
 await h.get('clearFilters').emit('click');assert.equal(h.app.exportModel().rows.length,6);assert.equal(h.get('filterHint').hidden,true);assert.deepEqual(h.api.logs.map(row=>row.date_label),labels);
});

test('export trainer matching is forgiving but never rewrites original names',async()=>{
 const names=['  Alex   Smith  ','alex smith','',' \t ','Coach <Admin>','Other'],logs=names.map((trainer,index)=>log({id:uuid(40+index),position:String(index+1),date_label:'10/01/2026',trainer}));const h=environment({logs});await h.start();
 assert.equal(h.app.normalizeTrainer('  ALEX \t Smith  '),'alex smith');const options=h.get('filterTrainer').innerHTML;assert.equal([...options.matchAll(/value="name:alex smith"/g)].length,1);assert.match(options,/Coach &lt;Admin&gt;/);assert.doesNotMatch(options,/<Admin>/);
 await h.filter('filterTrainer','name:alex smith');assert.equal(h.app.exportModel().rows.length,2);await h.filter('filterTrainer','unassigned');assert.equal(h.app.exportModel().rows.length,2);assert.deepEqual(h.api.logs.map(row=>row.trainer),names);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('every export spans all known pets including archived history regardless of the selected dog',async()=>{
 const dogs=[dog({name:'Alpha <Paws>'}),dog({id:uuid(2),name:'Beta'}),dog({id:uuid(3),name:'Archived & Dog',deleted_at:'2026-10-01T12:00:00Z'})];
 const logs=[log({date_label:'10/01/2026',trainer:' Coach '}),log({id:uuid(12),dog_id:uuid(2),date_label:'10/02/2026',trainer:'COACH'}),log({id:uuid(13),dog_id:uuid(3),date_label:'10/02/2026',trainer:'Coach'}),log({id:uuid(14),dog_id:uuid(999),date_label:'10/01/2026',trainer:'Coach'}),log({id:uuid(15),dog_id:uuid(2),date_label:'10/01/2026',trainer:'Coach',deleted_at:'2026-10-01T12:00:00Z'}),log({id:uuid(16),dog_id:uuid(2),date_label:'10/03/2026',trainer:'Other'})];
 const h=environment({dogs,logs});await h.start();h.app.selectDog(uuid(2));await h.filter('filterFrom','2026-10-01');await h.filter('filterThrough','2026-10-02');await h.filter('filterTrainer','name:coach');
 const model=h.app.exportModel();assert.deepEqual(Array.from(model.rows,row=>row.dogName).sort(),['Alpha <Paws>','Archived & Dog','Beta']);assert.equal(model.rows.find(row=>row.dogName==='Archived & Dog').archived,true);assert.equal(h.app.state.selectedDog,uuid(2));assert.deepEqual([...h.rows.keys()].sort(),[uuid(12),uuid(16)]);
 for(const row of model.rows)for(const field of fields)assert.equal(typeof row[field],'string');assert.match(h.get('exportRows').innerHTML,/Alpha &lt;Paws&gt;/);assert.doesNotMatch(h.get('exportRows').innerHTML,/<Paws>/);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('shared training sessions export under either trainer without duplicate rows',async()=>{
 const names=['jess and emily',' Emily & Jess ','Jess / Emily','Emily+Jess','Jess','Emily','Mari'];
 const h=environment({logs:names.map((trainer,index)=>log({id:uuid(70+index),trainer,date_label:'11/23/2026'}))});await h.start();
 const options=h.get('filterTrainer').innerHTML;assert.equal([...options.matchAll(/value="name:emily"/g)].length,1);assert.equal([...options.matchAll(/value="name:jess"/g)].length,1);assert.doesNotMatch(options,/value="name:jess and emily"/);
 await h.filter('filterTrainer','name:emily');assert.deepEqual(Array.from(h.app.exportModel().rows,row=>row.trainer).sort(),names.filter((_,i)=>[0,1,2,3,5].includes(i)).sort());
 await h.filter('filterTrainer','name:jess');assert.deepEqual(Array.from(h.app.exportModel().rows,row=>row.trainer).sort(),names.filter((_,i)=>[0,1,2,3,4].includes(i)).sort());assert.deepEqual(h.api.logs.map(row=>row.trainer),names);
});

test('archived training rows stay read only in All dogs and stay available in exports',async()=>{
 const archived=dog({id:uuid(3),name:'Archived',deleted_at:'2026-10-01T12:00:00Z'}),entry=log({dog_id:uuid(3),date_label:'2026-10-01'});const h=environment({dogs:[dog(),archived],logs:[entry]});await h.start();h.app.selectDog('all');assert.equal(h.rows.size,1);assert.ok(h.rows.get(entry.id).children.every(input=>input.readOnly));assert.equal(h.rows.get(entry.id).button.disabled,true);assert.equal(h.rows.get(entry.id).trainerButton.disabled,true);
 const before=clone(h.api.logs);h.input(entry.id,'notes','Forbidden archived edit');assert.equal(h.app.state.editors.get(entry.id).values.notes,'');await h.save(entry.id);await h.app.deleteRow(h.app.state.editors.get(entry.id));assert.deepEqual(h.api.logs,before);assert.equal(h.app.exportModel().rows.length,1);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('export preview uses saved values and blocks downloads while drafts are unfinished',async()=>{
 const h=environment({logs:[log({date_label:'2026-10-01',notes:'Saved note'})]});await h.start();h.input(uuid(11),'notes','Keep this unfinished note');await h.get('exportData').emit('click');assert.equal(h.get('trainingExport').open,true);assert.equal(h.app.exportModel().rows[0].notes,'Saved note');assert.equal(h.get('downloadTrainingCsv').disabled,true);
 await h.filter('filterTrainer','name:unrelated');assert.ok(h.rows.has(uuid(11)));assert.equal(h.app.state.editors.get(uuid(11)).values.notes,'Keep this unfinished note');await h.get('clearFilters').emit('click');h.document.activeElement=null;await h.save(uuid(11));assert.equal(h.api.logs[0].notes,'Keep this unfinished note');assert.equal(h.app.exportModel().rows[0].notes,'Keep this unfinished note');assert.equal(h.get('downloadTrainingCsv').disabled,false);
});

test('invalid export ranges report an error and never hide or discard editing rows',async()=>{
 const h=environment({logs:[log({date_label:'2026-10-01'})]});await h.start();h.input(uuid(11),'notes','Draft');await h.filter('filterFrom','2026-10-03');await h.filter('filterThrough','2026-10-01');assert.ok(h.app.exportModel().error);assert.equal(h.get('filterError').hidden,false);assert.equal(h.get('downloadTrainingCsv').disabled,true);assert.equal(h.rows.size,1);assert.equal(h.app.state.editors.get(uuid(11)).values.notes,'Draft');
 await h.get('clearFilters').emit('click');assert.equal(h.get('filterError').hidden,true);assert.equal(h.app.exportModel().rows.length,1);assert.equal(h.rows.size,1);assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('CSV exports every data field, quotes literal text and protects spreadsheet formulas',async()=>{
 const original=log({date_label:'10/01/2026',day_label:'=1+1',session_label:' +SUM(1,2)',time_label:'-20',trainer:'Emily',work_detail:'Practice, "wait"\nThen recall',notes:'@command'});const h=environment({dogs:[dog({name:'A, "Dog"'})],logs:[original]});await h.start();const csv=h.app.exportCsv(h.app.exportModel());assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/Dog.*Day.*Date.*Session.*Time.*Trainer.*Work detail.*Notes/);assert.match(csv,/\r\n/);assert.match(csv,/"A, ""Dog"""/);assert.match(csv,/"Practice, ""wait""\nThen recall"/);assert.match(csv,/'=1\+1/);assert.match(csv,/'\s*\+SUM/);assert.match(csv,/'@command/);assert.deepEqual(h.api.logs,[original]);
});

test('CSV download rechecks sign in and produces no file after sign out',async()=>{
 const h=environment({logs:[log({date_label:'10/01/2026',trainer:'Emily'})]});await h.start();await h.get('exportData').emit('click');await h.get('downloadTrainingCsv').emit('click');assert.equal(h.api.downloads.length,1);assert.match(h.api.downloads[0].name,/\.csv$/);assert.equal(h.api.blobs.length,1);assert.match(await h.api.blobs[0].text(),/Fixture dog/);
 h.signOut();await h.get('downloadTrainingCsv').emit('click');assert.equal(h.api.downloads.length,1);assert.equal(h.get('trainingExport').open,false);assert.equal(h.get('exportRows').innerHTML,'');
});

test('trainer cells use vetted multi-select choices and preserve legacy strings until explicitly changed',async()=>{
 const legacy='  Emliy & Someone  ',h=environment({logs:[log({trainer:legacy})]});await h.start();const row=h.rows.get(uuid(11));assert.equal(row.children.length,6);assert.ok(row.trainerButton);assert.equal(row.children.some(input=>input.dataset.field==='trainer'),false);h.app.openTrainer(uuid(11));assert.equal(h.get('trainerDialog').open,true);assert.deepEqual([...h.choices.keys()].sort(),[uuid(201),uuid(202),uuid(203)]);h.app.closeTrainer();assert.equal(h.api.logs[0].trainer,legacy);h.input(uuid(11),'notes','Other cell only');await h.save(uuid(11));assert.equal(h.api.logs[0].trainer,legacy);
 await h.trainers(uuid(11),['jess','emily']);assert.equal(h.api.logs[0].trainer,'Emily and Jess');assert.equal(h.api.logs[0].notes,'Other cell only');assert.deepEqual(h.api.calls.filter(call=>call.op==='update').at(-1).payload,{trainer:'Emily and Jess'});
 await h.trainers(uuid(11),[]);assert.equal(h.api.logs[0].trainer,'');
});

test('trainer typos and invented choices cannot be saved while other historical cells remain editable',async()=>{
 const h=environment({logs:[log({trainer:'Old spelling'})]});await h.start();const editor=h.app.state.editors.get(uuid(11));editor.values.trainer='Emliy';await h.save(uuid(11));assert.equal(h.api.logs[0].trainer,'Old spelling');assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);assert.ok(editor.error);
 const fresh=environment();await fresh.start();fresh.app.addRow();const draft=[...fresh.app.state.editors.values()].find(e=>!e.base);await fresh.trainers(draft.id,['mari']);assert.equal(fresh.api.logs.find(row=>row.id===draft.id).trainer,'Mari');assert.equal(fresh.api.logs.filter(row=>row.id===draft.id).length,1);
});

test('sign out clears export selections, private previews and an open trainer picker',async()=>{
 const h=environment({logs:[log({date_label:'2026-10-01',trainer:'Private coach'})]});await h.start();await h.get('exportData').emit('click');h.app.openTrainer(uuid(11));await h.filter('filterFrom','2026-10-01');await h.filter('filterTrainer','name:private coach');h.signOut();assert.deepEqual(clone(h.app.state.filters),{from:'',through:'',trainer:''});assert.equal(h.get('trainingExport').open,false);assert.equal(h.get('trainerDialog').open,false);assert.equal(h.get('exportRows').innerHTML,'');assert.doesNotMatch(h.get('filterTrainer').innerHTML,/Private coach|private coach/);assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);
});


test('opening the trainer picker and pressing Done without a change never clears an old unknown name',async()=>{
 const h=environment({logs:[log({trainer:'Historical unknown trainer'})]});await h.start();h.app.openTrainer(uuid(11));assert.equal(h.app.state.trainerEditor.changed,false);await h.app.applyTrainerSelection();assert.equal(h.api.logs[0].trainer,'Historical unknown trainer');assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('a trainer is added once to the shared roster and becomes a selectable canonical name',async()=>{
 const h=environment();await h.start();h.get('newTrainerName').value='  Alex   Chen  ';await h.app.saveTrainerName({preventDefault(){}});const added=h.api.trainers.find(person=>person.name==='Alex Chen');assert.ok(added);assert.equal(h.api.trainers.length,4);assert.equal(added.active,true);
 h.app.openTrainer(uuid(11));assert.ok(h.choices.has(added.id));await h.trainers(uuid(11),[added.id]);assert.equal(h.api.logs[0].trainer,'Alex Chen');
 h.get('newTrainerName').value='alex chen';await h.app.saveTrainerName({preventDefault(){}});assert.equal(h.api.trainers.length,4,'case and spacing variants cannot create duplicate roster members');
});

test('deactivating and restoring a roster trainer does not remove historical payroll sessions',async()=>{
 const h=environment({logs:[log({trainer:'Emily',date_label:'10/01/2026'})]});await h.start();const person=h.app.state.trainers.find(row=>row.id===uuid(201));await h.app.setTrainerActive(person,false);assert.equal(h.api.trainers.find(row=>row.id===uuid(201)).active,false);h.app.openTrainer(uuid(11));assert.equal(h.choices.get(uuid(201))?.disabled??true,true);h.app.closeTrainer();await h.filter('filterTrainer','name:emily');assert.equal(h.app.exportModel().rows.length,1);assert.equal(h.api.logs[0].trainer,'Emily');
 await h.app.setTrainerActive(h.app.state.trainers.find(row=>row.id===uuid(201)),true);assert.equal(h.api.trainers.find(row=>row.id===uuid(201)).active,true);h.app.openTrainer(uuid(11));assert.ok(h.choices.has(uuid(201)));assert.equal(h.choices.get(uuid(201)).disabled,false);assert.equal(h.api.logs[0].trainer,'Emily');
});

test('downloads refetch every pet so a newly saved session on another device is included',async()=>{
 const h=environment({dogs:[dog(),dog({id:uuid(2),name:'Second dog'})],logs:[log({date_label:'10/01/2026',trainer:'Emily'})]});await h.start();await h.get('exportData').emit('click');h.api.logs.push(log({id:uuid(12),dog_id:uuid(2),date_label:'10/01/2026',trainer:'Emily',work_detail:'New remote session'}));
 await h.get('downloadTrainingCsv').emit('click');assert.equal(h.api.downloads.length,1);const csv=await h.api.blobs[0].text();assert.match(csv,/Second dog/);assert.match(csv,/New remote session/);assert.equal(h.app.state.selectedDog,uuid(1));assert.equal(h.api.calls.filter(call=>call.op==='update'||call.op==='insert').length,0);
});

test('sign out during a download fetch discards its late result instead of creating a file',async()=>{
 const gate=deferred();let held=false;const h=environment({logs:[log({date_label:'10/01/2026',trainer:'Emily'})]});await h.start();await h.get('exportData').emit('click');h.api.intercept=call=>{if(call.table==='hq_training_logs'&&call.op==='select'&&call.range){held=true;return gate.promise;}};
 const download=h.get('downloadTrainingCsv').emit('click');await until(()=>held);h.signOut();gate.resolve({data:clone(h.api.logs),error:null});await download;assert.equal(h.api.downloads.length,0);assert.equal(h.get('trainingExport').open,false);assert.equal(h.app.state.logs.length,0);
});

test('late roster writes after sign out cannot restore private trainer names or unlock a new session',async()=>{
 for(const action of ['add','deactivate']){
  const gate=deferred();let held=false;const h=environment({intercept(call){if(call.table==='hq_training_trainers'&&call.op===(action==='add'?'insert':'update')){held=true;return gate.promise;}}});await h.start();h.app.openTrainer(uuid(11));let mutation;
  if(action==='add'){h.get('newTrainerName').value='Private new trainer';mutation=h.app.saveTrainerName({preventDefault(){}});}else mutation=h.app.setTrainerActive(h.app.state.trainers.find(person=>person.id===uuid(201)),false);
  await until(()=>held);h.signOut();gate.resolve({data:trainer({id:action==='add'?uuid(204):uuid(201),name:'Private new trainer',active:action==='add',revision:2}),error:null});await mutation;
  assert.equal(h.app.state.trainers.length,0);assert.equal(h.app.state.trainerRosterSaving,false);assert.equal(h.get('trainerDialog').open,false);assert.doesNotMatch(h.get('filterTrainer').innerHTML,/Private new trainer/);assert.equal(h.get('trainerRoster').innerHTML,'');
 }
});

test('closing an export cancels its pending fetch and a later download wins over the old response',async()=>{
 const gate=deferred();let held=false;const h=environment({logs:[log({date_label:'10/01/2026',trainer:'Emily'})]});await h.start();await h.get('exportData').emit('click');h.api.intercept=call=>{if(call.table==='hq_training_logs'&&call.op==='select'&&call.range&&!held){held=true;return gate.promise;}};
 const old=h.get('downloadTrainingCsv').emit('click');await until(()=>held);h.app.closeExport();h.app.openExport();await h.get('downloadTrainingCsv').emit('click');assert.equal(h.api.downloads.length,1);gate.resolve({data:clone(h.api.logs),error:null});await old;assert.equal(h.api.downloads.length,1);assert.equal(h.app.state.exportLoading,false);assert.equal(h.get('trainingExport').open,true);assert.equal(h.get('downloadTrainingCsv').disabled,false);
});

test('a trainer selection made while another cell is saving is queued with the returned row revision',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({trainer:'Emily'})],intercept(call){if(call.table==='hq_training_logs'&&call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();h.input(uuid(11),'notes','New session note');const saved=h.save(uuid(11));await until(()=>pending);const picked=h.trainers(uuid(11),['jess']);assert.equal(h.app.state.editors.get(uuid(11)).values.trainer,'Jess');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await saved;await picked;assert.equal(h.api.logs[0].notes,'New session note');assert.equal(h.api.logs[0].trainer,'Jess');assert.equal(h.api.logs[0].revision,3);assert.deepEqual(h.api.calls.filter(call=>call.table==='hq_training_logs'&&call.op==='update').map(call=>call.payload),[{notes:'New session note'},{trainer:'Jess'}]);
});
