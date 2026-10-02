/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.LICENSES_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'dog-licenses.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/dog-licenses.js'),'utf8');
const fields=['pet_name','request_type','initials'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const log=(extra={})=>({id:uuid(11),pet_name:'Fixture pet',request_type:'Renewal',initials:'AB',position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<400&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({logs=[log()],active=true,intercept=null}={}) {
 const api={logs:clone(logs),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
 const nodes=new Map(),rows=new Map(),errors=new Map(),restores=new Map(),timers=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){return selector==='[data-restore-row]'?[...restores.values()]:[];},querySelector(selector){const m=selector.match(/\[data-(row|error)-id="([^"]+)"\]/);return m?(m[1]==='row'?rows:errors).get(m[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,classes:new Set(),children:[],
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
   setAttribute(){},matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},
   closest(selector){if(selector==='#licenseRows')return this.row?nodes.get('licenseRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='licenseRows')parseRows(value);if(id==='deletedList')parseRestores(value);}});return n;
 }
 function parseRows(markup){rows.clear();errors.clear();for(const match of markup.matchAll(/<tr class="tr-row" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)){
  const row=node();row.dataset.rowId=match[1];row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;
  for(const m of match[2].matchAll(/<(textarea|select)[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/(?:textarea|select)>/g)){
   const input=node();input.dataset.field=m[2];input.tagName=m[1].toUpperCase();
   if(input.tagName==='SELECT'){
    input.options=Array.from(m[3].matchAll(/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g),o=>({value:decode(o[1]),selected:/\bselected\b/.test(o[2])}));
    let selected=input.options.find(o=>o.selected)?.value??input.options[0]?.value??'';
    Object.defineProperty(input,'value',{get(){return selected;},set(v){selected=input.options.some(o=>o.value===v)?v:'';}});
   }else input.value=decode(m[3]).replace(/\r\n?/g,'\n');
   input.row=row;row.children.push(input);
  }
  rows.set(match[1],row);const err=node();err.button=node();err.button.dataset.id=match[1];err.button.dataset.action='retry';err.errorText=node();errors.set(match[1],err);
 }}
 function parseRestores(markup){restores.clear();for(const m of markup.matchAll(/data-restore-row="([^"]+)"/g)){const button=node();button.dataset.restoreRow=decode(m[1]);restores.set(button.dataset.restoreRow,button);}}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],n);}
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  assert.equal(call.table,'hq_dog_licenses');const list=api.logs;
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
 class TestDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-01T14:00:00Z']));}static now(){return Date.parse('2026-10-01T14:00:00Z');}}
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
test('compact table has three editable cells, a request selector, and direct add/delete controls',async()=>{
 const h=environment();await h.start();const cells=h.rows.get(uuid(11)).children;
 assert.deepEqual(cells.map(cell=>cell.dataset.field),fields);
 assert.equal(cells[1].tagName,'SELECT');assert.deepEqual(cells[1].options.map(option=>option.value),['','Renewal','Registration']);
 assert.ok(h.get('addRow'));assert.equal(h.get('dogSelect'),undefined);
});
test('editing a name changes only that cell and preserves literal values and original source',async()=>{
 const original=log({request_type:' Renewal ',initials:' AB\r\nCD  ',source_file:'Fixture.pdf',source_row:4,source_values:['Original pet',' Renewal ',' AB\r\nCD  ']});
 const h=environment({logs:[original]});await h.start();h.input(original.id,'pet_name','Renamed pet');await h.save(original.id);
 const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='pet_name'?'Renamed pet':original[key]);
 assert.deepEqual(saved.source_values,original.source_values);assert.equal(saved.source_row,4);assert.equal(saved.position,'1');
 const call=h.api.calls.find(c=>c.op==='update');assert.deepEqual(call.payload,{pet_name:'Renamed pet'});assert.ok(call.filters.some(([key,value])=>key==='revision'&&value===1));
});
test('normalized textarea no-op preserves original line endings and whitespace',async()=>{
 const h=environment({logs:[log({pet_name:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'pet_name','Line\nTwo  ');await h.save(uuid(11));
 assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].pet_name,'Line\r\nTwo  ');
});
test('an unknown imported request value remains selected until the user changes it',async()=>{
 const h=environment({logs:[log({request_type:'Renewal / pending'})]});await h.start();const select=h.rows.get(uuid(11)).children[1];
 assert.equal(select.value,'Renewal / pending');assert.ok(select.options.some(option=>option.value==='Renewal / pending'));
 h.input(uuid(11),'initials','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].request_type,'Renewal / pending');
 select.value='Registration';await h.get('licenseRows').emit('change',{target:select});await until(()=>h.api.logs[0].request_type==='Registration');
});
test('a blank new row stays local and can be removed without a database request',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 await h.save(editor.id);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);assert.equal(h.api.logs.length,0);
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);
});
test('a partial row with only initials saves and later edits update the same record',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 h.input(editor.id,'initials','  AB / CD  ');await h.save(editor.id);h.input(editor.id,'pet_name','Later name');await h.save(editor.id);
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].initials,'  AB / CD  ');assert.equal(h.api.logs[0].request_type,'');assert.equal(h.api.logs[0].pet_name,'Later name');
});
test('blur saves while tabbing to another cell without replacing focus',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'pet_name','Changed');const next=h.rows.get(uuid(11)).children[1];next.focus();
 await h.get('licenseRows').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.logs[0].pet_name==='Changed');
 assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children[1],next);
});
test('select changes save immediately without requiring blur',async()=>{
 const h=environment();await h.start();const select=h.input(uuid(11),'request_type','Registration');
 await h.get('licenseRows').emit('change',{target:select});await until(()=>h.api.logs[0].request_type==='Registration');
 assert.equal(h.document.activeElement,select);assert.deepEqual(h.api.calls.find(c=>c.op==='update').payload,{request_type:'Registration'});
});
test('new typing during an in-flight save queues behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'pet_name','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'initials','Typed during save');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].initials,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children[2].value,'Typed during save');
});
test('lost insert response reuses the UUID and preserves the newer draft',async()=>{
 let fail=true;const h=environment({logs:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.logs.push(log({...call.payload,position:'1'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.app.addRow();const editor=[...h.app.state.editors.values()][0];h.input(editor.id,'pet_name','First');await h.save(editor.id);assert.ok(editor.error);
 h.input(editor.id,'pet_name','Second');await h.save(editor.id);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,editor.id);assert.equal(h.api.logs[0].pet_name,'Second');
});
test('lost update response recovers the saved revision before applying a newer draft',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'pet_name','First');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.input(uuid(11),'initials','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].pet_name,'First');assert.equal(h.api.logs[0].initials,'CD');assert.equal(h.api.logs[0].revision,3);
});
test('different-cell edits merge while same-cell conflicts retain the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'initials','Local');h.api.logs[0]={...h.api.logs[0],pet_name:'Remote pet',revision:2};await h.save(uuid(11));
 assert.equal(h.api.logs[0].pet_name,'Remote pet');assert.equal(h.api.logs[0].initials,'Local');
 h.input(uuid(11),'initials','New local');h.api.logs[0]={...h.api.logs[0],initials:'New remote',revision:4};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.initials,'New local');assert.equal(h.api.logs[0].initials,'New remote');
 assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');
});
test('clearing the last value during an in-flight save reports an unsaved empty row',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({pet_name:'Start',request_type:'',initials:''})],intercept(call){if(call.op==='update'){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'pet_name','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'pet_name','');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.match(h.app.state.editors.get(uuid(11)).error,/empty/);assert.equal(h.get('saveStatus').textContent,'Some changes are not saved');
});
test('focused or unfinished cells block refresh and every field is disabled while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'initials','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);
 await h.save(uuid(11));await h.app.refresh();assert.equal(h.api.calls.filter(c=>c.range).length,1);h.document.activeElement=null;
 h.api.intercept=call=>{if(call.table==='hq_dog_licenses'&&call.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);
 assert.ok(h.rows.get(uuid(11)).children.every(cell=>cell.disabled));gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children[2].value,'Draft');
});
test('Delete avoids an unwanted blur save and soft-deletes the row',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'pet_name','Local draft'),row=h.rows.get(uuid(11));
 await h.get('licenseRows').emit('pointerdown',{target:row.button});
 await h.get('licenseRows').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 const mutations=h.api.calls.filter(call=>call.op==='update');assert.equal(mutations.length,1);assert.deepEqual(Object.keys(mutations[0].payload),['deleted_at']);
 assert.equal(h.rows.size,0);assert.equal(h.get('deletedCount').textContent,1);assert.equal(h.get('deletedSection').open,true);
});
test('tabbing from Initials to Delete still autosaves the edited cell',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'initials','CD'),button=h.rows.get(uuid(11)).button;button.focus();
 await h.get('licenseRows').emit('focusout',{target:input,relatedTarget:button});h.runTimers(0);await until(()=>h.api.logs[0].initials==='CD');
 assert.equal(h.document.activeElement,button);assert.equal(h.api.logs[0].deleted_at,null);
});
test('deleted entries stay restorable after the five-second notice expires and after refresh',async()=>{
 const original=log({source_values:['Fixture pet','Renewal','AB']});const h=environment({logs:[original]});await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
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
 const input=h.input(uuid(11),'initials','Focused draft');await h.app.undoDelete(h.app.state.logs.find(row=>row.id===uuid(12)));
 assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.logs.find(row=>row.id===uuid(12)).deleted_at,null);
 h.document.activeElement=null;await h.get('licenseRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(12)));
 assert.equal(h.api.logs.find(row=>row.id===uuid(11)).initials,'Focused draft');assert.equal(h.rows.size,2);
});
test('restore blocks simultaneous refresh, Add row, and a second restore',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=call=>{if(call.op==='update'&&call.payload.deleted_at===null){held=true;return gate.promise;}};const restore=h.app.undoDelete();await until(()=>held);
 const count=h.api.calls.length;await h.app.refresh();await h.app.undoDelete();h.app.addRow();assert.equal(h.api.calls.length,count);assert.equal(h.app.state.editors.size,0);assert.ok(h.restores.get(uuid(11)).disabled);
 h.api.logs[0]={...h.api.logs[0],deleted_at:null,revision:3};gate.resolve({data:clone(h.api.logs[0]),error:null});await restore;assert.equal(h.rows.size,1);
});
test('anonymous and unapproved accounts never fetch license records',async()=>{
 for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_dog_licenses').length,0);assert.equal(h.rows.size,0);assert.equal(h.get('addRow').disabled,true);}
});
test('sign-out rejects delayed save, delete, restore and fetch responses',async()=>{
 for(const mode of ['save','delete','restore','fetch']){
  const h=environment();await h.start();if(mode==='restore')await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_dog_licenses'){pending=call;return gate.promise;}};
  let mutation;if(mode==='save'){h.input(uuid(11),'pet_name','Late pet');mutation=h.save(uuid(11));}else if(mode==='delete')mutation=h.app.deleteRow(h.app.state.editors.get(uuid(11)));else if(mode==='restore')mutation=h.app.undoDelete();else mutation=h.app.refresh();
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[log()]:log({pet_name:'Late pet',revision:2}),error:null});await mutation;
  assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toast').hidden,true);
 }
});
test('pagination preserves more than 1,000 entries and sorts large source positions exactly',async()=>{
 const logs=Array.from({length:1001},(_,i)=>log({id:uuid(100+i),position:String(9007199254740993n+BigInt(i))}));const h=environment({logs});await h.start();
 assert.equal(h.app.state.logs.length,1001);assert.equal(h.rows.keys().next().value,uuid(1100));assert.deepEqual(h.api.calls.filter(call=>call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('names and unknown selector values are escaped in active and deleted entries',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='\"><img src=x onerror=alert(1)>';
 const h=environment({logs:[log({pet_name:payload,request_type:custom}),log({id:uuid(12),pet_name:payload,initials:custom,deleted_at:'2026-10-01'})]});await h.start();
 assert.doesNotMatch(h.get('licenseRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);
 assert.equal(h.rows.get(uuid(11)).children.length,3);assert.equal(h.rows.get(uuid(11)).children[0].value,payload);assert.equal(h.rows.get(uuid(11)).children[1].value,custom);
 assert.match(h.get('deletedList').innerHTML,/&lt;\/textarea&gt;/);
});
