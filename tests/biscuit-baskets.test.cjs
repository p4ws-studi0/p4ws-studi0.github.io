/* Behavioral checks use synthetic locations and visits only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.BISCUIT_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'biscuit-baskets.html'),'utf8'),source=fs.readFileSync(path.join(root,'assets/biscuit-baskets.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const visitFields=['visited_on','items_given','spoke_to','town','notes'];
const location=(extra={})=>({id:uuid(11),location_name:'Fixture clinic',town:'Fixture town',status:'active',status_notes:'',position:'1',revision:1,source_file:null,source_row:null,source_values:null,deleted_at:null,...extra});
const visit=(extra={})=>({id:uuid(101),location_id:uuid(11),visited_on:'10/1/2026',items_given:'Fixture materials',spoke_to:'Fixture contact',town:'',notes:'',position:'1',revision:1,source_file:null,source_row:null,source_column:null,source_values:null,source_year:null,deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(check){for(let i=0;i<500&&!check();i++)await Promise.resolve();assert.ok(check(),'expected async condition');}
const decode=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({locations=[location()],visits=[visit()],active=true,intercept=null,now='2026-10-10T14:00:00Z'}={}){
 const api={locations:clone(locations),visits:clone(visits),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
 const nodes=new Map(),rows=new Map(),directory=new Map(),errors=new Map(),restores=new Map(),controls=[];const timers=new Map();let timer=0,nextID=10000;
 const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){return selector==='[data-restore-row]'?[...restores.values()]:selector==='[data-control]'?controls:[];},querySelector(selector){const match=selector.match(/\[data-(row|location|error)-id="([^"]+)"\]/);return match?(match[1]==='row'?rows:match[1]==='location'?directory:errors).get(match[2])||null:null;}};
 function node(id=''){
  const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,open:false,textContent:'',value:'',scrollHeight:64,scrollTop:0,scrollLeft:0,classes:new Set(),children:[],buttons:[],
   addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},setAttribute(){},
   matches(selector){return selector==='[data-field]'&&Boolean(this.dataset.field);},closest(selector){if(selector==='#visitRows')return this.row&&this.row.kind==='visit'?nodes.get('visitRows'):null;if(selector==='[data-row-id]')return this.row?.kind==='visit'?this.row:null;if(selector==='[data-action]')return this.dataset.action?this:null;if(selector==='[data-action="delete"]')return this.dataset.action==='delete'?this:null;if(selector==='[data-restore-row]')return this.dataset.restoreRow?this:null;return null;},
   focus(){document.activeElement=this;},blur(){document.activeElement=null;},showModal(){this.open=true;},close(){this.open=false;document.activeElement=null;},
   querySelector(selector){if(selector==='button'||selector==='[data-action="delete"]')return this.button||null;if(selector==='[data-row-error]')return this.errorText||null;const key=selector.match(/data-field="([^"]+)"/)?.[1];return this.children.find(input=>input.dataset.field===key)||null;},querySelectorAll(selector){return selector==='[data-control]'?this.buttons:this.children;}};
  n.classList={toggle(name,on){if(on)n.classes.add(name);else n.classes.delete(name);},add(name){n.classes.add(name);},remove(name){n.classes.delete(name);}};
  let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='locationRows')parseDirectory(value);if(id==='deletedList'||id==='deletedVisitList')parseRestores(id,value);}});return n;
 }
 function parseButtons(markup,row){const buttons=[];for(const match of markup.matchAll(/<button([^>]*)>/g)){const button=node();for(const attr of match[1].matchAll(/data-([\w-]+)="([^"]*)"/g)){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());button.dataset[key]=decode(attr[2]);}button.row=row;if(/\bdata-control\b/.test(match[1])){controls.push(button);buttons.push(button);}}return buttons;}
 function parseDirectory(markup){
  if(document.activeElement?.row?.kind==='visit')document.activeElement=null;rows.clear();directory.clear();errors.clear();controls.length=0;
  for(const id of ['visitRows','deletedVisitsSection','deletedVisitCount','deletedVisitList'])nodes.delete(id);
  for(const match of markup.matchAll(/<tr class="bb-location" data-location-id="([^"]+)">([\s\S]*?)<\/tr>/g)){const row=node();row.kind='location';row.dataset.locationId=match[1];row.buttons=parseButtons(match[2],row);directory.set(match[1],row);}
  parseButtons(markup.replace(/<tr class="bb-location"[\s\S]*?<\/tr>/g,''),null);
  for(const id of ['visitRows','deletedVisitsSection','deletedVisitCount','deletedVisitList'])if(markup.includes(`id="${id}"`))nodes.set(id,node(id));
  if(nodes.has('visitRows'))nodes.get('visitRows').innerHTML=markup.match(/<tbody id="visitRows">([\s\S]*?)<\/tbody>/)?.[1]||'';
  for(const match of markup.matchAll(/<tr class="tr-row" data-row-id="([^"]+)">([\s\S]*?)<\/tr>/g)){const row=node();row.kind='visit';row.dataset.rowId=match[1];row.row=row;row.button=node();row.button.dataset.action='delete';row.button.row=row;for(const m of match[2].matchAll(/<textarea[^>]*data-field="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)){const input=node();input.dataset.field=m[1];input.tagName='TEXTAREA';input.value=decode(m[2]).replace(/\r\n?/g,'\n');input.row=row;row.children.push(input);}rows.set(match[1],row);}
  for(const match of markup.matchAll(/<tr class="tr-row-error" data-error-id="([^"]+)"([^>]*)>/g)){const row=node();row.hidden=/\bhidden\b/.test(match[2]);row.button=node();row.button.dataset.kind=match[1].split(':')[0];row.button.dataset.id=match[1].split(':')[1];row.button.dataset.action='retry';row.errorText=node();errors.set(match[1],row);}
 }
 function parseRestores(id,markup){const kind=id==='deletedList'?'location':'visit';for(const [key,button]of restores)if(button.dataset.kind===kind)restores.delete(key);for(const match of markup.matchAll(/<button[^>]*data-restore-row="([^"]+)"[^>]*data-kind="([^"]+)"/g)){const button=node();button.dataset.restoreRow=match[1];button.dataset.kind=match[2];restores.set(`${match[2]}:${match[1]}`,button);}}
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique initial HTML IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);const field=match[0].match(/data-location-field="([^"]+)"/)?.[1];if(field)n.dataset.locationField=field;nodes.set(match[1],n);}
 async function complete(call){
  api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
  if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};
  assert.ok(['hq_biscuit_locations','hq_biscuit_visits'].includes(call.table));const isVisit=call.table==='hq_biscuit_visits',list=isVisit?api.visits:api.locations,matches=row=>call.filters.every(([key,value])=>row[key]===value);
  if(call.op==='insert'){
   if(list.some(row=>row.id===call.payload.id))return {data:null,error:{code:'23505'}};
   if(isVisit&&!api.locations.some(row=>row.id===call.payload.location_id&&!row.deleted_at))return {data:null,error:{code:'42501'}};
   const position=String(Math.max(0,...list.map(row=>Number(row.position)))+1);
   const row=isVisit?visit({visited_on:'',items_given:'',spoke_to:'',town:'',notes:'',...call.payload,position}):location({location_name:'',town:'',status_notes:'',...call.payload,position});list.push(row);return {data:clone(row),error:null};
  }
  if(call.op==='update'){const index=list.findIndex(matches);if(index<0)return {data:null,error:null};if(isVisit&&!api.locations.some(row=>row.id===list[index].location_id&&!row.deleted_at))return {data:null,error:{code:'42501'}};list[index]={...list[index],...call.payload,revision:list[index].revision+1};return {data:clone(list[index]),error:null};}
  let data=list.filter(matches).sort((a,b)=>String(a.id).localeCompare(String(b.id)));if(call.range)data=data.slice(call.range[0],call.range[1]+1);return {data:call.range?clone(data):clone(data[0]||null),error:null};
 }
 const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){api.callbacks.push(fn);}},from(table){const call={table,op:'select',filters:[]};const run=()=>complete(call);const chain={select(){return chain;},eq(key,value){call.filters.push([key,value]);return chain;},order(){return chain;},range(a,b){call.range=[a,b];return run();},update(value){call.op='update';call.payload=clone(value);return chain;},insert(value){call.op='insert';call.payload=clone(value);return chain;},single:run,maybeSingle:run};return chain;}};
 const window={events:{},addEventListener(type,fn){(this.events[type]||=[]).push(fn);}};
 class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,console,crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
 const marker="  if(document.readyState==='loading')";assert.equal(source.split(marker).length,2);
 vm.runInContext(source.replace(marker,`  window.hooks={state,init,refresh,visitDate,rowDate,sortVisits,sortLocations,visibleLocations,renderDirectory,editorFor,dirty,saveEditor,deleteRow,undoDelete,expandLocation,addVisit,openLocation,closeLocationDialog,submitLocation,resetAuth,takeInput,takeLocationInput,reloadRow};\n${marker}`),context);
 const app=window.hooks;
 return {app,api,nodes,rows,directory,errors,restores,controls,document,timers,get:id=>nodes.get(id),
  async start(){app.init();await until(()=>!app.state.loading);},
  async expand(id=uuid(11)){await app.expandLocation(id);},
  input(id,key,value){const input=rows.get(id).children.find(input=>input.dataset.field===key);input.focus();input.value=value;app.takeInput(input);return input;},
  form(key,value){const ids={location_name:'locationName',town:'locationTown',status:'locationStatus',status_notes:'locationStatusNotes'},input=nodes.get(ids[key]);input.focus();input.value=value;app.takeLocationInput(input);},
  editor(id=uuid(101),kind='visit'){return app.state.editors.get(`${kind}:${id}`);},async save(id=uuid(101),kind='visit'){return app.saveEditor(app.state.editors.get(`${kind}:${id}`));},
  signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},runTimers(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}}
 };
}
test('directory is alphabetical, includes every status and opens only one compact history',async()=>{
 const h=environment({locations:[location({location_name:'Zulu'}),location({id:uuid(12),location_name:'Alpha',status:'closed',position:'2'}),location({id:uuid(13),location_name:'Beta',status:'do_not_visit',position:'3'})]});await h.start();
 assert.deepEqual([...h.directory.keys()],[uuid(12),uuid(13),uuid(11)]);assert.equal(h.rows.size,0);await h.expand();assert.equal(h.rows.size,1);assert.deepEqual(h.rows.get(uuid(101)).children.map(cell=>cell.dataset.field),visitFields);
 await h.expand(uuid(12));assert.equal(h.app.state.expanded,uuid(12));assert.equal(h.rows.size,0);assert.equal((h.get('locationRows').innerHTML.match(/id="visitRows"/g)||[]).length,1);
});
test('search, town and status filters combine without modifying source records',async()=>{
 const h=environment({locations:[location({location_name:'North Clinic',town:'Town A'}),location({id:uuid(12),location_name:'South Clinic',town:'Town B',status:'closed',position:'2'}),location({id:uuid(13),location_name:'North Office',town:'Town A',status:'do_not_visit',position:'3'})]});await h.start();const original=clone(h.api.locations);
 h.get('searchLocations').value='north';await h.get('searchLocations').emit('input');assert.equal(h.directory.size,2);h.get('townFilter').value='Town A';await h.get('townFilter').emit('change');h.get('statusFilter').value='active';await h.get('statusFilter').emit('change');assert.deepEqual([...h.directory.keys()],[uuid(11)]);
 assert.deepEqual(h.api.locations,original);assert.equal(h.api.calls.filter(call=>call.op!=='select').length,0);
});
test('unknown years stay unknown and imported visits keep newest recorded group first',async()=>{
 const rows=[visit({id:uuid(101),visited_on:'10/11',source_file:'Fixture.csv',source_column:2,source_values:['10/11'],position:'1'}),visit({id:uuid(102),visited_on:'11/7/25',source_file:'Fixture.csv',source_column:12,source_values:['11/7/25'],position:'2'}),visit({id:uuid(103),visited_on:'1/23',source_file:'Fixture.csv',source_column:17,source_values:['1/23'],position:'3'}),visit({id:uuid(104),visited_on:'9/15/26',source_file:'Fixture.csv',source_column:24,source_values:['9/15/26'],position:'4'}),visit({id:uuid(105),visited_on:'10/10/2026',position:'5'})];
 const h=environment({visits:rows});await h.start();await h.expand();assert.deepEqual([...h.rows.keys()],[uuid(105),uuid(104),uuid(103),uuid(102),uuid(101)]);assert.equal(h.app.visitDate('10/11'),null);assert.equal(h.app.rowDate(rows[0]),null);assert.equal(h.api.visits[0].visited_on,'10/11');
});
test('known full US and ISO dates sort together; year context applies only to original literal',async()=>{
 const h=environment();await h.start();const rows=[visit({id:uuid(102),visited_on:'2026-10-10',position:'2'}),visit({id:uuid(103),visited_on:'10/11/26',position:'3'}),visit({id:uuid(104),visited_on:'10/09/2026',position:'4'})];assert.deepEqual(Array.from(h.app.sortVisits(rows),row=>row.id),[uuid(103),uuid(102),uuid(104)]);
 assert.equal(h.app.rowDate(visit({visited_on:'8/19',source_values:['8/19'],source_year:2025})),Date.UTC(2025,7,19));assert.equal(h.app.rowDate(visit({visited_on:'8/20',source_values:['8/19'],source_year:2025})),null);
 for(const value of ['2/29/25','2026-02-29','4/31/2026','13/1/26','1/2/123','2026-10-009'])assert.equal(h.app.visitDate(value),null,value);assert.equal(h.app.visitDate('2024-02-29'),Date.UTC(2024,1,29));
});
test('same full dates and unknown new dates use exact descending insertion positions',async()=>{
 const h=environment();await h.start();const rows=[visit({id:uuid(102),visited_on:'',position:'9007199254740993'}),visit({id:uuid(103),visited_on:'7/8',position:'9007199254740994'}),visit({id:uuid(104),visited_on:'10/9/26',position:'9007199254740995'}),visit({id:uuid(105),visited_on:'10/9/26',position:'9007199254740996'})];assert.deepEqual(Array.from(h.app.sortVisits(rows),row=>row.id),[uuid(105),uuid(104),uuid(103),uuid(102)]);
});
test('new visit prefills full Eastern date and current town but stays local until input',async()=>{
 const h=environment({now:'2027-01-01T02:00:00Z'});await h.start();await h.expand();h.app.addVisit();const editor=[...h.app.state.editors.values()].find(e=>!e.base);assert.equal(editor.values.visited_on,'12/31/2026');assert.equal(editor.values.town,'Fixture town');assert.equal(h.document.activeElement.dataset.field,'items_given');await h.app.saveEditor(editor);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
 await h.app.deleteRow(editor);assert.equal(h.api.visits.length,1);assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);
});
test('partial visit saves once and later edits update its immutable parent and same UUID',async()=>{
 const h=environment({visits:[]});await h.start();h.app.addVisit(uuid(11));const editor=[...h.app.state.editors.values()].find(e=>!e.base);h.input(editor.id,'notes','  Next delivery after lunch.  ');await h.app.saveEditor(editor);h.input(editor.id,'items_given','Brochures');await h.app.saveEditor(editor);
 assert.equal(h.api.visits.length,1);assert.equal(h.api.visits[0].id,editor.id);assert.equal(h.api.visits[0].location_id,uuid(11));assert.equal(h.api.visits[0].notes,'  Next delivery after lunch.  ');assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='insert').payload).sort(),['id','location_id',...visitFields].sort());assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{items_given:'Brochures'});
});
test('editing one cell preserves imported blank town, literal text and source span',async()=>{
 const original=visit({visited_on:'  10/11  ',town:'',notes:'Line one\r\nLine two  ',source_file:'Fixture.csv',source_row:3,source_column:2,source_values:['  10/11  ','Fixture materials','Fixture contact','','Line one\r\nLine two  ']});const h=environment({visits:[original]});await h.start();await h.expand();h.input(original.id,'items_given','Changed materials');await h.save(original.id);
 for(const key of visitFields)assert.equal(h.api.visits[0][key],key==='items_given'?'Changed materials':original[key]);assert.deepEqual(h.api.visits[0].source_values,original.source_values);assert.equal(h.api.visits[0].source_column,2);assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{items_given:'Changed materials'});
});
test('normalized textarea no-op retains original CRLF and whitespace',async()=>{
 const h=environment({visits:[visit({notes:'Line\r\nTwo  '})]});await h.start();await h.expand();h.input(uuid(101),'notes','Line\nTwo  ');await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.api.visits[0].notes,'Line\r\nTwo  ');
});
test('blur autosaves while tabbing without replacing the next focused cell',async()=>{
 const h=environment();await h.start();await h.expand();const first=h.input(uuid(101),'items_given','Updated');const next=h.rows.get(uuid(101)).children[2];next.focus();await h.get('basketsPage').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.visits[0].items_given==='Updated');assert.equal(h.document.activeElement,next);assert.equal(h.rows.get(uuid(101)).children[2],next);
});
test('typing during in-flight save queues the next cell behind the returned revision',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();await h.expand();h.input(uuid(101),'items_given','First');const save=h.save();await until(()=>pending);h.input(uuid(101),'notes','Typed while saving');h.api.visits[0]={...h.api.visits[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.visits[0]),error:null});await save;assert.equal(h.api.visits[0].notes,'Typed while saving');assert.equal(h.api.visits[0].revision,3);
});
test('different-cell edits merge and same-cell conflicts keep the local draft and reload action',async()=>{
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'notes','Local');h.api.visits[0]={...h.api.visits[0],items_given:'Remote materials',revision:2};await h.save();assert.equal(h.api.visits[0].notes,'Local');assert.equal(h.api.visits[0].items_given,'Remote materials');
 h.input(uuid(101),'notes','New local');h.api.visits[0]={...h.api.visits[0],notes:'New remote',revision:4};await h.save();assert.ok(h.editor().conflict);assert.equal(h.editor().values.notes,'New local');assert.equal(h.errors.get(`visit:${uuid(101)}`).button.dataset.action,'reload');
});
test('lost visit insert response reuses UUID and applies a newer local draft',async()=>{
 let fail=true;const h=environment({visits:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.visits.push(visit({...call.payload}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.app.addVisit(uuid(11));const editor=[...h.app.state.editors.values()].find(e=>!e.base);h.input(editor.id,'items_given','First');await h.app.saveEditor(editor);assert.ok(editor.error);h.input(editor.id,'items_given','Second');await h.app.saveEditor(editor);assert.equal(h.api.visits.length,1);assert.equal(h.api.visits[0].items_given,'Second');assert.equal(h.api.visits[0].id,editor.id);
});
test('lost update response reconciles its saved revision before applying more input',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&fail){fail=false;api.visits[0]={...api.visits[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.expand();h.input(uuid(101),'items_given','First');await h.save();h.input(uuid(101),'notes','Later');await h.save();assert.equal(h.api.visits[0].items_given,'First');assert.equal(h.api.visits[0].notes,'Later');assert.equal(h.api.visits[0].revision,3);
});
test('Delete skips pointer blur saves and visit deletion stays restorable after toast expiry',async()=>{
 const h=environment();await h.start();await h.expand();const input=h.input(uuid(101),'items_given','Discarded draft'),row=h.rows.get(uuid(101));await h.get('basketsPage').emit('pointerdown',{target:row.button});await h.get('basketsPage').emit('focusout',{target:input,relatedTarget:row.button});h.runTimers(0);await h.app.deleteRow(h.editor());assert.equal(h.api.calls.filter(call=>call.op==='update').length,1);assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='update').payload),['deleted_at']);h.runTimers(5000);assert.equal(h.get('toast').hidden,true);assert.ok(h.restores.has(`visit:${uuid(101)}`));await h.app.undoDelete({kind:'visit',row:h.app.state.visits[0]});assert.equal(h.api.visits[0].deleted_at,null);assert.equal(h.rows.size,1);
});
test('lost delete and restore responses recover safely without duplicating visits',async()=>{
 let fail=true;const h=environment({intercept(call,api){if(call.op==='update'&&call.payload.deleted_at&&fail){fail=false;api.visits[0]={...api.visits[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.expand();const editor=h.editor();await h.app.deleteRow(editor);assert.ok(editor.error);await h.app.deleteRow(editor);assert.equal(h.rows.size,0);h.api.intercept=(call,api)=>{if(call.op==='update'&&call.payload.deleted_at===null){api.visits[0]={...api.visits[0],deleted_at:null,revision:3};return {data:null,error:{code:'NETWORK'}};}};await h.app.undoDelete();assert.equal(h.api.visits.length,1);assert.equal(h.rows.size,1);assert.equal(h.get('toastText').textContent,'Visit restored.');
});
test('location deletion preserves all history and restoring it makes visits accessible',async()=>{
 const original=[visit(),visit({id:uuid(102),position:'2',deleted_at:'2026-10-01'})];const h=environment({visits:original});await h.start();await h.expand();await h.app.deleteRow(h.app.editorFor(h.app.state.locations[0],'location'));assert.equal(h.directory.size,0);assert.deepEqual(h.api.visits,original);assert.ok(h.restores.has(`location:${uuid(11)}`));h.runTimers(5000);await h.app.undoDelete({kind:'location',row:h.app.state.locations[0]});assert.equal(h.directory.size,1);await h.expand();assert.equal(h.rows.size,1);assert.ok(h.restores.has(`visit:${uuid(102)}`));
});
test('location form adds and edits literal values while preserving source metadata',async()=>{
 const h=environment({locations:[],visits:[]});await h.start();await h.app.openLocation();h.form('location_name','  New clinic  ');h.form('town','Town A');h.form('status','do_not_visit');h.form('status_notes','  Delivery paused.\nCall first.  ');await h.app.submitLocation();assert.equal(h.api.locations.length,1);assert.equal(h.api.locations[0].location_name,'  New clinic  ');assert.equal(h.api.locations[0].status,'do_not_visit');assert.equal(h.get('locationDialog').open,false);
 const id=h.api.locations[0].id;await h.app.openLocation(id);h.form('town','Town B');await h.app.submitLocation();assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{town:'Town B'});assert.equal(h.api.locations[0].status_notes,'  Delivery paused.\nCall first.  ');
});
test('location concurrent edits merge different fields and preserve same-field conflicts in the form',async()=>{
 const h=environment();await h.start();await h.app.openLocation(uuid(11));h.form('town','Local town');h.api.locations[0]={...h.api.locations[0],status_notes:'Remote note',revision:2};await h.app.submitLocation();assert.equal(h.api.locations[0].town,'Local town');assert.equal(h.api.locations[0].status_notes,'Remote note');await h.app.openLocation(uuid(11));h.form('town','New local');h.api.locations[0]={...h.api.locations[0],town:'New remote',revision:4};await h.app.submitLocation();assert.ok(h.app.state.dialogEditor.conflict);assert.equal(h.get('locationTown').value,'New local');assert.equal(h.get('reloadLocation').hidden,false);assert.equal(h.get('saveLocation').disabled,true);
});
test('failed new location insert remains resumable after Close with the same UUID and values',async()=>{
 let fail=true;const h=environment({locations:[],visits:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.locations.push(location({...call.payload}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();await h.app.openLocation();const id=h.app.state.dialogEditor.id;h.form('location_name','Kept clinic');await h.app.submitLocation();assert.ok(h.app.state.dialogEditor.error);h.app.closeLocationDialog();assert.equal(h.get('addLocation').textContent,'Resume location');await h.app.openLocation();assert.equal(h.app.state.dialogEditor.id,id);assert.equal(h.get('locationName').value,'Kept clinic');await h.app.submitLocation();assert.equal(h.api.locations.length,1);assert.equal(h.api.locations[0].id,id);assert.equal(h.get('locationDialog').open,false);assert.equal(h.get('addLocation').textContent,'Add location');
});
test('closing an invalid untouched new location clears the local validation draft',async()=>{
 const h=environment({locations:[],visits:[]});await h.start();await h.app.openLocation();h.form('location_name','   ');await h.app.submitLocation();assert.match(h.get('locationFormError').textContent,/name/);h.app.closeLocationDialog();assert.equal(h.app.state.editors.size,0);assert.equal(h.get('saveStatus').textContent,'All changes saved');await h.app.refresh();assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);
});
test('rapid double Add location opens just one editor and one modal',async()=>{
 const h=environment({locations:[],visits:[]});await h.start();await Promise.all([h.app.openLocation(),h.app.openLocation()]);assert.equal([...h.app.state.editors.values()].filter(editor=>editor.kind==='location').length,1);assert.equal(h.get('locationDialog').open,true);assert.equal(h.app.state.openingLocation,false);
});
test('busy parent deletion disables expanded controls and prevents adding or editing a location',async()=>{
 const gate=deferred();let pending;const h=environment({intercept(call){if(call.table==='hq_biscuit_locations'&&call.op==='update'){pending=call;return gate.promise;}}});await h.start();await h.expand();const editor=h.app.editorFor(h.app.state.locations[0],'location'),deletion=h.app.deleteRow(editor);await until(()=>pending);const count=h.app.state.editors.size;h.app.addVisit(uuid(11));await h.app.openLocation(uuid(11));assert.equal(h.app.state.editors.size,count);assert.equal(h.get('locationDialog').open,false);assert.ok(h.controls.filter(button=>button.dataset.id===uuid(11)).every(button=>button.disabled));
 h.api.locations[0]={...h.api.locations[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.locations[0]),error:null});await deletion;assert.equal(h.app.state.locations[0].deleted_at!==null,true);
});
test('remote parent deletion exposes Restore and preserves a rejected visit draft until Retry',async()=>{
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'notes','Must keep this draft');h.api.locations[0]={...h.api.locations[0],deleted_at:'2026-10-10T12:00:00Z',revision:2};await h.save();const editor=h.editor();assert.ok(editor.parentDeleted);assert.equal(editor.values.notes,'Must keep this draft');assert.equal(h.get('deletedSection').open,true);assert.ok(h.restores.has(`location:${uuid(11)}`));assert.equal(h.app.state.expanded,uuid(11));
 await h.app.undoDelete({kind:'location',row:h.app.state.locations[0]});assert.equal(h.rows.get(uuid(101)).children[4].value,'Must keep this draft');assert.ok(editor.error);await h.app.saveEditor(editor);assert.equal(h.api.visits[0].notes,'Must keep this draft');assert.equal(editor.error,'');
});
test('unsaved or focused visits and location dialogs block refresh without losing values',async()=>{
 const h=environment();await h.start();await h.expand();h.input(uuid(101),'notes','Unsaved');const before=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,before);await h.save();await h.app.refresh();assert.equal(h.api.calls.filter(call=>call.range&&call.table==='hq_biscuit_visits').length,1);h.document.activeElement=null;await h.app.openLocation(uuid(11));const calls=h.api.calls.length;await h.app.refresh();assert.equal(h.api.calls.length,calls);assert.equal(h.get('locationDialog').open,true);
});
test('restore during a focused draft keeps focus and the local visit values',async()=>{
 const h=environment({visits:[visit(),visit({id:uuid(102),position:'2',deleted_at:'2026-10-01'})]});await h.start();await h.expand();const input=h.input(uuid(101),'notes','Focused draft');await h.app.undoDelete({kind:'visit',row:h.app.state.visits.find(row=>row.id===uuid(102))});assert.equal(h.document.activeElement,input);assert.equal(input.value,'Focused draft');assert.equal(h.api.visits[1].deleted_at,null);h.document.activeElement=null;await h.get('basketsPage').emit('focusout',{target:input});h.runTimers(0);await until(()=>h.rows.has(uuid(102)));assert.equal(h.api.visits[0].notes,'Focused draft');
});
test('notes focus expands and blur resets scroll while preserving complete long content',async()=>{
 const h=environment();await h.start();await h.expand();const note='  Long note\n'+'Additional details '.repeat(200),input=h.input(uuid(101),'notes',note);input.scrollHeight=180;await h.get('basketsPage').emit('focusin',{target:input});assert.equal(input.style.height,'180px');input.scrollTop=80;input.scrollLeft=20;h.document.activeElement=null;await h.get('basketsPage').emit('focusout',{target:input});assert.equal(input.scrollTop,0);assert.equal(input.scrollLeft,0);assert.equal(input.style.height,'');h.runTimers(0);await until(()=>h.api.visits[0].notes===note);
});
test('anonymous and unapproved accounts never fetch location or visit data',async()=>{
 for(const anonymous of [true,false]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table!=='hq_tour_staff').length,0);assert.equal(h.directory.size,0);assert.equal(h.get('addLocation').disabled,true);}
});
test('sign-out rejects delayed visit save, location save, deletion, restore and fetch responses',async()=>{
 for(const mode of ['visit-save','location-save','delete','restore','fetch']){
  const h=environment();await h.start();await h.expand();if(mode==='restore')await h.app.deleteRow(h.editor());if(mode==='location-save'){await h.app.openLocation(uuid(11));h.form('location_name','Late clinic');}
  const gate=deferred();let pending;h.api.intercept=call=>{if(call.table!=='hq_tour_staff'){pending=call;return gate.promise;}};let action;
  if(mode==='visit-save'){h.input(uuid(101),'notes','Late note');action=h.save();}else if(mode==='location-save')action=h.app.submitLocation();else if(mode==='delete')action=h.app.deleteRow(h.editor());else if(mode==='restore')action=h.app.undoDelete();else{h.document.activeElement=null;action=h.app.refresh();}
  await until(()=>pending);h.signOut();gate.resolve({data:mode==='fetch'?[location()]:mode==='location-save'?location({revision:2}):visit({revision:2}),error:null});await action;assert.equal(h.app.state.locations.length,0);assert.equal(h.app.state.visits.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.directory.size,0);assert.equal(h.get('locationDialog').open,false);assert.equal(h.get('toast').hidden,true);
 }
});
test('both tables paginate beyond one thousand records and no private archive is requested',async()=>{
 const locations=Array.from({length:1001},(_,index)=>location({id:uuid(1000+index),location_name:`Clinic ${String(index).padStart(4,'0')}`,position:String(index+1)}));const visits=Array.from({length:1001},(_,index)=>visit({id:uuid(5000+index),location_id:locations[index].id,position:String(index+1)}));const h=environment({locations,visits});await h.start();assert.equal(h.app.state.locations.length,1001);assert.equal(h.app.state.visits.length,1001);for(const table of ['hq_biscuit_locations','hq_biscuit_visits'])assert.deepEqual(h.api.calls.filter(call=>call.table===table&&call.range).map(call=>call.range),[[0,499],[500,999],[1000,1499]]);
});
test('HTML-like names and visit text are escaped throughout active and deleted records',async()=>{
 const payload='</textarea><script>alert(1)</script>',custom='"><img src=x onerror=alert(1)>';const h=environment({locations:[location({location_name:payload,status_notes:custom}),location({id:uuid(12),location_name:payload,deleted_at:'2026-10-01'})],visits:[visit({notes:payload,items_given:custom}),visit({id:uuid(102),visited_on:payload,items_given:custom,deleted_at:'2026-10-01'})]});await h.start();await h.expand();assert.doesNotMatch(h.get('locationRows').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedList').innerHTML,/<script>|<img/);assert.doesNotMatch(h.get('deletedVisitList').innerHTML,/<script>|<img/);assert.equal(h.rows.get(uuid(101)).children[4].value,payload);
});

test('Cancel discards validation-only edits to an existing location without changing its saved values',async()=>{
 const h=environment();await h.start();await h.app.openLocation(uuid(11));h.form('location_name','');await h.app.submitLocation();assert.match(h.get('locationFormError').textContent,/name/);h.app.closeLocationDialog();assert.equal(h.app.state.editors.size,0);assert.equal(h.api.locations[0].location_name,'Fixture clinic');assert.equal(h.get('saveStatus').textContent,'All changes saved');
});
test('remote parent deletion during visit deletion has a Restore then delete retry path',async()=>{
 const h=environment();await h.start();await h.expand();const editor=h.editor();h.api.locations[0]={...h.api.locations[0],deleted_at:'2026-10-10T12:00:00Z',revision:2};await h.app.deleteRow(editor);assert.ok(editor.parentDeleted);assert.ok(h.restores.has(`location:${uuid(11)}`));assert.equal(h.api.visits[0].deleted_at,null);await h.app.undoDelete({kind:'location',row:h.app.state.locations[0]});assert.equal(h.errors.get(`visit:${uuid(101)}`).button.dataset.action,'delete');await h.app.deleteRow(editor);assert.ok(h.api.visits[0].deleted_at);assert.equal(h.rows.size,0);
});

test('parent deletion locks existing visit fields and rejects input, save, delete and restore while pending',async()=>{
 const gate=deferred();let pending;const h=environment({visits:[visit(),visit({id:uuid(102),position:'2',deleted_at:'2026-10-01'})],intercept(call){if(call.table==='hq_biscuit_locations'&&call.op==='update'){pending=call;return gate.promise;}}});await h.start();await h.expand();const visitEditor=h.editor(),parent=h.app.editorFor(h.app.state.locations[0],'location'),deletion=h.app.deleteRow(parent);await until(()=>pending);assert.ok(h.rows.get(uuid(101)).children.every(input=>input.disabled));assert.equal(h.rows.get(uuid(101)).button.disabled,true);assert.equal(h.restores.get(`visit:${uuid(102)}`).disabled,true);
 const count=h.api.calls.length;h.input(uuid(101),'notes','Must not become a hidden draft');assert.equal(visitEditor.values.notes,'');assert.equal(h.app.dirty(visitEditor),false);await h.app.saveEditor(visitEditor);await h.app.deleteRow(visitEditor);await h.app.undoDelete({kind:'visit',row:h.app.state.visits[1]});assert.equal(h.api.calls.length,count);
 h.api.locations[0]={...h.api.locations[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.locations[0]),error:null});await deletion;assert.equal(h.app.dirty(visitEditor),false);h.document.activeElement=null;await h.app.refresh();assert.equal(h.app.state.locations[0].deleted_at!==null,true);assert.equal(h.get('saveStatus').textContent,'All changes saved');
});
