const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/home-slack.js'),'utf8');
const emojiSource = fs.readFileSync(path.join(__dirname,'../assets/slack-emoji.js'),'utf8');
const fixture = (patch={}) => ({message:{ts:'1790953200.000001',text:'Hello *team*',author:{name:'Test Staff'},permalink:'https://paws.slack.com/archives/C1/p1790953200000001',images:[],files:[],...patch},updated_at:'2026-10-02T15:00:00Z'});
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function flush(){for(let pass=0;pass<3;pass++){for(let i=0;i<60;i++)await Promise.resolve();await new Promise(setImmediate);}}
function harness({message=fixture(),handler,session={user:{id:'staff-1'},access_token:'fixture-user-jwt'},emoji=true}={}) {
  const nodes=new Map(),listeners={},auth=[],timers=new Map(),intervals=[],created=[],createdBlobs=[],revoked=[];
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes=new Set(),events={},attributes={};
    const n={id,hidden:false,disabled:false,open:false,innerHTML:'',textContent:'',attributes,events,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},
      addEventListener(name,fn){(events[name]??=[]).push(fn);},
      setAttribute(k,v){attributes[k]=v;},getAttribute(k){return attributes[k]??null;},removeAttribute(k){delete attributes[k];delete n[k];},
      showModal(){n.open=true;},close(){n.open=false;},focus(){},
      querySelector(selector){if(selector==='img')return n.innerHTML.includes('<img ')?node(id+'-img'):null;const image=selector.match(/data-slack-image="(.*?)"/)?.[1];return image&&n.innerHTML.includes(`data-slack-image="${image}"`)?node('image-'+image):null;},
      querySelectorAll(selector){
        const name=selector.match(/data-slack-emoji="(.*?)"/)?.[1];
        return [...n.innerHTML.matchAll(/<span class="home-slack-emoji" data-slack-emoji="([^"]+)">/g)].filter(match=>!name||match[1]===name).map((match,index)=>{const slot=node(`emoji-${match[1]}-${index}`);slot.dataset={slackEmoji:match[1]};return slot;});
      }
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
  if(emoji)vm.runInContext(emojiSource,context);
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


test('Slack shortcodes render standard emoji, aliases, flags and composed skin tones',async()=>{
  const text=':dog: :paw_prints: :heart: :rainbow: :+1: :thumbsup: :wave::skin-tone-3: :female-technologist::skin-tone-4: :us: :dog::heart:';
  const h=harness({message:fixture({text})});await h.settle();
  assert.equal(h.get('homeSlackBody').innerHTML,'🐶 🐾 ❤️ 🌈 👍 👍 👋🏼 👩🏽‍💻 🇺🇸 🐶❤️');
  assert.deepEqual(h.api.calls.map(call=>call.action),['message']);
});
test('emoji render alongside Slack formatting while code and URL destinations remain literal',async()=>{
  const h=harness();await h.settle();
  const result=h.app.formatText('*Thank you :heart:* _Great :dog:_ <https://example.test/:dog:?a=1&b=2|Celebrate :tada:> `:dog: :( <3` ```\n:heart:\n:(\n``` https://example.test/:dog:?face=:( :wave:');
  assert.match(result,/<strong>Thank you ❤️<\/strong>/);
  assert.match(result,/<em>Great 🐶<\/em>/);
  assert.match(result,/href="https:\/\/example.test\/:dog:\?a=1&amp;b=2"[^>]*>Celebrate 🎉<\/a>/);
  assert.match(result,/<code>:dog: :\( &lt;3<\/code>/);
  assert.match(result,/<pre><code>\n:heart:\n:\(\n<\/code><\/pre>/);
  assert.ok(result.endsWith('https://example.test/:dog:?face=:( 👋'));
});
test('native Unicode stays intact and common emoticons render only at text boundaries',async()=>{
  const h=harness();await h.settle();
  assert.equal(h.app.formatText('Our sweet dog :( <3 😢'), 'Our sweet dog 😞 ❤️ 😢');
  assert.equal(h.app.formatText('Hello :-) ;) :D :p'), 'Hello 🙂 😉 😄 😛');
  assert.equal(h.app.formatText('array:() ratio 12:30 x<3 https://example.test/:/'), 'array:() ratio 12:30 x&lt;3 https://example.test/:/');
});
test('unknown emoji names and unsupported tones stay readable without HTML or prototype lookups',async()=>{
  const h=harness();await h.settle();
  assert.equal(h.app.formatText(':paws_custom: :constructor: :__proto__: :dog::skin-tone-3:'), ':paws_custom: :constructor: :__proto__: :dog::skin-tone-3:');
  const result=h.app.formatText('&lt;img src=x onerror=alert(1)&gt; :heart: <javascript:alert(1)|:dog:>');
  assert.ok(!result.includes('<img')&&!result.includes('href="javascript:'));
  assert.ok(result.includes('❤️'));assert.ok(result.includes('&lt;img'));
});
test('emoji rendering is idempotent across refreshes and clears with private message text on logout',async()=>{
  const h=harness({message:fixture({text:':wave: *Team :heart:*'})});await h.settle();
  const markup=h.get('homeSlackBody').innerHTML;await h.app.refresh();assert.equal(h.get('homeSlackBody').innerHTML,markup);
  h.signOut();assert.equal(h.get('homeSlackBody').innerHTML,'');assert.equal(h.get('homeSlackMessage').hidden,true);
});
test('a missing emoji asset leaves the Slack widget operational with readable original text',async()=>{
  const h=harness({emoji:false,message:fixture({text:'Team :heart: <https://example.test|Details>'})});await h.settle();
  assert.equal(h.get('homeSlackMessage').hidden,false);assert.match(h.get('homeSlackBody').innerHTML,/Team :heart:/);
  assert.match(h.get('homeSlackBody').innerHTML,/href="https:\/\/example.test\/"/);
});
test('homepage loads the bundled emoji renderer before the widget',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.ok(html.indexOf('/assets/slack-emoji.js?')<html.indexOf('/assets/home-slack.js?'));
  const emoji=require('../assets/slack-emoji.js');
  assert.equal(emoji.resolve('man-woman-girl-boy'),'👨‍👩‍👧‍👦');assert.equal(emoji.resolve('WHITE_CHECK_MARK'),'✅');
  assert.equal(emoji.resolve('constructor'),'');assert.equal(emoji.resolve('__proto__'),'');
});

test('custom emoji take precedence over standard names and aliases resolve without changing code or URLs',async()=>{
  const h=harness();await h.settle();
  const custom=[{name:'dog',image:true},{name:'paws_party',image:true},{name:'thanks',alias:'heart'}];
  const html=h.app.formatText('*Team :paws_party:* :dog: :thanks: `:paws_party:` https://example.test/:dog: <https://example.test/:dog:|:paws_party:>',custom);
  assert.match(html,/<strong>Team <span class="home-slack-emoji" data-slack-emoji="paws_party">:paws_party:<\/span><\/strong>/);
  assert.match(html,/data-slack-emoji="dog"/);assert.ok(html.includes('❤️'));
  assert.match(html,/<code>:paws_party:<\/code>/);assert.ok(html.includes('https://example.test/:dog:'));
  assert.match(html,/href="https:\/\/example.test\/:dog:"[^>]*><span class="home-slack-emoji"/);
  assert.ok(!html.includes('🐶'));
});
test('custom emoji use one authenticated binary request per name and preserve animated GIF bytes',async()=>{
  const payload=fixture({text:':paws_party: :paws_party:',custom_emojis:[{name:'paws_party',image:true}]});
  const bytes=Uint8Array.from([71,73,70,56,57,97,255,254,128,0]);
  const h=harness({handler:body=>body.action==='message'?{data:payload,error:null}:new Response(bytes,{headers:{'Content-Type':'image/gif'}})});await h.settle();
  assert.deepEqual(h.api.calls.map(call=>call.action),['message','emoji']);
  const request=h.api.requests[1];assert.equal(request.transport,'fetch');assert.equal(JSON.parse(request.body).emoji_name,'paws_party');assert.equal(JSON.parse(request.body).message_ts,payload.message.ts);
  assert.equal(request.headers.Authorization,'Bearer fixture-user-jwt');assert.equal(request.credentials,'omit');
  assert.equal(h.createdBlobs[0].type,'image/gif');assert.deepEqual(new Uint8Array(await h.createdBlobs[0].arrayBuffer()),bytes);
  assert.equal(h.app.state.emojiUrls.size,1);assert.match(h.get('emoji-paws_party-0').innerHTML,/<img src="blob:test-0" alt=":paws_party:"/);
  assert.match(h.get('emoji-paws_party-1').innerHTML,/blob:test-0/);
  await h.app.refresh();await flush();assert.ok(h.revoked.includes('blob:test-0'));
  h.signOut();assert.equal(h.app.state.emojiUrls.size,0);assert.equal(h.get('homeSlackBody').innerHTML,'');
});
test('optional emoji failures keep shortcodes readable and reject unsafe or oversized images',async()=>{
  for(const response of [new Response('unavailable',{status:502}),new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}),new Response(new Uint8Array(1024*1024+1),{headers:{'Content-Type':'image/png'}})]){
    const h=harness({handler:body=>body.action==='message'?{data:fixture({text:':paws:',custom_emojis:[{name:'paws',image:true}]}),error:null}:response});await h.settle();
    assert.equal(h.get('homeSlackMessage').hidden,false);assert.match(h.get('homeSlackBody').innerHTML,/>:paws:<\/span>/);assert.equal(h.created.length,0);
  }
  const h=harness();await h.settle();assert.equal(h.app.formatText(':paws:',[{name:'paws" onerror="x',image:true},{name:'paws',alias:'<script>'}]),':paws:');
});
test('revoked access and logout suppress late emoji bytes and release all existing emoji objects',async()=>{
  const pending=deferred();const payload=fixture({text:':paws:',custom_emojis:[{name:'paws',image:true}]});
  const h=harness({handler:body=>body.action==='message'?{data:payload,error:null}:pending.promise});await h.settle();
  h.listeners['window:paws-access-revoked']();pending.resolve(new Response('bytes',{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(h.created.length,0);assert.equal(h.get('homeSlackBody').innerHTML,'');
  const ready=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['GIF89a'],{type:'image/gif'}),error:null})});await ready.settle();
  ready.listeners['window:pagehide']();assert.equal(ready.app.state.emojiUrls.size,0);assert.equal(ready.revoked.length,1);
  const denied=harness({handler:body=>body.action==='message'?{data:payload,error:null}:new Response('{}',{status:403,headers:{'Content-Type':'application/json'}})});await denied.settle();assert.equal(denied.get('homeSlackBody').innerHTML,'');assert.equal(denied.get('homeSlackMessage').hidden,true);
});

test('author profile photos use protected binary transport and keep the existing avatar dimensions',async()=>{
  const payload=fixture({author:{name:'Test Staff',avatar:true}}),bytes=Uint8Array.from([255,216,255,224,0,128]);
  const h=harness({handler:body=>body.action==='message'?{data:payload,error:null}:new Response(bytes,{headers:{'Content-Type':'image/jpeg'}})});await h.settle();
  assert.deepEqual(h.api.calls.map(call=>call.action),['message','avatar']);assert.deepEqual(h.api.calls[1],{action:'avatar',message_ts:payload.message.ts});
  assert.equal(h.api.requests[1].transport,'fetch');assert.equal(h.api.requests[1].headers.Authorization,'Bearer fixture-user-jwt');assert.equal(h.api.requests[1].credentials,'omit');
  assert.equal(h.get('homeSlackInitials').getAttribute('data-initials'),'TS');assert.match(h.get('homeSlackInitials').innerHTML,/<img src="blob:test-0" alt="" decoding="async">/);
  assert.equal(h.app.state.avatarUrl,'blob:test-0');assert.deepEqual(new Uint8Array(await h.createdBlobs[0].arrayBuffer()),bytes);
  const css=fs.readFileSync(path.join(__dirname,'../assets/home-slack.css'),'utf8');assert.match(css,/\.home-slack-avatar img[^}]*object-fit: cover/);
  await h.app.refresh();await flush();assert.ok(h.revoked.includes('blob:test-0'));h.signOut();assert.equal(h.app.state.avatarUrl,null);assert.equal(h.get('homeSlackInitials').textContent,'');
});
test('missing or failed optional avatars preserve initials while revoked access clears the post',async()=>{
  const noPhoto=harness({message:fixture({author:{name:'No Photo'}})});await noPhoto.settle();assert.deepEqual(noPhoto.api.calls.map(call=>call.action),['message']);assert.equal(noPhoto.get('homeSlackInitials').textContent,'NP');
  for(const response of [new Response('{}',{status:404}),new Response('bad',{headers:{'Content-Type':'image/svg+xml'}}),new Response(new Uint8Array(1024*1024+1),{headers:{'Content-Type':'image/png'}})]){
    const h=harness({handler:body=>body.action==='message'?{data:fixture({author:{name:'Test Staff',avatar:true}}),error:null}:response});await h.settle();
    assert.equal(h.get('homeSlackInitials').textContent,'TS');assert.equal(h.get('homeSlackMessage').hidden,false);assert.equal(h.created.length,0);
  }
  const denied=harness({handler:body=>body.action==='message'?{data:fixture({author:{name:'Test Staff',avatar:true}}),error:null}:new Response('{}',{status:403})});await denied.settle();assert.equal(denied.get('homeSlackMessage').hidden,true);assert.equal(denied.get('homeSlackInitials').textContent,'');
});
test('late profile photo responses never reappear after a newer post or workspace revocation',async()=>{
  const pending=deferred();let reads=0;
  const h=harness({handler:body=>body.action==='avatar'?pending.promise:{data:++reads===1?fixture({author:{name:'Old Author',avatar:true}}):fixture({author:{name:'New Author'}}),error:null}});await h.settle();
  await h.app.refresh();pending.resolve(new Response('bytes',{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(h.created.length,0);assert.equal(h.get('homeSlackInitials').textContent,'NA');
  const late=deferred(),r=harness({handler:body=>body.action==='avatar'?late.promise:{data:fixture({author:{name:'Test Staff',avatar:true}}),error:null}});await r.settle();r.listeners['window:paws-access-revoked']();late.resolve(new Response('bytes',{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(r.created.length,0);assert.equal(r.get('homeSlackInitials').textContent,'');
});
test('photo decode errors restore initials and page exit releases successful photos',async()=>{
  const h=harness({handler:body=>({data:body.action==='message'?fixture({author:{name:'Test Staff',avatar:true}}):new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
  h.get('homeSlackInitials-img').events.error[0]();assert.equal(h.get('homeSlackInitials').textContent,'TS');assert.equal(h.app.state.avatarUrl,null);assert.equal(h.revoked.length,1);
  await h.app.refresh();await flush();h.listeners['window:pagehide']();assert.equal(h.app.state.avatarUrl,null);assert.equal(h.revoked.length,2);assert.equal(h.get('homeSlackInitials').textContent,'TS');
});
