/* Daily closing checks use synthetic fixtures only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.END_OF_DAY_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'end-of-day.html'),'utf8'),source=fs.readFileSync(path.join(root,'assets/end-of-day.js'),'utf8');
const allFields=['staff_name','cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','receipt_description','drawer_total','cash_replaced','cash_deposit','check_deposit','total_deposit','notes','additional_note','bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
const computed=['drawer_total','total_deposit'],fields=allFields.filter(key=>!computed.includes(key)),denoms=['bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=(extra={})=>({id:uuid(11),entry_date:'2026-10-13',...Object.fromEntries(allFields.map(key=>[key,''])),staff_name:'Fixture Staff',position:'1',revision:1,created_at:'2026-10-13T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let index=0;index<800&&!check();index++)await Promise.resolve();assert.ok(check(),'expected asynchronous condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({records=[record()],active=true,intercept=null,now='2026-10-13T16:00:00Z',reducedMotion=false}={}) {
  const api={records:clone(records),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept};
  const nodes=new Map(),inputs=new Map(),buttons=[],timers=new Map();let timer=0,nextID=10000,day=null;
  const document={readyState:'loading',hidden:false,activeElement:null,getElementById:id=>nodes.get(id),addEventListener(){},querySelectorAll(selector){if(selector==='#dayFields [data-field]')return [...inputs.values()];if(selector==='[data-restore-date],[data-week-end],[data-open-date]')return buttons.filter(button=>button.dataset.restoreDate||button.dataset.weekEnd||button.dataset.openDate);return [];}};
  function node(id='') {
    const n={id,dataset:{},style:{},events:{},disabled:false,hidden:false,textContent:'',value:'',attrs:{},classes:new Set(),children:[],
      addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
      setAttribute(key,value){this.attrs[key]=value;},matches(selector){return selector==='[data-field]'?Boolean(this.dataset.field):selector==='[data-money]'?Boolean(this.money):false;},
      closest(selector){if(selector==='#dayFields')return this.day||null;if(selector==='[data-day-date]')return this.day||null;const match=selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);if(!match)return null;const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return this.dataset[key]&&(match[2]===undefined||this.dataset[key]===match[2])?this:null;},
      focus(){document.activeElement=this;},blur(){document.activeElement=null;},select(){this.selected=true;},scrollIntoView(options){this.scrolled=options;}};
    n.classList={toggle(key,on){if(on)n.classes.add(key);else n.classes.delete(key);},add(key){n.classes.add(key);},remove(key){n.classes.delete(key);}};
    let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='dayContent')parseDay(value);if(['weekRows','historyList','deletedList','attentionList'].includes(id))parseButtons(value,id);}});return n;
  }
  function parseButtons(markup,parent) {
    for(let index=buttons.length-1;index>=0;index--)if(buttons[index].parent===parent)buttons.splice(index,1);
    for(const match of markup.matchAll(/<button\b([^>]*)>/g)) {const button=node();button.parent=parent;for(const attr of match[1].matchAll(/data-([a-z-]+)="([^"]+)"/g)){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());button.dataset[key]=decode(attr[2]);}buttons.push(button);}
  }
  function parseDay(markup) {
    inputs.clear();day=null;for(const key of [...nodes.keys()])if(key.startsWith('field-')||key.startsWith('error-')||['dayFields','dayError','dayErrorText','retryDay','deleteDay','drawerTotal','depositTotal','drawerBalance','drawerRecorded','depositRecorded'].includes(key))nodes.delete(key);
    for(const match of markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(n.id,n);}
    const date=markup.match(/id="dayFields" data-day-date="([^"]+)"/)?.[1];if(date){day=nodes.get('dayFields');day.dataset.dayDate=date;}
    for(const match of markup.matchAll(/<textarea\b([^>]*data-field="([^"]+)"[^>]*)>([\s\S]*?)<\/textarea>|<input\b([^>]*data-field="([^"]+)"[^>]*)\/>/g)) {
      const attrs=match[1]||match[4],key=match[2]||match[5],id=attrs.match(/id="([^"]+)"/)?.[1],input=nodes.get(id)||node(id);input.dataset.field=key;input.day=day;input.money=/\bdata-money\b/.test(attrs);input.value=decode(match[1]?match[3]:attrs.match(/value="([^"]*)"/)?.[1]||'').replace(/\r\n?/g,'\n');inputs.set(key,input);nodes.set(id,input);
    }
    const retry=nodes.get('retryDay');if(retry)retry.dataset.dayAction='retry';const remove=nodes.get('deleteDay');if(remove)remove.dataset.dayAction='delete';parseButtons(markup,'dayContent');
  }
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique initial IDs');const n=node(match[1]);n.hidden=/\bhidden\b/.test(match[0]);nodes.set(n.id,n);}
  let app;
  function serverTotals(row,patch,insert=false) {
    for(const [total,parts]of [['drawer_total',denoms],['total_deposit',['cash_deposit','check_deposit']]])if(insert||parts.some(key=>key in patch&&patch[key]!==row[key])){const values={...row,...patch},sum=app.sumMoney(values,parts);assert.equal(sum.valid,true);patch[total]=sum.cents===null?'':app.centsText(sum.cents);}
  }
  async function complete(call) {
    api.calls.push(call);const response=api.intercept?.(call,api);if(response!==undefined)return response;
    if(call.table==='hq_tour_staff')return {data:api.active&&api.session?{user_id:api.session.user.id,active:true}:null,error:null};assert.equal(call.table,'hq_end_of_day');
    const matches=row=>call.filters.every(([op,key,value])=>op==='eq'?row[key]===value:op==='gte'?row[key]>=value:op==='lte'?row[key]<=value:op==='not'?row[key]!==null&&row[key]!==undefined:false);
    if(call.op==='insert') {
      if(api.records.some(row=>row.id===call.payload.id||row.entry_date===call.payload.entry_date))return {data:null,error:{code:'23505'}};
      const patch=clone(call.payload),row=record({id:patch.id,entry_date:patch.entry_date,staff_name:'',position:String(api.records.length+1)});serverTotals(row,patch,true);api.records.push({...row,...patch});return {data:clone(api.records.at(-1)),error:null};
    }
    if(call.op==='update') {const index=api.records.findIndex(matches);if(index<0)return {data:null,error:null};const row=api.records[index],patch=clone(call.payload);serverTotals(row,patch);for(const key of computed)if(!(key in patch)||!Object.keys(call.payload).some(name=>(key==='drawer_total'?denoms:['cash_deposit','check_deposit']).includes(name)))patch[key]=row[key];api.records[index]={...row,...patch,revision:row.revision+1};return {data:clone(api.records[index]),error:null};}
    let rows=api.records.filter(matches);if(call.order)rows.sort((a,b)=>String(a[call.order.key]).localeCompare(String(b[call.order.key]))*(call.order.ascending?1:-1));if(call.limit!==undefined)rows=rows.slice(0,call.limit);if(call.range)rows=rows.slice(call.range[0],call.range[1]+1);
    if(call.columns==='entry_date')rows=rows.map(row=>({entry_date:row.entry_date}));return {data:call.single?clone(rows[0]||null):clone(rows),error:null};
  }
  const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){api.callbacks.push(fn);}},from(table){const call={table,op:'select',filters:[]};const run=()=>complete(call);const chain={select(columns){call.columns=columns;return chain;},eq(key,value){call.filters.push(['eq',key,value]);return chain;},gte(key,value){call.filters.push(['gte',key,value]);return chain;},lte(key,value){call.filters.push(['lte',key,value]);return chain;},not(key,op,value){call.filters.push(['not',key,value]);return chain;},order(key,{ascending=true}={}){call.order={key,ascending};return chain;},limit(value){call.limit=value;return chain;},range(start,end){call.range=[start,end];return run();},update(patch){call.op='update';call.payload=clone(patch);return chain;},insert(patch){call.op='insert';call.payload=clone(patch);return chain;},single(){call.single=true;return run();},maybeSingle(){call.single=true;return run();}};return chain;}};
  const window={events:{},matchMedia:()=>({matches:reducedMotion}),addEventListener(type,fn){(this.events[type]||=[]).push(fn);}};
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,console,crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
  const marker="  if (document.readyState==='loading')";assert.equal(source.split(marker).length,2);
  vm.runInContext(source.replace(marker,`  window.hooks={state,init,easternToday,validDate,shiftDate,weekDates,rangeLabel,parseMoney,centsText,currency,sumMoney,hasActivity,dirty,unfinished,editorForDate,render,renderForm,renderWeek,renderCalculations,takeInput,changedPatch,selectDate,loadWeek,saveEditor,deleteDay,restoreDay,reloadDay,resetAuth};\n${marker}`),context);app=window.hooks;
  return {app,api,nodes,inputs,buttons,document,timers,get:id=>nodes.get(id),async start(){app.init();await until(()=>!app.state.loading);},input(key,value){const input=inputs.get(key);assert.ok(input,`input ${key} exists`);input.focus();input.value=value;app.takeInput(input);return input;},save(date=app.state.selectedDate){return app.saveEditor(app.state.editors.get(date));},signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},runTimers(delay){for(const [id,item]of [...timers])if(item.delay===delay){timers.delete(id);item.fn();}}};
}

test('default range is today and the previous six Eastern calendar dates, including around midnight',async()=>{
  for(const [now,today]of [['2026-10-14T03:30:00Z','2026-10-13'],['2026-10-14T04:30:00Z','2026-10-14'],['2026-01-01T03:30:00Z','2025-12-31']]){const h=environment({now,records:[]});await h.start();assert.equal(h.app.state.today,today);assert.equal(h.app.state.selectedDate,today);assert.equal(h.app.state.weekEnd,today);const dates=h.app.weekDates(today);assert.equal(dates.length,7);assert.equal(dates[0],today);assert.equal(dates[6],h.app.shiftDate(today,-6));assert.ok(dates.every(date=>date<=today));}
});
test('seven-day shifts use calendar dates without spring or autumn DST drift',async()=>{
  const h=environment();await h.start();for(const [start,expected]of [['2026-03-11','2026-03-04'],['2026-11-04','2026-10-28'],['2026-01-03','2025-12-27']]){assert.equal(h.app.shiftDate(start,-7),expected);assert.equal(h.app.shiftDate(expected,7),start);assert.equal(new Set(h.app.weekDates(start)).size,7);}
  assert.equal(h.app.validDate('2024-02-29'),true);for(const date of ['2025-02-29','2026-04-31','2026-1-01','2026-13-01','10/13/2026'])assert.equal(h.app.validDate(date),false);
});
test('money parser accepts forgiving literal dollars using exact signed cents',async()=>{
  const h=environment();await h.start();for(const [value,cents]of [['',null],['  ',null],['$1,234.50',123450n],['-$12',-1200n],['$-12',-1200n],['+12.3',1230n],['$+12',1200n],['( $12.30 )',-1230n],['.50',50n],['40.',4000n],['0',0n],['  0001.05  ',105n],['999999999.99',99999999999n]]){const parsed=h.app.parseMoney(value);assert.equal(parsed.valid,true,value);assert.equal(parsed.cents,cents,value);}
});
test('money parser rejects ambiguous commas, inner whitespace, extra signs and excess precision or range',async()=>{
  const h=environment();await h.start();for(const value of ['1,23','1,0000','1,234,56','1 000','1e3','12.345','-$-12','$ $12','($-12)','(+12)','12)','(12','NaN','.','1000000000.00','12 dollars'])assert.equal(h.app.parseMoney(value).valid,false,value);
});
test('drawer and deposit sums remain exact for pennies and can exceed the per-input maximum',async()=>{
  const h=environment();await h.start();assert.equal(h.app.sumMoney({quarters:'.10',dimes:'.20'},['quarters','dimes']).cents,30n);assert.equal(h.app.currency(30n),'$0.30');assert.equal(h.app.centsText(-105n),'-1.05');
  const large=Object.fromEntries(denoms.map(key=>[key,'999999999.99']));assert.equal(h.app.sumMoney(large,denoms).cents,999999999990n);assert.equal(h.app.currency(999999999990n),'$9,999,999,999.90');assert.equal(h.app.parseMoney('9999999999.90',{limit:false}).valid,true);assert.equal(h.app.sumMoney({cash_deposit:'999999999.99',check_deposit:'999999999.99'},['cash_deposit','check_deposit']).cents,199999999998n);
});
test('blank sums stay blank, blank components act as zero, and invalid components prevent a total',async()=>{
  const h=environment();await h.start();assert.equal(h.app.sumMoney({},denoms).cents,null);assert.equal(h.app.sumMoney({bills_20:'200',bills_5:''},denoms).cents,20000n);assert.equal(h.app.sumMoney({bills_20:'unknown'},denoms).valid,false);assert.equal(h.app.currency(null),'—');
});
test('all 22 editable fields are available and the two server-derived totals are read-only outputs',async()=>{
  const h=environment();await h.start();assert.deepEqual([...h.inputs.keys()].sort(),[...fields].sort());assert.equal(h.inputs.has('drawer_total'),false);assert.equal(h.inputs.has('total_deposit'),false);assert.ok(h.get('drawerTotal'));assert.ok(h.get('depositTotal'));assert.match(h.get('dayContent').innerHTML,/dollar amount.*not the number of bills or coins/);assert.match(h.get('dayContent').innerHTML,/Additional note from the original log/);
});
test('daily keyboard order follows money, drawer count, then deposits without positive tabindex',async()=>{
  const h=environment();await h.start();assert.deepEqual([...h.inputs.keys()],['staff_name','cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','cash_replaced','receipt_description',...denoms,'cash_deposit','check_deposit','notes','additional_note']);assert.doesNotMatch(h.get('dayContent').innerHTML,/tabindex="[1-9]/);
});
test('explicit entry actions reveal the loaded day while history reveals its week, respecting reduced motion',async()=>{
  for(const reducedMotion of [false,true]){
    const h=environment({reducedMotion,records:[record(),record({id:uuid(12),entry_date:'2026-10-06'})]});await h.start();assert.equal(h.get('dayPanel').scrolled,undefined);
    await h.get('goToday').emit('click');assert.equal(h.get('dayPanel').scrolled.behavior,reducedMotion?'auto':'smooth');assert.equal(h.get('dayPanel').scrolled.block,'start');
    const history=h.buttons.find(button=>button.dataset.weekEnd==='2026-10-06');await h.get('historyList').emit('click',{target:history});assert.equal(h.app.state.weekEnd,'2026-10-06');assert.equal(h.get('weekSection').scrolled.block,'start');
    h.get('jumpDate').value='2026-11-06';await h.get('jumpDate').emit('change');assert.equal(h.app.state.selectedDate,'2026-11-06');assert.equal(h.app.state.loading,false);assert.equal(h.get('dayPanel').scrolled.block,'start');
  }
});
test('prefilled zero rows with blank staff and notes stay Not started without a short or target-met badge',async()=>{
  const zero=record({staff_name:'',...Object.fromEntries(allFields.filter(key=>!['staff_name','receipt_description','notes','additional_note'].includes(key)).map(key=>[key,'0.00']))});const h=environment({records:[zero]});await h.start();assert.equal(h.app.hasActivity(h.app.state.editors.get(zero.entry_date).values),false);assert.match(h.get('weekRows').innerHTML,/Not started/);assert.equal(h.get('drawerBalance').dataset.state,'idle');assert.doesNotMatch(h.get('drawerBalance').textContent,/Short|Over|met/);assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);
});
test('drawer target comparison uses denomination amounts alone and requires day activity',async()=>{
  const h=environment({records:[record({bills_20:'190',drawer_total:'190',cash_received:'500',cash_deposit:'500'})]});await h.start();assert.equal(h.get('drawerBalance').dataset.state,'short');assert.match(h.get('drawerBalance').textContent,/\$10.00/);
  h.input('bills_20','200');assert.equal(h.get('drawerBalance').dataset.state,'met');h.input('bills_20','200.01');assert.equal(h.get('drawerBalance').dataset.state,'over');assert.match(h.get('drawerBalance').textContent,/\$0.01/);assert.equal(h.get('drawerTotal').textContent,'$200.01');
});
test('recorded deposit mismatch is visible and no-op or notes-only saves preserve the imported literals',async()=>{
  const original=record({cash_deposit:'10.00',check_deposit:'20',total_deposit:'29.50',drawer_total:'200',bills_20:'200',source_values:allFields.map(key=>`Original ${key}`),source_column:7,source_date:'10/13/2026'});const h=environment({records:[original]});await h.start();assert.equal(h.get('depositTotal').textContent,'$30.00');assert.equal(h.get('depositRecorded').hidden,false);assert.match(h.get('depositRecorded').textContent,/\$29.50/);assert.match(h.get('weekRows').innerHTML,/\$29.50/);
  await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);h.input('notes','  Follow up with a manager\nKeep the original totals  ');await h.save();const saved=h.api.records[0];assert.equal(saved.total_deposit,'29.50');assert.equal(saved.drawer_total,'200');assert.deepEqual(saved.source_values,original.source_values);assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{notes:'  Follow up with a manager\nKeep the original totals  '});
});
test('changing a denomination recalculates only the drawer and changing a deposit recalculates only deposit',async()=>{
  const h=environment({records:[record({bills_20:'200',drawer_total:'200',cash_deposit:'10',check_deposit:'20',total_deposit:'29.50'})]});await h.start();h.input('bills_20','$200.01');await h.save();assert.equal(h.api.records[0].drawer_total,'200.01');assert.equal(h.api.records[0].total_deposit,'29.50');assert.equal(h.api.records[0].bills_20,'$200.01');
  h.input('cash_deposit','10.01');await h.save();assert.equal(h.api.records[0].total_deposit,'30.01');assert.equal(h.api.records[0].drawer_total,'200.01');assert.ok(h.api.calls.filter(call=>call.op==='update').every(call=>computed.every(key=>!(key in call.payload))));
});
test('invalid new money stays local, shows a field error and can be corrected without losing text',async()=>{
  const h=environment();await h.start();h.input('cash_received','$12.345');await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.inputs.get('cash_received').value,'$12.345');assert.equal(h.get('error-cash_received').hidden,false);assert.match(h.get('saveStatus').textContent,/not saved/);
  h.input('cash_received','  $12.34  ');await h.save();assert.equal(h.api.records[0].cash_received,'  $12.34  ');assert.equal(h.get('error-cash_received').hidden,true);
});
test('textarea no-op preserves CRLF and surrounding whitespace without writing',async()=>{
  const h=environment({records:[record({notes:' Line one\r\nLine two  ',additional_note:' Extra  '})]});await h.start();h.input('notes',' Line one\nLine two  ');await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.api.records[0].notes,' Line one\r\nLine two  ');assert.equal(h.api.records[0].additional_note,' Extra  ');
});
test('missing dates create only local drafts until input and the date never appears as an editable field',async()=>{
  const h=environment({records:[]});await h.start();assert.ok(h.app.state.editors.get('2026-10-13'));assert.equal(h.app.unfinished(),false);await h.save();assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);assert.equal(h.inputs.has('entry_date'),false);h.input('staff_name','  Fixture Closer  ');await h.save();assert.equal(h.api.records.length,1);assert.equal(h.api.records[0].entry_date,'2026-10-13');assert.equal(h.api.records[0].staff_name,'  Fixture Closer  ');
});
test('blur and Tab save the field without replacing the next focused input',async()=>{
  const h=environment();await h.start();const first=h.input('cash_received','12.34'),next=h.inputs.get('checks_received');next.focus();await h.get('dayContent').emit('focusout',{target:first,relatedTarget:next});h.runTimers(0);await until(()=>h.api.records[0].cash_received==='12.34');assert.equal(h.document.activeElement,next);assert.equal(h.inputs.get('checks_received'),next);
});
test('keyboard focus selects existing money but pointer focus preserves normal cursor behavior',async()=>{
  const h=environment();await h.start();const input=h.inputs.get('cash_received');input.focus();await h.get('dayContent').emit('focusin',{target:input});assert.equal(input.selected,true);input.selected=false;await h.get('dayContent').emit('pointerdown',{target:input});await h.get('dayContent').emit('focusin',{target:input});assert.equal(input.selected,false);
});
test('new typing during a save queues against the returned revision while keeping focus',async()=>{
  const gate=deferred();let pending;const h=environment({intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();h.input('cash_received','12');const save=h.save();await until(()=>pending);const input=h.input('notes','Typed during save');h.api.records[0]={...h.api.records[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.records[0]),error:null});await save;assert.equal(h.api.records[0].notes,'Typed during save');assert.equal(h.api.records[0].revision,3);assert.equal(h.document.activeElement,input);
});
test('lost insert response reuses the date and UUID and retains newer input',async()=>{
  let fail=true;const h=environment({records:[],intercept(call,api){if(call.op==='insert'&&fail){fail=false;api.records.push(record({...call.payload,staff_name:call.payload.staff_name||'',position:'1'}));return {data:null,error:{code:'NETWORK'}};}}});await h.start();h.input('staff_name','First closer');const editor=h.app.state.editors.get('2026-10-13');await h.save();assert.ok(editor.error);h.input('notes','New note after failed response');await h.save();assert.equal(h.api.records.length,1);assert.equal(h.api.records[0].id,editor.id);assert.equal(h.api.records[0].notes,'New note after failed response');
});
test('simultaneous creation of the same date merges disjoint input without making a second record',async()=>{
  let race=true;const h=environment({records:[],intercept(call,api){if(call.op==='insert'&&race){race=false;api.records.push(record({id:uuid(99),entry_date:call.payload.entry_date,staff_name:'Remote closer',notes:'',position:'1'}));return {data:null,error:{code:'23505'}};}}});await h.start();h.input('notes','Local note');await h.save();assert.equal(h.api.records.length,1);assert.equal(h.api.records[0].staff_name,'Remote closer');assert.equal(h.api.records[0].notes,'Local note');assert.equal(h.app.state.editors.get('2026-10-13').id,uuid(99));
});
test('simultaneous same-date creation with overlapping values keeps a visible local conflict',async()=>{
  const h=environment({records:[],intercept(call,api){if(call.op==='insert'){api.records.push(record({id:uuid(99),entry_date:call.payload.entry_date,staff_name:'Remote closer'}));return {data:null,error:{code:'23505'}};}}});await h.start();h.input('staff_name','Local closer');await h.save();const editor=h.app.state.editors.get('2026-10-13');assert.ok(editor.conflict);assert.equal(editor.values.staff_name,'Local closer');assert.equal(h.api.records[0].staff_name,'Remote closer');assert.equal(h.get('retryDay').dataset.dayAction,'reload');
});
test('same-date creation cannot recreate a deleted day discovered during an insert race',async()=>{
  const h=environment({records:[],intercept(call,api){if(call.op==='insert'){api.records.push(record({id:uuid(99),entry_date:call.payload.entry_date,staff_name:'Deleted closer',deleted_at:'2026-10-13T12:00:00Z'}));return {data:null,error:{code:'23505'}};}}});await h.start();h.input('staff_name','Local closer');await h.save();assert.ok(h.app.state.editors.get('2026-10-13').conflict);assert.equal(h.api.records.length,1);assert.ok(h.api.records[0].deleted_at);assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);
});
test('different-cell updates merge while same-cell conflicts preserve the local draft',async()=>{
  const h=environment();await h.start();h.input('notes','Local note');h.api.records[0]={...h.api.records[0],staff_name:'Remote closer',revision:2};await h.save();assert.equal(h.api.records[0].staff_name,'Remote closer');assert.equal(h.api.records[0].notes,'Local note');h.input('notes','New local note');h.api.records[0]={...h.api.records[0],notes:'Remote note',revision:4};await h.save();const editor=h.app.state.editors.get('2026-10-13');assert.ok(editor.conflict);assert.equal(editor.values.notes,'New local note');assert.equal(h.api.records[0].notes,'Remote note');
});
test('week navigation retains invalid drafts and exposes a way back to finish them',async()=>{
  const h=environment();await h.start();h.input('cash_received','bad amount');await h.save();h.document.activeElement=null;h.app.selectDate('2026-10-06',{week:true});await until(()=>!h.app.state.loading);assert.equal(h.app.state.editors.get('2026-10-13').values.cash_received,'bad amount');assert.equal(h.get('attentionList').hidden,false);assert.match(h.get('attentionList').innerHTML,/2026-10-13/);h.app.selectDate('2026-10-13',{week:true});await until(()=>!h.app.state.loading);assert.equal(h.inputs.get('cash_received').value,'bad amount');
});
test('changing weeks uses only narrow date queries and keeps saved and dirty days cached',async()=>{
  const h=environment({records:[record(),record({id:uuid(12),entry_date:'2026-10-06',notes:'Older week'})]});await h.start();h.app.selectDate('2026-10-06',{week:true});await until(()=>!h.app.state.loading);assert.equal(h.inputs.get('notes').value,'Older week');assert.ok(h.app.state.logs.some(row=>row.entry_date==='2026-10-13'));
  const rangeCalls=h.api.calls.filter(call=>call.table==='hq_end_of_day'&&call.range&&!call.filters.some(([op])=>op==='not'));assert.equal(rangeCalls.length,2);for(const call of rangeCalls){assert.ok(call.filters.some(([op,key])=>op==='gte'&&key==='entry_date'));assert.ok(call.filters.some(([op,key])=>op==='lte'&&key==='entry_date'));}
  assert.equal(h.api.calls.filter(call=>call.limit===1).length,1);
});
test('periodic refresh fetches just the visible week and preserves focus or unsaved work',async()=>{
  const h=environment();await h.start();let count=h.api.calls.length;h.input('notes','Draft');await h.app.loadWeek({silent:true});assert.equal(h.api.calls.length,count);await h.save();await h.app.loadWeek({silent:true});assert.equal(h.api.calls.filter(call=>call.range&&!call.filters.some(([op])=>op==='not')).length,1);h.document.activeElement=null;count=h.api.calls.length;await h.app.loadWeek({silent:true});const calls=h.api.calls.slice(count);assert.equal(calls.filter(call=>call.range).length,1);assert.ok(calls.find(call=>call.range).filters.some(([op])=>op==='gte'));assert.equal(calls.filter(call=>call.limit===1).length,0);
});
test('history expands twelve date ranges at a time and date jump reaches explicit future dates',async()=>{
  const h=environment({records:[record(),record({id:uuid(12),entry_date:'2023-06-11'})]});await h.start();assert.equal((h.get('historyList').innerHTML.match(/data-week-end=/g)||[]).length,12);await h.get('loadOlderWeeks').emit('click');assert.equal((h.get('historyList').innerHTML.match(/data-week-end=/g)||[]).length,24);h.get('jumpDate').value='2026-11-06';await h.get('jumpDate').emit('change');await until(()=>!h.app.state.loading);assert.equal(h.app.state.weekEnd,'2026-11-06');assert.equal(h.app.state.selectedDate,'2026-11-06');assert.equal(h.app.weekDates(h.app.state.weekEnd)[6],'2026-10-31');
});
test('deleting a day keeps it restorable after the five-second toast and blocks automatic recreation',async()=>{
  const original=record({cash_received:' 12.34 ',additional_note:' Legacy note ',source_values:allFields.map(key=>`Original ${key}`)});const h=environment({records:[original]});await h.start();await h.app.deleteDay(h.app.state.editors.get('2026-10-13'));assert.equal(h.inputs.size,0);assert.match(h.get('dayContent').innerHTML,/Restore entry/);h.runTimers(5000);assert.equal(h.get('toast').hidden,true);assert.match(h.get('deletedList').innerHTML,/2026-10-13/);assert.equal(h.app.editorForDate('2026-10-13'),null);assert.equal(h.api.calls.filter(call=>call.op==='insert').length,0);await h.app.restoreDay();assert.equal(h.api.records[0].deleted_at,null);assert.equal(h.inputs.get('cash_received').value,' 12.34 ');assert.deepEqual(h.api.records[0].source_values,original.source_values);
});
test('lost delete and restore responses reconcile the existing date safely',async()=>{
  let failDelete=true;const h=environment({intercept(call,api){if(call.op==='update'&&call.payload.deleted_at&&failDelete){failDelete=false;api.records[0]={...api.records[0],...call.payload,revision:2};return {data:null,error:{code:'NETWORK'}};}}});await h.start();const editor=h.app.state.editors.get('2026-10-13');await h.app.deleteDay(editor);assert.ok(editor.error);assert.ok([...h.inputs.values()].every(input=>input.disabled));await h.app.deleteDay(editor);assert.equal(h.inputs.size,0);
  h.api.intercept=(call,api)=>{if(call.op==='update'&&call.payload.deleted_at===null){api.records[0]={...api.records[0],deleted_at:null,revision:3};return {data:null,error:{code:'NETWORK'}};}};await h.app.restoreDay();assert.equal(h.inputs.size,22);assert.equal(h.api.records.length,1);
});
test('Delete pointer avoids saving a discarded draft while Tab to Delete still saves',async()=>{
  const h=environment();await h.start();const input=h.input('notes','Discarded local note'),button=h.get('deleteDay');await h.get('dayContent').emit('pointerdown',{target:button});await h.get('dayContent').emit('focusout',{target:input,relatedTarget:button});h.runTimers(0);await h.app.deleteDay(h.app.state.editors.get('2026-10-13'));assert.deepEqual(Object.keys(h.api.calls.find(call=>call.op==='update').payload),['deleted_at']);
  const other=environment();await other.start();const next=other.input('notes','Keep local note');other.get('deleteDay').focus();await other.get('dayContent').emit('focusout',{target:next});other.runTimers(0);await until(()=>other.api.records[0].notes==='Keep local note');assert.equal(other.api.records[0].deleted_at,null);
});
test('anonymous and unapproved accounts never fetch daily financial records',async()=>{
  for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_end_of_day').length,0);assert.equal(h.inputs.size,0);assert.equal(h.get('goToday').disabled,true);}
});
test('sign-out discards late save, delete, restore and week query responses',async()=>{
  for(const mode of ['save','delete','restore','load']){const h=environment();await h.start();if(mode==='restore')await h.app.deleteDay(h.app.state.editors.get('2026-10-13'));const gate=deferred();let pending;h.api.intercept=call=>{if(call.table==='hq_end_of_day'){pending=call;return gate.promise;}};let mutation;
    if(mode==='save'){h.input('notes','Late note');mutation=h.save();}else if(mode==='delete')mutation=h.app.deleteDay(h.app.state.editors.get('2026-10-13'));else if(mode==='restore')mutation=h.app.restoreDay();else mutation=h.app.loadWeek({silent:true});await until(()=>pending);h.signOut();gate.resolve({data:mode==='load'?[record()]:record({notes:'Late note',revision:2}),error:null});await mutation;assert.equal(h.inputs.size,0);assert.equal(h.app.state.logs.length,0);assert.equal(h.app.state.editors.size,0);assert.equal(h.get('toast').hidden,true);}
});
test('all literal values are escaped in forms, staff suggestions and deleted entries',async()=>{
  const payload='</textarea><script>alert(1)</script>',original=record({staff_name:'\"><img src=x onerror=alert(1)>',notes:payload,additional_note:payload});const h=environment({records:[original]});await h.start();assert.doesNotMatch(h.get('dayContent').innerHTML,/<script>|<img/);assert.equal(h.inputs.get('notes').value,payload);assert.doesNotMatch(h.get('staffSuggestions').innerHTML,/<img/);await h.app.deleteDay(h.app.state.editors.get('2026-10-13'));assert.doesNotMatch(h.get('deletedList').innerHTML,/<img|<script/);
});
test('End Of Day has sidebar and homepage links without loading daily financial records on the homepage',()=>{
  const sidebar=fs.readFileSync(path.join(root,'partials/sidebar.html'),'utf8'),home=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.equal((sidebar.match(/href="\/end-of-day"/g)||[]).length,1);assert.equal((home.match(/href="\/end-of-day"/g)||[]).length,1);assert.doesNotMatch(home,/end-of-day\.js|hq_end_of_day/);assert.doesNotMatch(html+source,/preview-client|Fixture Staff|Annaella|53\.04/);assert.match(html,/Browse earlier weeks/);assert.match(html,/Drawer target/);
});
