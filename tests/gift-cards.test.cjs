/* Behavioral checks with synthetic records only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.GIFT_CARDS_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'gift-cards.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/gift-cards.js'),'utf8');
const fields=['certificate_number','amount','purchased_date','purchaser_name','purchase_initials','redeemed_date','redeemer_name','redemption_initials'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const log=(extra={})=>({id:uuid(11),certificate_number:'99-01',amount:'',purchased_date:'',purchaser_name:'Fixture purchaser',purchase_initials:'',redeemed_date:'',redeemer_name:'',redemption_initials:'',position:'1',revision:1,created_at:'2026-09-30T12:00:00Z',deleted_at:null,...extra});
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
   closest(selector){if(selector==='#giftCardRows')return this.row?nodes.get('giftCardRows'):null;if(selector==='[data-row-id]')return this.row||null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(n=>n.dataset.field===key)||null;},
   querySelectorAll(){return this.children;}};
  n.classList={toggle(c,on){if(on)n.classes.add(c);else n.classes.delete(c);},add(c){n.classes.add(c);},remove(c){n.classes.delete(c);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='giftCardRows')parseRows(value);if(id==='deletedList')parseRestores(value);}});return n;
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
 nodes.get('cardFilter').value='details';
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  assert.equal(call.table,'hq_gift_cards');const list=api.logs;
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
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,sortLogs,purchaseDate,rowDate,renderRows,addRow,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty};\n${marker}`),context);
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
 assert.ok(cells.every(cell=>cell.tagName==='TEXTAREA'));assert.doesNotMatch(h.get('giftCardRows').innerHTML,/<select/);assert.match(h.get('giftCardRows').innerHTML,/maxlength="20000"/);
 assert.ok(h.get('addRow'));assert.equal(h.get('dogSelect'),undefined);
});
test('editing a certificate changes only that cell and preserves all source literals',async()=>{
 const original=log({purchased_date:'  8/19  ',purchaser_name:' First line\r\nSecond line  ',source_file:'Fixture.csv',source_row:4,source_values:['99-01','','  8/19  ',' First line\r\nSecond line  ','','','','']});
 const h=environment({logs:[original]});await h.start();h.input(original.id,'certificate_number','99-02');await h.save(original.id);
 const saved=h.api.logs[0];for(const key of fields)assert.equal(saved[key],key==='certificate_number'?'99-02':original[key]);
 assert.deepEqual(saved.source_values,original.source_values);assert.equal(saved.source_row,4);assert.equal(saved.position,'1');
 const call=h.api.calls.find(c=>c.op==='update');assert.deepEqual(call.payload,{certificate_number:'99-02'});assert.ok(call.filters.some(([key,value])=>key==='revision'&&value===1));
});
test('normalized textarea no-op preserves original line endings and whitespace',async()=>{
 const h=environment({logs:[log({certificate_number:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'certificate_number','Line\nTwo  ');await h.save(uuid(11));
 assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].certificate_number,'Line\r\nTwo  ');
});
test('date and note cells accept literal mixed text without coercion',async()=>{
 const h=environment({logs:[log({purchased_date:'8/19/25 — original drop',purchaser_name:'Pending — revisit after the weekend.'})]});await h.start();
 for(const key of ['purchased_date','purchaser_name'])assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field===key).value,h.api.logs[0][key]);
 h.input(uuid(11),'purchased_date','next Thursday, after lunch');await h.save(uuid(11));assert.equal(h.api.logs[0].purchased_date,'next Thursday, after lunch');assert.equal(h.api.logs[0].purchaser_name,'Pending — revisit after the weekend.');
});
test('a blank new row stays local and can be removed without a database request',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 await h.save(editor.id);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);assert.equal(h.api.logs.length,0);
 await h.app.deleteRow(editor);assert.equal(h.rows.size,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);
});
test('a partial row with only a purchaser name saves and later edits update the same record',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0];
 h.input(editor.id,'purchaser_name','  AB / CD  ');await h.save(editor.id);h.input(editor.id,'certificate_number','99-03');await h.save(editor.id);
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].purchaser_name,'  AB / CD  ');assert.equal(h.api.logs[0].purchased_date,'');assert.equal(h.api.logs[0].certificate_number,'99-03');
});
test('blur saves while tabbing to another cell without replacing focus',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'certificate_number','Changed');const next=h.rows.get(uuid(11)).children[1];next.focus();
 await h.get('giftCardRows').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.logs[0].certificate_number==='Changed');
 assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children[1],next);
});
test('new typing during an in-flight save queues behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'certificate_number','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'purchaser_name','Typed during save');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].purchaser_name,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='purchaser_name').value,'Typed during save');
});
test('lost insert response reuses the UUID and preserves the newer draft',async()=>{
 let fail=true;const h=environment({logs:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.logs.push(log({...call.payload,position:'1'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.app.addRow();const editor=[...h.app.state.editors.values()][0];h.input(editor.id,'certificate_number','First');await h.save(editor.id);assert.ok(editor.error);
 h.input(editor.id,'certificate_number','Second');await h.save(editor.id);assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,editor.id);assert.equal(h.api.logs[0].certificate_number,'Second');
});
test('lost update response recovers the saved revision before applying a newer draft',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'certificate_number','First');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.input(uuid(11),'purchaser_name','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].certificate_number,'First');assert.equal(h.api.logs[0].purchaser_name,'CD');assert.equal(h.api.logs[0].revision,3);
});
test('different-cell edits merge while same-cell conflicts retain the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'purchaser_name','Local');h.api.logs[0]={...h.api.logs[0],certificate_number:'99-04',revision:2};await h.save(uuid(11));
 assert.equal(h.api.logs[0].certificate_number,'99-04');assert.equal(h.api.logs[0].purchaser_name,'Local');
 h.input(uuid(11),'purchaser_name','New local');h.api.logs[0]={...h.api.logs[0],purchaser_name:'New remote',revision:4};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.purchaser_name,'New local');assert.equal(h.api.logs[0].purchaser_name,'New remote');
 assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');
});
test('clearing the last value during an in-flight save reports an unsaved empty row',async()=>{
 const gate=deferred();let pending;const h=environment({logs:[log({certificate_number:'Start',purchased_date:'',purchaser_name:''})],intercept(call){if(call.op==='update'){pending=call;return gate.promise;}}});await h.start();h.get('cardFilter').value='all';await h.get('cardFilter').emit('change');
 h.input(uuid(11),'certificate_number','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'certificate_number','');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.match(h.app.state.editors.get(uuid(11)).error,/empty/);assert.equal(h.get('saveStatus').textContent,'Some changes are not saved');
});
test('focused or unfinished cells block refresh and every field is disabled while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'purchaser_name','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);
 await h.save(uuid(11));await h.app.refresh();assert.equal(h.api.calls.filter(c=>c.range).length,1);h.document.activeElement=null;
 h.api.intercept=call=>{if(call.table==='hq_gift_cards'&&call.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);
 assert.ok(h.rows.get(uuid(11)).children.every(cell=>cell.disabled));gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='purchaser_name').value,'Draft');
});
test('Delete avoids an unwanted blur save and soft-deletes the row',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'certificate_number','Local draft'),row=h.rows.get(uuid(11));
 await h.get('giftCardRows').emit('pointerdown',{target:row.button});
 await h.get('giftCardRows').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 const mutations=h.api.calls.filter(call=>call.op==='update');assert.equal(mutations.length,1);assert.deepEqual(Object.keys(mutations[0].payload),['deleted_at']);
 assert.equal(h.rows.size,0);assert.equal(h.get('deletedCount').textContent,1);assert.equal(h.get('deletedSection').open,true);
});
test('tabbing from final redemption initials to Delete still autosaves that cell',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'redemption_initials','TS'),button=h.rows.get(uuid(11)).button;button.focus();
 await h.get('giftCardRows').emit('focusout',{target:input,relatedTarget:button});h.runTimers(0);await until(()=>h.api.logs[0].redemption_initials==='TS');
 assert.equal(h.document.activeElement,button);assert.equal(h.api.logs[0].deleted_at,null);
});
test('deleted entries stay restorable after the five-second notice expires and after refresh',async()=>{
 const original=log({source_values:['99-01','','','Fixture purchaser','','','','']});const h=environment({logs:[original]});await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
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
 const input=h.input(uuid(11),'purchaser_name','Focused draft');await h.app.undoDelete(h.app.state.logs.find(row=>row.id===uuid(12)));
 assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.logs.find(row=>row.id===uuid(12)).deleted_at,null);
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(12)));
 assert.equal(h.api.logs.find(row=>row.id===uuid(11)).purchaser_name,'Focused draft');assert.equal(h.rows.size,2);
});
test('restore blocks simultaneous refresh, Add row, and a second restore',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
 h.api.intercept=call=>{if(call.op==='update'&&call.payload.deleted_at===null){held=true;return gate.promise;}};const restore=h.app.undoDelete();await until(()=>held);
 const count=h.api.calls.length;await h.app.refresh();await h.app.undoDelete();h.app.addRow();assert.equal(h.api.calls.length,count);assert.equal(h.app.state.editors.size,0);assert.ok(h.restores.get(uuid(11)).disabled);
 h.api.logs[0]={...h.api.logs[0],deleted_at:null,revision:3};gate.resolve({data:clone(h.api.logs[0]),error:null});await restore;assert.equal(h.rows.size,1);
});
test('anonymous and unapproved accounts never fetch gift card records',async()=>{
 for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_gift_cards').length,0);assert.equal(h.rows.size,0);assert.equal(h.get('addRow').disabled,true);}
});
test('sign-out rejects delayed save, delete, restore and fetch responses',async()=>{
 for(const mode of ['save','delete','restore','fetch']){
  const h=environment();await h.start();if(mode==='restore')await h.app.deleteRow(h.app.state.editors.get(uuid(11)));
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_gift_cards'){pending=call;return gate.promise;}};
  let mutation;if(mode==='save'){h.input(uuid(11),'certificate_number','99-05');mutation=h.save(uuid(11));}else if(mode==='delete')mutation=h.app.deleteRow(h.app.state.editors.get(uuid(11)));else if(mode==='restore')mutation=h.app.undoDelete();else mutation=h.app.refresh();
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[log()]:log({certificate_number:'99-05',revision:2}),error:null});await mutation;
  assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.get('deletedCount').textContent,0);assert.equal(h.get('toast').hidden,true);
 }
});
test('pagination preserves more than 1,000 entries and sorts large source positions exactly',async()=>{
 const logs=Array.from({length:1001},(_,i)=>log({id:uuid(100+i),position:String(9007199254740993n+BigInt(i))}));const h=environment({logs});await h.start();
 assert.equal(h.app.state.logs.length,1001);assert.equal(h.rows.keys().next().value,uuid(100));assert.deepEqual(h.api.calls.filter(call=>call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('certificate numbers, dates and purchaser text are escaped in active and deleted entries',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='\"><img src=x onerror=alert(1)>';
 const h=environment({logs:[log({certificate_number:payload,purchased_date:custom,purchaser_name:payload}),log({id:uuid(12),certificate_number:payload,purchaser_name:custom,deleted_at:'2026-10-01'})]});await h.start();
 assert.doesNotMatch(h.get('giftCardRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);
 assert.equal(h.rows.get(uuid(11)).children.length,8);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='certificate_number').value,payload);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='purchased_date').value,custom);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='purchaser_name').value,payload);
 assert.match(h.get('deletedList').innerHTML,/&lt;\/textarea&gt;/);
});

test('purchase dates sort newest first and invalid or blank dates keep original order below them',async()=>{
 const samples=[['2026-10-02',1],['',2],['2/29/2025',3],['9/30/26',4],['10/09/2026',5],['10/09/26 after visit',6],['4/21',7],['unknown',8],['4/31/26',9]];
 const h=environment({logs:samples.map(([date,pos])=>log({id:uuid(20+pos),position:String(pos),purchased_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()], [uuid(25),uuid(26),uuid(21),uuid(24),uuid(22),uuid(23),uuid(27),uuid(28),uuid(29)]);
 assert.equal(h.api.logs.find(r=>r.id===uuid(26)).purchased_date,'10/09/26 after visit');
});
test('leading date parsing validates full dates and leap days without accepting truncated dates',async()=>{
 const h=environment();await h.start();
 for(const value of ['2/29/24',' 2-29-2024 outcome','2.29.2024 (details)'])assert.equal(h.app.purchaseDate(value),Date.UTC(2024,1,29));
 for(const value of ['2/29/25','04/31/26','0/2/26','13/1/26','10/0/26','1/2/123','1/2/20266','1/2/','3/4/2','2026-13-09','2026-02-29','2026-10-009','x 4/5/26','1/2-26'])assert.equal(h.app.purchaseDate(value),null,value);
 assert.equal(h.app.purchaseDate('1/2'),null);
});
test('new drafts stay first and a saved date edit reorders only after the table loses focus',async()=>{
 const h=environment({logs:[log({purchased_date:'10/01/26'}),log({id:uuid(12),position:'2',purchased_date:'10/02/26'})]});await h.start();
 assert.equal([...h.rows.keys()][0],uuid(12));const input=h.input(uuid(11),'purchased_date','10/03/26');await h.save(uuid(11));assert.equal([...h.rows.keys()][0],uuid(12));assert.equal(h.document.activeElement,input);
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>[...h.rows.keys()][0]===uuid(11));
 h.app.addRow();const first=[...h.rows.keys()][0];assert.ok(!h.app.state.editors.get(first).base);h.app.addRow();assert.notEqual([...h.rows.keys()][0],first);assert.equal([...h.rows.keys()][1],first);
});
test('purchaser ledger text can be saved independently with line breaks and blank remaining fields',async()=>{
 const h=environment({logs:[]});await h.start();h.app.addRow();const editor=[...h.app.state.editors.values()][0],note='  Deliver another batch next week.\nLeave materials at the reception desk.  ';
 const input=h.input(editor.id,'purchaser_name',note);input.scrollHeight=140;await h.get('giftCardRows').emit('focusin',{target:input});assert.equal(input.style.height,'140px');
 await h.save(editor.id);assert.equal(h.api.logs[0].purchaser_name,note);for(const key of fields.filter(key=>key!=='purchaser_name'))assert.equal(h.api.logs[0][key],'');
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});assert.equal(input.style.height,'');
});


test('unfocused purchaser text restarts at their beginning after scroll and still save on blur',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'purchaser_name','Long note\nMore details');input.scrollTop=100;input.scrollLeft=80;
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);h.runTimers(0);await until(()=>h.api.logs[0].purchaser_name==='Long note\nMore details');
});

test('ISO and numeric US dates sort together while original date text remains untouched',async()=>{
 const dates=['2026-10-09','10/08/26','2026-10-10 after drop-off','10/11/2026','2024-02-29'];
 const h=environment({logs:dates.map((date,index)=>log({id:uuid(30+index),position:String(index+1),purchased_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()],[uuid(33),uuid(32),uuid(30),uuid(31),uuid(34)]);
 for(let index=0;index<dates.length;index++)assert.equal(h.api.logs[index].purchased_date,dates[index]);
 assert.equal(h.app.purchaseDate('2024-02-29'),Date.UTC(2024,1,29));assert.equal(h.app.purchaseDate('2025-02-29'),null);
});

test('same-date and unknown imported rows follow original CSV rows even if inserted out of order',async()=>{
 const logs=[log({id:uuid(11),position:'40',source_file:'Fixture.csv',source_row:2,purchased_date:'9/14/26'}),log({id:uuid(12),position:'12',source_file:'Fixture.csv',source_row:3,purchased_date:'9/14/26'}),log({id:uuid(13),position:'18',source_file:'Fixture.csv',source_row:4,purchased_date:''}),log({id:uuid(14),position:'11',source_file:'Fixture.csv',source_row:5,purchased_date:'unknown'}),log({id:uuid(15),position:'15',purchased_date:''})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(12),uuid(13),uuid(14),uuid(15)]);
 h.input(uuid(13),'purchaser_name','Follow up');await h.save(uuid(13));h.document.activeElement=null;h.app.renderRows();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(12),uuid(13),uuid(14),uuid(15)]);assert.equal(h.api.logs[2].source_row,4);
});

test('default With details filter keeps number-only inventory out of the compact view',async()=>{
 const logs=Array.from({length:262},(_,i)=>log({id:uuid(100+i),position:String(i+1),certificate_number:`TEST-${i+1}`,purchaser_name:'',amount:i<38?' $ 25.00 ':'',redeemer_name:i<10?'Fixture recipient':''}));
 const h=environment({logs});await h.start();assert.equal(h.app.state.cardFilter,'details');assert.equal(h.rows.size,38);assert.equal(h.get('rowCount').textContent,'38 of 262 entries');
 for(const [filter,count]of [['all',262],['number',224],['redemption',10],['details',38]]){h.get('cardFilter').value=filter;await h.get('cardFilter').emit('change');assert.equal(h.rows.size,count,filter);}
 assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);
});

test('all eight cells save independently without rewriting currency, ledgers or other cells',async()=>{
 const literals=['99-08',' $1,250.00 ',' 1/4 ','Fixture purchaser\r\n2/6 $25 partial',' AB ','2/5/26 (part)','Fixture redeemer  ',' CD '];
 const original=log({...Object.fromEntries(fields.map((key,index)=>[key,literals[index]])),source_file:'Fixture.csv',source_row:17,source_values:literals});
 const h=environment({logs:[original]});await h.start();
 for(const key of fields){h.input(original.id,key,`${original[key]} updated`);await h.save(original.id);const call=h.api.calls.filter(call=>call.op==='update').at(-1);assert.deepEqual(Object.keys(call.payload),[key]);}
 for(const key of fields)assert.equal(h.api.logs[0][key],`${original[key]} updated`);
 assert.deepEqual(h.api.logs[0].source_values,literals);assert.equal(h.api.logs[0].source_row,17);assert.equal(h.api.logs[0].source_file,'Fixture.csv');assert.equal(h.api.logs[0].position,'1');
});

test('redemption filter uses only redemption columns and preserves partial ledger annotations',async()=>{
 const ledger='Fixture purchaser\n1/2 - $20\n2/3 - $10\npartial redemption remaining';
 const logs=[log({id:uuid(11),purchaser_name:ledger}),log({id:uuid(12),position:'2',purchaser_name:'',redeemer_name:'Name only'}),log({id:uuid(13),position:'3',purchased_date:'3/10/26',redeemed_date:'3/9/26 (part)'}),log({id:uuid(14),position:'4',purchaser_name:'',redemption_initials:'TS'})];
 const h=environment({logs});await h.start();h.get('cardFilter').value='redemption';await h.get('cardFilter').emit('change');assert.deepEqual([...h.rows.keys()],[uuid(13),uuid(12),uuid(14)]);
 h.get('cardFilter').value='all';await h.get('cardFilter').emit('change');const input=h.input(uuid(11),'purchaser_name',ledger);input.scrollHeight=180;await h.get('giftCardRows').emit('focusin',{target:input});assert.equal(input.style.height,'180px');await h.save(uuid(11));
 assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.api.logs[0].redeemed_date,'');assert.equal(h.api.logs[2].redeemed_date,'3/9/26 (part)');
});

test('filters ignore whitespace for presence while retaining every literal cell',async()=>{
 const logs=[log({id:uuid(11),purchaser_name:' \n\t ',amount:' ',redeemed_date:'  '}),log({id:uuid(12),position:'2',purchaser_name:'',amount:'0'}),log({id:uuid(13),position:'3',purchaser_name:'',purchase_initials:'XY'}),log({id:uuid(14),position:'4',purchaser_name:'',redemption_initials:'no'})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(13),uuid(14)]);
 h.get('cardFilter').value='number';await h.get('cardFilter').emit('change');assert.deepEqual([...h.rows.keys()],[uuid(11)]);
 h.get('cardFilter').value='redemption';await h.get('cardFilter').emit('change');assert.deepEqual([...h.rows.keys()],[uuid(14)]);assert.deepEqual(h.api.logs,logs);
});

test('search matches all eight fields case-insensitively without changing their values',async()=>{
 const logs=fields.map((key,index)=>log({id:uuid(20+index),position:String(index+1),certificate_number:'fixture',purchaser_name:'',[key]:` Mixed CASE token-${index} `}));
 const h=environment({logs});await h.start();
 for(let i=0;i<fields.length;i++){h.get('searchGiftCards').value=`  TOKEN-${i} `;await h.get('searchGiftCards').emit('input');assert.deepEqual([...h.rows.keys()],[uuid(20+i)],fields[i]);}
 assert.equal(h.app.state.cardFilter,'all');assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);
});

test('looking up a number-only certificate switches the default filter to All cards and clearing keeps it',async()=>{
 const logs=[log({id:uuid(11),certificate_number:'99-01',purchaser_name:''}),log({id:uuid(12),position:'2',certificate_number:'99-02',amount:'$50'})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(12)]);
 h.get('searchGiftCards').value='99-01';await h.get('searchGiftCards').emit('input');assert.equal(h.get('cardFilter').value,'all');assert.equal(h.app.state.cardFilter,'all');assert.deepEqual([...h.rows.keys()],[uuid(11)]);
 h.get('searchGiftCards').value='';await h.get('searchGiftCards').emit('input');assert.equal(h.app.state.cardFilter,'all');assert.equal(h.rows.size,2);
 h.get('cardFilter').value='details';await h.get('cardFilter').emit('change');assert.deepEqual([...h.rows.keys()],[uuid(12)]);assert.deepEqual(h.api.logs,logs);
});

test('explicit Number only and Redemption details filters remain combined with a search',async()=>{
 const h=environment({logs:[log({id:uuid(11),certificate_number:'99-01',purchaser_name:''}),log({id:uuid(12),position:'2',certificate_number:'99-02',redeemer_name:'Recipient'})]});await h.start();
 h.get('cardFilter').value='number';await h.get('cardFilter').emit('change');h.get('searchGiftCards').value='99';await h.get('searchGiftCards').emit('input');assert.equal(h.app.state.cardFilter,'number');assert.deepEqual([...h.rows.keys()],[uuid(11)]);
 h.get('cardFilter').value='redemption';await h.get('cardFilter').emit('change');h.get('searchGiftCards').value='RECIPIENT';await h.get('searchGiftCards').emit('input');assert.equal(h.app.state.cardFilter,'redemption');assert.deepEqual([...h.rows.keys()],[uuid(12)]);
 h.get('searchGiftCards').value='99-01';await h.get('searchGiftCards').emit('input');assert.equal(h.rows.size,0);assert.match(h.get('emptyState').textContent,/match/);
});

test('filtered-out records do not hide local Add card drafts or unsuccessful saves',async()=>{
 let fail=true;const h=environment({intercept(call){if(call.op==='update'&&fail){fail=false;return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.input(uuid(11),'redeemer_name','Draft recipient');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.document.activeElement=null;h.get('cardFilter').value='number';await h.get('cardFilter').emit('change');h.get('searchGiftCards').value='missing';await h.get('searchGiftCards').emit('input');assert.ok(h.rows.has(uuid(11)));assert.match(h.get('rowCount').textContent,/unsaved rows stay visible/);
 const calls=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,calls);
 h.app.addRow();const draft=[...h.app.state.editors.values()].find(editor=>!editor.base);assert.ok(h.rows.has(draft.id));assert.equal(h.document.activeElement.dataset.field,'certificate_number');assert.equal([...h.rows.keys()][0],draft.id);await h.app.deleteRow(draft);
 h.document.activeElement=null;await h.get('giftCardRows').emit('click',{target:h.errors.get(uuid(11)).button});await until(()=>!h.app.state.editors.get(uuid(11)).saving);assert.equal(h.api.logs[0].redeemer_name,'Draft recipient');assert.equal(h.rows.size,0);assert.equal(h.api.logs.length,1);
});

test('a preallocated certificate can be found, edited and saved as the same record',async()=>{
 const h=environment({logs:[log({certificate_number:'99-01',purchaser_name:'',source_file:'Fixture.csv',source_row:24,source_values:['99-01','','','','','','','']})]});await h.start();assert.equal(h.rows.size,0);
 h.get('searchGiftCards').value='99-01';await h.get('searchGiftCards').emit('input');h.input(uuid(11),'amount',' $25.00 ');await h.save(uuid(11));h.input(uuid(11),'purchaser_name','Fixture buyer');await h.save(uuid(11));
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,uuid(11));assert.equal(h.api.logs[0].source_row,24);assert.deepEqual(h.api.logs[0].source_values,['99-01','','','','','','','']);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
});

test('new yearless purchase dates remain unknown across calendar changes without source year inference',async()=>{
 for(const now of ['2026-10-01T14:00:00Z','2027-01-01T06:00:00Z']){
  const h=environment({now,logs:[log({id:uuid(11),position:'1',purchased_date:'8/19'}),log({id:uuid(12),position:'2',purchased_date:'1/5/26'}),log({id:uuid(13),position:'3',purchased_date:'10/23025'}),log({id:uuid(14),position:'4',purchased_date:''})]});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(11),uuid(13),uuid(14)]);assert.equal(h.app.purchaseDate('8/19'),null);
  h.app.addRow();const draft=[...h.app.state.editors.values()].find(editor=>!editor.base);h.input(draft.id,'purchased_date','8/20');await h.save(draft.id);assert.equal(h.api.logs.at(-1).purchased_date,'8/20');assert.equal(h.app.rowDate(h.api.logs.at(-1)),null);const call=h.api.calls.find(call=>call.op==='insert');assert.deepEqual(Object.keys(call.payload).sort(),['id',...fields].sort());
 }
});

 test('collapsible guide explains issuing and partial-use redemption without assuming full redemption',()=>{
 assert.match(html,/<details class="gc-guide">/);assert.match(html,/How to issue or redeem a card/);assert.match(html,/including any partial-use notes/);assert.match(html,/Discard the physical card only once it is fully used/);assert.match(html,/Gift Certificate as the payment method/);
 });
