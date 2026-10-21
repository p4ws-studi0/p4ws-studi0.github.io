/* Daily closing checks use synthetic fixtures only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.END_OF_DAY_TEST_ROOT||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'end-of-day.html'),'utf8'),source=fs.readFileSync(path.join(root,'assets/end-of-day.js'),'utf8');
const reportUtility=require(path.join(root,'assets/end-of-day-report.js'));
const allFields=['staff_name','cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','receipt_description','drawer_total','cash_replaced','cash_deposit','check_deposit','total_deposit','notes','additional_note','bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
const denominationCents={bills_100:10000n,bills_50:5000n,bills_20:2000n,bills_10:1000n,bills_5:500n,bills_1:100n,quarters:25n,dimes:10n,nickels:5n,pennies:1n};
const computed=['drawer_total','total_deposit'],fields=allFields.filter(key=>!computed.includes(key)),denoms=['bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=(extra={})=>({id:uuid(11),entry_date:'2026-10-13',...Object.fromEntries(allFields.map(key=>[key,''])),staff_name:'Fixture Staff',position:'1',revision:1,created_at:'2026-10-13T12:00:00Z',deleted_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){for(let index=0;index<800&&!check();index++)await Promise.resolve();assert.ok(check(),'expected asynchronous condition');}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function environment({records=[record()],active=true,intercept=null,now='2026-10-13T16:00:00Z',reducedMotion=false,smallScreen=false}={}) {
  const api={records:clone(records),active,session:{user:{id:uuid(900)}},calls:[],callbacks:[],intercept,downloads:[],urls:new Map(),revoked:[],prints:[],printLayout:{width:1000,height:700,contentWidth:980,contentHeight:680},reportSize:{width:900,height:600}};
  const nodes=new Map(),inputs=new Map(),buttons=[],timers=new Map();let timer=0,nextID=10000,day=null;
  const document={readyState:'loading',hidden:false,activeElement:null,events:{},getElementById:id=>nodes.get(id),addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},body:{appendChild(child){child.appended=true;}},createElement(tag){const child=node();child.tagName=tag;return child;},querySelectorAll(selector){if(selector==='#dayFields [data-field]')return [...inputs.values()];if(selector==='[data-restore-date],[data-week-end],[data-open-date]')return buttons.filter(button=>button.dataset.restoreDate||button.dataset.weekEnd||button.dataset.openDate);return [];}};
  const bodyClasses=new Set();document.body.classList={add(...names){names.forEach(name=>bodyClasses.add(name));},remove(...names){names.forEach(name=>bodyClasses.delete(name));},contains(name){return bodyClasses.has(name);},toggle(name,on){const enabled=on===undefined?!bodyClasses.has(name):Boolean(on);if(enabled)bodyClasses.add(name);else bodyClasses.delete(name);return enabled;}};
  function node(id='') {
    const n={id,dataset:{},style:{setProperty(name,value){this[name]=value;},removeProperty(name){const value=this[name];delete this[name];return value;}},events:{},disabled:false,hidden:false,open:false,textContent:'',value:'',attrs:{},classes:new Set(),children:[],
      addEventListener(type,fn){(this.events[type]||=[]).push(fn);},async emit(type,event={}){for(const fn of this.events[type]||[])await fn(event);},
      setAttribute(key,value){this.attrs[key]=value;},getAttribute(key){return this.attrs[key];},removeAttribute(key){delete this.attrs[key];},contains(target){return target===this||target?.parent===this.id;},matches(selector){return selector==='[data-field]'?Boolean(this.dataset.field):selector==='[data-money]'?Boolean(this.money):selector==='[data-quantity]'?Boolean(this.quantity):false;},
      closest(selector){if(selector==='button,input,select,textarea,a')return ['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(String(this.tagName).toUpperCase())?this:null;if(selector==='#dayFields')return this.day||null;if(selector==='[data-day-date]')return this.day||null;const match=selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);if(!match)return null;const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return this.dataset[key]&&(match[2]===undefined||this.dataset[key]===match[2])?this:null;},
      getBoundingClientRect(){if(id!=='weekReport')return this.rect||{left:0,top:0,width:100,height:40};const width=this.classes.has('is-expanded')?window.innerWidth-32:Math.min(api.reportSize.width,window.innerWidth-32),height=this.classes.has('is-expanded')?window.innerHeight-32:Math.min(api.reportSize.height,window.innerHeight-32),left=this.classes.has('is-positioned')?parseFloat(this.style['--eod-report-left']):(window.innerWidth-width)/2,top=this.classes.has('is-positioned')?parseFloat(this.style['--eod-report-top']):(window.innerHeight-height)/2;return {left,top,width,height,right:left+width,bottom:top+height};},setPointerCapture(pointerId){this.capturedPointer=pointerId;},releasePointerCapture(pointerId){if(this.capturedPointer===pointerId)this.capturedPointer=null;},hasPointerCapture(pointerId){return this.capturedPointer===pointerId;},focus(){document.activeElement=this;},blur(){document.activeElement=null;},select(){this.selected=true;},scrollIntoView(options){this.scrolled=options;},
      querySelectorAll(selector){return selector==='.eod-print-page'?this.printPages||[]:[];},querySelector(selector){return selector==='.eod-print-page-content'?this.printContent||null:null;},showModal(){this.open=true;},close(){this.open=false;for(const fn of this.events.close||[])fn({target:this});},click(){if(this.tagName==='a')api.downloads.push({href:this.href,filename:this.download,blob:api.urls.get(this.href)});},remove(){this.removed=true;}};
    n.classList={contains(key){return n.classes.has(key);},toggle(key,on){if(on)n.classes.add(key);else n.classes.delete(key);},add(...keys){keys.forEach(key=>n.classes.add(key));},remove(...keys){keys.forEach(key=>n.classes.delete(key));}};
    let markup='';Object.defineProperty(n,'innerHTML',{get(){return markup;},set(value){markup=value;if(id==='dayContent')parseDay(value);if(id==='weekReportPrint')n.printPages=[...value.matchAll(/class="([^"]*)"/g)].filter(match=>match[1].split(/\s+/).includes('eod-print-page')).map(()=>{const page=node();page.clientWidth=api.printLayout.width;page.clientHeight=api.printLayout.height;page.printContent={scrollWidth:api.printLayout.contentWidth,scrollHeight:api.printLayout.contentHeight};return page;});if(['weekRows','historyList','deletedList','attentionList','reportCalendar','jumpCalendar'].includes(id))parseButtons(value,id);}});return n;
  }
  function parseButtons(markup,parent) {
    for(let index=buttons.length-1;index>=0;index--)if(buttons[index].parent===parent){if(buttons[index].id)nodes.delete(buttons[index].id);buttons.splice(index,1);}
    for(const match of markup.matchAll(/<button\b([^>]*)>/g)) {const id=match[1].match(/\bid="([^"]+)"/)?.[1]||'',button=node(id);button.parent=parent;for(const attr of match[1].matchAll(/data-([a-z-]+)="([^"]+)"/g)){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());button.dataset[key]=decode(attr[2]);}buttons.push(button);if(id)nodes.set(id,button);}
  }
  function parseDay(markup) {
    inputs.clear();day=null;for(const key of [...nodes.keys()])if(key.startsWith('field-')||key.startsWith('error-')||['dayFields','dayError','dayErrorText','retryDay','deleteDay','drawerTotal','depositTotal','drawerBalance','drawerRecorded','depositRecorded'].includes(key))nodes.delete(key);
    for(const match of markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const n=node(match[1]);n.tagName=match[0].match(/^<(\w+)/)?.[1]?.toUpperCase();n.hidden=/\bhidden\b/.test(match[0]);nodes.set(n.id,n);}
    const date=markup.match(/id="dayFields" data-day-date="([^"]+)"/)?.[1];if(date){day=nodes.get('dayFields');day.dataset.dayDate=date;}
    for(const match of markup.matchAll(/<textarea\b([^>]*data-field="([^"]+)"[^>]*)>([\s\S]*?)<\/textarea>|<input\b([^>]*data-field="([^"]+)"[^>]*)\/>/g)) {
      const attrs=match[1]||match[4],key=match[2]||match[5],id=attrs.match(/id="([^"]+)"/)?.[1],input=nodes.get(id)||node(id);input.dataset.field=key;input.day=day;input.money=/\bdata-money\b/.test(attrs);input.quantity=/\bdata-quantity\b/.test(attrs);for(const attribute of attrs.matchAll(/([\w-]+)="([^"]*)"/g))input.attrs[attribute[1]]=decode(attribute[2]);input.value=decode(match[1]?match[3]:attrs.match(/value="([^"]*)"/)?.[1]||'').replace(/\r\n?/g,'\n');inputs.set(key,input);nodes.set(id,input);
    }
    const retry=nodes.get('retryDay');if(retry)retry.dataset.dayAction='retry';const remove=nodes.get('deleteDay');if(remove)remove.dataset.dayAction='delete';parseButtons(markup,'dayContent');
  }
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){assert.ok(!nodes.has(match[1]),'unique initial IDs');const n=node(match[1]);n.tagName=match[0].match(/^<(\w+)/)?.[1]?.toUpperCase();n.hidden=/\bhidden\b/.test(match[0]);for(const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)){n.attrs[attr[1]]=decode(attr[2]);if(attr[1].startsWith('data-'))n.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=decode(attr[2]);}nodes.set(n.id,n);}
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
  const window={innerWidth:smallScreen?390:1440,innerHeight:900,PawsEodReport:reportUtility,events:{},matchMedia:query=>({matches:query.includes('max-width')?smallScreen:reducedMotion}),addEventListener(type,fn){(this.events[type]||=[]).push(fn);},print(){api.prints.push({content:nodes.get('weekReportPrint')?.innerHTML||'',scales:(nodes.get('weekReportPrint')?.printPages||[]).map(page=>page.style['--eod-print-scale']),reportClass:document.body.classList.contains('eod-print-report'),calls:api.calls.length});}};
  const objectURL={createObjectURL(blob){const url=`blob:fixture-${api.urls.size+1}`;api.urls.set(url,blob);return url;},revokeObjectURL(url){api.revoked.push(url);}};
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,Intl,Blob,URL:objectURL,console,crypto:{randomUUID:()=>uuid(nextID++)},setInterval(){},setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout(id){timers.delete(id);}});
  const marker="  if (document.readyState==='loading')";assert.equal(source.split(marker).length,2);
  vm.runInContext(source.replace(marker,`  window.hooks={state,reportState,reportWindowState,jumpState,init,easternToday,validDate,shiftDate,weekDates,rangeLabel,parseJumpDate,formatJumpDate,toggleJumpCalendar,renderJumpCalendar,jumpCalendarKey,commitJumpDate,parseMoney,parseQuantity,quantityValue,quantityInputValue,centsText,currency,sumMoney,hasActivity,dirty,unfinished,editorForDate,render,renderForm,renderWeek,renderCalculations,takeInput,changedPatch,selectDate,loadWeek,saveEditor,deleteDay,restoreDay,reloadDay,resetAuth,openReport,prepareReport,outputReport,closeReport,chooseReportDate,calendarKey,reportRangeError,renderCalendar,toggleReportDates,updateReportRange,fitPrintPages,resetReportWindow,toggleReportExpanded,clampReportPosition,startReportDrag,moveReportDrag,endReportDrag};\n${marker}`),context);app=window.hooks;
  return {app,api,nodes,inputs,buttons,document,window,timers,get:id=>nodes.get(id),async start(){app.init();await until(()=>!app.state.loading);},input(key,value){const input=inputs.get(key);assert.ok(input,`input ${key} exists`);input.focus();input.value=value;app.takeInput(input);return input;},save(date=app.state.selectedDate){return app.saveEditor(app.state.editors.get(date));},signOut(){api.session=null;for(const fn of api.callbacks)fn('SIGNED_OUT',null);},runTimers(delay){for(const [id,item]of [...timers])if(item.delay===delay){timers.delete(id);item.fn();}}};
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
  const h=environment();await h.start();assert.deepEqual([...h.inputs.keys()].sort(),[...fields].sort());assert.equal(h.inputs.has('drawer_total'),false);assert.equal(h.inputs.has('total_deposit'),false);assert.ok(h.get('drawerTotal'));assert.ok(h.get('depositTotal'));assert.match(h.get('dayContent').innerHTML,/[Nn]umber of bills.*coins/);assert.match(h.get('dayContent').innerHTML,/Additional note from the original log/);
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
  h.input('bills_20','10');assert.equal(h.get('drawerBalance').dataset.state,'met');h.input('bills_20','11');assert.equal(h.get('drawerBalance').dataset.state,'over');assert.match(h.get('drawerBalance').textContent,/\$20.00/);assert.equal(h.get('drawerTotal').textContent,'$220.00');
});
test('recorded deposit mismatch is visible and no-op or notes-only saves preserve the imported literals',async()=>{
  const original=record({cash_deposit:'10.00',check_deposit:'20',total_deposit:'29.50',drawer_total:'200',bills_20:'200',source_values:allFields.map(key=>`Original ${key}`),source_column:7,source_date:'10/13/2026'});const h=environment({records:[original]});await h.start();assert.equal(h.get('depositTotal').textContent,'$30.00');assert.equal(h.get('depositRecorded').hidden,false);assert.match(h.get('depositRecorded').textContent,/\$29.50/);assert.match(h.get('weekRows').innerHTML,/\$29.50/);
  await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);h.input('notes','  Follow up with a manager\nKeep the original totals  ');await h.save();const saved=h.api.records[0];assert.equal(saved.total_deposit,'29.50');assert.equal(saved.drawer_total,'200');assert.deepEqual(saved.source_values,original.source_values);assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{notes:'  Follow up with a manager\nKeep the original totals  '});
});
test('changing a denomination recalculates only the drawer and changing a deposit recalculates only deposit',async()=>{
  const h=environment({records:[record({bills_20:'200',drawer_total:'200',cash_deposit:'10',check_deposit:'20',total_deposit:'29.50'})]});await h.start();h.input('bills_20','11');await h.save();assert.equal(h.api.records[0].drawer_total,'220.00');assert.equal(h.api.records[0].total_deposit,'29.50');assert.equal(h.api.records[0].bills_20,'220.00');
  h.input('cash_deposit','10.01');await h.save();assert.equal(h.api.records[0].total_deposit,'30.01');assert.equal(h.api.records[0].drawer_total,'220.00');assert.ok(h.api.calls.filter(call=>call.op==='update').every(call=>computed.every(key=>!(key in call.payload))));
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
test('Go to date accepts typed US and ISO dates while rejecting invalid calendar dates',async()=>{
  const h=environment();await h.start();
  for(const [value,date]of [['2026-10-02','2026-10-02'],['10/2/2026','2026-10-02'],[' 1-3-2027 ','2027-01-03'],['2.29.2024','2024-02-29'],['12/31/9999','9999-12-31']])assert.equal(h.app.parseJumpDate(value),date,value);
  for(const value of ['', '10/2/26','2/29/2026','4/31/2026','13/1/2026','0/1/2026','1/0/2026','2026-02-30','1/1/0999','1/1/10000','next Tuesday'])assert.equal(h.app.parseJumpDate(value),'',value);
  assert.equal(h.app.formatJumpDate('2026-10-02'),'10/02/2026');assert.match(html,/<input\b[^>]*id="jumpDate"[^>]*type="text"/);assert.ok(h.get('openDateCalendar'));assert.ok(h.get('jumpDatePicker'));
});
test('Go to date preserves direct typing using change or Enter and normalizes the displayed date',async()=>{
  const h=environment();await h.start();assert.equal(h.get('jumpDate').value,'10/13/2026');
  h.get('jumpDate').value='11/6/2026';await h.get('jumpDate').emit('change');assert.equal(h.app.state.weekEnd,'2026-11-06');assert.equal(h.app.state.selectedDate,'2026-11-06');assert.equal(h.get('jumpDate').value,'11/06/2026');
  let prevented=false;h.get('jumpDate').value='2027-01-03';await h.get('jumpDate').emit('keydown',{key:'Enter',preventDefault(){prevented=true;}});await until(()=>!h.app.state.loading);assert.equal(prevented,true);assert.equal(h.app.state.weekEnd,'2027-01-03');assert.equal(h.app.state.selectedDate,'2027-01-03');assert.equal(h.get('jumpDate').value,'01/03/2027');assert.equal(h.get('dayPanel').scrolled.block,'start');
});
test('Go to date opens a graphical calendar at the current date with month and year controls',async()=>{
  const h=environment();await h.start();h.get('openDateCalendar').focus();await h.get('openDateCalendar').emit('click');assert.equal(h.get('jumpDatePicker').hidden,false);assert.equal(h.get('openDateCalendar').attrs['aria-expanded'],'true');assert.equal(h.app.jumpState.month,'2026-10-01');assert.equal(h.app.jumpState.focusDate,'2026-10-13');assert.equal(h.document.activeElement?.id,'eod-jump-2026-10-13');assert.match(h.get('jumpCalendar').innerHTML,/<button[^>]*data-jump-date="2026-10-13"[^>]*aria-selected="true"/);assert.equal(h.get('jumpMonth').value,'10');assert.equal(h.get('jumpYear').value,'2026');
  h.get('jumpMonth').value='02';await h.get('jumpMonth').emit('change');assert.equal(h.app.jumpState.month,'2026-02-01');h.get('jumpYear').value='2024';await h.get('jumpYear').emit('change');assert.equal(h.app.jumpState.month,'2024-02-01');assert.ok(h.get('eod-jump-2024-02-29'));
  const next=h.get('jumpNextMonth');assert.ok(next);await h.get('jumpDatePicker').emit('click',{target:next});assert.equal(h.app.jumpState.month,'2024-03-01');
});
test('choosing a calendar day navigates and closes the calendar without discarding another day’s invalid draft',async()=>{
  const h=environment();await h.start();h.input('cash_received','bad amount');await h.save();h.document.activeElement=null;await h.get('openDateCalendar').emit('click');const day=h.get('eod-jump-2026-10-06');assert.ok(day);await h.get('jumpDatePicker').emit('click',{target:day});await until(()=>!h.app.state.loading);assert.equal(h.app.state.weekEnd,'2026-10-06');assert.equal(h.app.state.selectedDate,'2026-10-06');assert.equal(h.get('jumpDatePicker').hidden,true);assert.equal(h.get('jumpDate').value,'10/06/2026');assert.equal(h.app.state.editors.get('2026-10-13').values.cash_received,'bad amount');assert.equal(h.api.calls.filter(call=>call.op==='insert'||call.op==='update').length,0);
});
test('Go to date keyboard navigation handles week and month boundaries including leap years',async()=>{
  const h=environment();await h.start();h.app.toggleJumpCalendar(true);
  function press(date,key){h.app.jumpState.month=date.slice(0,7)+'-01';h.app.jumpState.focusDate=date;h.app.renderJumpCalendar();let prevented=false;h.app.jumpCalendarKey({target:h.get(`eod-jump-${date}`),key,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.document.activeElement?.id,`eod-jump-${h.app.jumpState.focusDate}`);return h.app.jumpState.focusDate;}
  assert.equal(press('2026-12-31','ArrowRight'),'2027-01-01');assert.equal(h.app.jumpState.month,'2027-01-01');assert.equal(press('2026-10-01','ArrowUp'),'2026-09-24');assert.equal(press('2026-10-13','Home'),'2026-10-12');assert.equal(press('2026-10-13','End'),'2026-10-18');assert.equal(press('2026-01-31','PageDown'),'2026-02-28');assert.equal(press('2024-03-31','PageUp'),'2024-02-29');assert.equal(h.app.state.weekEnd,'2026-10-13');
});
test('an invalid typed jump stays visible with a helpful error and makes no record queries',async()=>{
  const h=environment();await h.start();const count=h.api.calls.length;h.get('jumpDate').value='02/30/2026';await h.get('jumpDate').emit('change');assert.equal(h.get('jumpDate').attrs['aria-invalid'],'true');assert.equal(h.get('jumpDate').value,'02/30/2026');assert.equal(h.app.state.weekEnd,'2026-10-13');assert.equal(h.api.calls.length,count);assert.ok(h.app.jumpState.invalid);h.app.renderWeek();assert.equal(h.get('jumpDate').value,'02/30/2026');
  h.get('jumpDate').value='2/28/2026';await h.get('jumpDate').emit('change');assert.notEqual(h.get('jumpDate').attrs['aria-invalid'],'true');assert.equal(h.app.state.weekEnd,'2026-02-28');assert.equal(h.get('jumpDate').value,'02/28/2026');
});
test('Go to date closes on Escape, outside interaction, page exit, workspace revocation and auth reset',async()=>{
  for(const action of ['escape','pointerdown','focusin','pagehide','paws-access-revoked','reset']){
    const h=environment();await h.start();h.app.toggleJumpCalendar(true);assert.equal(h.get('jumpDatePicker').hidden,false);
    if(action==='escape'){let prevented=false;await h.get('dateJump').emit('keydown',{key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.document.activeElement,h.get('jumpDate'));}
    else if(action==='reset')h.app.resetAuth(null);
    else if(['pointerdown','focusin'].includes(action))await h.document.emit(action,{target:h.get('pageMessage')});
    else for(const handler of h.window.events[action]||[])handler({detail:{status:'revoked'}});
    assert.equal(h.get('jumpDatePicker').hidden,true,action);assert.equal(h.get('openDateCalendar').attrs['aria-expanded'],'false',action);
  }
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
  for(const anonymous of [false,true]){const h=environment({active:false});if(anonymous)h.api.session=null;await h.start();assert.equal(h.api.calls.filter(call=>call.table==='hq_end_of_day').length,0);assert.equal(h.inputs.size,0);assert.equal(h.get('goToday').disabled,true);assert.equal(h.get('openDateCalendar').disabled,true);h.app.toggleJumpCalendar(true);assert.equal(h.get('jumpDatePicker').hidden,true);}
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

test('Export opens the selected seven-day report with a fresh, accessible preview and both output choices',async()=>{
  const h=environment();await h.start();await h.app.selectDate('2026-10-06',{week:true});const baseline=h.api.calls.length;h.get('openWeekReport').focus();await h.get('openWeekReport').emit('click');
  assert.match(html,/<button\b[^>]*id="openWeekReport"[^>]*>Export\s*<svg/);assert.equal(h.get('weekReport').open,true);assert.equal(h.app.reportState.start,'2026-09-30');assert.equal(h.app.reportState.end,'2026-10-06');assert.equal(h.app.reportState.model.days.length,7);assert.equal(h.app.reportState.busy,false);assert.equal(h.get('weekReportContent').hidden,false);assert.equal(h.get('weekReportContent').attrs.role,'region');assert.match(h.get('weekReportContent').attrs['aria-label'],/preview/i);assert.match(h.get('weekReportContent').innerHTML,/2026-10-06/);assert.equal(h.get('reportMessage').textContent,'');assert.equal(h.get('printReport').disabled,false);assert.equal(h.get('downloadReport').disabled,false);
  for(const id of ['reportStartDate','reportEndDate','applyReportDates','cancelReportDates'])assert.equal(h.get(id),undefined,`${id} is no longer a redundant control`);
  assert.equal((html.match(/id="reportCalendar"/g)||[]).length,1);assert.ok(h.get('reportLastSeven'));assert.ok(h.get('selectReportDates'));const reads=h.api.calls.slice(baseline);assert.equal(reads[0].table,'hq_tour_staff');assert.equal(reads.at(-1).table,'hq_end_of_day');assert.ok(reads.every(call=>call.op==='select'));
  h.app.closeReport();assert.equal(h.get('weekReport').open,false);assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.document.activeElement,h.get('openWeekReport'));
});

test('a single graphical calendar applies forward, backward and single-day ranges and refreshes the preview after the second selection',async()=>{
  const h=environment();await h.start();await h.app.openReport();
  for(const [first,last,expectedStart,expectedEnd]of [['2026-10-01','2026-10-03','2026-10-01','2026-10-03'],['2026-10-08','2026-10-02','2026-10-02','2026-10-08'],['2026-10-04','2026-10-04','2026-10-04','2026-10-04']]){
    const previousStart=h.app.reportState.start,previousEnd=h.app.reportState.end,baseline=h.api.calls.length;await h.get('selectReportDates').emit('click');assert.equal(h.get('reportDatePicker').hidden,false);assert.equal(h.document.activeElement?.id,`eod-calendar-${previousStart}`);assert.equal((h.get('reportCalendar').innerHTML.match(/tabindex="0"/g)||[]).length,1);assert.equal((h.get('reportCalendar').innerHTML.match(/class="eod-calendar-month"/g)||[]).length,1);assert.equal((h.get('reportCalendar').innerHTML.match(/role="grid"/g)||[]).length,1);
    await h.app.chooseReportDate(first);assert.equal(h.app.reportState.selecting,true);assert.equal(h.app.reportState.start,previousStart);assert.equal(h.app.reportState.end,previousEnd);assert.equal(h.get('reportDatePicker').hidden,false);assert.equal(h.api.calls.length,baseline);await h.app.chooseReportDate(last);
    assert.equal(h.app.reportState.start,expectedStart);assert.equal(h.app.reportState.end,expectedEnd);assert.equal(h.app.reportState.selecting,false);assert.equal(h.get('reportDatePicker').hidden,true);assert.equal(h.document.activeElement,h.get('selectReportDates'));assert.equal(h.app.reportState.model.start,expectedStart);assert.equal(h.app.reportState.model.end,expectedEnd);assert.match(h.get('weekReportContent').innerHTML,new RegExp(expectedStart));assert.match(h.get('weekReportContent').innerHTML,new RegExp(expectedEnd));assert.equal(h.api.calls.slice(baseline).filter(call=>call.table==='hq_end_of_day').length,1);
  }
});

test('cross-month selection and Last 7 days refresh the preview without changing the editing week',async()=>{
  const h=environment();await h.start();await h.app.selectDate('2026-09-29',{week:true});await h.app.openReport();const baseline=h.api.calls.length;h.app.toggleReportDates(true);await h.app.chooseReportDate('2026-09-29');
  const next=h.buttons.find(button=>button.parent==='reportCalendar'&&button.dataset.calendarStep==='1');await h.get('reportCalendar').emit('click',{target:next});assert.equal(h.app.reportState.month,'2026-10-01');assert.equal(h.app.reportState.pendingStart,'2026-09-29');assert.equal(h.app.reportState.selecting,true);await h.app.chooseReportDate('2026-10-04');assert.equal(h.app.reportState.start,'2026-09-29');assert.equal(h.app.reportState.end,'2026-10-04');assert.equal(h.app.reportState.model.days.length,6);assert.equal(h.get('reportDatePicker').hidden,true);
  await h.get('reportLastSeven').emit('click');assert.equal(h.app.reportState.start,'2026-10-07');assert.equal(h.app.reportState.end,'2026-10-13');assert.equal(h.app.state.weekEnd,'2026-09-29');assert.equal(h.app.reportState.model.days.length,7);assert.match(h.get('weekReportContent').innerHTML,/2026-10-13/);assert.equal(h.api.calls.slice(baseline).filter(call=>call.table==='hq_end_of_day').length,2);
  h.app.toggleReportDates(true);await h.app.chooseReportDate('2026-10-01');await h.get('reportLastSeven').emit('click');assert.equal(h.get('reportDatePicker').hidden,true);assert.equal(h.app.reportState.selecting,false);assert.equal(h.app.reportState.model.start,'2026-10-07');assert.equal(h.app.reportState.model.end,'2026-10-13');
});

test('the one-month range calendar supports keyboard days, weeks and months with clamped month-end dates',async()=>{
  for(const smallScreen of [false,true]){
    const h=environment({smallScreen});await h.start();await h.app.openReport();h.app.toggleReportDates(true);
    function press(date,key){h.app.reportState.month=date.slice(0,7)+'-01';h.app.reportState.focusDate=date;h.app.renderCalendar();let prevented=false;h.app.calendarKey({target:h.get(`eod-calendar-${date}`),key,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.document.activeElement?.id,`eod-calendar-${h.app.reportState.focusDate}`);assert.equal((h.get('reportCalendar').innerHTML.match(/role="grid"/g)||[]).length,1);return h.app.reportState.focusDate;}
    assert.equal(press('2026-10-13','ArrowLeft'),'2026-10-12');assert.equal(press('2026-10-13','ArrowDown'),'2026-10-20');assert.equal(press('2026-10-13','Home'),'2026-10-12');assert.equal(press('2026-10-13','End'),'2026-10-18');assert.equal(press('2026-01-31','PageDown'),'2026-02-28');assert.equal(press('2024-03-31','PageUp'),'2024-02-29');assert.equal(press('2026-12-31','ArrowRight'),'2027-01-01');assert.equal(h.app.reportState.month,'2027-01-01');
  }
});

test('Escape dismisses only the range calendar and preserves the chosen dates and preview',async()=>{
  const h=environment();await h.start();await h.app.openReport();const preview=h.get('weekReportContent').innerHTML,baseline=h.api.calls.length;h.app.toggleReportDates(true);await h.app.chooseReportDate('2026-10-01');let prevented=false;
  await h.get('weekReport').emit('cancel',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.get('reportDatePicker').hidden,true);assert.equal(h.get('weekReport').open,true);assert.equal(h.app.reportState.start,'2026-10-07');assert.equal(h.app.reportState.end,'2026-10-13');assert.equal(h.document.activeElement,h.get('selectReportDates'));assert.equal(h.get('weekReportContent').innerHTML,preview);assert.equal(h.api.calls.length,baseline);
});

test('invalid and over-year report ranges are explained without fetching records or replacing selected dates',async()=>{
  const h=environment();await h.start();await h.app.openReport();const count=h.api.calls.length;
  for(const [start,end]of [['','2026-10-13'],['2026-02-29','2026-03-01'],['2026-10-14','2026-10-13'],['2024-01-01','2025-01-01']]){assert.ok(h.app.reportRangeError(start,end));h.app.updateReportRange(start,end);assert.equal(h.app.reportState.start,'2026-10-07');assert.equal(h.app.reportState.end,'2026-10-13');assert.equal(await h.app.prepareReport(start,end),null);assert.equal(h.get('reportMessage').classes.has('is-error'),true);}
  assert.equal(h.api.calls.length,count);assert.equal(h.app.reportRangeError('2024-01-01','2024-12-31'),'');assert.equal(h.app.reportRangeError('2024-02-29','2024-02-29'),'');
});

test('changing selected dates immediately clears the old preview before replacement data is requested',async()=>{
  const h=environment();await h.start();await h.app.openReport();assert.ok(h.app.reportState.model);assert.notEqual(h.get('weekReportContent').innerHTML,'');const baseline=h.api.calls.length;
  h.app.updateReportRange('2026-10-01','2026-10-02');assert.equal(h.app.reportState.start,'2026-10-01');assert.equal(h.app.reportState.end,'2026-10-02');assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.get('reportMessage').textContent,'');assert.equal(h.api.calls.length,baseline);
});

test('opening a preview waits for an in-flight draft save before a fresh narrow saved-record query',async()=>{
  const h=environment();await h.start();const gate=deferred();let pending;h.api.intercept=call=>{if(call.op==='update'){pending=call;return gate.promise;}};
  h.input('notes','Recently typed draft');const saving=h.save();await until(()=>pending);const baseline=h.api.calls.length,opening=h.app.openReport();await Promise.resolve();await Promise.resolve();assert.equal(h.app.reportState.busy,true);assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.api.calls.slice(baseline).filter(call=>call.table==='hq_end_of_day').length,0);
  h.api.records[0]={...h.api.records[0],...pending.payload,revision:2};gate.resolve({data:clone(h.api.records[0]),error:null});await saving;await opening;
  assert.equal(h.app.reportState.model.days.at(-1).values.notes,'Recently typed draft');assert.equal(h.api.downloads.length,0);assert.equal(h.api.prints.length,0);assert.match(h.get('weekReportContent').innerHTML,/Recently typed draft/);const reads=h.api.calls.slice(baseline).filter(call=>call.table==='hq_end_of_day');assert.equal(reads.length,1);assert.equal(reads[0].op,'select');assert.deepEqual(reads[0].filters,[['gte','entry_date','2026-10-07'],['lte','entry_date','2026-10-13']]);assert.deepEqual(reads[0].range,[0,499]);
});

test('invalid or conflicting entries prevent previews and both outputs instead of displaying stale saved data',async()=>{
  for(const mode of ['invalid','conflict']){
    const h=environment();await h.start();h.input(mode==='invalid'?'cash_received':'notes',mode==='invalid'?'12.345':'Conflicting draft');if(mode==='conflict'){const editor=h.app.state.editors.get(h.app.state.selectedDate);editor.conflict=true;editor.error='This day changed on another device.';}
    const baseline=h.api.calls.length;await h.app.openReport();assert.equal(h.app.reportState.model,null);assert.match(h.get('reportMessage').textContent,/Finish saving/);assert.equal(h.get('weekReportContent').innerHTML,'');await h.app.outputReport('csv');await h.app.outputReport('print');assert.equal(h.api.prints.length,0);assert.equal(h.api.downloads.length,0);assert.equal(h.api.calls.slice(baseline).filter(call=>call.table==='hq_end_of_day').length,0);
  }
});

test('the preview and CSV include every date and original totals while blanking deleted details and never writing records',async()=>{
  const h=environment({records:[record({drawer_total:'199.99',bills_20:'200',cash_deposit:'10',check_deposit:'20',total_deposit:'29.50',notes:'Saved note'}),record({id:uuid(12),entry_date:'2026-10-12',staff_name:'Deleted closer',cash_received:'987.65',notes:'Deleted secret',deleted_at:'2026-10-13T12:00:00Z'})]});await h.start();const before=clone(h.api.records),baseline=h.api.calls.length;await h.app.openReport();await h.app.outputReport('csv');
  const days=h.app.reportState.model.days,active=days.at(-1),deleted=days.at(-2);assert.equal(days.length,7);assert.equal(active.values.drawer_total,'199.99');assert.equal(active.values.total_deposit,'29.50');assert.equal(deleted.status,'Deleted');assert.ok(Object.values(deleted.values).every(value=>value===''));assert.equal(days[0].status,'No entry');assert.doesNotMatch(h.get('weekReportContent').innerHTML,/Deleted closer|987\.65|Deleted secret/);assert.deepEqual(h.api.records,before);assert.ok(h.api.calls.slice(baseline).every(call=>call.op==='select'));const csv=await h.api.downloads[0].blob.text();assert.doesNotMatch(csv,/Deleted closer|987\.65|Deleted secret/);for(let day=7;day<=13;day++){const date=new RegExp(`2026-10-${String(day).padStart(2,'0')}`);assert.match(csv,date);assert.match(h.get('weekReportContent').innerHTML,date);}
});

test('a failed fresh report fetch clears the earlier preview and cannot reuse old data for either output',async()=>{
  const h=environment();await h.start();await h.app.openReport();assert.ok(h.app.reportState.model);h.api.intercept=call=>call.table==='hq_end_of_day'?{data:null,error:{code:'NETWORK'}}:undefined;
  for(const kind of ['csv','print']){await h.app.outputReport(kind);assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.match(h.get('reportMessage').textContent,/Could not load/);assert.equal(h.api.prints.length,0);assert.equal(h.api.downloads.length,0);assert.equal(h.app.reportState.busy,false);}
});

test('sign-out or closing the dialog while loading previews or outputs discards late private results',async()=>{
  for(const action of ['sign-out','close'])for(const stage of ['preview','csv','print']){
    const h=environment();await h.start();if(stage!=='preview')await h.app.openReport();const gate=deferred();let pending=false;h.api.intercept=call=>{if(call.table==='hq_end_of_day'){pending=true;return gate.promise;}};const operation=stage==='preview'?h.app.openReport():h.app.outputReport(stage);await until(()=>pending);if(action==='sign-out')h.signOut();else h.app.closeReport();gate.resolve({data:[record({notes:'Late private financial note'})],error:null});await operation;
    assert.equal(h.app.reportState.model,null);assert.equal(h.app.reportState.busy,false);assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.get('weekReport').open,false);assert.equal(h.api.downloads.length,0);assert.equal(h.api.prints.length,0);
  }
});

test('each CSV and print rechecks access and saved data instead of using the earlier preview snapshot',async()=>{
  for(const kind of ['csv','print']){
    const h=environment();await h.start();await h.app.openReport();const baseline=h.api.calls.length;h.api.records[0].notes='Saved from another device';await h.app.outputReport(kind);const fresh=h.api.calls.slice(baseline);assert.equal(fresh[0].table,'hq_tour_staff');assert.equal(fresh.at(-1).table,'hq_end_of_day');assert.match(h.get('weekReportContent').innerHTML,/Saved from another device/);
    if(kind==='csv'){assert.equal(h.api.downloads.length,1);assert.match(await h.api.downloads[0].blob.text(),/Saved from another device/);assert.equal(h.api.prints.length,0);}else {assert.equal(h.api.prints.length,1);assert.match(h.api.prints[0].content,/Saved from another device/);assert.equal(h.api.prints[0].reportClass,true);assert.equal(h.app.reportState.printing,true);for(const handler of h.window.events.afterprint||[])handler({});assert.equal(h.app.reportState.printing,false);assert.ok(h.app.reportState.model);assert.match(h.get('weekReportContent').innerHTML,/Saved from another device/);}
    h.api.active=false;await h.app.outputReport(kind);assert.equal(h.api.downloads.length,kind==='csv'?1:0);assert.equal(h.api.prints.length,kind==='print'?1:0);assert.equal(h.app.reportState.model,null);assert.equal(h.app.state.ready,false);assert.equal(h.get('weekReportContent').innerHTML,'');assert.match(h.get('reportMessage').textContent,/workspace access/);
  }
});

test('CSV filename and content reflect the selected range, preserve the preview and promptly revoke object URLs',async()=>{
  const h=environment({records:[record({notes:'CSV fixture, "quoted"\nSecond line',cash_received:'0',checks_received:'',total_deposit:'29.50'})]});await h.start();await h.app.openReport();h.app.updateReportRange('2026-10-12','2026-10-13');await h.app.outputReport('csv');
  assert.equal(h.api.downloads.length,1);const download=h.api.downloads[0];assert.equal(download.filename,'paws-end-of-day_2026-10-12_to_2026-10-13.csv');assert.equal(download.blob.type,'text/csv;charset=utf-8;');const bytes=new Uint8Array(await download.blob.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);const output=await download.blob.text();assert.match(output,/"2026-10-12","No entry"/);assert.match(output,/"2026-10-13","Recorded"/);assert.match(output,/CSV fixture, ""quoted""\nSecond line/);assert.match(output,/29\.50/);assert.doesNotMatch(output,/source_values|created_by/);assert.equal(h.app.reportState.urls.size,1);assert.ok(h.app.reportState.model);assert.match(h.get('weekReportContent').innerHTML,/CSV fixture/);
  h.runTimers(1000);assert.ok(h.api.revoked.includes(download.href));assert.equal(h.app.reportState.urls.size,0);await h.app.outputReport('csv');const next=h.api.downloads.at(-1);h.app.closeReport();assert.ok(h.api.revoked.includes(next.href));assert.equal(h.app.reportState.urls.size,0);assert.equal(h.get('weekReportContent').innerHTML,'');
});

test('an unrelated unsaved week does not block another date range from being previewed or exported',async()=>{
  const h=environment({records:[record(),record({id:uuid(12),entry_date:'2026-10-06',notes:'Prior saved week'})]});await h.start();h.input('cash_received','invalid');await h.app.selectDate('2026-10-06',{week:true});const baseline=h.api.calls.length;await h.app.openReport();assert.equal(h.app.reportState.model.start,'2026-09-30');assert.match(h.get('weekReportContent').innerHTML,/Prior saved week/);await h.app.outputReport('csv');assert.equal(h.api.downloads.length,1);assert.match(await h.api.downloads[0].blob.text(),/Prior saved week/);assert.equal(h.app.state.editors.get('2026-10-13').values.cash_received,'invalid');assert.ok(h.api.calls.slice(baseline).every(call=>call.op==='select'));
});

test('workspace revocation and leaving the page discard delayed outputs and previews without signing out or clearing drafts',async()=>{
  for(const event of ['paws-access-revoked','pagehide'])for(const kind of ['csv','print']){
    const h=environment({records:[record({notes:'Initially private report details'})]});await h.start();await h.app.openReport();await h.app.outputReport('csv');const previousURL=h.api.downloads[0].href;
    h.input('notes','Operational draft to preserve');const gate=deferred();let pending=false;h.api.intercept=call=>{if(call.table==='hq_end_of_day'&&call.op==='select'){pending=true;return gate.promise;}};
    const output=h.app.outputReport(kind);await until(()=>pending);const request=h.app.reportState.request,session=h.api.session;
    assert.ok(h.window.events[event]?.length,`${event} is handled`);for(const handler of h.window.events[event])handler({detail:{status:'revoked'}});
    assert.equal(h.get('weekReport').open,false);assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.ok(h.app.reportState.request>request);assert.equal(h.app.reportState.busy,false);assert.ok(h.api.revoked.includes(previousURL));assert.equal(h.app.reportState.urls.size,0);assert.equal(h.api.session,session);assert.equal(h.app.state.editors.get('2026-10-13').values.notes,'Operational draft to preserve');
    gate.resolve({data:[record({notes:'Late private data must be discarded'})],error:null});await output;assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.api.prints.length,0);assert.equal(h.api.downloads.length,1);
  }
});

test('dedicated print styles activate only for a fresh report print and normal browser printing preserves the preview',async()=>{
  const h=environment({records:[record({notes:'Visible private preview details',cash_received:'123456.78'})]});await h.start();await h.app.openReport();const preview=h.get('weekReportContent').innerHTML;assert.match(preview,/Visible private preview details/);assert.equal(h.app.reportState.printing,false);assert.equal(h.document.body.classList.contains('eod-print-report'),false);
  for(const handler of h.window.events.beforeprint||[])handler({});assert.equal(h.get('weekReportContent').innerHTML,preview);assert.equal(h.document.body.classList.contains('eod-print-report'),false);for(const handler of h.window.events.afterprint||[])handler({});assert.equal(h.get('weekReportContent').innerHTML,preview);
  await h.app.outputReport('print');assert.equal(h.api.prints.length,1);assert.equal(h.api.prints[0].reportClass,true);assert.equal(h.app.reportState.printing,true);for(const handler of h.window.events.afterprint||[])handler({});assert.equal(h.document.body.classList.contains('eod-print-report'),false);assert.equal(h.app.reportState.printing,false);assert.equal(h.get('weekReportContent').innerHTML,preview);
  for(const handler of h.window.events['paws-access-revoked'])handler({detail:{status:'revoked'}});for(const handler of h.window.events.beforeprint||[])handler({});assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.document.body.classList.contains('eod-print-report'),false);for(const handler of h.window.events.afterprint||[])handler({});assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.api.prints.length,1);
});

test('closing or revoking access between preparation and the output continuation cannot release private data',async()=>{
  for(const action of ['close','revoked','sign-out'])for(const kind of ['csv','print']){
    const h=environment();await h.start();await h.app.openReport();h.window.PawsEodReport={...reportUtility,createReport(options){const report=reportUtility.createReport(options);Promise.resolve().then(()=>{if(action==='close')h.app.closeReport();else if(action==='sign-out')h.signOut();else for(const handler of h.window.events['paws-access-revoked'])handler({detail:{status:'revoked'}});});return report;}};
    await h.app.outputReport(kind);assert.equal(h.get('weekReport').open,false);assert.equal(h.app.reportState.model,null);assert.equal(h.api.downloads.length,0,`${action} prevents ${kind}`);assert.equal(h.api.prints.length,0,`${action} prevents ${kind}`);assert.equal(h.get('weekReportContent').innerHTML,'');
  }
});

test('whole denomination counts multiply into exact cents for every bill and coin',async()=>{
  const h=environment();await h.start();
  for(const [key,unit]of Object.entries(denominationCents)){
    for(const count of [0n,1n,3n,127n]){const parsed=h.app.parseQuantity(key,String(count));assert.equal(parsed.valid,true,`${key} ${count}`);assert.equal(parsed.quantity,count);assert.equal(parsed.cents,count*unit);}
    const maximum=99999999999n/unit;assert.equal(h.app.parseQuantity(key,String(maximum)).valid,true,key);assert.equal(h.app.parseQuantity(key,String(maximum)).cents,maximum*unit);assert.equal(h.app.parseQuantity(key,String(maximum+1n)).valid,false,key);
  }
  assert.equal(h.app.parseQuantity('dimes','3').cents,30n);assert.equal(h.app.parseQuantity('quarters','3').cents,75n);assert.equal(h.app.parseQuantity('pennies','7').cents,7n);
});

test('quantity parser accepts forgiving whole counts but rejects fractions, negatives and ambiguous values',async()=>{
  const h=environment();await h.start();
  for(const [value,quantity]of [['0',0n],[' 0002 ',2n],['+2',2n],['2.0',2n],['1,000',1000n],['+1,234.00',1234n]]){const parsed=h.app.parseQuantity('pennies',value);assert.equal(parsed.valid,true,value);assert.equal(parsed.quantity,quantity);assert.equal(parsed.cents,quantity);}
  for(const value of ['', '  ']){const parsed=h.app.parseQuantity('quarters',value);assert.equal(parsed.valid,true);assert.equal(parsed.quantity,null);assert.equal(parsed.cents,null);}
  for(const value of ['-1','-0','1.5','0.01','1e3','$2','1 000','1,00','1,0000','1,234,56','NaN','Infinity','two','++2','2.00.0'])assert.equal(h.app.parseQuantity('bills_20',value).valid,false,value);
});

test('stored denomination amounts become whole displayed counts only when exactly representable',async()=>{
  const h=environment();await h.start();
  for(const [key,amount,count]of [['bills_20','200','10'],['bills_100',' $1,000.00 ','10'],['quarters','1.00','4'],['dimes','0.30','3'],['nickels','0.15','3'],['pennies','0.07','7'],['bills_50','0.00','0'],['quarters','','']])assert.equal(h.app.quantityValue(key,amount),count,`${key} ${amount}`);
  for(const [key,amount]of [['bills_20','190'],['quarters','1.10'],['dimes','0.35'],['pennies','-0.01'],['bills_1','legacy text']])assert.equal(h.app.quantityValue(key,amount),null,`${key} ${amount}`);
});

test('drawer inputs ask for counts while other money fields still ask for dollar amounts',async()=>{
  const h=environment({records:[record({bills_20:'200',quarters:'1.00'})]});await h.start();
  for(const key of denoms){const input=h.inputs.get(key);assert.equal(input.quantity,true,key);assert.equal(input.attrs.inputmode,'numeric',key);assert.equal(input.attrs.placeholder,'0',key);}
  assert.equal(h.inputs.get('bills_20').value,'10');assert.equal(h.inputs.get('quarters').value,'4');assert.equal(h.inputs.get('cash_received').quantity,false);assert.equal(h.inputs.get('cash_received').attrs.inputmode,'decimal');assert.equal(h.inputs.get('cash_received').attrs.placeholder,'0.00');assert.match(h.get('dayContent').innerHTML,/[Nn]umber of bills.*coins/);
});

test('saving all denomination counts writes dollar amounts and leaves total calculation to the server',async()=>{
  const h=environment();await h.start();for(const key of denoms)h.input(key,'3');assert.equal(h.get('drawerTotal').textContent,'$559.23');await h.save();
  const writes=h.api.calls.filter(call=>call.op==='update');assert.equal(writes.length,1);assert.equal('drawer_total'in writes[0].payload,false);assert.equal('total_deposit'in writes[0].payload,false);for(const [key,unit]of Object.entries(denominationCents)){const amount=h.app.centsText(unit*3n);assert.equal(writes[0].payload[key],amount,key);assert.equal(h.api.records[0][key],amount,key);assert.equal(h.app.quantityInputValue(h.app.state.editors.get('2026-10-13'),key),'3',key);}assert.equal(h.api.records[0].drawer_total,'559.23');assert.ok(Object.keys(writes[0].payload).every(key=>denoms.includes(key)));await h.app.openReport();assert.match(h.get('weekReportContent').innerHTML,/\$20 bills \(amount \$\)/);await h.app.outputReport('csv');const csv=await h.api.downloads[0].blob.text();assert.match(csv,/\$20 bills \(amount \$\)/);assert.equal(h.app.reportState.model.days.at(-1).values.bills_20,'60.00');
});

test('zero and blank denomination counts remain distinct after saving',async()=>{
  const h=environment();await h.start();h.input('quarters','0');await h.save();assert.equal(h.api.records[0].quarters,'0.00');assert.equal(h.api.records[0].drawer_total,'0.00');assert.equal(h.inputs.get('quarters').value,'0');
  h.input('quarters','');await h.save();assert.equal(h.api.records[0].quarters,'');assert.equal(h.api.records[0].drawer_total,'');assert.equal(h.inputs.get('quarters').value,'');
});

test('invalid raw counts stay local, block saving and reporting, and suppress the old drawer balance',async()=>{
  for(const invalid of ['-1','1.5','$20','1e2']){
    const h=environment({records:[record({bills_20:'200',drawer_total:'200'})]});await h.start();const editor=h.app.state.editors.get('2026-10-13');h.input('bills_20',invalid);assert.equal(editor.values.bills_20,'200');assert.equal(h.app.quantityInputValue(editor,'bills_20'),invalid);assert.equal(h.app.dirty(editor),true);assert.match(h.get('drawerTotal').textContent,/Check counts/);assert.equal(h.get('drawerBalance').dataset.state,'idle');assert.doesNotMatch(h.get('drawerBalance').textContent,/target met/);await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.get('error-bills_20').hidden,false);assert.equal(h.inputs.get('bills_20').value,invalid);await h.app.openReport();assert.equal(h.app.reportState.model,null);assert.equal(h.get('weekReportContent').innerHTML,'');assert.match(h.get('reportMessage').textContent,/Finish saving/);await h.app.outputReport('csv');await h.app.outputReport('print');assert.equal(h.api.downloads.length,0);assert.equal(h.api.prints.length,0);h.app.closeReport();h.input('bills_20','10');assert.equal(h.app.dirty(editor),false);assert.equal(h.get('error-bills_20').hidden,true);assert.equal(h.get('drawerTotal').textContent,'$200.00');await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);
  }
});

test('invalid quantity drafts survive week navigation and do not become stored dollar amounts',async()=>{
  const h=environment({records:[record({bills_20:'200'}),record({id:uuid(12),entry_date:'2026-10-06'})]});await h.start();h.input('bills_20','2.5');await h.save();h.document.activeElement=null;await h.app.selectDate('2026-10-06',{week:true});assert.equal(h.get('attentionList').hidden,false);assert.equal(h.app.quantityInputValue(h.app.state.editors.get('2026-10-13'),'bills_20'),'2.5');await h.app.selectDate('2026-10-13',{week:true});assert.equal(h.inputs.get('bills_20').value,'2.5');assert.equal(h.api.records.find(row=>row.entry_date==='2026-10-13').bills_20,'200');assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);
});

test('legacy amounts that cannot be whole counts remain visible as saved amounts and are never rounded or patched',async()=>{
  const original=record({bills_20:'190',quarters:'1.10',bills_1:'-3.00',drawer_total:'188.10',source_values:allFields.map(key=>`Original ${key}`)});const h=environment({records:[original]});await h.start();for(const key of ['bills_20','quarters','bills_1'])assert.equal(h.inputs.get(key).value,'',key);assert.match(h.get('amount-bills_20').textContent,/[Ss]aved amount/);assert.match(h.get('amount-bills_20').textContent,/\$190\.00/);assert.match(h.get('amount-quarters').textContent,/\$1\.10/);assert.match(h.get('amount-bills_1').textContent,/-\$3\.00/);await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);h.input('notes','Keep the historic amounts');await h.save();const saved=h.api.records[0];for(const key of ['bills_20','quarters','bills_1','drawer_total'])assert.equal(saved[key],original[key],key);assert.deepEqual(saved.source_values,original.source_values);assert.deepEqual(h.api.calls.find(call=>call.op==='update').payload,{notes:'Keep the historic amounts'});
});

test('re-entering the same count preserves the original stored amount formatting without a write',async()=>{
  const original=record({bills_20:'  $200.00  ',quarters:'1.00',drawer_total:'201.00'});const h=environment({records:[original]});await h.start();h.input('bills_20','+0010.0');const editor=h.app.state.editors.get('2026-10-13');assert.equal(editor.values.bills_20,original.bills_20);assert.equal(h.app.dirty(editor),false);await h.save();assert.equal(h.api.calls.filter(call=>call.op==='update').length,0);assert.equal(h.api.records[0].bills_20,original.bills_20);
});

test('new count input during a save keeps the newer quantity and queues the correct dollar update',async()=>{
  const gate=deferred();let pending;const h=environment({records:[record({bills_20:'200',drawer_total:'200'})],intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();h.input('bills_20','11');const saving=h.save();await until(()=>pending);const input=h.input('bills_20','12');h.api.records[0]={...h.api.records[0],...pending.payload,drawer_total:'220.00',revision:2};gate.resolve({data:clone(h.api.records[0]),error:null});await saving;assert.equal(h.api.records[0].bills_20,'240.00');assert.equal(h.api.records[0].drawer_total,'240.00');assert.equal(h.api.records[0].revision,3);assert.equal(h.app.quantityInputValue(h.app.state.editors.get('2026-10-13'),'bills_20'),'12');assert.equal(input.value,'12');assert.equal(h.document.activeElement,input);const patches=h.api.calls.filter(call=>call.op==='update').map(call=>call.payload);assert.deepEqual(patches,[{bills_20:'220.00'},{bills_20:'240.00'}]);
});

test('an invalid count entered during a save remains an unsaved draft after the earlier valid amount is accepted',async()=>{
  const gate=deferred();let pending;const h=environment({records:[record({bills_20:'200',drawer_total:'200'})],intercept(call){if(call.op==='update'&&!pending){pending=call;return gate.promise;}}});await h.start();h.input('bills_20','11');const saving=h.save();await until(()=>pending);h.input('bills_20','11.5');h.api.records[0]={...h.api.records[0],...pending.payload,drawer_total:'220.00',revision:2};gate.resolve({data:clone(h.api.records[0]),error:null});await saving;const editor=h.app.state.editors.get('2026-10-13');assert.equal(h.api.records[0].bills_20,'220.00');assert.equal(h.api.calls.filter(call=>call.op==='update').length,1);assert.equal(h.app.quantityInputValue(editor,'bills_20'),'11.5');assert.equal(h.inputs.get('bills_20').value,'11.5');assert.equal(h.app.dirty(editor),true);assert.ok(editor.fieldErrors.bills_20);assert.match(h.get('drawerTotal').textContent,/Check counts/);
});

test('a remote denomination update merges into an untouched count field while a different local field saves',async()=>{
  const h=environment({records:[record({bills_20:'200',drawer_total:'200'})]});await h.start();h.input('notes','Local note');h.api.records[0]={...h.api.records[0],bills_20:'220.00',drawer_total:'220.00',revision:2};await h.save();const editor=h.app.state.editors.get('2026-10-13');assert.equal(h.api.records[0].notes,'Local note');assert.equal(h.api.records[0].bills_20,'220.00');assert.equal(h.app.quantityInputValue(editor,'bills_20'),'11');assert.equal(h.inputs.get('bills_20').value,'11');assert.equal(h.get('drawerTotal').textContent,'$220.00');
});

test('overlapping remote count changes preserve the local quantity for a visible conflict',async()=>{
  const h=environment({records:[record({bills_20:'200',drawer_total:'200'})]});await h.start();h.input('bills_20','11');h.api.records[0]={...h.api.records[0],bills_20:'240.00',drawer_total:'240.00',revision:2};await h.save();const editor=h.app.state.editors.get('2026-10-13');assert.equal(editor.conflict,true);assert.equal(editor.values.bills_20,'220.00');assert.equal(h.app.quantityInputValue(editor,'bills_20'),'11');assert.equal(h.inputs.get('bills_20').value,'11');assert.equal(h.api.records[0].bills_20,'240.00');assert.equal(h.get('retryDay').dataset.dayAction,'reload');
});


test('Print prepares a separate snapshot with one fitted page per week and keeps the screen preview unchanged',async()=>{
  const note='Detailed reconciliation note '.repeat(80),h=environment({records:[record({notes:note,bills_20:'200'})]});await h.start();await h.app.openReport();assert.equal(h.get('weekReportPrint').innerHTML,'');h.app.updateReportRange('2026-10-01','2026-10-14');await h.app.prepareReport('2026-10-01','2026-10-14');const preview=h.get('weekReportContent').innerHTML;h.api.printLayout={width:1000,height:700,contentWidth:1200,contentHeight:1700};await h.app.outputReport('print');assert.equal(h.api.prints.length,1);assert.equal(h.api.prints[0].scales.length,2);assert.equal(h.get('weekReportPrint').printPages.length,2);assert.equal(h.get('weekReportPrint').classes.has('is-measuring'),false);for(const scale of h.api.prints[0].scales){assert.ok(Number(scale)>0&&Number(scale)<1,`oversized pages fit at ${scale}`);}assert.match(h.api.prints[0].content,/Detailed reconciliation note/);assert.match(h.api.prints[0].content,/\$20 bills \(amount \$\)/);assert.equal(h.get('weekReportContent').innerHTML,preview);
  for(const handler of h.window.events.afterprint||[])handler({});assert.equal(h.get('weekReportPrint').innerHTML,'');assert.equal(h.get('weekReportPrint').printPages.length,0);assert.equal(h.get('weekReportContent').innerHTML,preview);assert.ok(h.app.reportState.model);await h.app.outputReport('csv');assert.equal(h.api.downloads.length,1);assert.equal(h.get('weekReportPrint').innerHTML,'');h.app.closeReport();assert.equal(h.get('weekReportPrint').innerHTML,'');assert.equal(h.get('weekReportContent').innerHTML,'');
});

test('print fitting never enlarges a page that already fits or leaves the hidden measurement state active',async()=>{
  const h=environment();await h.start();await h.app.openReport();h.api.printLayout={width:1000,height:700,contentWidth:900,contentHeight:600};h.get('weekReportPrint').innerHTML=reportUtility.printHtml(h.app.reportState.model);h.app.fitPrintPages();assert.equal(h.get('weekReportPrint').printPages.length,1);assert.equal(h.get('weekReportPrint').printPages[0].style['--eod-print-scale'],'1');assert.equal(h.get('weekReportPrint').classes.has('is-measuring'),false);h.app.closeReport();assert.equal(h.get('weekReportPrint').innerHTML,'');
});

test('closing, revoking access or changing dates while fonts load cancels the pending print snapshot',async()=>{
  for(const action of ['close','revoked','range']){
    const h=environment();await h.start();await h.app.openReport();const fonts=deferred(),previous=h.app.reportState.model;h.document.fonts={ready:fonts.promise};const printing=h.app.outputReport('print');await until(()=>h.app.reportState.model&&h.app.reportState.model!==previous&&!h.app.reportState.busy);assert.equal(h.api.prints.length,0);assert.equal(h.get('weekReportPrint').innerHTML,'');
    if(action==='close')h.app.closeReport();else if(action==='range')h.app.updateReportRange('2026-10-01','2026-10-02');else for(const handler of h.window.events['paws-access-revoked'])handler({detail:{status:'revoked'}});fonts.resolve();await printing;assert.equal(h.api.prints.length,0,action);assert.equal(h.get('weekReportPrint').innerHTML,'');assert.equal(h.document.body.classList.contains('eod-print-report'),false);assert.equal(h.app.reportState.printing,false);
  }
});

test('the report expands and restores its accessible control without changing dates, preview or saved records',async()=>{
  const h=environment();await h.start();await h.app.openReport();const preview=h.get('weekReportContent').innerHTML,model=h.app.reportState.model,baseline=h.api.calls.length,expand=h.get('expandWeekReport');assert.equal(expand.attrs['aria-pressed'],'false');assert.equal(expand.attrs['aria-label'],'Expand preview');await expand.emit('click');assert.equal(h.app.reportWindowState.expanded,true);assert.equal(h.get('weekReport').classes.has('is-expanded'),true);assert.equal(expand.attrs['aria-pressed'],'true');assert.equal(expand.attrs['aria-label'],'Restore preview size');assert.equal(h.app.reportState.model,model);assert.equal(h.get('weekReportContent').innerHTML,preview);assert.equal(h.api.calls.length,baseline);await expand.emit('click');assert.equal(h.app.reportWindowState.expanded,false);assert.equal(h.get('weekReport').classes.has('is-expanded'),false);assert.equal(expand.attrs['aria-pressed'],'false');assert.equal(expand.attrs['aria-label'],'Expand preview');assert.equal(h.get('weekReportContent').innerHTML,preview);
});

test('desktop report dragging follows the captured pointer and clamps the window inside every viewport edge',async()=>{
  const h=environment();await h.start();await h.app.openReport();const toolbar=h.get('reportToolbar'),dialog=h.get('weekReport'),rect=dialog.getBoundingClientRect();let prevented=false;
  await toolbar.emit('pointerdown',{button:0,isPrimary:true,pointerType:'mouse',pointerId:7,clientX:rect.left+20,clientY:rect.top+15,target:h.get('reportTitle'),currentTarget:toolbar,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(toolbar.hasPointerCapture(7),true);assert.equal(toolbar.classes.has('is-dragging'),true);
  for(const handler of h.window.events.pointermove||[])handler({pointerId:8,clientX:1000,clientY:800,preventDefault(){}});assert.equal(h.app.reportWindowState.position.left,rect.left);assert.equal(h.app.reportWindowState.position.top,rect.top);
  for(const handler of h.window.events.pointermove||[])handler({pointerId:7,clientX:rect.left+120,clientY:rect.top+65,preventDefault(){}});assert.deepEqual({...h.app.reportWindowState.position},{left:rect.left+100,top:rect.top+50});assert.equal(dialog.classes.has('is-positioned'),true);
  for(const handler of h.window.events.pointermove||[])handler({pointerId:7,clientX:-1000,clientY:-1000,preventDefault(){}});assert.deepEqual({...h.app.reportWindowState.position},{left:8,top:8});
  for(const handler of h.window.events.pointermove||[])handler({pointerId:7,clientX:10000,clientY:10000,preventDefault(){}});assert.deepEqual({...h.app.reportWindowState.position},{left:h.window.innerWidth-rect.width-8,top:h.window.innerHeight-rect.height-8});assert.equal(dialog.style['--eod-report-left'],`${h.app.reportWindowState.position.left}px`);assert.equal(dialog.style['--eod-report-top'],`${h.app.reportWindowState.position.top}px`);
  for(const handler of h.window.events.pointerup||[])handler({pointerId:7});assert.equal(h.app.reportWindowState.drag,null);assert.equal(toolbar.hasPointerCapture(7),false);assert.equal(toolbar.classes.has('is-dragging'),false);
});

test('report dragging ignores controls, nonprimary pointers, secondary buttons, touch and mobile layouts',async()=>{
  for(const mode of ['control','nonprimary','secondary','touch','mobile','expanded']){
    const h=environment({smallScreen:mode==='mobile'});await h.start();await h.app.openReport();if(mode==='expanded')h.app.toggleReportExpanded();const toolbar=h.get('reportToolbar'),event={button:mode==='secondary'?2:0,isPrimary:mode!=='nonprimary',pointerType:mode==='touch'?'touch':'mouse',pointerId:1,clientX:300,clientY:180,target:mode==='control'?h.get('expandWeekReport'):toolbar,currentTarget:toolbar,preventDefault(){throw new Error(`${mode} must not start a drag`);}};await toolbar.emit('pointerdown',event);assert.equal(h.app.reportWindowState.drag,null,mode);assert.equal(h.app.reportWindowState.position,null,mode);assert.equal(toolbar.classes.has('is-dragging'),false,mode);
  }
});

test('a moved report restores its position after expansion and remains visible after desktop or mobile resizing',async()=>{
  const h=environment();await h.start();await h.app.openReport();const toolbar=h.get('reportToolbar'),rect=h.get('weekReport').getBoundingClientRect();await toolbar.emit('pointerdown',{button:0,isPrimary:true,pointerType:'pen',pointerId:3,clientX:rect.left,clientY:rect.top,target:toolbar,preventDefault(){}});for(const handler of h.window.events.pointermove||[])handler({pointerId:3,clientX:10000,clientY:10000,preventDefault(){}});for(const handler of h.window.events.pointercancel||[])handler({pointerId:3});const moved={...h.app.reportWindowState.position};assert.equal(h.app.reportWindowState.drag,null);assert.equal(toolbar.hasPointerCapture(3),false);h.app.toggleReportExpanded();h.app.toggleReportExpanded();assert.deepEqual({...h.app.reportWindowState.position},moved);
  h.window.innerWidth=1100;h.window.innerHeight=700;for(const handler of h.window.events.resize||[])handler({});assert.deepEqual({...h.app.reportWindowState.position},{left:192,top:92});h.app.toggleReportExpanded();h.window.innerWidth=390;for(const handler of h.window.events.resize||[])handler({});assert.equal(h.app.reportWindowState.position,null);assert.equal(h.app.reportWindowState.drag,null);assert.equal(h.app.reportWindowState.expanded,true);assert.equal(h.get('weekReport').classes.has('is-positioned'),false);assert.equal(Boolean(h.get('weekReport').style['--eod-report-left']),false);assert.equal(Boolean(h.get('weekReport').style['--eod-report-top']),false);
});

test('closing, authentication reset, access revocation and page exit reset report window position, expansion and pointer capture',async()=>{
  for(const action of ['close','auth','revoked','pagehide'])for(const view of ['expanded','dragging']){
    const h=environment();await h.start();await h.app.openReport();const toolbar=h.get('reportToolbar');await toolbar.emit('pointerdown',{button:0,isPrimary:true,pointerType:'mouse',pointerId:5,clientX:300,clientY:180,target:toolbar,preventDefault(){}});if(view==='expanded'){for(const handler of h.window.events.pointerup||[])handler({pointerId:5});h.app.toggleReportExpanded();}assert.ok(h.app.reportWindowState.position);if(action==='close')h.app.closeReport();else if(action==='auth')h.app.resetAuth(null);else for(const handler of h.window.events[action==='revoked'?'paws-access-revoked':'pagehide']||[])handler({detail:{status:'revoked'}});assert.equal(h.get('weekReport').open,false);assert.equal(h.app.reportWindowState.position,null);assert.equal(h.app.reportWindowState.drag,null);assert.equal(h.app.reportWindowState.expanded,false);assert.equal(toolbar.hasPointerCapture(5),false);assert.equal(toolbar.classes.has('is-dragging'),false);assert.equal(h.get('weekReport').classes.has('is-expanded'),false);assert.equal(h.get('weekReport').classes.has('is-positioned'),false);assert.equal(h.get('expandWeekReport').attrs['aria-pressed'],'false');assert.equal(h.get('weekReportContent').innerHTML,'');assert.equal(h.get('weekReportPrint').innerHTML,'');
  }
});

test('expanding and moving the preview cannot change the printable pages or their fitted dimensions',async()=>{
  const h=environment({records:[record({notes:'Consistent print layout',bills_20:'200'})]});await h.start();await h.app.openReport();await h.app.outputReport('print');for(const handler of h.window.events.afterprint||[])handler({});const first=h.api.prints[0],toolbar=h.get('reportToolbar');await toolbar.emit('pointerdown',{button:0,isPrimary:true,pointerType:'mouse',pointerId:2,clientX:300,clientY:180,target:toolbar,preventDefault(){}});for(const handler of h.window.events.pointermove||[])handler({pointerId:2,clientX:420,clientY:240,preventDefault(){}});for(const handler of h.window.events.pointerup||[])handler({pointerId:2});h.app.toggleReportExpanded();await h.app.outputReport('print');assert.equal(h.api.prints.length,2);assert.equal(h.api.prints[1].content,first.content);assert.deepEqual(h.api.prints[1].scales,first.scales);assert.equal(h.app.reportWindowState.expanded,true);assert.ok(h.app.reportWindowState.position);for(const handler of h.window.events.afterprint||[])handler({});assert.equal(h.get('weekReportPrint').innerHTML,'');assert.equal(h.app.reportWindowState.expanded,true);assert.match(h.get('weekReportContent').innerHTML,/Consistent print layout/);assert.ok(h.api.calls.every(call=>call.op==='select'));
});


test('re-entering an unchanged count cannot hide a newer remote denomination amount during another field save',async()=>{
  const h=environment({records:[record({bills_20:'200',drawer_total:'200'})]});await h.start();h.input('bills_20','10');assert.equal(h.app.dirty(h.app.state.editors.get('2026-10-13')),false);h.input('notes','Local note after re-entering the same count');h.api.records[0]={...h.api.records[0],bills_20:'220.00',drawer_total:'220.00',revision:2};await h.save();const editor=h.app.state.editors.get('2026-10-13');assert.equal(h.api.records[0].bills_20,'220.00');assert.equal(editor.values.bills_20,'220.00');assert.equal(h.app.quantityInputValue(editor,'bills_20'),'11');assert.equal(h.inputs.get('bills_20').value,'11');assert.equal(h.app.dirty(editor),false);assert.equal(h.get('drawerTotal').textContent,'$220.00');assert.equal(h.api.records[0].notes,'Local note after re-entering the same count');
});
