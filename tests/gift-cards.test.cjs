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
   input.readOnly=/readonly/.test(m[0]);input.row=row;row.children.push(input);
  }
  rows.set(match[1],row);const err=node();err.button=node();err.button.dataset.id=match[1];err.button.dataset.action='retry';err.errorText=node();errors.set(match[1],err);
 }}
 function parseRestores(markup){restores.clear();for(const m of markup.matchAll(/data-restore-row="([^"]+)"/g)){const button=node();button.dataset.restoreRow=decode(m[1]);restores.set(button.dataset.restoreRow,button);}}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],n);}
 nodes.get('cardFilter').value='all';
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
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,sortLogs,purchaseDate,rowDate,renderRows,addRow,chooseCard,compareNumbers,takeInput,saveEditor,deleteRow,undoDelete,reloadRow,resetAuth,editorFor,dirty};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,errors,restores,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  input(id,key,value){const input=rows.get(id).children.find(n=>n.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  async save(id){return app.saveEditor(app.state.editors.get(id));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},
  runTimers(delay){for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}}
 };
}
test('compact table has a fixed certificate number and seven editable details',async()=>{

 const h=environment();await h.start();const cells=h.rows.get(uuid(11)).children;
 assert.deepEqual(cells.map(cell=>cell.dataset.field),fields);assert.equal(cells[0].readOnly,true);assert.ok(cells.slice(1).every(cell=>!cell.readOnly));
 assert.match(h.get('giftCardRows').innerHTML,/readonly tabindex="-1"/);assert.match(h.get('giftCardRows').innerHTML,/maxlength="20000"/);
 assert.ok(h.get('addRow'));assert.ok(h.get('emptyCardNumber'));assert.doesNotMatch(source,/\.insert\(|randomUUID/);

});
test('certificate input cannot change the number while detail edits preserve source literals',async()=>{

 const original=log({purchased_date:'  8/19  ',purchaser_name:' First line\r\nSecond line  ',source_file:'Fixture.csv',source_row:4,source_values:['99-01','','  8/19  ',' First line\r\nSecond line  ','','','','']});
 const h=environment({logs:[original]});await h.start();const cell=h.rows.get(original.id).children[0];cell.value='99-02';h.app.takeInput(cell);await h.save(original.id);
 assert.equal(h.api.logs[0].certificate_number,'99-01');assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);
 h.input(original.id,'amount',' $50 ');await h.save(original.id);assert.deepEqual(h.api.calls.find(c=>c.op==='update').payload,{amount:' $50 '});assert.deepEqual(h.api.logs[0].source_values,original.source_values);

});
test('normalized detail no-op preserves original line endings and whitespace',async()=>{

 const h=environment({logs:[log({purchaser_name:'Line\r\nTwo  '})]});await h.start();h.input(uuid(11),'purchaser_name','Line\nTwo  ');await h.save(uuid(11));
 assert.equal(h.api.calls.filter(c=>c.op==='update').length,0);assert.equal(h.api.logs[0].purchaser_name,'Line\r\nTwo  ');

});
test('date and note cells accept literal mixed text without coercion',async()=>{
 const h=environment({logs:[log({purchased_date:'8/19/25 — original drop',purchaser_name:'Pending — revisit after the weekend.'})]});await h.start();
 for(const key of ['purchased_date','purchaser_name'])assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field===key).value,h.api.logs[0][key]);
 h.input(uuid(11),'purchased_date','next Thursday, after lunch');await h.save(uuid(11));assert.equal(h.api.logs[0].purchased_date,'next Thursday, after lunch');assert.equal(h.api.logs[0].purchaser_name,'Pending — revisit after the weekend.');
});
test('Add never creates a row and shows only deduplicated existing empty numbers',async()=>{

 const logs=[log({id:uuid(11),certificate_number:'40-01',purchaser_name:''}),log({id:uuid(12),certificate_number:'40-02',purchaser_name:''}),log({id:uuid(13),certificate_number:'40-02',purchaser_name:'Occupied'}),log({id:uuid(14),certificate_number:'40-03',purchaser_name:'',deleted_at:'2026-10-01'}),log({id:uuid(15),certificate_number:'40-01',purchaser_name:'',source_file:'Fixture.csv',source_row:3})];
 const h=environment({logs});await h.start();h.app.addRow();assert.equal(h.get('cardPicker').hidden,false);
 const options=h.get('emptyCardNumber').innerHTML;assert.match(options,/40-01/);assert.equal((options.match(/40-01/g)||[]).length,1);assert.match(options,new RegExp(uuid(15)));assert.doesNotMatch(options,/40-02|40-03/);
 assert.equal(h.api.logs.length,5);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);assert.ok([...h.app.state.editors.values()].every(e=>e.base));

});
test('choosing an empty card focuses amount and updates the existing row only',async()=>{

 const h=environment({logs:[log({purchaser_name:''})]});await h.start();h.app.addRow();h.get('emptyCardNumber').value=uuid(11);await h.app.chooseCard();
 assert.equal(h.get('cardPicker').hidden,true);assert.equal(h.document.activeElement.dataset.field,'amount');
 h.input(uuid(11),'purchaser_name','  AB / CD  ');await h.save(uuid(11));h.input(uuid(11),'amount','$25');await h.save(uuid(11));
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].certificate_number,'99-01');assert.equal(h.api.logs[0].purchaser_name,'  AB / CD  ');assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);

});
test('blur saves while tabbing to another cell without replacing focus',async()=>{
 const h=environment();await h.start();const first=h.input(uuid(11),'amount','Changed');const next=h.rows.get(uuid(11)).children[2];next.focus();
 await h.get('giftCardRows').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.logs[0].amount==='Changed');
 assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(11)).children[2],next);
});
test('new typing during an in-flight save queues behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'amount','First');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'purchaser_name','Typed during save');
 h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].purchaser_name,'Typed during save');assert.equal(h.api.logs[0].revision,3);assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='purchaser_name').value,'Typed during save');
});
test('selection rejects a card filled by a teammate while the picker was open',async()=>{

 const h=environment({logs:[log({purchaser_name:''})]});await h.start();h.app.addRow();h.get('emptyCardNumber').value=uuid(11);h.api.logs[0].purchaser_name='Teammate';h.api.logs[0].revision=2;await h.app.chooseCard();
 assert.equal(h.get('cardPicker').hidden,false);assert.match(h.get('pickerMessage').textContent,/no longer empty/);assert.equal(h.api.calls.filter(c=>c.op!=='select').length,0);

});
test('lost update response recovers the saved revision before applying a newer draft',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'amount','First');await h.save(uuid(11));assert.ok(h.app.state.editors.get(uuid(11)).error);
 h.input(uuid(11),'purchaser_name','CD');await h.save(uuid(11));assert.equal(h.api.logs[0].amount,'First');assert.equal(h.api.logs[0].purchaser_name,'CD');assert.equal(h.api.logs[0].revision,3);
});
test('different-cell edits merge while same-cell conflicts retain the local draft',async()=>{
 const h=environment();await h.start();h.input(uuid(11),'purchaser_name','Local');h.api.logs[0]={...h.api.logs[0],amount:'$40',revision:2};await h.save(uuid(11));
 assert.equal(h.api.logs[0].amount,'$40');assert.equal(h.api.logs[0].purchaser_name,'Local');
 h.input(uuid(11),'purchaser_name','New local');h.api.logs[0]={...h.api.logs[0],purchaser_name:'New remote',revision:4};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.ok(editor.conflict);assert.equal(editor.values.purchaser_name,'New local');assert.equal(h.api.logs[0].purchaser_name,'New remote');
 assert.equal(h.errors.get(uuid(11)).button.dataset.action,'reload');
});
test('clearing the last detail leaves the fixed certificate slot empty',async()=>{

 const gate=deferred();let pending;let held=false;const h=environment({logs:[log({purchaser_name:''})],intercept(call){if(call.op==='update'&&!held){held=true;pending=call;return gate.promise;}}});await h.start();
 h.input(uuid(11),'amount','$25');const save=h.save(uuid(11));await until(()=>pending);h.input(uuid(11),'amount','');h.api.logs[0]={...h.api.logs[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.logs[0]),error:null});await save;
 assert.equal(h.api.logs[0].amount,'');assert.equal(h.api.logs[0].certificate_number,'99-01');assert.equal(h.app.state.editors.get(uuid(11)).error,'');

});
test('focused or unfinished cells block refresh and every field is disabled while fetching',async()=>{
 const gate=deferred();let held=false;const h=environment();await h.start();h.input(uuid(11),'purchaser_name','Draft');const count=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,count);
 await h.save(uuid(11));await h.app.refresh();assert.equal(h.api.calls.filter(c=>c.range).length,1);h.document.activeElement=null;
 h.api.intercept=call=>{if(call.table==='hq_gift_cards'&&call.range){held=true;return gate.promise;}};const refresh=h.app.refresh();await until(()=>held);
 assert.ok(h.rows.get(uuid(11)).children.every(cell=>cell.disabled));gate.resolve({data:clone(h.api.logs),error:null});await refresh;assert.equal(h.rows.get(uuid(11)).children.find(c=>c.dataset.field==='purchaser_name').value,'Draft');
});
test('Delete avoids an unwanted blur save and soft-deletes the row',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'amount','Local draft'),row=h.rows.get(uuid(11));
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
  let mutation;if(mode==='save'){h.input(uuid(11),'amount','99-05');mutation=h.save(uuid(11));}else if(mode==='delete')mutation=h.app.deleteRow(h.app.state.editors.get(uuid(11)));else if(mode==='restore')mutation=h.app.undoDelete();else mutation=h.app.refresh();
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

test('certificate order starts at the latest purchase then descends with higher numbers at the bottom',async()=>{

 const logs=[log({id:uuid(11),certificate_number:'40-03',purchased_date:'9/19/26'}),log({id:uuid(12),certificate_number:'40-01',purchased_date:'10/2'}),log({id:uuid(13),certificate_number:'41-00',purchaser_name:''}),log({id:uuid(14),certificate_number:'40-02',purchased_date:'9/20/25'}),log({id:uuid(15),certificate_number:'40-04',purchaser_name:''})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(14),uuid(12),uuid(13),uuid(15)]);assert.deepEqual(h.api.logs,logs);

});
test('leading date parsing validates full dates and leap days without accepting truncated dates',async()=>{
 const h=environment();await h.start();
 for(const value of ['2/29/24',' 2-29-2024 outcome','2.29.2024 (details)'])assert.equal(h.app.purchaseDate(value),Date.UTC(2024,1,29));
 for(const value of ['2/29/25','04/31/26','0/2/26','13/1/26','10/0/26','1/2/123','1/2/20266','1/2/','3/4/2','2026-13-09','2026-02-29','2026-10-009','x 4/5/26','1/2-26'])assert.equal(h.app.purchaseDate(value),null,value);
 assert.equal(h.app.purchaseDate('1/2'),null);
});
test('date edits update the starting certificate only after the table loses focus',async()=>{

 const h=environment({logs:[log({certificate_number:'99-01',purchased_date:'10/01/26'}),log({id:uuid(12),certificate_number:'99-02',position:'2',purchased_date:'10/02/26'})]});await h.start();
 assert.equal([...h.rows.keys()][0],uuid(12));const input=h.input(uuid(11),'purchased_date','10/03/26');await h.save(uuid(11));assert.equal([...h.rows.keys()][0],uuid(12));assert.equal(h.document.activeElement,input);
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});h.runTimers(0);await until(()=>[...h.rows.keys()][0]===uuid(11));

});
test('purchaser ledger text can be saved independently on an existing empty certificate',async()=>{

 const h=environment({logs:[log({purchaser_name:''})]});await h.start();const note='  Deliver another batch next week.\nLeave materials at the reception desk.  ';
 const input=h.input(uuid(11),'purchaser_name',note);input.scrollHeight=140;await h.get('giftCardRows').emit('focusin',{target:input});assert.equal(input.style.height,'140px');await h.save(uuid(11));
 assert.equal(h.api.logs[0].purchaser_name,note);assert.equal(h.api.logs[0].certificate_number,'99-01');for(const key of fields.slice(1).filter(key=>key!=='purchaser_name'))assert.equal(h.api.logs[0][key],'');
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});assert.equal(input.style.height,'');

});
test('unfocused purchaser text restarts at their beginning after scroll and still save on blur',async()=>{
 const h=environment();await h.start();const input=h.input(uuid(11),'purchaser_name','Long note\nMore details');input.scrollTop=100;input.scrollLeft=80;
 h.document.activeElement=null;await h.get('giftCardRows').emit('focusout',{target:input});assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);h.runTimers(0);await until(()=>h.api.logs[0].purchaser_name==='Long note\nMore details');
});

test('latest full ISO or numeric date selects the pivot without rewriting entered text',async()=>{

 const dates=['2026-10-09','10/08/26','2026-10-10 after drop-off','10/11/2026','2024-02-29'];
 const h=environment({logs:dates.map((date,index)=>log({id:uuid(30+index),certificate_number:`99-0${index}`,position:String(index+1),purchased_date:date}))});await h.start();
 assert.deepEqual([...h.rows.keys()],[uuid(33),uuid(32),uuid(31),uuid(30),uuid(34)]);for(let i=0;i<dates.length;i++)assert.equal(h.api.logs[i].purchased_date,dates[i]);

});
test('same-date and unknown imported rows follow original CSV rows even if inserted out of order',async()=>{
 const logs=[log({id:uuid(11),position:'40',source_file:'Fixture.csv',source_row:2,purchased_date:'9/14/26'}),log({id:uuid(12),position:'12',source_file:'Fixture.csv',source_row:3,purchased_date:'9/14/26'}),log({id:uuid(13),position:'18',source_file:'Fixture.csv',source_row:4,purchased_date:''}),log({id:uuid(14),position:'11',source_file:'Fixture.csv',source_row:5,purchased_date:'unknown'}),log({id:uuid(15),position:'15',purchased_date:''})];
 const h=environment({logs});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(12),uuid(13),uuid(14),uuid(15)]);
 h.input(uuid(13),'purchaser_name','Follow up');await h.save(uuid(13));h.document.activeElement=null;h.app.renderRows();assert.deepEqual([...h.rows.keys()],[uuid(11),uuid(12),uuid(13),uuid(14),uuid(15)]);assert.equal(h.api.logs[2].source_row,4);
});

test('All cards is the default and optional filters retain the inventory',async()=>{

 const logs=Array.from({length:262},(_,i)=>log({id:uuid(100+i),position:String(i+1),certificate_number:`TEST-${i+1}`,purchaser_name:'',amount:i<38?' $ 25.00 ':'',redeemer_name:i<10?'Fixture recipient':''}));
 const h=environment({logs});await h.start();assert.equal(h.app.state.cardFilter,'all');assert.equal(h.rows.size,262);assert.equal(h.get('rowCount').textContent,'262 entries');
 for(const [filter,count]of [['number',224],['redemption',10],['details',38],['all',262]]){h.get('cardFilter').value=filter;await h.get('cardFilter').emit('change');assert.equal(h.rows.size,count,filter);}
 assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);

});
test('seven detail cells save independently without rewriting currency, ledgers or certificate numbers',async()=>{

 const literals=['99-08',' $1,250.00 ',' 1/4 ','Fixture purchaser\r\n2/6 $25 partial',' AB ','2/5/26 (part)','Fixture redeemer  ',' CD '];
 const original=log({...Object.fromEntries(fields.map((key,index)=>[key,literals[index]])),source_file:'Fixture.csv',source_row:17,source_values:literals});const h=environment({logs:[original]});await h.start();
 for(const key of fields.slice(1)){h.input(original.id,key,`${original[key]} updated`);await h.save(original.id);assert.deepEqual(Object.keys(h.api.calls.filter(c=>c.op==='update').at(-1).payload),[key]);}
 assert.equal(h.api.logs[0].certificate_number,'99-08');assert.deepEqual(h.api.logs[0].source_values,literals);assert.equal(h.api.logs[0].source_row,17);

});
test('redemption filter uses only redemption columns and preserves partial ledger annotations',async()=>{
 const ledger='Fixture purchaser\n1/2 - $20\n2/3 - $10\npartial redemption remaining';
 const logs=[log({id:uuid(11),purchaser_name:ledger}),log({id:uuid(12),position:'2',purchaser_name:'',redeemer_name:'Name only'}),log({id:uuid(13),position:'3',purchased_date:'3/10/26',redeemed_date:'3/9/26 (part)'}),log({id:uuid(14),position:'4',purchaser_name:'',redemption_initials:'TS'})];
 const h=environment({logs});await h.start();h.get('cardFilter').value='redemption';await h.get('cardFilter').emit('change');assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(13),uuid(14)]);
 h.get('cardFilter').value='all';await h.get('cardFilter').emit('change');const input=h.input(uuid(11),'purchaser_name',ledger);input.scrollHeight=180;await h.get('giftCardRows').emit('focusin',{target:input});assert.equal(input.style.height,'180px');await h.save(uuid(11));
 assert.deepEqual(h.api.logs,logs);assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.api.logs[0].redeemed_date,'');assert.equal(h.api.logs[2].redeemed_date,'3/9/26 (part)');
});

test('filters ignore whitespace for presence while retaining every literal cell',async()=>{
 const logs=[log({id:uuid(11),purchaser_name:' \n\t ',amount:' ',redeemed_date:'  '}),log({id:uuid(12),position:'2',purchaser_name:'',amount:'0'}),log({id:uuid(13),position:'3',purchaser_name:'',purchase_initials:'XY'}),log({id:uuid(14),position:'4',purchaser_name:'',redemption_initials:'no'})];
 const h=environment({logs});await h.start();h.get('cardFilter').value='details';await h.get('cardFilter').emit('change');assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(13),uuid(14)]);
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
 const h=environment({logs});await h.start();assert.equal(h.rows.size,2);
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

test('unsuccessful saves remain visible and selection cannot overwrite them',async()=>{

 let fail=true;const h=environment({intercept(call){if(call.op==='update'&&fail){fail=false;return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.input(uuid(11),'redeemer_name','Draft recipient');await h.save(uuid(11));
 h.document.activeElement=null;h.get('cardFilter').value='number';await h.get('cardFilter').emit('change');h.get('searchGiftCards').value='missing';await h.get('searchGiftCards').emit('input');assert.ok(h.rows.has(uuid(11)));assert.match(h.get('rowCount').textContent,/unsaved rows stay visible/);
 h.app.addRow();h.get('emptyCardNumber').value=uuid(11);await h.app.chooseCard();assert.match(h.get('pickerMessage').textContent,/Finish saving/);assert.equal(h.app.state.editors.get(uuid(11)).values.redeemer_name,'Draft recipient');
 await h.save(uuid(11));assert.equal(h.api.logs[0].redeemer_name,'Draft recipient');assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);

});
test('a preallocated certificate can be found, edited and saved as the same record',async()=>{
 const h=environment({logs:[log({certificate_number:'99-01',purchaser_name:'',source_file:'Fixture.csv',source_row:24,source_values:['99-01','','','','','','','']})]});await h.start();assert.equal(h.rows.size,1);
 h.get('searchGiftCards').value='99-01';await h.get('searchGiftCards').emit('input');h.input(uuid(11),'amount',' $25.00 ');await h.save(uuid(11));h.input(uuid(11),'purchaser_name','Fixture buyer');await h.save(uuid(11));
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].id,uuid(11));assert.equal(h.api.logs[0].source_row,24);assert.deepEqual(h.api.logs[0].source_values,['99-01','','','','','','','']);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
});

test('yearless dates stay unknown and numeric order is stable across calendar changes',async()=>{

 for(const now of ['2026-10-01T14:00:00Z','2027-01-01T06:00:00Z']){
 const h=environment({now,logs:[log({id:uuid(11),certificate_number:'9',purchased_date:'8/19'}),log({id:uuid(12),certificate_number:'10',purchased_date:'1/5/26'}),log({id:uuid(13),certificate_number:'11',purchased_date:'10/23025'}),log({id:uuid(14),certificate_number:'12',purchased_date:''})]});await h.start();assert.deepEqual([...h.rows.keys()],[uuid(12),uuid(11),uuid(14),uuid(13)]);assert.equal(h.app.purchaseDate('8/19'),null);
 h.input(uuid(11),'purchased_date','8/20');await h.save(uuid(11));assert.equal(h.api.logs[0].purchased_date,'8/20');assert.equal(h.app.rowDate(h.api.logs[0]),null);
 }

});
 test('collapsible guide explains issuing and partial-use redemption without assuming full redemption',()=>{
 assert.match(html,/<details class="gc-guide">/);assert.match(html,/How to issue or redeem a card/);assert.match(html,/including any partial-use notes/);assert.match(html,/Discard the physical card only once it is fully used/);assert.match(html,/Gift Certificate as the payment method/);
 });

test('two clients filling different cells of one blank card conflict instead of merging customers',async()=>{
 const h=environment({logs:[log({purchaser_name:''})]});await h.start();h.input(uuid(11),'amount','$25');
 h.api.logs[0]={...h.api.logs[0],purchaser_name:'Other customer',revision:2};await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.equal(editor.conflict,true);assert.equal(editor.values.amount,'$25');assert.equal(h.api.logs[0].amount,'');assert.equal(h.api.logs[0].purchaser_name,'Other customer');
});
test('a lost first-use update response recovers the existing slot without inserting',async()=>{
 let fail=true;const h=environment({logs:[log({purchaser_name:''})],intercept(call,api){if(call.op==='update'&&fail){fail=false;api.logs[0]={...api.logs[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();
 h.input(uuid(11),'amount','$25');await h.save(uuid(11));h.input(uuid(11),'purchaser_name','Fixture buyer');await h.save(uuid(11));
 assert.equal(h.api.logs.length,1);assert.equal(h.api.logs[0].amount,'$25');assert.equal(h.api.logs[0].purchaser_name,'Fixture buyer');assert.equal(h.api.logs[0].revision,3);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);
});
test('same-day purchase ties use the highest number and missing full dates fall back to descending numbers',async()=>{
 for(const dated of [true,false]){const h=environment({logs:[log({id:uuid(11),certificate_number:'40-09',purchased_date:dated?'10/10/26':'10/10'}),log({id:uuid(12),certificate_number:'40-10',purchased_date:dated?'10/10/26':'unknown'}),log({id:uuid(13),certificate_number:'41-00',purchaser_name:''})]});await h.start();
 assert.deepEqual([...h.rows.keys()],dated?[uuid(12),uuid(11),uuid(13)]:[uuid(13),uuid(12),uuid(11)]);}
});
test('picker cancellation and an empty inventory perform no database writes',async()=>{
 const h=environment();await h.start();h.app.addRow();assert.match(h.get('pickerMessage').textContent,/No empty/);assert.equal(h.get('chooseCard').disabled,true);
 await h.get('cancelCard').emit('click');assert.equal(h.get('cardPicker').hidden,true);assert.equal(h.document.activeElement,h.get('addRow'));assert.equal(h.api.calls.filter(c=>c.op!=='select').length,0);
});
test('selection cannot clear private data back onto the page after sign-out',async()=>{
 const h=environment({logs:[log({purchaser_name:''})]});await h.start();h.app.addRow();h.get('emptyCardNumber').value=uuid(11);
 const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_gift_cards'&&call.range){pending=call;return gate.promise;}};
 const choose=h.app.chooseCard();await until(()=>pending);assert.equal(h.get('emptyCardNumber').disabled,true);assert.equal(h.get('cancelCard').disabled,true);h.signOut();gate.resolve({data:[log({purchaser_name:''})],error:null});await choose;
 assert.equal(h.rows.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.get('cardPicker').hidden,true);assert.equal(h.get('emptyCardNumber').innerHTML,'');
});
test('duplicate allocation errors preserve entered details and do not loop or insert',async()=>{
 const h=environment({logs:[log({purchaser_name:''})],intercept(call){if(call.op==='update')return {data:null,error:{code:'23505'}};}});await h.start();h.input(uuid(11),'amount','$50');await h.save(uuid(11));
 const editor=h.app.state.editors.get(uuid(11));assert.match(editor.error,/already has an active entry/);assert.equal(editor.values.amount,'$50');assert.equal(h.api.calls.filter(c=>c.op==='update').length,1);assert.equal(h.api.calls.filter(c=>c.op==='insert').length,0);
});
test('selection detects deleted or occupied duplicate slots and excludes them on reopening',async()=>{
 for(const mode of ['deleted','duplicate']){const h=environment({logs:[log({purchaser_name:''})]});await h.start();h.app.addRow();h.get('emptyCardNumber').value=uuid(11);
 if(mode==='deleted')h.api.logs[0].deleted_at='2026-10-11';else h.api.logs.push(log({id:uuid(12),purchaser_name:'Other buyer'}));
 await h.app.chooseCard();assert.equal(h.get('cardPicker').hidden,false);assert.match(h.get('pickerMessage').textContent,/no longer empty/);assert.doesNotMatch(h.get('emptyCardNumber').innerHTML,/99-01/);assert.equal(h.api.calls.filter(c=>c.op!=='select').length,0);}
});
