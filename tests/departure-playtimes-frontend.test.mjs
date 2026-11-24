import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/departure-playtimes.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../departure-playtimes.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../assets/departure-playtimes.css',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function payload({day='2026-11-24',name='Maple',owner='Taylor',skipped=false,revision=0,note='',noteRevision=0,stale=false,refreshDue=false,empty=false}={}){
  return {source:{businessDate:day,fetchedAt:`${day}T17:00:00Z`,scheduleVersion:'schedule-1',summary:{},departures:empty?[]:[{dogName:name,ownerLast:owner,departureAt:`${day}T20:00:00Z`,checkedOutAt:null,noteKey:'departure-1',services:[{key:'service-1',serviceName:'Gold Activity Package',quantity:1,scheduledAt:`${day}T18:07:00Z`,durationMinutes:47,priceCents:1999}]}]},states:[{key:'service-1',skipped,revision,skippedBy:skipped?{id:'staff-b',name:'Staff B'}:null,skippedAt:skipped?`${day}T17:01:00Z`:null}],notes:noteRevision?[{key:'service-1',note,noteRevision,noteUpdatedBy:{id:'staff-a',name:'Staff A'},noteUpdatedAt:`${day}T17:00:00Z`}]:[],sourceAgeSeconds:0,sourceError:null,stale,refreshDue,refreshing:false};
}
function harness({initial=payload(),sessionId='staff-a',active=true,edgeResult={data:{},error:null},autoStart=true}={}){
  const elements=new Map(),requests=[],queues=new Map(),timers=new Map(),intervals=new Map();let timerId=0,uuid=0,clock=0,now=Date.parse('2026-11-24T17:00:00Z'),authCallback;
  const mock={payload:copy(initial),sessionId,active,accessError:null,edgeResult};
  const classList=()=>{const values=new Set();return {contains:x=>values.has(x),toggle(x,force){const next=force??!values.has(x);if(next)values.add(x);else values.delete(x);return next;}};};
  const decode=value=>String(value).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  const matches=(node,selector)=>selector.includes('data-note-input')||selector==='textarea'?node.dataset.noteInput!==undefined:selector.includes('data-note-save')?node.dataset.noteSave!==undefined:selector.includes('data-note-cancel')?node.dataset.noteCancel!==undefined:selector.includes('data-dismiss-draft')?node.dataset.dismissDraft!==undefined:selector.includes('data-key')?node.dataset.key!==undefined:false;
  function noteInputs(selector){
    if(!/data-note-input|textarea/.test(selector))return [];
    return [...(elements.get('departures')?.innerHTML||'').matchAll(/<textarea\b[^>]*data-note-input="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)].map(match=>{const node=element(`note:${decode(match[1])}`);node.dataset.noteInput=decode(match[1]);node.tagName='TEXTAREA';node.readOnly=/\breadonly\b/.test(match[0]);if(node.markup!==match[0]){node.value=decode(match[2]);node.markup=match[0];}return node;});
  }
  function element(id){
    if(elements.has(id))return elements.get(id);const listeners=new Map();
    const node={id,value:'',textContent:'',innerHTML:'',hidden:['toast','notice','careFilterMenu','skippedNotice','previousDrafts'].includes(id),disabled:false,open:false,dataset:{},style:{},scrollHeight:42,classList:classList(),attributes:new Map(),selectionStart:0,selectionEnd:0,
      addEventListener(type,callback){const callbacks=listeners.get(type)||[];callbacks.push(callback);listeners.set(type,callbacks);},
      async emit(type,event={}){return Promise.all((listeners.get(type)||[]).map(fn=>fn({target:node,...event})));},
      setAttribute(name,value){this.attributes.set(name,String(value));},getAttribute(name){return this.attributes.get(name);},querySelectorAll:noteInputs,querySelector:selector=>noteInputs(selector)[0]||null,matches:selector=>matches(node,selector),closest:selector=>matches(node,selector)?node:null,focus(){document.activeElement=node;},setSelectionRange(start,end){node.selectionStart=start;node.selectionEnd=end;},showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}};
    elements.set(id,node);return node;
  }
  for(const match of html.matchAll(/\bid="([^"]+)"/g))element(match[1]);
  const document={readyState:autoStart?'complete':'loading',hidden:false,activeElement:null,getElementById:element,querySelectorAll:noteInputs,addEventListener(...args){element('document').addEventListener(...args);}};
  function take(name,args){
    const queue=queues.get(name)||[],pending=queue.shift();requests.push({name,args:copy(args??{}),user:mock.sessionId});
    if(pending){if(typeof pending==='function')return pending(args);return pending;}
    if(name==='hq_departure_playtimes_day')return Promise.resolve({data:copy(mock.payload),error:null});
    if(name==='hq_departure_playtimes_history')return Promise.resolve({data:[],error:null});
    if(name==='edge')return Promise.resolve(mock.edgeResult);
    throw new Error(`Missing response for ${name}`);
  }
  const sdk={auth:{getSession:async()=>({data:{session:mock.sessionId?{user:{id:mock.sessionId}}:null},error:null}),onAuthStateChange(callback){authCallback=callback;return {data:{subscription:{unsubscribe(){}}}};}},from(name){assert.equal(name,'hq_tour_staff');const query={select(){return query;},eq(){return query;},maybeSingle:async()=>({data:mock.active?{user_id:mock.sessionId,active:true}:null,error:null})};return query;},rpc:take,functions:{invoke:(name,args)=>{assert.equal(name,'hq-departure-playtimes');return take('edge',args);}}};
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const window={addEventListener(...args){element('window').addEventListener(...args);}};
  const context=vm.createContext({document,window,supabaseClient:sdk,ensureHqWorkspaceAccess:async()=>{if(mock.accessError)throw mock.accessError;},Intl,Date:ClockDate,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`},setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),setInterval(fn,delay){const id=++timerId;intervals.set(id,{fn,delay});return id;},clearInterval:id=>intervals.delete(id)});
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,'globalThis.frontend={state,refresh,changeSkip,saveNote,cancelNote,openNote,openHistory,render,resetIdentity,hydrate,api,toast,expireDay};\n})();'),context);
  const h={mock,requests,queues,timers,intervals,elements,element,document,frontend:context.frontend,
    queue(name,value){const list=queues.get(name)||[];list.push(value);queues.set(name,list);},
    count:name=>requests.filter(request=>request.name===name).length,
    async ready(){await flush();assert.equal(this.frontend.state.loading,false);},
    advance(ms){clock+=ms;now+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}},
    setDate(value){now=Date.parse(value);},
    async event(name,event={}){await element('window').emit(name,event);await flush();},
    async auth(id,event='SIGNED_IN'){mock.sessionId=id;authCallback(event,id?{user:{id}}:null);await flush();},
    async inputNote(key,value){const node=noteInputs('textarea[data-note-input]').find(input=>input.dataset.noteInput===key);assert.ok(node,'note must exist');node.focus();await element('departures').emit('focusin',{target:node});node.value=value;await element('departures').emit('input',{target:node});return node;},
    async blurNote(key){const node=noteInputs('textarea[data-note-input]').find(input=>input.dataset.noteInput===key);document.activeElement=null;await element('departures').emit('focusout',{target:node});},
    blur(){document.activeElement=null;},
  };return h;
}
const skipAck=(skipped=true,revision=1)=>({data:{changed:true,idempotent:false,service:{key:'service-1',skipped,revision,skippedBy:skipped?{id:'staff-a',name:'Staff A'}:null,skippedAt:skipped?'2026-11-24T17:01:00Z':null}},error:null});
const noteAck=(note,noteRevision=1,key='service-1')=>({data:{changed:true,idempotent:false,service:{key,note,noteRevision,noteUpdatedBy:{id:'staff-a',name:'Staff A'},noteUpdatedAt:'2026-11-24T17:01:00Z'}},error:null});

test('production shell preserves the approved UI without demo, credential, billing, or standalone navigation controls',()=>{
  assert.match(html,/id="header"/);assert.match(html,/id="sideMenu"/);assert.match(html,/\/script\.js/);assert.match(html,/id="departurePlaytimesPage"/);
  assert.doesNotMatch(html,/Demo|scenario|gingrKey|Connect Gingr|id="actor"|Assumed Completed|Expected (?:total|charges)|id="(?:skippedFilter|allFilter)"/i);
  assert.match(html,/Find a pet/);for(const kind of ['tlc','puppy','bronze','silver','gold'])assert.match(html,new RegExp(`/assets/departure-playtimes/${kind}\\.svg`));
  assert.match(css,/#departurePlaytimesPage \.departure\.has-skipped/);assert.doesNotMatch(source,/localStorage|sessionStorage|\.signOut\(/);
});

test('authenticated daily source overlays shared status and notes without representing verified completion',async()=>{
  const h=harness({initial:payload({skipped:true,revision:2,note:'Two of three activities done.',noteRevision:3})});await h.ready();
  assert.equal(h.count('hq_departure_playtimes_day'),1);assert.equal(h.count('edge'),0);assert.equal(h.frontend.state.userId,'staff-a');
  const service=h.frontend.state.view.departures[0].services[0];assert.equal(service.skipped,true);assert.equal(service.noteRevision,3);assert.equal(service.verified,false);
  const rendered=h.element('departures').innerHTML;assert.match(rendered,/Leaving at 3:00\s?PM/);assert.match(rendered,/Undo Skip/);assert.match(rendered,/Two of three/);assert.doesNotMatch(rendered,/1:07|47 min|19\.99|invoice|Assumed Completed/i);assert.equal(h.element('skippedNoticeText').textContent,'1 playtime marked skipped today');
});

test('only an overdue cache requests Edge refresh, then reads the authoritative day again',async()=>{
  const initial=payload({refreshDue:true}),h=harness({initial,edgeResult:{data:{},error:null}});await h.ready();
  assert.deepEqual(h.requests.map(r=>r.name),['hq_departure_playtimes_day','edge','hq_departure_playtimes_day']);assert.deepEqual(h.requests[1].args,{body:{action:'refresh'}});
});

test('unready source shows loading rather than a false zero; a fresh empty source shows genuine zero',async()=>{
  const h=harness({initial:{source:null,states:[],notes:[],refreshing:true}});await h.ready();assert.equal(h.frontend.state.view,null);assert.match(h.element('departures').innerHTML,/Loading today/);assert.doesNotMatch(h.element('departures').innerHTML,/No boarding departures/);
  h.mock.payload=payload({empty:true});await h.frontend.refresh();assert.equal(h.frontend.state.view.departures.length,0);assert.match(h.element('departures').innerHTML,/No boarding departures today/);
});

test('a busy shared refresh lease gets bounded fast SQL-only retries rather than waiting for the normal poll',async()=>{
  const h=harness({initial:{source:null,refreshDue:true,refreshing:true,states:[],notes:[]}});await h.ready();assert.equal(h.count('edge'),1);assert.equal(h.count('hq_departure_playtimes_day'),2);
  for(let i=0;i<4;i++){h.advance(1200);await flush();}
  assert.equal(h.count('hq_departure_playtimes_day'),6);assert.equal(h.count('edge'),1);h.advance(10000);await flush();assert.equal(h.count('hq_departure_playtimes_day'),6);
  const restored=harness({initial:{source:null,refreshDue:true,refreshing:true,states:[],notes:[]}});await restored.ready();restored.mock.payload=payload({name:'Source ready'});restored.advance(1200);await flush();assert.match(restored.element('departures').innerHTML,/Source ready/);assert.equal(restored.count('edge'),1);
});

test('explicit refresh and periodic freshness checks work during typing without losing a draft or its selection',async()=>{
  const h=harness();await h.ready();const node=await h.inputNote('service-1','Draft still being typed');node.setSelectionRange(4,9);h.mock.payload=payload({stale:true});
  await h.element('refresh').emit('click');await flush();assert.equal(h.frontend.state.view.stale,true);assert.equal(h.document.activeElement.selectionStart,4);assert.equal(h.document.activeElement.selectionEnd,9);assert.match(h.element('departures').innerHTML,/Draft still being typed/);assert.match(h.element('departures').innerHTML,/readonly/);
  h.mock.payload=payload();for(const timer of h.intervals.values())timer.fn();await flush();assert.equal(h.frontend.state.view.stale,false);assert.match(h.element('departures').innerHTML,/Draft still being typed/);
});

test('source failure retains a same-day roster read-only and does not permit skip or note writes',async()=>{
  const h=harness();await h.ready();h.mock.payload={source:null,states:[],notes:[],sourceError:'provider unavailable'};await h.frontend.refresh({quiet:true});
  assert.equal(h.frontend.state.view.stale,true);assert.match(h.element('departures').innerHTML,/Maple/);assert.match(h.element('departures').innerHTML,/data-key="service-1" disabled/);assert.match(h.element('departures').innerHTML,/readonly/);
  await h.frontend.changeSkip('service-1');await h.inputNote('service-1','Must not save');await h.frontend.saveNote('service-1');assert.equal(h.count('hq_departure_playtimes_set_skip'),0);assert.equal(h.count('hq_departure_playtimes_save_note'),0);
});

test('skip and undo use exact shared RPC revisions and no optimistic saved status',async()=>{
  const h=harness();await h.ready();const pending=deferred();h.queue('hq_departure_playtimes_set_skip',pending.promise);const change=h.frontend.changeSkip('service-1');await flush();
  assert.equal(h.frontend.state.view.departures[0].services[0].skipped,false);assert.match(h.element('departures').innerHTML,/Saving…/);
  const first=h.requests.find(r=>r.name==='hq_departure_playtimes_set_skip');assert.deepEqual(first.args,{p_request_id:'00000000-0000-4000-8000-000000000001',p_key:'service-1',p_skipped:true,p_expected_revision:0,p_source_version:'schedule-1'});
  h.mock.payload=payload({skipped:true,revision:1});pending.resolve(skipAck());await change;assert.equal(h.frontend.state.view.summary.skipped,1);assert.match(h.element('toast').textContent,/marked as skipped/);
  h.mock.payload=payload({skipped:false,revision:2});h.queue('hq_departure_playtimes_set_skip',Promise.resolve(skipAck(false,2)));await h.frontend.changeSkip('service-1');
  const undo=h.requests.filter(r=>r.name==='hq_departure_playtimes_set_skip')[1];assert.equal(undo.args.p_skipped,false);assert.equal(undo.args.p_expected_revision,1);assert.equal(h.frontend.state.view.summary.skipped,0);assert.match(h.element('departures').innerHTML,/On today’s plan/);
});

test('a lost skip response retries one immutable request ID and cannot duplicate the action',async()=>{
  const h=harness();await h.ready();h.queue('hq_departure_playtimes_set_skip',()=>Promise.reject(new Error('connection closed')));h.queue('hq_departure_playtimes_set_skip',async()=>{h.mock.payload=payload({skipped:true,revision:1});return skipAck();});
  await h.frontend.changeSkip('service-1');const commands=h.requests.filter(r=>r.name==='hq_departure_playtimes_set_skip');assert.equal(commands.length,2);assert.deepEqual(commands[0].args,commands[1].args);assert.equal(h.frontend.state.view.summary.skipped,1);
});

test('server revision or schedule conflicts keep current state and refresh rather than inventing a saved skip',async()=>{
  for(const code of ['REVISION_CONFLICT','SCHEDULE_CONFLICT','STALE_SOURCE']){
    const h=harness();await h.ready();h.queue('hq_departure_playtimes_set_skip',Promise.resolve({data:null,error:{message:code}}));await h.frontend.changeSkip('service-1');
    assert.equal(h.frontend.state.view.summary.skipped,0);assert.equal(h.frontend.state.pending.size,0);assert.equal(h.count('hq_departure_playtimes_set_skip'),1);assert.ok(h.count('hq_departure_playtimes_day')>=2);
  }
});

test('inline notes debounce and background freshness reads preserve drafts and focused selection',async()=>{
  const h=harness();await h.ready();const node=await h.inputNote('service-1','Quiet indoor play, please.');node.setSelectionRange(7,12);
  await h.frontend.refresh({quiet:true});assert.equal(h.count('hq_departure_playtimes_day'),1);for(const timer of h.intervals.values())timer.fn();await flush();assert.equal(h.count('hq_departure_playtimes_day'),2);
  h.frontend.render();assert.equal(h.document.activeElement.dataset.noteInput,'service-1');assert.equal(h.document.activeElement.selectionStart,7);assert.equal(h.document.activeElement.selectionEnd,12);
  h.advance(799);await flush();assert.equal(h.count('hq_departure_playtimes_save_note'),0);
  h.queue('hq_departure_playtimes_save_note',async()=>{h.mock.payload=payload({note:'Quiet indoor play, please.',noteRevision:1});return noteAck('Quiet indoor play, please.');});h.advance(1);await flush();
  assert.equal(h.count('hq_departure_playtimes_save_note'),1);assert.equal(h.frontend.state.view.departures[0].services[0].note,'Quiet indoor play, please.');assert.equal(h.frontend.state.noteEditors.size,0);
});

test('blur saves a trimmed note immediately; clear is a note change and never changes a skip',async()=>{
  const h=harness({initial:payload({skipped:true,revision:1,note:'Saved note',noteRevision:4})});await h.ready();await h.inputNote('service-1','   ');
  h.queue('hq_departure_playtimes_save_note',async()=>{h.mock.payload=payload({skipped:true,revision:1,note:'',noteRevision:5});return noteAck('',5);});await h.blurNote('service-1');h.advance(0);await flush();
  const command=h.requests.find(r=>r.name==='hq_departure_playtimes_save_note');assert.equal(command.args.p_note,'');assert.equal(command.args.p_expected_revision,4);assert.equal(h.frontend.state.view.departures[0].services[0].skipped,true);assert.equal(h.count('hq_departure_playtimes_set_skip'),0);
});

test('typing during a save advances only to its own acknowledgement, never a teammate revision',async()=>{
  const h=harness();await h.ready();await h.inputNote('service-1','First edit');const wait=deferred();h.queue('hq_departure_playtimes_save_note',wait.promise);const save=h.frontend.saveNote('service-1');await flush();
  await h.inputNote('service-1','My second edit');h.mock.payload=payload({note:'Teammate note',noteRevision:2});wait.resolve(noteAck('First edit',1));await save;
  const editor=[...h.frontend.state.noteEditors.values()][0];assert.equal(editor.draft,'My second edit');assert.equal(editor.original,'First edit');assert.equal(editor.revision,1);
  h.queue('hq_departure_playtimes_save_note',Promise.resolve({data:null,error:{message:'NOTE_REVISION_CONFLICT'}}));h.advance(0);await flush();
  const second=h.requests.filter(r=>r.name==='hq_departure_playtimes_save_note')[1];assert.equal(second.args.p_expected_revision,1);assert.match(editor.error,/Someone updated/);assert.equal(editor.draft,'My second edit');assert.match(h.element('departures').innerHTML,/Use latest/);
});

test('lost note response retries identical command and retains draft on a conflict without automatic retry loop',async()=>{
  const h=harness();await h.ready();await h.inputNote('service-1','Keep this text');h.queue('hq_departure_playtimes_save_note',()=>Promise.reject(new Error('lost response')));h.queue('hq_departure_playtimes_save_note',Promise.resolve({data:null,error:{message:'NOTE_REVISION_CONFLICT'}}));
  await h.frontend.saveNote('service-1');const commands=h.requests.filter(r=>r.name==='hq_departure_playtimes_save_note');assert.deepEqual(commands[0].args,commands[1].args);assert.match([...h.frontend.state.noteEditors.values()][0].error,/Someone updated/);
  h.advance(10000);await flush();assert.equal(h.count('hq_departure_playtimes_save_note'),2);h.frontend.cancelNote('service-1');assert.equal(h.frontend.state.noteEditors.size,0);
});

test('a server-confirmed mutation remains visible if only the following source read fails, with further changes paused',async()=>{
  const h=harness();await h.ready();h.queue('hq_departure_playtimes_set_skip',async()=>{h.mock.payload={source:null,refreshing:false};return skipAck();});await h.frontend.changeSkip('service-1');
  assert.equal(h.frontend.state.view.departures[0].services[0].skipped,true);assert.equal(h.frontend.state.view.stale,true);assert.match(h.element('departures').innerHTML,/Undo Skip/);assert.equal(h.frontend.state.pending.size,0);
});

test('a pet without booked services has an inline departure note using its server-provided key',async()=>{
  const initial=payload();initial.source.departures[0].services=[];const h=harness({initial});await h.ready();assert.match(h.element('departures').innerHTML,/No additional playtimes listed/);assert.match(h.element('departures').innerHTML,/data-note-input="departure-1"/);
  await h.inputNote('departure-1','Owner collecting belongings.');h.queue('hq_departure_playtimes_save_note',async()=>{h.mock.payload.notes=[{key:'departure-1',note:'Owner collecting belongings.',noteRevision:1}];return noteAck('Owner collecting belongings.',1,'departure-1');});await h.frontend.saveNote('departure-1');
  const command=h.requests.find(r=>r.name==='hq_departure_playtimes_save_note');assert.equal(command.args.p_key,'departure-1');assert.equal(h.frontend.state.view.departures[0].note,'Owner collecting belongings.');
});

test('care filters keep a single list for boarding cats and dogs, including skipped pets',async()=>{
  const initial=payload({skipped:true});const second=copy(initial.source.departures[0]);second.dogName='Mittens';second.noteKey='departure-cat';second.species='cat';second.services=[{key:'cat-service',serviceName:'Silver Activity Package Cats',quantity:1}];initial.source.departures.push(second);
  const h=harness({initial});await h.ready();assert.match(h.element('departures').innerHTML,/Maple/);assert.match(h.element('departures').innerHTML,/Mittens/);assert.match(h.element('departures').innerHTML,/has-skipped/);
  await h.element('careFilterSilver').emit('click');assert.match(h.element('departures').innerHTML,/Mittens/);assert.doesNotMatch(h.element('departures').innerHTML,/Maple/);assert.equal(h.element('allBadge').textContent,'1 / 2');assert.equal(h.element('careFilterSilver').getAttribute('aria-checked'),'true');
  await h.element('careFilterAll').emit('click');assert.match(h.element('departures').innerHTML,/Maple/);assert.match(h.element('departures').innerHTML,/Mittens/);
});

test('names, notes and history content are escaped in HTML',async()=>{
  const hostile='<img src=x onerror=alert(1)>',h=harness({initial:payload({name:hostile,owner:'O\'Brien & Co',note:hostile,noteRevision:1})});await h.ready();
  let markup=h.element('departures').innerHTML;assert.doesNotMatch(markup,/<img src=x/);assert.match(markup,/&lt;img src=x/);assert.match(markup,/O&#39;Brien &amp; Co/);
  h.queue('hq_departure_playtimes_history',Promise.resolve({data:[{action:'note',dogName:hostile,serviceName:'<svg onload=alert(1)>',actor:{name:hostile},note:hostile,occurredAt:'2026-11-24T17:00:00Z'}],error:null}));await h.frontend.openHistory();markup=h.element('historyList').innerHTML;assert.doesNotMatch(markup,/<img|<svg/);assert.match(markup,/&lt;img src=x/);
});

test('workspace revocation clears private roster, notes, history and stale requests without signing out',async()=>{
  const h=harness();await h.ready();await h.inputNote('service-1','Private draft');h.blur();const pending=deferred();h.queue('hq_departure_playtimes_day',pending.promise);const refresh=h.frontend.refresh();await flush();
  h.element('historyList').innerHTML='Private history';h.element('historyDialog').showModal();await h.event('paws-access-revoked');
  assert.equal(h.frontend.state.view,null);assert.equal(h.frontend.state.noteEditors.size,0);assert.equal(h.element('historyList').innerHTML,'');assert.equal(h.element('historyDialog').open,false);assert.doesNotMatch(h.element('departures').innerHTML,/Maple|Private/);
  pending.resolve({data:payload({name:'Stale private response'}),error:null});await refresh;assert.equal(h.frontend.state.view,null);assert.doesNotMatch(h.element('departures').innerHTML,/Stale private/);
});

test('a different auth identity cannot receive earlier history or have old finally clear its pending action',async()=>{
  const h=harness();await h.ready();const oldHistory=deferred();h.queue('hq_departure_playtimes_history',oldHistory.promise);const history=h.frontend.openHistory();await flush();
  const oldSkip=deferred();h.queue('hq_departure_playtimes_set_skip',oldSkip.promise);const skip=h.frontend.changeSkip('service-1');await flush();await h.auth('staff-b');h.advance(0);await flush();
  assert.equal(h.frontend.state.userId,'staff-b');assert.equal(h.frontend.state.authReady,true);const current=deferred();h.queue('hq_departure_playtimes_set_skip',current.promise);const newer=h.frontend.changeSkip('service-1');await flush();
  oldHistory.resolve({data:[{action:'skip',dogName:'Old secret',serviceName:'Playtime',actor:{name:'Old actor'},occurredAt:'2026-11-24T17:00:00Z'}],error:null});oldSkip.resolve(skipAck());await Promise.all([history,skip]);
  assert.equal(h.frontend.state.pending.size,1);assert.doesNotMatch(h.element('historyList').innerHTML,/Old secret/);h.mock.payload=payload({skipped:true,revision:1});current.resolve(skipAck());await newer;assert.equal(h.frontend.state.pending.size,0);
});

test('confirmed auth failure during a mutation immediately removes private data and drafts',async()=>{
  const h=harness();await h.ready();await h.inputNote('service-1','Private');h.queue('hq_departure_playtimes_save_note',Promise.resolve({data:null,error:{message:'ACCESS',code:'42501'}}));await h.frontend.saveNote('service-1');
  assert.equal(h.frontend.state.view,null);assert.equal(h.frontend.state.authReady,false);assert.equal(h.frontend.state.noteEditors.size,0);assert.doesNotMatch(h.element('departures').innerHTML,/Maple|Private/);
});

test('midnight removes yesterday immediately, preserves only read-only earlier drafts, and never writes them into today',async()=>{
  const h=harness();await h.ready();await h.inputNote('service-1','Unsaved previous-day note');h.setDate('2026-11-25T05:01:00Z');h.mock.payload={source:null,refreshing:true};await h.frontend.refresh({quiet:true});
  assert.equal(h.frontend.state.view,null);assert.doesNotMatch(h.element('departures').innerHTML,/Maple|Unsaved previous/);assert.equal(h.element('previousDrafts').hidden,false);assert.match(h.element('previousDraftList').innerHTML,/2026-11-24/);assert.match(h.element('previousDraftList').innerHTML,/textarea readonly/);
  h.mock.payload=payload({day:'2026-11-25',name:'Today pet'});h.blur();await h.frontend.refresh();assert.match(h.element('departures').innerHTML,/Today pet/);assert.doesNotMatch(h.element('departures').innerHTML,/Unsaved previous/);await h.frontend.saveNote('service-1');assert.equal(h.count('hq_departure_playtimes_save_note'),0);
});

test('BFCache return hides old data until auth rechecks, restarts one poll, and preserves same-user drafts',async()=>{
  const h=harness();await h.ready();await h.inputNote('service-1','Draft to keep');h.blur();await h.event('pagehide');assert.equal(h.intervals.size,0);
  const pending=deferred();h.queue('hq_departure_playtimes_day',pending.promise);await h.event('pageshow',{persisted:true});assert.equal(h.frontend.state.view,null);assert.doesNotMatch(h.element('departures').innerHTML,/Maple/);assert.equal(h.intervals.size,1);
  pending.resolve({data:payload(),error:null});await flush();assert.match(h.element('departures').innerHTML,/Draft to keep/);assert.equal(h.frontend.state.authReady,true);
});

test('toast disappears at five seconds and a newer message restarts that timer',async()=>{
  const h=harness();await h.ready();h.frontend.toast('First');h.advance(4999);assert.equal(h.element('toast').hidden,false);h.advance(1);assert.equal(h.element('toast').hidden,true);
  h.frontend.toast('Second');h.advance(4000);h.frontend.toast('Newer');h.advance(1000);assert.equal(h.element('toast').hidden,false);h.advance(4000);assert.equal(h.element('toast').hidden,true);
});
