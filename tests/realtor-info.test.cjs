/* Behavioral checks use synthetic realtors and contacts only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.REALTOR_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'realtor-info.html'),'utf8'),source=fs.readFileSync(path.join(root,'assets/realtor-info.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const contactFields=['contacted_date','notes'];
const realtor=(extra={})=>({id:uuid(11),realtor_name:'Fixture agency',phone:'',email:'',location:'',position:'1',revision:1,source_file:null,source_row:null,source_values:null,deleted_at:null,...extra});
const contact=(extra={})=>({id:uuid(101),realtor_id:uuid(11),contacted_date:'10/1/2026',notes:'',position:'1',revision:1,source_file:null,source_row:null,source_column:null,source_values:null,deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(check){for(let i=0;i<500&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({realtors=[realtor()],contacts=[contact()],active=true,intercept=null,now='2026-10-10T14:00:00Z'}={}){
 const api={realtors:clone(realtors),contacts:clone(contacts),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
 const nodes=new Map(),rows=new Map(),directory=new Map(),errors=new Map(),restores=new Map(),controls=[];const timers=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){return selector==='[data-restore-row]'?[...restores.values()]:selector==='[data-control]'?controls:[];},querySelector(selector){const match=selector.match(/\[data-(row|realtor|error)-id="([^"]+)"\]/);return match?(match[1]==='row'?rows:match[1]==='realtor'?directory:errors).get(match[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,open:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,scrollLeft:0,classes:new Set(),children:[],buttons:[],
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},setAttribute(){},
   matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},closest(selector){if(selector==='#contactRows')return this.row&&this.row.kind==='contact'?nodes.get('contactRows'):null;if(selector==='[data-row-id]')return this.row?.kind==='contact'?this.row:null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},showModal(){this.open=true;},close(){this.open=false;document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(input=>input.dataset.field===key)||null;},querySelectorAll(selector){return selector==='[data-control]'?this.buttons:this.children;}};
  n.classList={toggle(name,on){if(on)n.classes.add(name);else n.classes.delete(name);},add(name){n.classes.add(name);},remove(name){n.classes.delete(name);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='realtorRows')parseDirectory(value);if(id==='deletedList'||id==='deletedContactList')parseRestores(id,value);}});return n;
 }
 function parseButtons(markup,row){const buttons=[];for(const match of markup.matchAll(/<button([^>]*)>/g)){const button=node();for(const attr of match[1].matchAll(/data-([\w-]+)="([^"]*)"/g)){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());button.dataset[key]=decode(attr[2]);}button.row=row;if(/\bdata-control\b/.test(match[1])){controls.push(button);buttons.push(button);}}return buttons;}
 function parseDirectory(markup){
  if(document.activeElement?.row?.kind==='contact')document.activeElement=null;rows.clear();directory.clear();errors.clear();controls.length=0;
  for(const id of ['contactRows','deletedContactsSection','deletedContactCount','deletedContactList'])nodes.delete(id);
  for(const match of markup.matchAll(/<tr class="ri-realtor" data-realtor-id="([^"]+)">([\s\S]*?)<\/tr>/g)){const row=node();row.kind='realtor';row.dataset.realtorId=match[1];row.buttons=parseButtons(match[2],row);directory.set(match[1],row);}
  parseButtons(markup.replace(/<tr class="ri-realtor"[\s\S]*?<\/tr>/g,''),null);
  for(const id of ['contactRows','deletedContactsSection','deletedContactCount','deletedContactList'])if(markup.includes(`id="${id}"`))nodes.set(id,node(id));
  if(nodes.has('contactRows'))nodes.get('contactRows').innerHTML=markup.match(/<tbody id="contactRows">([\s\S]*?)<\/tbody>/)?.[1]||'';
  for(const match of markup.matchAll(/<tr class="tr-row" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)){const row=node();row.kind='contact';row.dataset.rowId=match[1];row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;row.buttons=parseButtons(match[2],row);for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){const input=node();input.dataset.field=m[1];input.tagName='TEXTAREA';input.value=decode(m[2]).replace(/\r\n?/g,'\n');input.row=row;row.children.push(input);}rows.set(match[1],row);}
  for(const match of markup.matchAll(/<tr class="tr-row-error" data-error-id="([^"]+)"([^>]*)>/g)){const row=node();row.hidden=/\bhidden\b/.test(match[2]);row.button=node();row.button.dataset.kind=match[1].split(':')[0];row.button.dataset.id=match[1].split(':')[1];row.button.dataset.action='retry';row.errorText=node();errors.set(match[1],row);}
 }
 function parseRestores(id,markup){const kind=id==='deletedList'?'realtor':'contact';for(const [key,button]of restores)if(button.dataset.kind===kind)restores.delete(key);for(const match of markup.matchAll(/<button[^>]*data-restore-row="([^"]+)"[^>]*data-kind="([^"]+)"/g)){const button=node();button.dataset.restoreRow=match[1];button.dataset.kind=match[2];restores.set(`${match[2]}:${match[1]}`,button);}}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique initial HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);const field=match[0].match(/data-realtor-field="([^"]+)"/)?.[1];if(field)n.dataset.realtorField=field;nodes.set(match[1],n);}
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  assert.ok(['hq_realtors','hq_realtor_contacts'].includes(call.table));const isContact=call.table==='hq_realtor_contacts',list=isContact?api.contacts:api.realtors,matches=row=>call.filters.every(([key,value])=>row[key]===value);
  if(call.op==='insert'){
   if(list.some(row=>row.id===call.payload.id))return {data:null,error:{code:'23505'}};
   if(isContact&&!api.realtors.some(row=>row.id===call.payload.realtor_id&&!row.deleted_at))return {data:null,error:{code:'42501'}};
   const position=String(Math.max(0,...list.map(row=>Number(row.position)))+1);
   const row=isContact?contact({contacted_date:'',notes:'',...call.payload,position}):realtor({realtor_name:'',phone:'',email:'',location:'',...call.payload,position});list.push(row);return {data:clone(row),error:null};
  }
  if(call.op==='update'){const index=list.findIndex(matches);if(index<0)return {data:null,error:null};if(isContact&&!api.realtors.some(row=>row.id===list[index].realtor_id&&!row.deleted_at))return {data:null,error:{code:'42501'}};list[index]={...list[index],...call.payload,revision:list[index].revision+1};return {data:clone(list[index]),error:null};}
  let data=list.filter(matches).sort((a,b)=>String(a.id).localeCompare(String(b.id)));if(call.range)data=data.slice(call.range[0],call.range[1]+1);return {data:call.range?clone(data):clone(data[0]||null),error:null};
 }
 const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){api.callbacks.push(fn);}},from(table){const call={table,op:'select',filters:[]};const run=()=>complete(call);const chain={select(){return chain;},eq(key,value){call.filters.push([key,value]);return chain;},order(){return chain;},range(a,b){call.range=[a,b];return run();},update(value){call.op='update';call.payload=clone(value);return chain;},insert(value){call.op='insert';call.payload=clone(value);return chain;},single:run,maybeSingle:run};return chain;}};
 const window={events:{},addEventListener(type,fn){(this.events[type]||=[]).push(fn);}};
 class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,console,crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
 const marker="  if(document.readyState==='loading')";assert.equal(source.split(marker).length,2);
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,sortContacts,sortRealtors,visibleRealtors,renderDirectory,editorFor,dirty,saveEditor,deleteRow,undoDelete,expandRealtor,addContact,openRealtor,closeRealtorDialog,submitRealtor,resetAuth,takeInput,takeRealtorInput,reloadRow};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,directory,errors,restores,controls,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  async expand(id=uuid(11)){await app.expandRealtor(id);},
  input(id,key,value){const input=rows.get(id).children.find(input=>input.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  form(key,value){const ids={realtor_name:'realtorName',phone:'realtorPhone',email:'realtorEmail',location:'realtorLocation'},input=nodes.get(ids[key]);input.focus();input.value=value;app.takeRealtorInput(input);},
  editor(id=uuid(101),kind='contact'){return app.state.editors.get(`${kind}:${id}`);},async save(id=uuid(101),kind='contact'){return app.saveEditor(app.state.editors.get(`${kind}:${id}`));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},runTimers(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}}
 };
}
test('new contact prefills full Eastern date but stays local until input',async()=>{
 const h=environment({now:'2027-01-01T02:00:00Z'});await h.start();await h.expand();h.app.addContact();const editor=[...h.app.state.editors.values()].find(e=>!e.base);assert.equal(editor.values.contacted_date,'12/31/2026');assert.equal(h.document.activeElement.dataset.field,'notes');await h.app.saveEditor(editor);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
 await h.app.deleteRow(editor);assert.equal(h.api.contacts.length,1);assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);
});
test('partial contact saves once and later edits update its immutable parent and same UUID',async()=>{
 const h=environment({contacts:[]});await h.start();h.app.addContact(uuid(11));const editor=[...h.app.state.editors.values()].find(e=>!e.base);h.input(editor.id,'notes','  Next delivery after lunch.  ');await h.app.saveEditor(editor);h.input(editor.id,'contacted_date','Brochures');await h.app.saveEditor(editor);
 assert.equal(h.api.contacts.length,1);assert.equal(h.api.contacts[0].id,editor.id);assert.equal(h.api.contacts[0].realtor_id,uuid(11));assert.equal(h.api.contacts[0].notes,'  Next delivery after lunch.  ');assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='insert').payload).sort(),['id','realtor_id',...contactFields].sort());assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{contacted_date:'Brochures'});
});
test('editing one contact cell preserves compound dates, literal notes and the source pair',async()=>{
 const original=contact({contacted_date:'  4/3/2025, 5/2/26  ',notes:'Line one\r\nLine two  ',source_file:'Fixture.csv',source_row:3,source_column:5,source_values:['  4/3/2025, 5/2/26  ','Line one\r\nLine two  ']});const h=environment({contacts:[original]});await h.start();await h.expand();h.input(original.id,'notes','Changed note');await h.save(original.id);
 assert.equal(h.api.contacts[0].contacted_date,original.contacted_date);assert.equal(h.api.contacts[0].notes,'Changed note');assert.deepEqual(h.api.contacts[0].source_values,original.source_values);assert.equal(h.api.contacts[0].source_column,5);assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{notes:'Changed note'});
});
test('normalized textarea no-op retains original CRLF and whitespace',async()=>{
 const h=environment({contacts:[contact({notes:'Line\r\nTwo  '})]});await h.start();await h.expand();h.input(uuid(101),'notes','Line\nTwo  ');await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.api.contacts[0].notes,'Line\r\nTwo  ');
});
test('blur autosaves while tabbing without replacing the next focused cell',async()=>{
 const h=environment();await h.start();await h.expand();const first=h.input(uuid(101),'contacted_date','Updated');const next=h.rows.get(uuid(101)).children[1];next.focus();await h.get('realtorsPage').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.contacts[0].contacted_date==='Updated');assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(101)).children[1],next);
});
test('typing during in-flight save queues the next cell behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();await h.expand();h.input(uuid(101),'contacted_date','First');const save=h.save();await until(()=>pending);h.input(uuid(101),'notes','Typed while saving');h.api.contacts[0]={...h.api.contacts[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.contacts[0]),error:null});await save;assert.equal(h.api.contacts[0].notes,'Typed while saving');assert.equal(h.api.contacts[0].revision,3);
});
test('different-cell edits merge and same-cell conflicts keep the local draft and reload action',async()=>{
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'notes','Local');h.api.contacts[0]={...h.api.contacts[0],contacted_date:'Remote materials',revision:2};await h.save();assert.equal(h.api.contacts[0].notes,'Local');assert.equal(h.api.contacts[0].contacted_date,'Remote materials');
 h.input(uuid(101),'notes','New local');h.api.contacts[0]={...h.api.contacts[0],notes:'New remote',revision:4};await h.save();assert.ok(h.editor().conflict);assert.equal(h.editor().values.notes,'New local');assert.equal(h.errors.get(`contact:${uuid(101)}`).button.dataset.action,'reload');
});
test('lost contact insert response reuses UUID and applies a newer local draft',async()=>{
 let fail=true;const h=environment({contacts:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.contacts.push(contact({...call.payload}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.app.addContact(uuid(11));const editor=[...h.app.state.editors.values()].find(e=>!e.base);h.input(editor.id,'contacted_date','First');await h.app.saveEditor(editor);assert.ok(editor.error);h.input(editor.id,'contacted_date','Second');await h.app.saveEditor(editor);assert.equal(h.api.contacts.length,1);assert.equal(h.api.contacts[0].contacted_date,'Second');assert.equal(h.api.contacts[0].id,editor.id);
});
test('lost update response reconciles its saved revision before applying more input',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.contacts[0]={...api.contacts[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.expand();h.input(uuid(101),'contacted_date','First');await h.save();h.input(uuid(101),'notes','Later');await h.save();assert.equal(h.api.contacts[0].contacted_date,'First');assert.equal(h.api.contacts[0].notes,'Later');assert.equal(h.api.contacts[0].revision,3);
});
test('Delete skips pointer blur saves and contact deletion stays restorable after toast expiry',async()=>{
 const h=environment();await h.start();await h.expand();const input=h.input(uuid(101),'contacted_date','Discarded draft'),row=h.rows.get(uuid(101));await h.get('realtorsPage').emit('pointerdown',{target:row.button});await h.get('realtorsPage').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.editor());assert.equal(h.api.calls.filter(call=>call.op==='update').length,1);assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='update').payload),['deleted_at']);h.runTimers(5000);assert.equal(h.get('toast').hidden,true);assert.ok(h.restores.has(`contact:${uuid(101)}`));await h.app.undoDelete({kind:'contact',row:h.app.state.contacts[0]});assert.equal(h.api.contacts[0].deleted_at,null);assert.equal(h.rows.size,1);
});
test('lost delete and restore responses recover safely without duplicating contacts',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&call.payload.deleted_at&&fail){fail=false;api.contacts[0]={...api.contacts[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.expand();const editor=h.editor();await h.app.deleteRow(editor);assert.ok(editor.error);await h.app.deleteRow(editor);assert.equal(h.rows.size,0);h.api.intercept=(call,api)=>{if(call.op==='update'&&call.payload.deleted_at===null){api.contacts[0]={...api.contacts[0],deleted_at:null,revision:3};return {data:null,error:{code:'NETWORK'}};}};await h.app.undoDelete();assert.equal(h.api.contacts.length,1);assert.equal(h.rows.size,1);assert.equal(h.get('toastText').textContent,'Contact restored.');
});
test('realtor deletion preserves all history and restoring it makes contacts accessible',async()=>{
 const original=[contact(),contact({id:uuid(102),position:'2',deleted_at:'2026-10-01'})];const h=environment({contacts:original});await h.start();await h.expand();await h.app.deleteRow(h.app.editorFor(h.app.state.realtors[0],'realtor'));assert.equal(h.directory.size,0);assert.deepEqual(h.api.contacts,original);assert.ok(h.restores.has(`realtor:${uuid(11)}`));h.runTimers(5000);await h.app.undoDelete({kind:'realtor',row:h.app.state.realtors[0]});assert.equal(h.directory.size,1);await h.expand();assert.equal(h.rows.size,1);assert.ok(h.restores.has(`contact:${uuid(102)}`));
});
test('realtor form adds and edits literal values while preserving source metadata',async()=>{
 const h=environment({realtors:[],contacts:[]});await h.start();await h.app.openRealtor();h.form('realtor_name','  New clinic  ');h.form('location','Town A');h.form('phone','do_not_contact');h.form('email','  Delivery paused.\nCall first.  ');await h.app.submitRealtor();assert.equal(h.api.realtors.length,1);assert.equal(h.api.realtors[0].realtor_name,'  New clinic  ');assert.equal(h.api.realtors[0].phone,'do_not_contact');assert.equal(h.get('realtorDialog').open,false);
 const id=h.api.realtors[0].id;await h.app.openRealtor(id);h.form('location','Town B');await h.app.submitRealtor();assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{location:'Town B'});assert.equal(h.api.realtors[0].email,'  Delivery paused.\nCall first.  ');
});
test('realtor concurrent edits merge different fields and preserve same-field conflicts in the form',async()=>{
 const h=environment();await h.start();await h.app.openRealtor(uuid(11));h.form('location','Local location');h.api.realtors[0]={...h.api.realtors[0],email:'Remote note',revision:2};await h.app.submitRealtor();assert.equal(h.api.realtors[0].location,'Local location');assert.equal(h.api.realtors[0].email,'Remote note');await h.app.openRealtor(uuid(11));h.form('location','New local');h.api.realtors[0]={...h.api.realtors[0],location:'New remote',revision:4};await h.app.submitRealtor();assert.ok(h.app.state.dialogEditor.conflict);assert.equal(h.get('realtorLocation').value,'New local');assert.equal(h.get('reloadRealtor').hidden,false);assert.equal(h.get('saveRealtor').disabled,true);
});
test('failed new realtor insert remains resumable after Close with the same UUID and values',async()=>{
 let fail=true;const h=environment({realtors:[],contacts:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.realtors.push(realtor({...call.payload}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.app.openRealtor();const id=h.app.state.dialogEditor.id;h.form('realtor_name','Kept clinic');await h.app.submitRealtor();assert.ok(h.app.state.dialogEditor.error);h.app.closeRealtorDialog();assert.equal(h.get('addRealtor').textContent,'Resume realtor');await h.app.openRealtor();assert.equal(h.app.state.dialogEditor.id,id);assert.equal(h.get('realtorName').value,'Kept clinic');await h.app.submitRealtor();assert.equal(h.api.realtors.length,1);assert.equal(h.api.realtors[0].id,id);assert.equal(h.get('realtorDialog').open,false);assert.equal(h.get('addRealtor').textContent,'Add realtor');
});
test('closing an invalid untouched new realtor clears the local validation draft',async()=>{
 const h=environment({realtors:[],contacts:[]});await h.start();await h.app.openRealtor();h.form('realtor_name','   ');await h.app.submitRealtor();assert.match(h.get('realtorFormError').textContent,/detail/);h.app.closeRealtorDialog();assert.equal(h.app.state.editors.size,0);assert.equal(h.get('saveStatus').textContent,'All changes saved');await h.app.refresh();assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
});
test('rapid double Add realtor opens just one editor and one modal',async()=>{
 const h=environment({realtors:[],contacts:[]});await h.start();await Promise.all([h.app.openRealtor(),h.app.openRealtor()]);assert.equal([...h.app.state.editors.values()].filter(editor=>editor.kind==='realtor').length,1);assert.equal(h.get('realtorDialog').open,true);assert.equal(h.app.state.openingRealtor,false);
});
test('busy parent deletion disables expanded controls and prevents adding or editing a realtor',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.table==='hq_realtors'&&call.op==='update'){pending=call;return gate.promise;}}});await h.start();await h.expand();const editor=h.app.editorFor(h.app.state.realtors[0],'realtor'),deletion=h.app.deleteRow(editor);await until(()=>pending);const count=h.app.state.editors.size;h.app.addContact(uuid(11));await h.app.openRealtor(uuid(11));assert.equal(h.app.state.editors.size,count);assert.equal(h.get('realtorDialog').open,false);assert.ok(h.controls.filter(button=>button.dataset.id===uuid(11)).every(button=>button.disabled));
 h.api.realtors[0]={...h.api.realtors[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.realtors[0]),error:null});await deletion;assert.equal(h.app.state.realtors[0].deleted_at!==null,true);
});
test('remote parent deletion exposes Restore and preserves a rejected contact draft until Retry',async()=>{
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'notes','Must keep this draft');h.api.realtors[0]={...h.api.realtors[0],deleted_at:'2026-10-10T12:00:00Z',revision:2};await h.save();const editor=h.editor();assert.ok(editor.parentDeleted);assert.equal(editor.values.notes,'Must keep this draft');assert.equal(h.get('deletedSection').open,true);assert.ok(h.restores.has(`realtor:${uuid(11)}`));assert.equal(h.app.state.expanded,uuid(11));
 await h.app.undoDelete({kind:'realtor',row:h.app.state.realtors[0]});assert.equal(h.rows.get(uuid(101)).children[1].value,'Must keep this draft');assert.ok(editor.error);await h.app.saveEditor(editor);assert.equal(h.api.contacts[0].notes,'Must keep this draft');assert.equal(editor.error,'');
});
test('unsaved or focused contacts and realtor dialogs block refresh without losing values',async()=>{
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'notes','Unsaved');const before=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,before);await h.save();await h.app.refresh();assert.equal(h.api.calls.filter(call=>call.range&&call.table==='hq_realtor_contacts').length,1);h.document.activeElement=null;await h.app.openRealtor(uuid(11));const calls=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,calls);assert.equal(h.get('realtorDialog').open,true);
});
test('restore during a focused draft keeps focus and the local contact values',async()=>{
 const h=environment({contacts:[contact(),contact({id:uuid(102),position:'2',deleted_at:'2026-10-01'})]});await h.start();await h.expand();const input=h.input(uuid(101),'notes','Focused draft');await h.app.undoDelete({kind:'contact',row:h.app.state.contacts.find(row=>row.id===uuid(102))});assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.contacts[1].deleted_at,null);h.document.activeElement=null;await h.get('realtorsPage').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(102)));assert.equal(h.api.contacts[0].notes,'Focused draft');
});
test('notes focus expands and blur resets scroll while preserving complete long content',async()=>{
 const h=environment();await h.start();await h.expand();const note='  Long note\n'+'Additional details '.repeat(200),input=h.input(uuid(101),'notes',note);input.scrollHeight=180;await h.get('realtorsPage').emit('focusin',{target:input});assert.equal(input.style.height,'180px');input.scrollTop=80;input.scrollLeft=20;h.document.activeElement=null;await h.get('realtorsPage').emit('focusout',{target:input});assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);assert.equal(input.style.height,'');h.runTimers(0);await until(()=>h.api.contacts[0].notes===note);
});
test('anonymous and unapproved accounts never fetch realtor or contact data',async()=>{
 for(const anonymous of [true,false]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table!=='hq_tour_staff').length,0);assert.equal(h.directory.size,0);assert.equal(h.get('addRealtor').disabled,true);}
});
test('sign-out rejects delayed contact save, realtor save, deletion, restore and fetch responses',async()=>{
 for(const mode of ['contact-save','realtor-save','delete','restore','fetch']){
  const h=environment();await h.start();await h.expand();if(mode==='restore')await h.app.deleteRow(h.editor());if(mode==='realtor-save'){await h.app.openRealtor(uuid(11));h.form('realtor_name','Late clinic');}
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table!=='hq_tour_staff'){pending=call;return gate.promise;}};let action;
  if(mode==='contact-save'){h.input(uuid(101),'notes','Late note');action=h.save();}else if(mode==='realtor-save')action=h.app.submitRealtor();else if(mode==='delete')action=h.app.deleteRow(h.editor());else if(mode==='restore')action=h.app.undoDelete();else{h.document.activeElement=null;action=h.app.refresh();}
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[realtor()]:mode==='realtor-save'?realtor({revision:2}):contact({revision:2}),error:null});await action;assert.equal(h.app.state.realtors.length,0);assert.equal(h.app.state.contacts.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.directory.size,0);assert.equal(h.get('realtorDialog').open,false);assert.equal(h.get('toast').hidden,true);
 }
});
test('both tables paginate beyond one thousand records and no private archive is requested',async()=>{
 const realtors=Array.from({length:1001},(_,index)=>realtor({id:uuid(1000+index),realtor_name:`Clinic ${String(index).padStart(4,'0')}`,position:String(index+1)}));const contacts=Array.from({length:1001},(_,index)=>contact({id:uuid(5000+index),realtor_id:realtors[index].id,position:String(index+1)}));const h=environment({realtors,contacts});await h.start();assert.equal(h.app.state.realtors.length,1001);assert.equal(h.app.state.contacts.length,1001);for(const table of ['hq_realtors','hq_realtor_contacts'])assert.deepEqual(h.api.calls.filter(call=>call.table===table&&call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('HTML-like names and contact text are escaped throughout active and deleted records',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='"><img src=x onerror=alert(1)>';const h=environment({realtors:[realtor({realtor_name:payload,email:custom}),realtor({id:uuid(12),realtor_name:payload,deleted_at:'2026-10-01'})],contacts:[contact({notes:payload,contacted_date:custom}),contact({id:uuid(102),contacted_date:payload,contacted_date:custom,deleted_at:'2026-10-01'})]});await h.start();await h.expand();assert.doesNotMatch(h.get('realtorRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedContactList').innerHTML,/<script>|<img/);assert.equal(h.rows.get(uuid(101)).children[1].value,payload);
});

test('Cancel discards validation-only edits to an existing realtor without changing its saved values',async()=>{
 const h=environment();await h.start();await h.app.openRealtor(uuid(11));h.form('realtor_name','');await h.app.submitRealtor();assert.match(h.get('realtorFormError').textContent,/detail/);h.app.closeRealtorDialog();assert.equal(h.app.state.editors.size,0);assert.equal(h.api.realtors[0].realtor_name,'Fixture agency');assert.equal(h.get('saveStatus').textContent,'All changes saved');
});
test('remote parent deletion during contact deletion has a Restore then delete retry path',async()=>{
 const h=environment();await h.start();await h.expand();const editor=h.editor();h.api.realtors[0]={...h.api.realtors[0],deleted_at:'2026-10-10T12:00:00Z',revision:2};await h.app.deleteRow(editor);assert.ok(editor.parentDeleted);assert.ok(h.restores.has(`realtor:${uuid(11)}`));assert.equal(h.api.contacts[0].deleted_at,null);await h.app.undoDelete({kind:'realtor',row:h.app.state.realtors[0]});assert.equal(h.errors.get(`contact:${uuid(101)}`).button.dataset.action,'delete');await h.app.deleteRow(editor);assert.ok(h.api.contacts[0].deleted_at);assert.equal(h.rows.size,0);
});

test('parent deletion locks existing contact fields and rejects input, save, delete and restore while pending',async()=>{
 const gate=deferred();let pending;const h=environment({contacts:[contact(),contact({id:uuid(102),position:'2',deleted_at:'2026-10-01'})],intercept(call){if(call.table==='hq_realtors'&&call.op==='update'){pending=call;return gate.promise;}}});await h.start();await h.expand();const contactEditor=h.editor(),parent=h.app.editorFor(h.app.state.realtors[0],'realtor'),deletion=h.app.deleteRow(parent);await until(()=>pending);assert.ok(h.rows.get(uuid(101)).children.every(input=>input.disabled));assert.equal(h.rows.get(uuid(101)).button.disabled,true);assert.equal(h.restores.get(`contact:${uuid(102)}`).disabled,true);
 const count=h.api.calls.length;h.input(uuid(101),'notes','Must not become a hidden draft');assert.equal(contactEditor.values.notes,'');assert.equal(h.app.dirty(contactEditor),false);await h.app.saveEditor(contactEditor);await h.app.deleteRow(contactEditor);await h.app.undoDelete({kind:'contact',row:h.app.state.contacts[1]});assert.equal(h.api.calls.length,count);
 h.api.realtors[0]={...h.api.realtors[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.realtors[0]),error:null});await deletion;assert.equal(h.app.dirty(contactEditor),false);h.document.activeElement=null;await h.app.refresh();assert.equal(h.app.state.realtors[0].deleted_at!==null,true);assert.equal(h.get('saveStatus').textContent,'All changes saved');
});

test('directory is alphabetical with a main-row edit button and just two history cells',async()=>{
 const h=environment({realtors:[realtor({realtor_name:' Zulu agency '}),realtor({id:uuid(12),realtor_name:'Alpha agency',position:'2'}),realtor({id:uuid(13),realtor_name:'beta agency',position:'3'})]});await h.start();assert.deepEqual([...h.directory.keys()],[uuid(12),uuid(13),uuid(11)]);assert.equal(h.rows.size,0);
 const edit=h.controls.find(button=>button.dataset.action==='edit-realtor'&&button.dataset.id===uuid(11));assert.ok(edit);await h.get('realtorsPage').emit('click',{target:edit});await until(()=>h.get('realtorDialog').open);assert.equal(h.get('realtorName').value,' Zulu agency ');h.app.closeRealtorDialog();
 await h.expand();assert.deepEqual(h.rows.get(uuid(101)).children.map(input=>input.dataset.field),['contacted_date','notes']);assert.ok(h.rows.get(uuid(101)).children.every(input=>input.tagName==='TEXTAREA'));await h.expand(uuid(12));assert.equal(h.app.state.expanded,uuid(12));assert.equal((h.get('realtorRows').innerHTML.match(/id="contactRows"/g)||[]).length,1);
});

test('four-field form accepts partial entries and nonstandard phone or email text',async()=>{
 const fieldNames=Array.from(html.matchAll(/data-realtor-field="([^"]+)"/g),match=>match[1]);assert.deepEqual(fieldNames,['realtor_name','phone','email','location']);assert.doesNotMatch(html,/type="email"|type="tel"|realtorStatus/);
 const h=environment({realtors:[],contacts:[]});await h.start();await h.app.openRealtor();await h.app.submitRealtor();assert.match(h.get('realtorFormError').textContent,/any realtor detail/);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
 h.form('email',' Ask for an email address later ');await h.app.submitRealtor();assert.equal(h.api.realtors.length,1);assert.equal(h.api.realtors[0].realtor_name,'');assert.equal(h.api.realtors[0].email,' Ask for an email address later ');assert.match(h.get('realtorRows').innerHTML,/Unnamed realtor/);
 await h.app.openRealtor(h.api.realtors[0].id);h.form('phone',' ext. 42 / front desk ');h.form('location',' Town to be confirmed ');await h.app.submitRealtor();assert.equal(h.api.realtors[0].phone,' ext. 42 / front desk ');assert.equal(h.api.realtors[0].location,' Town to be confirmed ');
});

test('parent edits preserve all eight archived CSV cells and independent contact pairs',async()=>{
 const source=['Fixture agency  ',' 123 / ext 4 ','MixedCase@fixture.invalid ',' Location text ','4/3/2025,5/2/26',' First note ','6/1/26','Second note'];
 const parent=realtor({realtor_name:source[0],phone:source[1],email:source[2],location:source[3],source_file:'Fixture.csv',source_row:5,source_values:source});
 const records=[contact({source_file:'Fixture.csv',source_row:5,source_column:5,contacted_date:source[4],notes:source[5],source_values:source.slice(4,6)}),contact({id:uuid(102),position:'2',source_file:'Fixture.csv',source_row:5,source_column:7,contacted_date:source[6],notes:source[7],source_values:source.slice(6,8)})];
 const h=environment({realtors:[parent],contacts:records});await h.start();await h.app.openRealtor(parent.id);h.form('email','Replacement text');await h.app.submitRealtor();assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{email:'Replacement text'});
 for(const key of ['realtor_name','phone','location'])assert.equal(h.api.realtors[0][key],parent[key]);assert.deepEqual(h.api.realtors[0].source_values,source);assert.deepEqual(h.api.contacts,records);await h.expand();assert.deepEqual([...h.rows.keys()],[uuid(102),uuid(101)]);assert.equal(h.rows.get(uuid(101)).children[0].value,source[4]);
});

test('rightmost imported pair is last recorded even if its literal date is earlier',async()=>{
 const records=[contact({source_file:'Fixture.csv',source_row:3,source_column:5,contacted_date:'12/31/2030, 1/5/31',notes:'First recorded pair',source_values:['12/31/2030, 1/5/31','First recorded pair'],position:'40'}),contact({id:uuid(102),source_file:'Fixture.csv',source_row:3,source_column:7,contacted_date:'1/2',notes:'Rightmost pair',source_values:['1/2','Rightmost pair'],position:'1'})];
 const h=environment({contacts:records});await h.start();const directory=h.get('realtorRows').innerHTML;assert.match(directory,/title="1\/2">1\/2/);assert.match(directory,/Rightmost pair/);assert.match(directory,/History \(2\)/);await h.expand();assert.deepEqual([...h.rows.keys()],[uuid(102),uuid(101)]);assert.deepEqual(h.api.contacts,records);
 await h.app.deleteRow(h.editor(uuid(102)));assert.match(h.get('realtorRows').innerHTML,/title="12\/31\/2030, 1\/5\/31"/);assert.match(h.get('realtorRows').innerHTML,/Hide history \(1\)/);
});

test('new recorded contacts sort by exact descending positions without inferring or splitting dates',async()=>{
 const records=[contact({id:uuid(101),position:'9007199254740993',contacted_date:'2099-12-31'}),contact({id:uuid(102),position:'9007199254740994',contacted_date:'1/2'}),contact({id:uuid(103),position:'9007199254740995',contacted_date:'unknown'}),contact({id:uuid(104),position:'9',source_file:'Fixture.csv',source_row:5,source_column:5,contacted_date:'4/3/2025.5/2/26'}),contact({id:uuid(105),position:'1',source_file:'Fixture.csv',source_row:5,source_column:7,contacted_date:'2020-01-01'})];
 const h=environment({contacts:records});await h.start();await h.expand();assert.deepEqual([...h.rows.keys()],[uuid(103),uuid(102),uuid(101),uuid(105),uuid(104)]);assert.deepEqual(h.api.contacts,records);assert.equal(h.app.state.contacts.length,5);
});

test('one search finds all parent fields and active history cells without altering records',async()=>{
 const records=[contact({realtor_id:uuid(11),contacted_date:'4/3/2025,5/2/26',notes:'No response — front desk'}),contact({id:uuid(102),realtor_id:uuid(12),notes:'Secret old note',deleted_at:'2026-10-01'})];
 const parents=[realtor({realtor_name:'North agency',phone:'203 ext 7',email:'MixedCASE@fixture.invalid',location:'Main street'}),realtor({id:uuid(12),position:'2',realtor_name:'South agency',phone:'555 other',email:'other@fixture.invalid',location:'Side street'})];
 const h=environment({realtors:parents,contacts:records});await h.start();
 for(const query of ['NORTH','EXT 7','mixedcase','MAIN STREET','5/2/26','NO RESPONSE']){h.get('searchRealtors').value=query;await h.get('searchRealtors').emit('input');assert.deepEqual([...h.directory.keys()],[uuid(11)],query);}
 h.get('searchRealtors').value='secret old';await h.get('searchRealtors').emit('input');assert.equal(h.directory.size,0);h.get('searchRealtors').value='';await h.get('searchRealtors').emit('input');assert.equal(h.directory.size,2);assert.deepEqual(h.api.realtors,parents);assert.deepEqual(h.api.contacts,records);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);
});

test('search keeps failed contact saves accessible and retry removes the recovery row after success',async()=>{
 let fail=true;const h=environment({intercept(call){if(call.op==='update'&&fail){fail=false;return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.expand();h.input(uuid(101),'notes','Kept unsaved draft');await h.save();assert.ok(h.editor().error);
 h.document.activeElement=null;h.get('searchRealtors').value='unmatched';await h.get('searchRealtors').emit('input');assert.ok(h.directory.has(uuid(11)));assert.ok(h.rows.has(uuid(101)));assert.equal(h.rows.get(uuid(101)).children[1].value,'Kept unsaved draft');const calls=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,calls);
 await h.get('realtorsPage').emit('click',{target:h.errors.get(`contact:${uuid(101)}`).button});await until(()=>!h.editor().saving);assert.equal(h.api.contacts[0].notes,'Kept unsaved draft');assert.equal(h.directory.size,0);
});

test('untouched new contact remains local until the explicit Save action',async()=>{
 const h=environment({contacts:[],now:'2027-01-01T02:00:00Z'});await h.start();h.app.addContact(uuid(11));const editor=[...h.app.state.editors.values()].find(editor=>!editor.base);assert.equal(editor.values.contacted_date,'12/31/2026');assert.equal(editor.values.notes,'');await h.app.saveEditor(editor);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
 const save=h.controls.find(button=>button.dataset.action==='save-contact'&&button.dataset.id===editor.id);assert.ok(save);await h.get('realtorsPage').emit('click',{target:save});await until(()=>h.api.contacts.length===1&&!editor.saving);assert.equal(h.api.contacts[0].contacted_date,'12/31/2026');assert.equal(h.api.contacts[0].notes,'');assert.equal(h.api.contacts[0].realtor_id,uuid(11));assert.equal(h.api.contacts[0].id,editor.id);
});

test('notes-only new contact can clear the default date and save a partial record',async()=>{
 const h=environment({contacts:[]});await h.start();h.app.addContact(uuid(11));const editor=[...h.app.state.editors.values()].find(editor=>!editor.base);h.input(editor.id,'contacted_date','');h.input(editor.id,'notes','  Ask for contact details later  ');await h.app.saveEditor(editor);assert.equal(h.api.contacts.length,1);assert.equal(h.api.contacts[0].contacted_date,'');assert.equal(h.api.contacts[0].notes,'  Ask for contact details later  ');assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='insert').payload).sort(),['contacted_date','id','notes','realtor_id']);
});

test('very long contact dates and notes are not truncated or split when saved',async()=>{
 const literalDate='Recorded dates: '+'1/2, 3/4; '.repeat(30),literalNotes='  Details\n'+'Follow up after the next conversation. '.repeat(200);
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'contacted_date',literalDate);await h.save();h.input(uuid(101),'notes',literalNotes);await h.save();assert.equal(h.api.contacts[0].contacted_date,literalDate);assert.equal(h.api.contacts[0].notes,literalNotes);assert.equal(h.api.contacts.length,1);assert.match(h.get('realtorRows').innerHTML,/maxlength="500"/);assert.match(h.get('realtorRows').innerHTML,/maxlength="20000"/);
});

test('parent deletion waits for child deletion and a failed delete stays visible for safe retry',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.table==='hq_realtor_contacts'&&call.op==='update'&&call.payload.deleted_at&&!pending){pending=call;return gate.promise;}}});await h.start();await h.expand();const child=h.editor(),deletion=h.app.deleteRow(child);await until(()=>pending);const parent=h.app.editorFor(h.app.state.realtors[0],'realtor'),calls=h.api.calls.length;
 await h.app.deleteRow(parent);assert.equal(h.api.calls.length,calls);assert.equal(h.api.realtors[0].deleted_at,null);assert.equal(h.app.state.expanded,uuid(11));assert.ok(h.rows.has(uuid(101)));
 gate.resolve({data:null,error:{code:'NETWORK'}});await deletion;assert.ok(child.error);assert.ok(child.deleteAttempt);assert.equal(h.errors.get(`contact:${uuid(101)}`).hidden,false);await h.app.deleteRow(parent);assert.equal(h.api.realtors[0].deleted_at,null);
 await h.get('realtorsPage').emit('click',{target:h.errors.get(`contact:${uuid(101)}`).button});await until(()=>Boolean(h.api.contacts[0].deleted_at)&&!child.deleting);await h.app.deleteRow(parent);assert.ok(h.api.realtors[0].deleted_at);await h.app.undoDelete({kind:'realtor',row:h.app.state.realtors[0]});h.document.activeElement=null;await h.app.refresh();assert.equal(h.get('saveStatus').textContent,'All changes saved');assert.equal(h.api.realtors[0].deleted_at,null);
});

test('history switching and parent editing cannot hide an in-flight child delete or its failed retry',async()=>{
 const gate=deferred();let pending;const h=environment({realtors:[realtor(),realtor({id:uuid(12),realtor_name:'Other agency',position:'2'})],intercept(call){if(call.table==='hq_realtor_contacts'&&call.op==='update'&&call.payload.deleted_at&&!pending){pending=call;return gate.promise;}}});await h.start();await h.expand();const child=h.editor(),deletion=h.app.deleteRow(child);await until(()=>pending);
 await h.app.expandRealtor(uuid(12));assert.equal(h.app.state.expanded,uuid(11));assert.ok(h.rows.has(uuid(101)));await h.app.openRealtor(uuid(11));assert.equal(h.get('realtorDialog').open,false);await h.app.expandRealtor(uuid(11));assert.equal(h.app.state.expanded,uuid(11));
 gate.resolve({data:null,error:{code:'NETWORK'}});await deletion;assert.ok(child.error);await h.app.expandRealtor(uuid(12));assert.equal(h.app.state.expanded,uuid(11));assert.ok(h.rows.has(uuid(101)));assert.equal(h.errors.get(`contact:${uuid(101)}`).button.dataset.action,'delete');
 await h.get('realtorsPage').emit('click',{target:h.errors.get(`contact:${uuid(101)}`).button});await until(()=>Boolean(h.api.contacts[0].deleted_at)&&!child.deleting);await h.app.expandRealtor(uuid(12));assert.equal(h.app.state.expanded,uuid(12));
});
