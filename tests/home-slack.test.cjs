const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/home-slack.js'),'utf8');
const fixture = (patch={}) => ({message:{ts:'1790953200.000001',text:'Hello *team*',author:{name:'Test Staff'},permalink:'https://paws.slack.com/archives/C1/p1790953200000001',images:[],files:[],...patch},updated_at:'2026-10-02T15:00:00Z'});
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function flush(){for(let pass=0;pass<3;pass++){for(let i=0;i<60;i++)await Promise.resolve();await new Promise(setImmediate);}}
function harness({message=fixture(),handler,session={user:{id:'staff-1'},access_token:'fixture-user-jwt'}}={}) {
  const nodes=new Map(),listeners={},auth=[],timers=new Map(),intervals=[],created=[],createdBlobs=[],revoked=[];
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes=new Set(),events={},attributes={};
    const n={id,hidden:false,disabled:false,open:false,innerHTML:'',textContent:'',attributes,events,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},
      addEventListener(name,fn){(events[name]??=[]).push(fn);},
      setAttribute(k,v){attributes[k]=v;},removeAttribute(k){delete attributes[k];delete n[k];},
      showModal(){n.open=true;},close(){n.open=false;},focus(){},
      querySelector(selector){const id=selector.match(/data-slack-image="(.*?)"/)?.[1];return id&&n.innerHTML.includes(`data-slack-image="${id}"`)?node('image-'+id):null;}
    };nodes.set(id,n);return n;
  }
  const api={calls:[],requests:[],session,message,handler,now:Date.parse('2026-10-02T15:00:00Z')};
  async function respond(body) {
    api.calls.push(body);
    const result=api.handler ? await api.handler(body) : {data:api.message,error:null};
    if(result instanceof Response)return result;
    if(result.error){
      const context=result.error.context;
      if(context instanceof Response)return context;
      const errorBody=context?.clone?await context.clone().json():{error:{code:'UNAVAILABLE'}};
      return new Response(JSON.stringify(errorBody),{status:context?.status||502,headers:{'Content-Type':'application/json'}});
    }
    if(result.data instanceof Blob)return new Response(result.data,{headers:{'Content-Type':result.data.type}});
    return new Response(JSON.stringify(result.data),{headers:{'Content-Type':'application/json'}});
  }
  // Match the real FunctionsClient: image/* is text, and the returned Response is consumed.
  async function sdkInvoke(body){
    api.requests.push({transport:'sdk',body});
    const response=await respond(body);
    if(!response.ok)return {data:null,error:{context:response},response};
    const type=(response.headers.get('Content-Type')||'text/plain').split(';')[0];
    const data=type==='application/json'?await response.json():['application/octet-stream','application/pdf'].includes(type)?await response.blob():await response.text();
    return {data,error:null,response};
  }
  const client={auth:{async getSession(){return {data:{session:api.session},error:null};},onAuthStateChange(fn){auth.push(fn);}},functions:{async invoke(name,{body}){return sdkInvoke(body);}}};
  const fetch=async(url,options)=>{
    const body=JSON.parse(options.body);api.requests.push({transport:'fetch',url,body,...options});
    return respond(body);
  };
  const document={hidden:false,getElementById:node,addEventListener(name,fn){listeners['document:'+name]=fn;}};
  const window={addEventListener(name,fn){listeners['window:'+name]=fn;}};
  class TestURL extends URL {static createObjectURL(blob){const url='blob:test-'+created.length;created.push(url);createdBlobs.push(blob);return url;}static revokeObjectURL(url){revoked.push(url);}}
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[api.now]));}static now(){return api.now;}}
  let timerId=0;
  const context=vm.createContext({document,window,supabaseClient:client,URL:TestURL,Date:TestDate,Blob,AbortController,fetch,Intl,console,
    setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},setInterval(fn,delay){intervals.push({fn,delay});}});
  vm.runInContext(source.replace("  $('homeSlackRefresh').addEventListener", "  globalThis.__slack = {state,refresh,formatText,safeURL,clearImages};\n  $('homeSlackRefresh').addEventListener"),context);
  return {api,document,listeners,created,createdBlobs,revoked,timers,intervals,get:node,app:context.__slack,
    async settle(){await flush();assert.equal(context.__slack.state.loading,false);},
    signOut(){api.session=null;auth.forEach(fn=>fn('SIGNED_OUT',null));},
    async click(id,event={}){for(const fn of node(id).events.click||[])await fn(event);}};
}

test('renders latest message, author, safe Slack link, and bounded automatic polling',async()=>{
  const h=harness();await h.settle();
  assert.equal(h.get('homeSlackAuthor').textContent,'Test Staff');
  assert.equal(h.get('homeSlackInitials').textContent,'TS');
  assert.match(h.get('homeSlackBody').innerHTML,/<strong>team<\/strong>/);
  assert.equal(h.get('homeSlackOpen').href,'https://paws.slack.com/archives/C1/p1790953200000001');
  assert.equal(h.get('homeSlackMessage').hidden,false);
  assert.equal(h.intervals[0].delay,60000);
  await h.app.refresh({automatic:true});assert.equal(h.api.calls.length,1);
  h.api.now+=60000;h.document.hidden=true;await h.app.refresh({automatic:true});assert.equal(h.api.calls.length,1);
  h.document.hidden=false;h.get('homeSlackImageDialog').open=true;await h.app.refresh({automatic:true});assert.equal(h.api.calls.length,1);
  h.get('homeSlackImageDialog').open=false;await h.app.refresh({automatic:true});assert.equal(h.api.calls.length,2);
});
test('escapes message markup and rejects unsafe/external Slack permalinks',async()=>{
  const h=harness({message:fixture({text:'<script>alert(1)</script> &lt;img src=x onerror=alert(1)&gt; <https://example.com/?a=1&b=2|read> `&lt;unsafe&gt;` _note_ ~old~ <!channel>',author:{name:'<img onerror=1>'},permalink:'https://slack.com.evil.example/message',files:[{title:'unsafe',permalink:'javascript:alert(1)'}]})});await h.settle();
  const html=h.get('homeSlackBody').innerHTML;
  assert.ok(!html.includes('<script>')&&!html.includes('<img'));
  assert.match(html,/href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(html,/<code>&lt;unsafe&gt;<\/code>/);
  assert.match(html,/<em>note<\/em>/);assert.match(html,/<s>old<\/s>/);assert.match(html,/@channel/);
  assert.equal(h.get('homeSlackOpen').hidden,true);assert.equal(h.get('homeSlackFiles').hidden,true);
  assert.equal(h.app.safeURL('https://user:password@paws.slack.com/x',true),'');
});
test('missing Slack connection is distinct from a genuinely empty channel',async()=>{
  const empty=harness({message:{message:null}});await empty.settle();assert.match(empty.get('homeSlackEmpty').textContent,/No messages/);
  const setup=harness({handler:()=>({data:null,error:{context:{status:503,clone:()=>({json:async()=>({error:{code:'CONNECTION_REQUIRED'}})})}}})});await setup.settle();
  assert.equal(setup.get('homeSlackEmpty').textContent,'Slack connection is not set up yet.');
  assert.ok(!setup.get('homeSlackEmpty').textContent.includes('No messages'));
});
test('network/access failures clear earlier private text, links, and images',async()=>{
  const h=harness();await h.settle();h.api.handler=()=>({data:null,error:{context:{status:403,clone:()=>({json:async()=>({error:{code:'ACCESS_DENIED'}})})}}});await h.app.refresh();
  assert.equal(h.get('homeSlackBody').innerHTML,'');assert.equal(h.get('homeSlackOpen').hidden,true);assert.equal(h.get('homeSlackMessage').hidden,true);
  assert.match(h.get('homeSlackEmpty').textContent,/unavailable for your account/);
  h.api.handler=()=>{throw Error('raw sensitive provider information');};await h.app.refresh();
  assert.ok(!h.get('homeSlackStatus').textContent.includes('raw sensitive'));
});
test('images use authenticated blob requests, accessible enlargement, and revoke on refresh/logout',async()=>{
  const payload=fixture({images:[{id:'F123',title:'Playtime',alt:'Dogs playing'}]});
  const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['image bytes'],{type:'image/png'}),error:null})});await h.settle();
  assert.deepEqual(h.api.calls.map(c=>c.action),['message','image']);
  assert.equal(h.api.calls[1].file_id,'F123');assert.equal(h.api.calls[1].message_ts,payload.message.ts);
  assert.equal(h.created.length,1);assert.match(h.get('image-F123').innerHTML,/alt="Dogs playing"/);
  await h.click('homeSlackImages',{target:{closest:()=>({dataset:{slackImage:'F123'}})}});
  assert.equal(h.get('homeSlackImageDialog').open,true);assert.equal(h.get('homeSlackLargeImage').src,'blob:test-0');
  await h.app.refresh();await flush();assert.ok(h.revoked.includes('blob:test-0'));assert.equal(h.get('homeSlackImageDialog').open,false);
  h.signOut();assert.equal(h.get('homeSlackMessage').hidden,true);assert.equal(h.app.state.urls.size,0);assert.equal(h.revoked.length,2);
});
test('image bytes bypass SDK text parsing and use a fresh user JWT without cookies or URL credentials',async()=>{
  const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,255,254,128,0,195,40]);
  let h;
  h=harness({handler:body=>{
    if(body.action==='message'){
      h.api.session.access_token='fresh-user-jwt';
      return {data:fixture({images:[{id:'F123',title:'Binary image'}]}),error:null};
    }
    return new Response(bytes,{headers:{'Content-Type':'image/png'}});
  }});await h.settle();
  assert.deepEqual(h.api.requests.map(request=>request.transport),['sdk','fetch']);
  const request=h.api.requests[1];
  assert.equal(request.url,'https://dppjgglaeieevsfwsbii.supabase.co/functions/v1/hq-slack-general');
  assert.equal(request.headers.Authorization,'Bearer fresh-user-jwt');
  assert.equal(request.method,'POST');assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');
  assert.equal(request.url.includes('fresh-user-jwt'),false);assert.equal(request.body.includes('fresh-user-jwt'),false);
  assert.equal(h.createdBlobs[0].type,'image/png');assert.deepEqual(new Uint8Array(await h.createdBlobs[0].arrayBuffer()),bytes);
});
test('image timeout aborts the direct request and late bytes cannot populate the widget',async()=>{
  const pending=deferred();const h=harness({handler:body=>body.action==='message'?{data:fixture({images:[{id:'F1'}]}),error:null}:pending.promise});await h.settle();
  const request=h.api.requests.find(request=>request.transport==='fetch');assert.equal(request.signal.aborted,false);
  const timeout=[...h.timers.values()].find(timer=>timer.delay===20000);assert.ok(timeout);timeout.fn();await flush();
  assert.equal(request.signal.aborted,true);assert.match(h.get('image-F1').innerHTML,/Image unavailable/);
  pending.resolve(new Response(Uint8Array.from([137,80,78,71]),{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(h.created.length,0);
});
test('missing image access tokens are rejected before making a direct request',async()=>{
  const h=harness({session:{user:{id:'staff-1'}},handler:()=>({data:fixture({images:[{id:'F1'}]}),error:null})});await h.settle();
  assert.equal(h.api.requests.filter(request=>request.transport==='fetch').length,0);assert.equal(h.get('homeSlackMessage').hidden,true);assert.match(h.get('homeSlackStatus').textContent,/access may have changed/);
});
test('late message and image responses cannot reappear after logout',async()=>{
  const pending=deferred();const h=harness({handler:()=>pending.promise});await flush();h.signOut();pending.resolve({data:fixture({text:'Private late message'}),error:null});await flush();
  assert.equal(h.get('homeSlackBody').innerHTML,'');assert.equal(h.get('homeSlackMessage').hidden,true);
  const image=deferred();const i=harness({handler:body=>body.action==='message'?{data:fixture({images:[{id:'F1'}]}),error:null}:image.promise});await i.settle();i.signOut();image.resolve({data:new Blob(['bytes'],{type:'image/png'}),error:null});await flush();
  assert.equal(i.created.length,0);assert.equal(i.get('homeSlackImages').innerHTML,'');
});
test('image access loss clears the entire earlier message',async()=>{
  const h=harness({handler:body=>body.action==='message'?{data:fixture({images:[{id:'F1'}]}),error:null}:{data:null,error:{context:{status:403}}}});await h.settle();
  assert.equal(h.get('homeSlackBody').innerHTML,'');assert.equal(h.get('homeSlackMessage').hidden,true);assert.match(h.get('homeSlackStatus').textContent,/access may have changed/);
});
test('rejects SVG images and malformed image IDs without exposing file URLs',async()=>{
  const h=harness({handler:body=>({data:body.action==='message'?fixture({images:[{id:'F1',title:'vector'},{id:'bad" onclick="x'}]}):new Blob(['<svg/>'],{type:'image/svg+xml'}),error:null})});await h.settle();
  assert.equal(h.created.length,0);assert.equal(h.api.calls.length,2);assert.match(h.get('image-F1').innerHTML,/Image unavailable/);
  assert.ok(!h.get('homeSlackImages').innerHTML.includes('onclick'));
});
test('newer refresh suppresses a late image from the earlier message',async()=>{
  const pending=deferred();let requests=0;
  const h=harness({handler:body=>body.action==='image'?pending.promise:{data:++requests===1?fixture({images:[{id:'F1'}]}):fixture({text:'New message'}),error:null}});await h.settle();
  await h.app.refresh();pending.resolve({data:new Blob(['bytes'],{type:'image/png'}),error:null});await flush();
  assert.equal(h.created.length,0);assert.equal(h.get('homeSlackBody').innerHTML,'New message');
});
test('signed-out visitors never request Slack content',async()=>{
  const h=harness({session:null});await h.settle();assert.equal(h.api.calls.length,0);assert.match(h.get('homeSlackEmpty').textContent,/Sign in/);
});
