const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Repo-relative when installed under /tests; an override supports checking staged test files.
const base=path.resolve(process.env.TOURS_TEST_ROOT||path.join(__dirname,'..'));
const files={editor:path.join(base,'assets/tour-editor.js'),tours:path.join(base,'assets/tours.js'),
  home:path.join(base,'assets/home-tours.js'),toursHtml:path.join(base,'tours.html'),homeHtml:path.join(base,'index.html')};
const read=file=>fs.readFileSync(file,'utf8');
const formIds=['tourId','customerName','customerInfo','tourDate','tourTime','hasFile','bookingStatus','staffInitials','outsideHoursConfirmed'];
const row=(patch={})=>({id:'00000000-0000-4000-8000-000000000001',customer_name:'Test Customer',customer_info:'Original note',
  tour_date:'2026-09-29',tour_time:'11:00:00',has_file:'yes',booking_status:'confirmed',staff_initials:'CR',
  outside_hours_confirmed:false,deleted_at:null,revision:1,...patch});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(check){for(let i=0;i<100&&!check();i++)await Promise.resolve();assert.ok(check(),'async operation reached expected state');}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}

function environment({html,at='2026-09-29T16:00:00Z',rows=[],intercept=null,active=true}={}) {
  let now=at;
  const makeNode=id=>({id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,required:false,open:false,
    dataset:{},events:{},attributes:{},classes:new Set(),
    addEventListener(name,fn){(this.events[name]??=[]).push(fn);},
    async emit(name,event={}){for(const fn of this.events[name]||[])await fn(event);},
    setAttribute(name,value){this.attributes[name]=value;},
    focus(){},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];},
    contains(){return true;},reset(){}});
  const nodes=new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g),([,id])=>[id,makeNode(id)]));
  function addClassList(node){node.classList={toggle(name,on){if(on)node.classes.add(name);else node.classes.delete(name);},
    add(name){node.classes.add(name);},remove(name){node.classes.delete(name);},contains(name){return node.classes.has(name);}};return node;}
  nodes.forEach(addClassList);
  const get=id=>{assert.ok(nodes.has(id),'markup contains #'+id);return nodes.get(id);};
  if(nodes.has('tourForm')){
    get('tourForm').querySelectorAll=()=>formIds.map(get);
    get('tourForm').reset=()=>formIds.forEach(id=>{get(id).value='';get(id).checked=false;});
    get('tourForm').reportValidity=()=>true;
  }
  const views=['upcoming','past','deleted'].map(view=>Object.assign(addClassList(makeNode(view+'Tab')),{dataset:{view}}));
  const api={rows,active,calls:[],session:{user:{id:'staff-1'}},authCallbacks:[],intercept};
  async function complete(call){
    api.calls.push(call);
    const answer=api.intercept?.(call);
    if(answer!==undefined)return answer;
    if(call.table==='hq_tour_staff')return {data:api.active?{user_id:'staff-1',active:true}:null,error:null};
    if(call.operation!=='select')throw new Error('Unexpected mutation '+call.operation);
    let matches=api.rows.filter(r=>call.filters.every(([,field,value])=>r[field]===value));
    matches.sort((a,b)=>{for(const [field,asc]of call.orders){const n=String(a[field]).localeCompare(String(b[field]));if(n)return asc?n:-n;}return 0;});
    if(call.range)matches=matches.slice(call.range[0],call.range[1]+1);
    if(call.fields&&call.fields!=='*')matches=matches.map(r=>Object.fromEntries(call.fields.split(',').map(field=>[field,r[field]])));
    return {data:call.terminal==='range'?matches:matches[0]||null,error:null};
  }
  const client={auth:{async getSession(){return {data:{session:api.session},error:null};},
    onAuthStateChange(fn){api.authCallbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}};}},
    from(table){
      const call={table,operation:'select',filters:[],orders:[]};
      const finish=terminal=>{call.terminal=terminal;return complete(call);};
      const chain={select(fields){call.fields=fields;return chain;},insert(payload){call.operation='insert';call.payload=payload;return chain;},
        update(payload){call.operation='update';call.payload=payload;return chain;},eq(field,value){call.filters.push(['eq',field,value]);return chain;},
        is(field,value){call.filters.push(['is',field,value]);return chain;},order(field,{ascending=true}={}){call.orders.push([field,ascending]);return chain;},
        range(start,end){call.range=[start,end];return finish('range');},single(){return finish('single');},maybeSingle(){return finish('maybeSingle');}};
      return chain;
    }};
  const timers=new Map();let timerId=0;
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const document={readyState:'loading',hidden:false,getElementById:get,
    querySelectorAll(selector){return selector==='[data-view]'?views:[];},addEventListener(){}};
  const window={addEventListener(){}};
  const context=vm.createContext({document,window,supabaseClient:client,Date:TestDate,
    crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000099'},
    setInterval(){return 1;},clearInterval(){},setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},console});
  return {get,nodes,api,context,window,timers,
    evaluate(source,name){return vm.runInContext(source,context,{filename:name});},setNow(value){now=value;},
    signOut(){api.session=null;for(const callback of api.authCallbacks)callback('SIGNED_OUT',null);},
    runTimers(delay){for(const[id,item]of Array.from(timers)){if(delay===undefined||item.delay===delay){timers.delete(id);item.fn();}}},
    async submit(){await get('tourForm').emit('submit',{preventDefault(){}});},
    async click(id,event={}){await get(id).emit('click',event);}};
}
module.exports={assert,fs,path,files,read,row,deferred,until,flush,environment};
