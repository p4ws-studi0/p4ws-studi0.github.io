/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.MARKETING_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'marketing-initiatives.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/marketing-initiatives.js'),'utf8');
const fields=['drop_off_location','initiative_date','notes'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const log=(extra={})=>({id:uuid(11),drop_off_location:'Fixture location',initiative_date:'',notes:'Fixture note',source_year:null,position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
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
   closest(selector){if(selector==='#marketingRows')return this.row?nodes.get('marketingRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='marketingRows')parseRows(value);if(id==='deletedList')parseRestores(value);}});return n;
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
  assert.equal(call.table,'hq_marketing_initiatives');const list=api.logs;
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
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,sortLogs,initiativeDate,rowDate,renderRows,addRow,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,errors,restores,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  input(id,key,value){const input=rows.get(id).children.find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},
  runTimers(delay){for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}}
 };
}
test('compact table has all three free-text editable cells and direct add/delete controls',async()=>{
 const h=environment();await h.start();const cells=h.rows.get(uuid(11)).children;
 assert.deepEqual(cells.map(cell=>cell.dataset.field),fields);
 assert.ok(cells.every(cell=>cell.tagName==='TEXTAREA'));assert.doesNotMatch(h.get('marketingRows').innerHTML,/<select/);assert.match(h.get('marketingRows').innerHTML,/maxlength="20000"/);
 assert.ok(h.get('addRow'));assert.equal(h.get('dogSelect'),undefined);
});
test('editing a location changes only that cell and preserves literal dates, notes and source year',async()=>{
 const original=log({initiative_date:'  8/19  ',notes:' First line\r\nSecond line  ',source_file:'Fixture.csv',source_row:4,source_year:2025,source_values:['Fixture location','  8/19  ',' First line\r\nSecond line  ']});
 const h=environment({logs:[original]});await h.start();h.input(original.id,'drop_off_location','Renamed location');await h.save(original.id);
 const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='drop_off_location'?'Renamed location':original[key]);
 assert.deepEqual(saved.source_values,original.source_values);assert.equal(saved.source_row,4);assert.equal(saved.source_year,2025);assert.equal(saved.position,'1');
 const call=h.api.calls.find(c=>c.op==='update');assert.deepEqual(call.payload,{drop_off_location:'Renamed location'});assert.ok(call.filters.some(([key,value])=>key==='revision'&&value===1));
});
test('normalized textarea no-op preserves original line endings and whitespace',async()=>{
 const h=environment({logs:[log({drop_off_location:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'drop_off_location','Line\nTwo  ');await h.save(uuid(11));
 assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].drop_off_location,'Line\r\nTwo  ');
});
test('date and note cells accept literal mixed text without coercion',async()=>{
 const h=environment({logs:[log({initiative_date:'8/19/25 — original drop',notes:'Pending — revisit after the weekend.'})]});await h.start();
 for(const key of ['initiative_date','notes'])assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field===key).value,h.api.logs[0][key]);
 h.input(uuid(11),'initiative_date','next Thursday, after lunch');await h.save(uuid(11));assert.equal(h.api.logs[0].initiative_date,'next Thursday, after lunch');assert.equal(h.api.logs[0].notes,'Pending — revisit after the weekend.');
});
test('a blank new row stays local and can be removed without a database request',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 await h.save(editor.id);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);assert.equal(h.api.logs.length,0);
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);
});
test('a partial row with only notes saves and later edits update the same record',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 h.input(editor.id,'notes','  AB / CD  ');await h.save(editor.id);h.input(editor.id,'drop_off_location','Later location');await h.save(editor.id);
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].notes,'  AB / CD  ');assert.equal(h.api.logs[0].initiative_date,'');assert.equal(h.api.logs[0].drop_off_location,'Later location');
});
test('blur saves while tabbing to another cell without replacing focus',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'drop_off_location','Changed');const next=h.rows.get(uuid(11)).children[1];next.focus();
 await h.get('marketingRows').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.logs[0].drop_off_location==='Changed');
 assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children[1],next);
});
test('new typing during an in-flight save queues behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'drop_off_location','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'notes','Typed during save');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].notes,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='notes').value,'Typed during save');
});
test('lost insert response reuses the UUID and preserves the newer draft',async()=>{
 let fail=true;const h=environment({logs:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.logs.push(log({...call.payload,position:'1'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.app.addRow();const editor=[...h.app.state.editors.values()][0];h.input(editor.id,'drop_off_location','First');await h.save(editor.id);assert.ok(editor.error);
 h.input(editor.id,'drop_off_location','Second');await h.save(editor.id);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,editor.id);assert.equal(h.api.logs[0].drop_off_location,'Second');
});
test('lost update response recovers the saved revision before applying a newer draft',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'drop_off_location','First');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.input(uuid(11),'notes','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].drop_off_location,'First');assert.equal(h.api.logs[0].notes,'CD');assert.equal(h.api.logs[0].revision,3);
});
test('different-cell edits merge while same-cell conflicts retain the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'notes','Local');h.api.logs[0]={...h.api.logs[0],drop_off_location:'Remote location',revision:2};await h.save(uuid(11));
 assert.equal(h.api.logs[0].drop_off_location,'Remote location');assert.equal(h.api.logs[0].notes,'Local');
 h.input(uuid(11),'notes','New local');h.api.logs[0]={...h.api.logs[0],notes:'New remote',revision:4};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.notes,'New local');assert.equal(h.api.logs[0].notes,'New remote');
 assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');
});
test('clearing the last value during an in-flight save reports an unsaved empty row',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({drop_off_location:'Start',initiative_date:'',notes:''})],intercept(call){if(call.op==='update'){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'drop_off_location','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'drop_off_location','');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.match(h.app.state.editors.get(uuid(11)).error,/empty/);assert.equal(h.get('saveStatus').textContent,'Some changes are not saved');
});
test('focused or unfinished cells block refresh and every field is disabled while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'notes','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);
 await h.save(uuid(11));await h.app.refresh();assert.equal(h.api.calls.filter(c=>c.range).length,1);h.document.activeElement=null;
 h.api.intercept=call=>{if(call.table==='hq_marketing_initiatives'&&call.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);
 assert.ok(h.rows.get(uuid(11)).children.every(cell=>cell.disabled));gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='notes').value,'Draft');
});
test('Delete avoids an unwanted blur save and soft-deletes the row',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'drop_off_location','Local draft'),row=h.rows.get(uuid(11));
 await h.get('marketingRows').emit('pointerdown',{target:row.button});
 await h.get('marketingRows').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 const mutations=h.api.calls.filter(call=>call.op==='update');assert.equal(mutations.length,1);assert.deepEqual(Object.keys(mutations[0].payload),['deleted_at']);
 assert.equal(h.rows.size,0);assert.equal(h.get('deletedCount').textContent,1);assert.equal(h.get('deletedSection').open,true);
});
test('tabbing from the final Notes cell to Delete still autosaves that cell',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'notes','Call again tomorrow.'),button=h.rows.get(uuid(11)).button;button.focus();
 await h.get('marketingRows').emit('focusout',{target:input,relatedTarget:button});h.runTimers(0);await until(()=>h.api.logs[0].notes==='Call again tomorrow.');
 assert.equal(h.document.activeElement,button);assert.equal(h.api.logs[0].deleted_at,null);
});
test('deleted entries stay restorable after the five-second notice expires and after refresh',async()=>{
 const original=log({source_values:['Fixture location','','Fixture note']});const h=environment({logs:[original]});await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
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
 const input=h.input(uuid(11),'notes','Focused draft');await h.app.undoDelete(h.app.state.logs.find(row=>row.id===uuid(12)));
 assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.logs.find(row=>row.id===uuid(12)).deleted_at,null);
 h.document.activeElement=null;await h.get('marketingRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(12)));
 assert.equal(h.api.logs.find(row=>row.id===uuid(11)).notes,'Focused draft');assert.equal(h.rows.size,2);
});
test('restore blocks simultaneous refresh, Add row, and a second restore',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=call=>{if(call.op==='update'&&call.payload.deleted_at===null){held=true;return gate.promise;}};const restore=h.app.undoDelete();await until(()=>held);
 const count=h.api.calls.length;await h.app.refresh();await h.app.undoDelete();h.app.addRow();assert.equal(h.api.calls.length,count);assert.equal(h.app.state.editors.size,0);assert.ok(h.restores.get(uuid(11)).disabled);
 h.api.logs[0]={...h.api.logs[0],deleted_at:null,revision:3};gate.resolve({data:clone(h.api.logs[0]),error:null});await restore;assert.equal(h.rows.size,1);
});
test('anonymous and unapproved accounts never fetch marketing records',async()=>{
 for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_marketing_initiatives').length,0);assert.equal(h.rows.size,0);assert.equal(h.get('addRow').disabled,true);}
});
test('sign-out rejects delayed save, delete, restore and fetch responses',async()=>{
 for(const mode of ['save','delete','restore','fetch']){
  const h=environment();await h.start();if(mode==='restore')await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_marketing_initiatives'){pending=call;return gate.promise;}};
  let mutation;if(mode==='save'){h.input(uuid(11),'drop_off_location','Late location');mutation=h.save(uuid(11));}else if(mode==='delete')mutation=h.app.deleteRow(h.app.state.editors.get(uuid(11)));else if(mode==='restore')mutation=h.app.undoDelete();else mutation=h.app.refresh();
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[log()]:log({drop_off_location:'Late location',revision:2}),error:null});await mutation;
  assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toast').hidden,true);
 }
});
test('pagination preserves more than 1,000 entries and sorts large source positions exactly',async()=>{
 const logs=Array.from({length:1001},(_,i)=>log({id:uuid(100+i),position:String(9007199254740993n+BigInt(i))}));const h=environment({logs});await h.start();
 assert.equal(h.app.state.logs.length,1001);assert.equal(h.rows.keys().next().value,uuid(100));assert.deepEqual(h.api.calls.filter(call=>call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('location names, free text and notes are escaped in active and deleted entries',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='\"><img src=x onerror=alert(1)>';
 const h=environment({logs:[log({drop_off_location:payload,initiative_date:custom,notes:payload}),log({id:uuid(12),drop_off_location:payload,notes:custom,deleted_at:'2026-10-01'})]});await h.start();
 assert.doesNotMatch(h.get('marketingRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);
 assert.equal(h.rows.get(uuid(11)).children.length,3);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='drop_off_location').value,payload);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='initiative_date').value,custom);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='notes').value,payload);
 assert.match(h.get('deletedList').innerHTML,/&lt;\/textarea&gt;/);
});

test('initiative dates sort newest first and invalid or blank dates keep original order below them',async()=>{
 const samples=[['2026-10-02',1],['',2],['2/29/2025',3],['9/30/26',4],['10/09/2026',5],['10/09/26 after visit',6],['4/21',7],['unknown',8],['4/31/26',9]];
 const h=environment({logs:samples.map(([date,pos])=>log({id:uuid(20+pos),position:String(pos),initiative_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()], [uuid(25),uuid(26),uuid(21),uuid(24),uuid(27),uuid(22),uuid(23),uuid(28),uuid(29)]);
 assert.equal(h.api.logs.find(r=>r.id===uuid(26)).initiative_date,'10/09/26 after visit');
});
test('leading date parsing validates full dates and leap days without accepting truncated dates',async()=>{
 const h=environment();await h.start();
 for(const value of ['2/29/24',' 2-29-2024 notes','2.29.2024 (details)'])assert.equal(h.app.initiativeDate(value),Date.UTC(2024,1,29));
 for(const value of ['2/29/25','04/31/26','0/2/26','13/1/26','10/0/26','1/2/123','1/2/20266','1/2/','3/4/2','2026-13-09','2026-02-29','2026-10-009','x 4/5/26','1/2-26'])assert.equal(h.app.initiativeDate(value),null,value);
 assert.equal(h.app.initiativeDate('1/2'),Date.UTC(2026,0,2));
});
test('new drafts stay first and a saved date edit reorders only after the table loses focus',async()=>{
 const h=environment({logs:[log({initiative_date:'10/01/26'}),log({id:uuid(12),position:'2',initiative_date:'10/02/26'})]});await h.start();
 assert.equal([...h.rows.keys()][0],uuid(12));const input=h.input(uuid(11),'initiative_date','10/03/26');await h.save(uuid(11));assert.equal([...h.rows.keys()][0],uuid(12));assert.equal(h.document.activeElement,input);
 h.document.activeElement=null;await h.get('marketingRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>[...h.rows.keys()][0]===uuid(11));
 h.app.addRow();const first=[...h.rows.keys()][0];assert.ok(!h.app.state.editors.get(first).base);h.app.addRow();assert.notEqual([...h.rows.keys()][0],first);assert.equal([...h.rows.keys()][1],first);
});
test('notes can be saved independently with line breaks and blank remaining fields',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0],note='  Deliver another batch next week.\nLeave materials at the reception desk.  ';
 const input=h.input(editor.id,'notes',note);input.scrollHeight=140;await h.get('marketingRows').emit('focusin',{target:input});assert.equal(input.style.height,'140px');
 await h.save(editor.id);assert.equal(h.api.logs[0].notes,note);for(const key of fields.filter(key=>key!=='notes'))assert.equal(h.api.logs[0][key],'');
 h.document.activeElement=null;await h.get('marketingRows').emit('focusout',{target:input});assert.equal(input.style.height,'');
});

test('yearless dates use the Eastern year around New Year rather than the UTC year',async()=>{
 const h=environment({now:'2027-01-01T01:00:00Z'});await h.start();assert.equal(h.app.initiativeDate('1/2'),Date.UTC(2026,0,2));
 const next=environment({now:'2027-01-01T06:00:00Z'});await next.start();assert.equal(next.app.initiativeDate('1/2'),Date.UTC(2027,0,2));
});

test('imported yearless dates keep their source year while new rows use the current Eastern year',async()=>{
 const h=environment({logs:[log({id:uuid(11),initiative_date:'8/19',source_year:2025,source_values:['Fixture location','8/19','Fixture note']}),log({id:uuid(12),position:'2',initiative_date:'1/5/26'}),log({id:uuid(13),position:'3',initiative_date:'8/19',source_year:null})]});await h.start();
 assert.deepEqual([...h.rows.keys()],[uuid(13),uuid(12),uuid(11)]);assert.equal(h.app.initiativeDate('8/19',2025),Date.UTC(2025,7,19));
 assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='initiative_date').value,'8/19');
 h.app.addRow();const editor=[...h.app.state.editors.values()].find(e=>!e.base);assert.equal(h.document.activeElement.dataset.field,'drop_off_location');
 h.input(editor.id,'initiative_date','8/19');await h.save(editor.id);assert.equal(h.api.logs.find(r=>r.id===editor.id).source_year,null);assert.equal(h.app.initiativeDate(h.api.logs.find(r=>r.id===editor.id).initiative_date),Date.UTC(2026,7,19));
 const call=h.api.calls.find(c=>c.op==='insert');assert.deepEqual(Object.keys(call.payload).sort(),['drop_off_location','id','initiative_date','notes'].sort());
});
test('explicit date years take precedence over source context and date edits preserve source context',async()=>{
 const h=environment({logs:[log({initiative_date:'8/19',source_year:2025,source_values:['Fixture location','8/19','Fixture note']})]});await h.start();
 assert.equal(h.app.initiativeDate('8/19/26',2025),Date.UTC(2026,7,19));assert.equal(h.app.initiativeDate('8/19/2024',2025),Date.UTC(2024,7,19));
 h.input(uuid(11),'initiative_date','8/20');await h.save(uuid(11));assert.equal(h.api.logs[0].source_year,2025);assert.equal(h.app.rowDate(h.api.logs[0]),Date.UTC(2026,7,20));assert.equal(h.api.logs[0].source_values[1],'8/19');
 h.input(uuid(11),'initiative_date','8/19');await h.save(uuid(11));assert.equal(h.app.rowDate(h.api.logs[0]),Date.UTC(2025,7,19));
 h.input(uuid(11),'initiative_date','8/20/26');await h.save(uuid(11));assert.equal(h.api.logs[0].source_year,2025);assert.equal(h.app.rowDate(h.api.logs[0]),Date.UTC(2026,7,20));
});
test('unfocused notes restart at their beginning after scroll and still save on blur',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'notes','Long note\nMore details');input.scrollTop=100;input.scrollLeft=80;
 h.document.activeElement=null;await h.get('marketingRows').emit('focusout',{target:input});assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);h.runTimers(0);await until(()=>h.api.logs[0].notes==='Long note\nMore details');
});

test('ISO and numeric US dates sort together while original date text remains untouched',async()=>{
 const dates=['2026-10-09','10/08/26','2026-10-10 after drop-off','10/11/2026','2024-02-29'];
 const h=environment({logs:dates.map((date,index)=>log({id:uuid(30+index),position:String(index+1),initiative_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()],[uuid(33),uuid(32),uuid(30),uuid(31),uuid(34)]);
 for(let index=0;index<dates.length;index++)assert.equal(h.api.logs[index].initiative_date,dates[index]);
 assert.equal(h.app.initiativeDate('2024-02-29'),Date.UTC(2024,1,29));assert.equal(h.app.initiativeDate('2025-02-29'),null);
});
