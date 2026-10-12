/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.K9_COUGH_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'k9-cough.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/k9-cough.js'),'utf8');
const fields=['added_date','initials','pet_name','service_dates','room','group_type','services','notes','pcw_reimbursement','management_follow_up'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const log=(extra={})=>({id:uuid(11),added_date:'',initials:'',pet_name:'Fixture pet',service_dates:'',room:'',group_type:'',services:'',notes:'Fixture note',pcw_reimbursement:'',management_follow_up:'',position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let i=0;i<400&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({logs=[log()],active=true,intercept=null,now='2026-10-01T14:00:00Z'}={}) {
 const api={logs:clone(logs),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
 const nodes=new Map(),rows=new Map(),details=new Map(),errors=new Map(),restores=new Map(),timers=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){return selector==='[data-restore-row]'?[...restores.values()]:[];},querySelector(selector){const m=selector.match(/\[data-(row|error|details)-id="([^"]+)"\]/);return m?(m[1]==='row'?rows:m[1]==='details'?details:errors).get(m[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,classes:new Set(),children:[],
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
   setAttribute(key,value){(this.attributes||={})[key]=value;},matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},
   closest(selector){if(selector==='#coughRows')return this.row?nodes.get('coughRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='[data-action="details"]')return this.detailsButton||null;if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='coughRows')parseRows(value);if(id==='deletedList')parseRestores(value);}});return n;
 }
 function parseRows(markup){rows.clear();details.clear();errors.clear();for(const match of markup.matchAll(/<tr class="tr-row" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)){
  const row=node();row.dataset.rowId=match[1];row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;row.detailsButton=node();row.detailsButton.dataset.action='details';row.detailsButton.row=row;row.detailsButton.attributes={'aria-expanded':match[2].match(/aria-expanded="([^"]+)"/)?.[1]};
  for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){
   const input=node();input.dataset.field=m[1];input.tagName='TEXTAREA';input.value=decode(m[2]).replace(/\r\n?/g,'\n');
   input.row=row;row.children.push(input);
  }
  rows.set(match[1],row);const err=node();err.button=node();err.button.dataset.id=match[1];err.button.dataset.action='retry';err.errorText=node();errors.set(match[1],err);
 }
 for(const match of markup.matchAll(/<tr class="kc-details"[^>]*data-details-id="([^"]+)"([^>]*)>([\s\S]*?)<\/tr>/g)){
  const row=node();row.dataset.rowId=match[1];row.dataset.detailsId=match[1];row.row=row;row.hidden=/\bhidden\b/.test(match[2]);
  for(const m of match[3].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){const input=node();input.dataset.field=m[1];input.dataset.detail='true';input.tagName='TEXTAREA';input.value=decode(m[2]).replace(/\r\n?/g,'\n');input.row=row;row.children.push(input);}
  details.set(match[1],row);
 }
 }
 function parseRestores(markup){restores.clear();for(const m of markup.matchAll(/data-restore-row="([^"]+)"/g)){const button=node();button.dataset.restoreRow=decode(m[1]);restores.set(button.dataset.restoreRow,button);}}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],n);}
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  assert.equal(call.table,'hq_k9_cough');const list=api.logs;
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
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,sortLogs,addedDate,rowDate,renderRows,addRow,toggleDetails,rowInputs,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,details,errors,restores,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  inputs(id){return [...(rows.get(id)?.children||[]),...(details.get(id)?.children||[])];},
  input(id,key,value){if(fields.slice(7).includes(key)&&details.get(id).hidden)app.toggleDetails(id);const input=[...rows.get(id).children,...details.get(id).children].find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},
  runTimers(delay){for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}}
 };
}
test('compact table has all ten free-text editable cells and direct add/delete controls',async()=>{
 const h=environment();await h.start();const cells=h.inputs(uuid(11));
 assert.deepEqual(cells.map(cell=>cell.dataset.field),fields);
 assert.ok(cells.every(cell=>cell.tagName==='TEXTAREA'));assert.doesNotMatch(h.get('coughRows').innerHTML,/<select/);assert.match(h.get('coughRows').innerHTML,/maxlength="20000"/);
 assert.ok(h.get('addRow'));assert.equal(h.get('dogSelect'),undefined);
});
test('editing a pet changes only that cell and preserves literal dates and notes',async()=>{
 const original=log({added_date:'  8/19  ',notes:' First line\r\nSecond line  ',source_file:'Fixture.csv',source_row:4,source_values:['  8/19  ','','Fixture pet','','','','',' First line\r\nSecond line  ','','']});
 const h=environment({logs:[original]});await h.start();h.input(original.id,'pet_name','Renamed location');await h.save(original.id);
 const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='pet_name'?'Renamed location':original[key]);
 assert.deepEqual(saved.source_values,original.source_values);assert.equal(saved.source_row,4);assert.equal(saved.position,'1');
 const call=h.api.calls.find(c=>c.op==='update');assert.deepEqual(call.payload,{pet_name:'Renamed location'});assert.ok(call.filters.some(([key,value])=>key==='revision'&&value===1));
});
test('normalized textarea no-op preserves original line endings and whitespace',async()=>{
 const h=environment({logs:[log({pet_name:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'pet_name','Line\nTwo  ');await h.save(uuid(11));
 assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].pet_name,'Line\r\nTwo  ');
});
test('date and note cells accept literal mixed text without coercion',async()=>{
 const h=environment({logs:[log({added_date:'8/19/25 — original drop',notes:'Pending — revisit after the weekend.'})]});await h.start();
 for(const key of ['added_date','notes'])assert.equal(h.inputs(uuid(11)).find(c=>c.dataset.field===key).value,h.api.logs[0][key]);
 h.input(uuid(11),'added_date','next Thursday, after lunch');await h.save(uuid(11));assert.equal(h.api.logs[0].added_date,'next Thursday, after lunch');assert.equal(h.api.logs[0].notes,'Pending — revisit after the weekend.');
});
test('a blank new row stays local and can be removed without a database request',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 await h.save(editor.id);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);assert.equal(h.api.logs.length,0);
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);
});
test('a partial row with only notes saves and later edits update the same record',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 h.input(editor.id,'notes','  AB / CD  ');await h.save(editor.id);h.input(editor.id,'pet_name','Later location');await h.save(editor.id);
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].notes,'  AB / CD  ');assert.equal(h.api.logs[0].added_date,'');assert.equal(h.api.logs[0].pet_name,'Later location');
});
test('blur saves while tabbing to another cell without replacing focus',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'pet_name','Changed');const next=h.inputs(uuid(11))[1];next.focus();
 await h.get('coughRows').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.logs[0].pet_name==='Changed');
 assert.equal(h.document.activeElement,next);assert.equal(h.inputs(uuid(11))[1],next);
});
test('new typing during an in-flight save queues behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'pet_name','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'notes','Typed during save');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].notes,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.inputs(uuid(11)).find(c=>c.dataset.field==='notes').value,'Typed during save');
});
test('lost insert response reuses the UUID and preserves the newer draft',async()=>{
 let fail=true;const h=environment({logs:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.logs.push(log({...call.payload,position:'1'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.app.addRow();const editor=[...h.app.state.editors.values()][0];h.input(editor.id,'pet_name','First');await h.save(editor.id);assert.ok(editor.error);
 h.input(editor.id,'pet_name','Second');await h.save(editor.id);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,editor.id);assert.equal(h.api.logs[0].pet_name,'Second');
});
test('lost update response recovers the saved revision before applying a newer draft',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'pet_name','First');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.input(uuid(11),'notes','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].pet_name,'First');assert.equal(h.api.logs[0].notes,'CD');assert.equal(h.api.logs[0].revision,3);
});
test('different-cell edits merge while same-cell conflicts retain the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'notes','Local');h.api.logs[0]={...h.api.logs[0],pet_name:'Remote location',revision:2};await h.save(uuid(11));
 assert.equal(h.api.logs[0].pet_name,'Remote location');assert.equal(h.api.logs[0].notes,'Local');
 h.input(uuid(11),'notes','New local');h.api.logs[0]={...h.api.logs[0],notes:'New remote',revision:4};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.notes,'New local');assert.equal(h.api.logs[0].notes,'New remote');
 assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');
});
test('clearing the last value during an in-flight save reports an unsaved empty row',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({pet_name:'Start',added_date:'',notes:''})],intercept(call){if(call.op==='update'){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'pet_name','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'pet_name','');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.match(h.app.state.editors.get(uuid(11)).error,/empty/);assert.equal(h.get('saveStatus').textContent,'Some changes are not saved');
});
test('focused or unfinished cells block refresh and every field is disabled while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'notes','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);
 await h.save(uuid(11));await h.app.refresh();assert.equal(h.api.calls.filter(c=>c.range).length,1);h.document.activeElement=null;
 h.api.intercept=call=>{if(call.table==='hq_k9_cough'&&call.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);
 assert.ok(h.inputs(uuid(11)).every(cell=>cell.disabled));gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.inputs(uuid(11)).find(c=>c.dataset.field==='notes').value,'Draft');
});
test('Delete avoids an unwanted blur save and soft-deletes the row',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'pet_name','Local draft'),row=h.rows.get(uuid(11));
 await h.get('coughRows').emit('pointerdown',{target:row.button});
 await h.get('coughRows').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 const mutations=h.api.calls.filter(call=>call.op==='update');assert.equal(mutations.length,1);assert.deepEqual(Object.keys(mutations[0].payload),['deleted_at']);
 assert.equal(h.rows.size,0);assert.equal(h.get('deletedCount').textContent,1);assert.equal(h.get('deletedSection').open,true);
});
test('tabbing from a detail Notes field to Delete still autosaves that cell',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'notes','Call again tomorrow.'),button=h.rows.get(uuid(11)).button;button.focus();
 await h.get('coughRows').emit('focusout',{target:input,relatedTarget:button});h.runTimers(0);await until(()=>h.api.logs[0].notes==='Call again tomorrow.');
 assert.equal(h.document.activeElement,button);assert.equal(h.api.logs[0].deleted_at,null);
});
test('deleted entries stay restorable after the five-second notice expires and after refresh',async()=>{
 const original=log({source_values:['','','Fixture pet','','','','','Fixture note','','']});const h=environment({logs:[original]});await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.runTimers(5000);assert.equal(h.get('toast').hidden,true);assert.ok(h.restores.has(uuid(11)));await h.app.refresh();assert.ok(h.restores.has(uuid(11)));
 await h.get('deletedList').emit('click',{target:h.restores.get(uuid(11))});await until(()=>!h.app.state.undoSaving);
 assert.equal(h.api.logs[0].deleted_at,null);assert.equal(h.rows.size,1);assert.deepEqual(h.api.logs[0].source_values,original.source_values);assert.equal(h.get('deletedCount').textContent,0);
});
test('lost delete response has a safe retry and supports Undo',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&call.payload.deleted_at&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 const editor=h.app.state.editors.get(uuid(11));await h.app.deleteRow(editor);assert.ok(editor.error);assert.ok(h.inputs(uuid(11)).every(cell=>cell.disabled));assert.equal(h.errors.get(uuid(11)).button.dataset.action,'delete');
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);await h.app.undoDelete();assert.equal(h.api.logs[0].deleted_at,null);assert.equal(h.rows.size,1);
});
test('lost restore response recovers the existing active record',async()=>{
 const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=(call,api)=>{if(call.op==='update'&&call.payload.deleted_at===null){api.logs[0]={...api.logs[0],deleted_at:null,revision:3};return {data:null,error:{code:'NETWORK'}};}};
 await h.app.undoDelete();assert.equal(h.rows.size,1);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toastText').textContent,'Entry restored.');
});
test('restoring while another row is focused preserves that draft and displays the restored row after blur',async()=>{
 const h=environment({logs:[log(),log({id:uuid(12),position:'2',deleted_at:'2026-10-01'})]});await h.start();
 const input=h.input(uuid(11),'notes','Focused draft');await h.app.undoDelete(h.app.state.logs.find(row=>row.id===uuid(12)));
 assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.logs.find(row=>row.id===uuid(12)).deleted_at,null);
 h.document.activeElement=null;await h.get('coughRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(12)));
 assert.equal(h.api.logs.find(row=>row.id===uuid(11)).notes,'Focused draft');assert.equal(h.rows.size,2);
});
test('restore blocks simultaneous refresh, Add row, and a second restore',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=call=>{if(call.op==='update'&&call.payload.deleted_at===null){held=true;return gate.promise;}};const restore=h.app.undoDelete();await until(()=>held);
 const count=h.api.calls.length;await h.app.refresh();await h.app.undoDelete();h.app.addRow();assert.equal(h.api.calls.length,count);assert.equal(h.app.state.editors.size,0);assert.ok(h.restores.get(uuid(11)).disabled);
 h.api.logs[0]={...h.api.logs[0],deleted_at:null,revision:3};gate.resolve({data:clone(h.api.logs[0]),error:null});await restore;assert.equal(h.rows.size,1);
});
test('anonymous and unapproved accounts never fetch K9 Cough records',async()=>{
 for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_k9_cough').length,0);assert.equal(h.rows.size,0);assert.equal(h.get('addRow').disabled,true);}
});
test('sign-out rejects delayed save, delete, restore and fetch responses',async()=>{
 for(const mode of ['save','delete','restore','fetch']){
  const h=environment();await h.start();if(mode==='restore')await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_k9_cough'){pending=call;return gate.promise;}};
  let mutation;if(mode==='save'){h.input(uuid(11),'pet_name','Late location');mutation=h.save(uuid(11));}else if(mode==='delete')mutation=h.app.deleteRow(h.app.state.editors.get(uuid(11)));else if(mode==='restore')mutation=h.app.undoDelete();else mutation=h.app.refresh();
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[log()]:log({pet_name:'Late location',revision:2}),error:null});await mutation;
  assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toast').hidden,true);
 }
});
test('pagination preserves more than 1,000 entries and sorts large source positions exactly',async()=>{
 const logs=Array.from({length:1001},(_,i)=>log({id:uuid(100+i),position:String(9007199254740993n+BigInt(i))}));const h=environment({logs});await h.start();
 assert.equal(h.app.state.logs.length,1001);assert.equal(h.rows.keys().next().value,uuid(100));assert.deepEqual(h.api.calls.filter(call=>call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('pet text, dates and notes are escaped in active and deleted entries',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='\"><img src=x onerror=alert(1)>';
 const h=environment({logs:[log({pet_name:payload,added_date:custom,notes:payload}),log({id:uuid(12),pet_name:payload,notes:custom,deleted_at:'2026-10-01'})]});await h.start();
 assert.doesNotMatch(h.get('coughRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);
 assert.equal(h.inputs(uuid(11)).length,10);assert.equal(h.inputs(uuid(11)).find(c=>c.dataset.field==='pet_name').value,payload);assert.equal(h.inputs(uuid(11)).find(c=>c.dataset.field==='added_date').value,custom);assert.equal(h.inputs(uuid(11)).find(c=>c.dataset.field==='notes').value,payload);
 assert.match(h.get('deletedList').innerHTML,/&lt;\/textarea&gt;/);
});

test('Date Added values sort newest first and invalid or blank dates keep original order below them',async()=>{
 const samples=[['2026-10-02',1],['',2],['2/29/2025',3],['9/30/26',4],['10/09/2026',5],['10/09/26 after visit',6],['4/21',7],['unknown',8],['4/31/26',9]];
 const h=environment({logs:samples.map(([date,pos])=>log({id:uuid(20+pos),position:String(pos),added_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()], [uuid(25),uuid(26),uuid(21),uuid(24),uuid(22),uuid(23),uuid(27),uuid(28),uuid(29)]);
 assert.equal(h.api.logs.find(r=>r.id===uuid(26)).added_date,'10/09/26 after visit');
});
test('leading date parsing validates full dates and leap days without accepting truncated dates',async()=>{
 const h=environment();await h.start();
 for(const value of ['2/29/24',' 2-29-2024 outcome','2.29.2024 (details)'])assert.equal(h.app.addedDate(value),Date.UTC(2024,1,29));
 for(const value of ['2/29/25','04/31/26','0/2/26','13/1/26','10/0/26','1/2/123','1/2/20266','1/2/','3/4/2','2026-13-09','2026-02-29','2026-10-009','x 4/5/26','1/2-26'])assert.equal(h.app.addedDate(value),null,value);
 assert.equal(h.app.addedDate('1/2'),null);
});
test('new drafts stay first and a saved date edit reorders only after the table loses focus',async()=>{
 const h=environment({logs:[log({added_date:'10/01/26'}),log({id:uuid(12),position:'2',added_date:'10/02/26'})]});await h.start();
 assert.equal([...h.rows.keys()][0],uuid(12));const input=h.input(uuid(11),'added_date','10/03/26');await h.save(uuid(11));assert.equal([...h.rows.keys()][0],uuid(12));assert.equal(h.document.activeElement,input);
 h.document.activeElement=null;await h.get('coughRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>[...h.rows.keys()][0]===uuid(11));
 h.app.addRow();const first=[...h.rows.keys()][0];assert.ok(!h.app.state.editors.get(first).base);h.app.addRow();assert.notEqual([...h.rows.keys()][0],first);assert.equal([...h.rows.keys()][1],first);
});
test('notes can be saved independently with line breaks and blank remaining fields',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0],note='  Deliver another batch next week.\nLeave materials at the reception desk.  ';
 const input=h.input(editor.id,'notes',note);input.scrollHeight=140;await h.get('coughRows').emit('focusin',{target:input});assert.equal(input.style.height,'140px');
 await h.save(editor.id);assert.equal(h.api.logs[0].notes,note);for(const key of fields.filter(key=>key!=='notes'))assert.equal(h.api.logs[0][key],'');
 h.document.activeElement=null;await h.get('coughRows').emit('focusout',{target:input});assert.equal(input.style.height,'');
});


test('unfocused notes restart at their beginning after scroll and still save on blur',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'notes','Long note\nMore details');input.scrollTop=100;input.scrollLeft=80;
 h.document.activeElement=null;await h.get('coughRows').emit('focusout',{target:input});assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);h.runTimers(0);await until(()=>h.api.logs[0].notes==='Long note\nMore details');
});

test('ISO and numeric US dates sort together while original date text remains untouched',async()=>{
 const dates=['2026-10-09','10/08/26','2026-10-10 after drop-off','10/11/2026','2024-02-29'];
 const h=environment({logs:dates.map((date,index)=>log({id:uuid(30+index),position:String(index+1),added_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()],[uuid(33),uuid(32),uuid(30),uuid(31),uuid(34)]);
 for(let index=0;index<dates.length;index++)assert.equal(h.api.logs[index].added_date,dates[index]);
 assert.equal(h.app.addedDate('2024-02-29'),Date.UTC(2024,1,29));assert.equal(h.app.addedDate('2025-02-29'),null);
});

test('same-date and unknown imported rows follow original CSV rows even if inserted out of order',async()=>{
 const logs=[log({id:uuid(11),position:'40',source_file:'Fixture.csv',source_row:2,added_date:'9/14/26'}),log({id:uuid(12),position:'12',source_file:'Fixture.csv',source_row:3,added_date:'9/14/26'}),log({id:uuid(13),position:'18',source_file:'Fixture.csv',source_row:4,added_date:''}),log({id:uuid(14),position:'11',source_file:'Fixture.csv',source_row:5,added_date:'unknown'}),log({id:uuid(15),position:'15',added_date:''})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(12),uuid(13),uuid(14),uuid(15)]);
 h.input(uuid(13),'notes','Follow up');await h.save(uuid(13));h.document.activeElement=null;h.app.renderRows();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(12),uuid(13),uuid(14),uuid(15)]);assert.equal(h.api.logs[2].source_row,4);
});

test('seven compact cells and three labelled detail fields share one editor without a wide ten-column sheet',async()=>{
 const h=environment();await h.start();assert.deepEqual(h.rows.get(uuid(11)).children.map(input=>input.dataset.field),fields.slice(0,7));assert.deepEqual(h.details.get(uuid(11)).children.map(input=>input.dataset.field),fields.slice(7));assert.equal(h.details.get(uuid(11)).hidden,true);assert.equal(h.rows.get(uuid(11)).detailsButton.attributes['aria-expanded'],'false');
 const main=h.rows.get(uuid(11)),details=h.details.get(uuid(11));main.detailsButton.focus();await h.get('coughRows').emit('click',{target:main.detailsButton});assert.equal(h.details.get(uuid(11)).hidden,false);assert.equal(main.detailsButton.attributes['aria-expanded'],'true');assert.equal(h.rows.get(uuid(11)),main);assert.equal(h.details.get(uuid(11)),details);assert.equal(h.app.state.editors.size,1);
 assert.match(h.get('coughRows').innerHTML,/Notes<\/span>/);assert.match(h.get('coughRows').innerHTML,/PCW reimbursement<\/span>/);assert.match(h.get('coughRows').innerHTML,/Management follow-up<\/span>/);
});

test('opening details brings its text into the table viewport without replacing focus or drafts',async()=>{
 const h=environment();await h.start();const pet=h.input(uuid(11),'pet_name','  Local pet draft  '),details=h.details.get(uuid(11)),main=h.rows.get(uuid(11));h.get('tableScroll').scrollLeft=680;await h.get('coughRows').emit('focusout',{target:pet,relatedTarget:main.detailsButton});main.detailsButton.focus();await h.get('coughRows').emit('click',{target:main.detailsButton});assert.equal(h.get('tableScroll').scrollLeft,0);assert.equal(h.details.get(uuid(11)),details);assert.equal(h.document.activeElement,main.detailsButton);assert.equal(h.app.state.editors.get(uuid(11)).values.pet_name,'  Local pet draft  ');h.runTimers(0);await until(()=>h.api.logs[0].pet_name==='  Local pet draft  ');
});

test('search matches all ten fields including closed detail text and preserves literal values',async()=>{
 const logs=fields.map((key,index)=>log({id:uuid(30+index),position:String(index+1),pet_name:'Fixture pet',notes:'',[key]:`  Unique TOKEN-${index}  `}));const h=environment({logs});await h.start();assert.equal(h.rows.size,10);
 for(let index=0;index<fields.length;index++){h.get('searchCough').value=`  token-${index} `;await h.get('searchCough').emit('input');assert.deepEqual([...h.rows.keys()],[uuid(30+index)],fields[index]);assert.equal(h.details.get(uuid(30+index)).hidden,true);}
 assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);h.get('searchCough').value='';await h.get('searchCough').emit('input');assert.equal(h.rows.size,10);
});

test('partial reimbursement-only drafts save all ten literal fields and keep the source archive out of writes',async()=>{
 const h=environment({logs:[]});await h.start();h.get('searchCough').value='unmatched';await h.get('searchCough').emit('input');h.app.addRow();const editor=[...h.app.state.editors.values()][0];assert.equal(h.document.activeElement.dataset.field,'pet_name');assert.equal(h.details.get(editor.id).hidden,false);assert.equal([...h.rows.keys()][0],editor.id);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
 const literal='  Requested $125.00\nAwaiting a response  ';h.input(editor.id,'pcw_reimbursement',literal);await h.save(editor.id);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].pcw_reimbursement,literal);for(const key of fields.filter(key=>key!=='pcw_reimbursement'))assert.equal(h.api.logs[0][key],'');assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='insert').payload).sort(),['id',...fields].sort());
});

test('collapsing and reopening details during a save retains queued edits in another detail field',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();const notes=h.input(uuid(11),'notes','  First note\nMore context  '),details=h.details.get(uuid(11)),main=h.rows.get(uuid(11));const save=h.save(uuid(11));await until(()=>pending);
 await h.get('coughRows').emit('focusout',{target:notes,relatedTarget:main.detailsButton});main.detailsButton.focus();h.app.toggleDetails(uuid(11));assert.equal(details.hidden,true);h.app.toggleDetails(uuid(11));const reimbursement=h.input(uuid(11),'pcw_reimbursement','  Partial amount / call later  ');assert.equal(h.details.get(uuid(11)),details);
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;assert.equal(h.api.logs[0].notes,'  First note\nMore context  ');assert.equal(h.api.logs[0].pcw_reimbursement,'  Partial amount / call later  ');assert.equal(h.api.logs[0].revision,3);assert.equal(h.document.activeElement,reimbursement);assert.equal(h.inputs(uuid(11)).find(input=>input.dataset.field==='pcw_reimbursement').value,'  Partial amount / call later  ');
});

test('a failed collapsed detail save stays retrievable through search and Retry with the same record',async()=>{
 let fail=true;const h=environment({intercept(call){if(call.op==='update'&&fail){fail=false;return {data:null,error:{code:'NETWORK'}};}}});await h.start();const input=h.input(uuid(11),'management_follow_up','  Follow up\nKeep these details  '),main=h.rows.get(uuid(11));await h.get('coughRows').emit('focusout',{target:input,relatedTarget:main.detailsButton});main.detailsButton.focus();h.app.toggleDetails(uuid(11));h.runTimers(0);await until(()=>Boolean(h.app.state.editors.get(uuid(11)).error));assert.equal(h.details.get(uuid(11)).hidden,true);
 h.document.activeElement=null;h.get('searchCough').value='no match';await h.get('searchCough').emit('input');assert.ok(h.rows.has(uuid(11)));assert.match(h.get('rowCount').textContent,/unsaved rows stay visible/);h.app.toggleDetails(uuid(11));assert.equal(h.inputs(uuid(11)).find(input=>input.dataset.field==='management_follow_up').value,'  Follow up\nKeep these details  ');
 await h.get('coughRows').emit('click',{target:h.errors.get(uuid(11)).button});await until(()=>!h.app.state.editors.get(uuid(11)).saving);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].management_follow_up,'  Follow up\nKeep these details  ');assert.equal(h.rows.size,0);
});

test('main/detail disjoint edits merge and synchronize hidden cells while same-detail conflicts retain the draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'service_dates','  Date range to confirm  ');h.api.logs[0]={...h.api.logs[0],management_follow_up:'Remote follow-up',revision:2};await h.save(uuid(11));assert.equal(h.api.logs[0].service_dates,'  Date range to confirm  ');assert.equal(h.inputs(uuid(11)).find(input=>input.dataset.field==='management_follow_up').value,'Remote follow-up');h.app.toggleDetails(uuid(11));assert.equal(h.details.get(uuid(11)).hidden,false);
 h.input(uuid(11),'management_follow_up','Local follow-up');h.api.logs[0]={...h.api.logs[0],management_follow_up:'New remote follow-up',revision:4};await h.save(uuid(11));const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.management_follow_up,'Local follow-up');assert.equal(h.api.logs[0].management_follow_up,'New remote follow-up');assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');h.app.toggleDetails(uuid(11));h.app.toggleDetails(uuid(11));assert.equal(h.inputs(uuid(11)).find(input=>input.dataset.field==='management_follow_up').value,'Local follow-up');
});

test('deleting and uncertain deletion disable every compact and expanded field without losing the archive',async()=>{
 const gate=deferred();let pending;const literals=['10/1/26','AB','Fixture pet','9/28 - 10/1','  A / B\nRoom changed  ','Mixed grouping','Boarding / Daycare','  Full note\nSecond line  ','Requested / no amount change','  Called twice\nWaiting for response  '],original=log({...Object.fromEntries(fields.map((key,index)=>[key,literals[index]])),source_file:'Fixture.csv',source_row:3,source_values:literals});
 const h=environment({logs:[original],intercept(call){if(call.op==='update'&&call.payload.deleted_at&&!pending){pending=call;return gate.promise;}}});await h.start();h.app.toggleDetails(uuid(11));const editor=h.app.state.editors.get(uuid(11)),deletion=h.app.deleteRow(editor);await until(()=>pending);assert.ok(h.inputs(uuid(11)).every(input=>input.disabled));const old=editor.values.management_follow_up;h.input(uuid(11),'management_follow_up','Forbidden during deletion');assert.equal(editor.values.management_follow_up,old);
 gate.resolve({data:null,error:{code:'NETWORK'}});await deletion;assert.ok(editor.error);assert.ok(h.inputs(uuid(11)).every(input=>input.disabled));await h.app.deleteRow(editor);assert.equal(h.rows.size,0);assert.equal(h.details.size,0);h.runTimers(5000);assert.equal(h.get('toast').hidden,true);h.document.activeElement=null;await h.app.undoDelete();assert.equal(h.rows.size,1);assert.equal(h.details.size,1);assert.deepEqual(h.api.logs[0].source_values,literals);for(const key of fields)assert.equal(h.api.logs[0][key],original[key]);assert.ok(h.inputs(uuid(11)).every(input=>!input.disabled));
});

test('sign-out clears expanded records and rejects a delayed detail save response',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'){pending=call;return gate.promise;}}});await h.start();h.input(uuid(11),'notes','Late note');const save=h.save(uuid(11));await until(()=>pending);h.signOut();assert.equal(h.rows.size,0);assert.equal(h.details.size,0);assert.equal(h.app.state.openDetails.size,0);gate.resolve({data:log({notes:'Late note',revision:2}),error:null});await save;assert.equal(h.rows.size,0);assert.equal(h.details.size,0);assert.equal(h.app.state.logs.length,0);
});

test('duplicate pet names remain separate cases through search, updates, deletion and restoration',async()=>{
 const logs=[log({id:uuid(11),pet_name:'Same fixture pet',added_date:'10/1/26'}),log({id:uuid(12),position:'2',pet_name:'Same fixture pet',added_date:'10/2/26',notes:'Second separate case'})];const h=environment({logs});await h.start();h.get('searchCough').value='same fixture';await h.get('searchCough').emit('input');assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(11)]);h.input(uuid(11),'notes','First case updated');await h.save(uuid(11));assert.equal(h.api.logs[1].notes,'Second separate case');h.document.activeElement=null;await h.app.deleteRow(h.app.state.editors.get(uuid(11)));assert.equal(h.rows.size,1);await h.app.undoDelete();assert.equal(h.rows.size,2);assert.equal(h.api.logs.length,2);assert.equal(h.api.logs[0].notes,'First case updated');
});

test('all ten literal fields update independently without interpretation and retain immutable source cells',async()=>{
 const literals=[' 10/1/26 ',' AB ','Fixture pet',' 9/1,9/8 / unknown ',' Room A to Room B; gate 3 ','small / individual / mixed','daycare, boarding','Line one\r\nLine two',' $200 requested, pending ','Manager called / awaiting reply'],original=log({...Object.fromEntries(fields.map((key,index)=>[key,literals[index]])),source_file:'Fixture.csv',source_row:7,source_values:literals});const h=environment({logs:[original]});await h.start();
 for(const key of fields){h.input(uuid(11),key,`${original[key]} changed`);await h.save(uuid(11));assert.deepEqual(Object.keys(h.api.calls.filter(call=>call.op==='update').at(-1).payload),[key]);}
 for(const key of fields)assert.equal(h.api.logs[0][key],`${original[key]} changed`);assert.deepEqual(h.api.logs[0].source_values,literals);assert.equal(h.api.logs[0].source_row,7);assert.equal(h.api.logs[0].position,'1');
});
