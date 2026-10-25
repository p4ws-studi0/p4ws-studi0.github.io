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
function harness({message=fixture(),handler,session={user:{id:'staff-1'},access_token:'fixture-user-jwt'},emoji=true,access}={}) {
  const nodes=new Map(),listeners={},auth=[],timers=new Map(),intervals=[],created=[],createdBlobs=[],revoked=[];
  let dynamicId=0;
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes=new Set(),events={},attributes={};
    const n={id,hidden:false,disabled:false,open:false,textContent:'',attributes,events,children:[],parentNode:null,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},
      addEventListener(name,fn){(events[name]??=[]).push(fn);},
      setAttribute(k,v){attributes[k]=v;},getAttribute(k){return attributes[k]??null;},removeAttribute(k){delete attributes[k];delete n[k];},
      showModal(){n.open=true;},close(){n.open=false;},focus(){},
      remove(){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(child=>child!==n);n.parentNode=null;},
      replaceChildren(...children){n.children=children;for(const child of children)child.parentNode=n;},
      querySelector(selector){if(selector==='img')return n.childImage||(n.innerHTML.includes('<img ')?node(id+'-img'):null);if(selector==='span')return n.childCaption||null;const image=selector.match(/data-slack-image="(.*?)"/)?.[1];return n.children.find(child=>child.dataset?.slackImage===image)||(image&&n.innerHTML.includes(`data-slack-image="${image}"`)?node('image-'+image):null);},
      querySelectorAll(selector){
        const name=selector.match(/data-slack-emoji="(.*?)"/)?.[1];
        return [...n.innerHTML.matchAll(/<span class="home-slack-emoji" data-slack-emoji="([^"]+)">/g)].filter(match=>!name||match[1]===name).map((match,index)=>{const slot=node(`emoji-${match[1]}-${index}`);slot.dataset={slackEmoji:match[1]};return slot;});
      }
    };
    n.dataset=new Proxy({}, {set(target,key,value){target[key]=value;if(key==='slackImage')nodes.set('image-'+value,n);return true;}});
    let markup='';Object.defineProperty(n,'innerHTML',{get(){
      if(n.children.length)return n.children.map(child=>`<button type="button" data-slack-image="${escape(child.dataset.slackImage)}">${child.innerHTML}</button>`).join('');
      if(n.childImage)return `<img src="${escape(n.childImage.src)}" alt="${escape(n.childImage.alt)}" loading="lazy" decoding="async"><span>${escape(n.childCaption.textContent)}</span>`;
      return markup;
    },set(value){
      markup=value;n.children=[];n.childImage=null;n.childCaption=null;
      if(n.tagName==='BUTTON'&&value.startsWith('<img ')){
        n.childImage=node(id+'-img-'+(++dynamicId));n.childImage.src=decode(value.match(/src="([^"]*)"/)?.[1]||'');n.childImage.alt=decode(value.match(/alt="([^"]*)"/)?.[1]||'');
        n.childCaption=node(id+'-caption-'+dynamicId);n.childCaption.textContent=decode(value.match(/<span>([\s\S]*?)<\/span>/)?.[1]||'');
      }
    }});
    nodes.set(id,n);return n;
  }
  const api={calls:[],requests:[],session,message,handler,access,membershipChecks:0,sessionChecks:0,now:Date.parse('2026-10-02T15:00:00Z')};
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
  const client={auth:{async getSession(){api.sessionChecks++;return {data:{session:api.session},error:null};},onAuthStateChange(fn){auth.push(fn);}},functions:{async invoke(name,{body}){return sdkInvoke(body);}}};
  const fetch=async(url,options)=>{
    const body=JSON.parse(options.body);api.requests.push({transport:'fetch',url,body,...options});
    return respond(body);
  };
  const document={hidden:false,getElementById:node,createElement(tag){const created=node('dynamic-'+(++dynamicId));created.tagName=tag.toUpperCase();return created;},addEventListener(name,fn){listeners['document:'+name]=fn;}};
  const window={addEventListener(name,fn){listeners['window:'+name]=fn;}};
  class TestURL extends URL {static createObjectURL(blob){const url='blob:test-'+created.length;created.push(url);createdBlobs.push(blob);return url;}static revokeObjectURL(url){revoked.push(url);}}
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[api.now]));}static now(){return api.now;}}
  let timerId=0;
  const context=vm.createContext({document,window,supabaseClient:client,ensureHqWorkspaceAccess:async session=>{api.membershipChecks++;if(api.access)return api.access(session);return {allowed:true};},URL:TestURL,Date:TestDate,Blob,AbortController,fetch,Intl,console,atob,
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
test('images use authenticated blob requests, preserve enlargement on unchanged refresh, and revoke on logout',async()=>{
  const payload=fixture({images:[{id:'F123',title:'Playtime',alt:'Dogs playing'}]});
  const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['image bytes'],{type:'image/png'}),error:null})});await h.settle();
  assert.deepEqual(h.api.calls.map(c=>c.action),['message','image']);
  assert.equal(h.api.calls[1].file_id,'F123');assert.equal(h.api.calls[1].message_ts,payload.message.ts);
  assert.equal(h.created.length,1);assert.match(h.get('image-F123').innerHTML,/alt="Dogs playing"/);
  await h.click('homeSlackImages',{target:{closest:()=>({dataset:{slackImage:'F123'}})}});
  assert.equal(h.get('homeSlackImageDialog').open,true);assert.equal(h.get('homeSlackLargeImage').src,'blob:test-0');
  await h.app.refresh();await flush();assert.equal(h.revoked.length,0);assert.equal(h.get('homeSlackImageDialog').open,true);assert.equal(h.created.length,1);
  h.signOut();assert.equal(h.get('homeSlackMessage').hidden,true);assert.equal(h.app.state.urls.size,0);assert.equal(h.revoked.length,1);assert.equal(h.get('homeSlackImageDialog').open,false);
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
  await h.app.refresh();await flush();h.listeners['window:pagehide']();assert.equal(h.app.state.avatarUrl,null);assert.equal(h.revoked.length,2);assert.equal(h.get('homeSlackInitials').textContent,'');assert.equal(h.get('homeSlackBody').innerHTML,'');
});

const smallKey=letter=>letter.repeat(64);
const inlineAsset=(key,type='image/png',bytes=Buffer.from([137,80,78,71,13,10,26,10]))=>({key,type,data:bytes.toString('base64')});
const bundledFixture=()=>({...fixture({text:':paws:',author:{name:'Test Staff',avatar:true,avatar_key:smallKey('a')},custom_emojis:[{name:'paws',image:true,key:smallKey('b')}]}),media:[inlineAsset(smallKey('a')),inlineAsset(smallKey('b'),'image/gif',Buffer.from('GIF89a'))]});
test('small photos and emojis render from the authorized message bundle without extra image requests',async()=>{
  const h=harness({message:bundledFixture()});await h.settle();
  assert.deepEqual(h.api.calls.map(call=>call.action),['message']);assert.equal(h.api.calls[0].include_media,true);assert.deepEqual(Array.from(h.api.calls[0].known_media),[]);
  assert.equal(h.created.length,2);assert.equal(h.app.state.smallMedia.size,2);assert.match(h.get('homeSlackInitials').innerHTML,/blob:test-0/);assert.match(h.get('emoji-paws-0').innerHTML,/blob:test-1/);
  assert.equal(h.get('homeSlackWidget').getAttribute('data-slack-inline-media'),'2');
  assert.equal(h.createdBlobs[1].type,'image/gif');assert.deepEqual(Buffer.from(await h.createdBlobs[1].arrayBuffer()),Buffer.from('GIF89a'));
});
test('unchanged media are reused after fresh message authorization instead of redownloading on refresh',async()=>{
  let h;h=harness({handler:body=>{
    assert.equal(body.action,'message','cached small media must not make additional requests');
    return {data:{...bundledFixture(),media:body.known_media.length?[]:bundledFixture().media},error:null};
  }});await h.settle();await h.app.refresh();await flush();
  assert.deepEqual(h.api.calls.map(call=>call.action),['message','message']);assert.deepEqual(Array.from(h.api.calls[1].known_media),[smallKey('a'),smallKey('b')]);assert.equal(h.created.length,2);assert.equal(h.revoked.length,0);
  assert.equal(h.get('homeSlackWidget').getAttribute('data-slack-reused-media'),'2');assert.match(h.get('homeSlackInitials').innerHTML,/blob:test-0/);assert.match(h.get('emoji-paws-0').innerHTML,/blob:test-1/);
  h.signOut();assert.equal(h.app.state.smallMedia.size,0);assert.equal(h.revoked.length,2);
});
test('a changed photo revision replaces only that asset even when the Slack timestamp stays the same',async()=>{
  const h=harness({message:bundledFixture()});await h.settle();const changed=bundledFixture();changed.message.author.avatar_key=smallKey('c');changed.media=[inlineAsset(smallKey('c'))];h.api.message=changed;
  await h.app.refresh();await flush();assert.deepEqual(h.revoked,['blob:test-0']);assert.equal(h.created.length,3);assert.match(h.get('homeSlackInitials').innerHTML,/blob:test-2/);assert.match(h.get('emoji-paws-0').innerHTML,/blob:test-1/);
  h.api.message=fixture({text:'A new post with no media'});await h.app.refresh();assert.equal(h.app.state.smallMedia.size,0);assert.equal(new Set(h.revoked).size,3);
});
test('invalid or unrelated inline images fall back to existing authenticated requests',async()=>{
  for(const invalid of [inlineAsset(smallKey('c')),inlineAsset(smallKey('a'),'image/svg+xml',Buffer.from('<svg/>')),{key:smallKey('a'),type:'image/png',data:'bad><base64'},inlineAsset(smallKey('a'),'image/png',Buffer.alloc(65537))]){
    const data=bundledFixture();data.media=[invalid];data.message.custom_emojis=[];data.message.text='Photo';
    const h=harness({handler:body=>({data:body.action==='message'?data:new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
    assert.deepEqual(h.api.calls.map(call=>call.action),['message','avatar']);assert.equal(h.created.length,1);assert.equal(h.api.requests[1].headers.Authorization,'Bearer fixture-user-jwt');
  }
});
test('warm small-media caches cannot survive access denial, changed accounts or late responses after logout',async()=>{
  const h=harness({message:bundledFixture()});await h.settle();h.api.handler=()=>({data:null,error:{context:new Response(JSON.stringify({error:{code:'ACCESS_DENIED'}}),{status:403,headers:{'Content-Type':'application/json'}})}});await h.app.refresh();assert.equal(h.app.state.smallMedia.size,0);assert.equal(h.revoked.length,2);assert.equal(h.get('homeSlackBody').innerHTML,'');
  const other=harness({message:bundledFixture()});await other.settle();other.api.session={user:{id:'other-staff'},access_token:'other-jwt'};await other.app.refresh();await flush();assert.deepEqual(Array.from(other.api.calls[1].known_media),[]);assert.ok(other.revoked.includes('blob:test-0')&&other.revoked.includes('blob:test-1'));
  const pending=deferred(),late=harness({handler:()=>pending.promise});await flush();late.signOut();pending.resolve({data:bundledFixture(),error:null});await flush();assert.equal(late.created.length,0);assert.equal(late.app.state.smallMedia.size,0);
});
test('custom emojis are scheduled ahead of attachment galleries and known key requests remain bounded',async()=>{
  const pending=deferred();const payload=fixture({text:':first: :second:',author:{name:'Test Staff',avatar:true},custom_emojis:[{name:'first',image:true},{name:'second',image:true}],images:[{id:'F1'},{id:'F2'},{id:'F3'},{id:'F4'}]});
  const h=harness({handler:body=>body.action==='message'?{data:payload,error:null}:pending.promise});await h.settle();assert.deepEqual(h.api.calls.slice(1).map(call=>call.action),['avatar','emoji','emoji']);
  h.signOut();pending.resolve(new Response('bytes',{headers:{'Content-Type':'image/png'}}));await flush();
  const many=harness();await many.settle();for(let i=0;i<65;i++)many.app.state.smallMedia.set(i.toString(16).padStart(64,'0'),{url:'blob:cached-'+i,size:1});await many.app.refresh();assert.equal(many.api.calls[1].known_media.length,48);assert.ok(JSON.stringify(many.api.calls[1]).length<4096);
});
test('aliases share one bundled image and an oversized combined bundle falls back within its byte budget',async()=>{
  const alias=fixture({text:':first: :second:',custom_emojis:[{name:'first',image:true,key:smallKey('a')},{name:'second',image:true,key:smallKey('a')}]});alias.media=[inlineAsset(smallKey('a'))];
  const shared=harness({message:alias});await shared.settle();assert.equal(shared.created.length,1);assert.deepEqual(shared.api.calls.map(call=>call.action),['message']);assert.equal(shared.app.state.emojiUrls.get('first'),shared.app.state.emojiUrls.get('second'));shared.signOut();assert.equal(shared.revoked.length,1);
  const names=Array.from({length:9},(_,i)=>'custom_'+i),keys=names.map((_,i)=>i.toString(16).padStart(64,'0'));
  const payload=fixture({text:names.map(name=>':'+name+':').join(' '),custom_emojis:names.map((name,i)=>({name,image:true,key:keys[i]}))});payload.media=keys.map(key=>inlineAsset(key,'image/png',Buffer.alloc(65536)));
  const limited=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['bytes'],{type:'image/png'}),error:null})});await limited.settle();assert.equal(limited.get('homeSlackWidget').getAttribute('data-slack-inline-media'),'4');assert.equal(limited.api.calls.filter(call=>call.action==='emoji').length,5);
});

test('50 unchanged authorized refreshes reuse the same attachment bytes, blob URL, button and image node',async()=>{
  const payload=fixture({images:[{id:'F1',title:'Playtime',alt:'Dogs playing'}]});
  const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['image bytes'],{type:'image/png'}),error:null})});await h.settle();
  const button=h.get('image-F1'),image=button.querySelector('img');
  for(let i=0;i<50;i++){h.api.now+=60000;await h.app.refresh({automatic:true});}
  await flush();
  assert.equal(h.api.calls.filter(call=>call.action==='message').length,51);assert.equal(h.api.membershipChecks,51);
  assert.equal(h.api.calls.filter(call=>call.action==='image').length,1);assert.equal(h.api.requests.filter(request=>request.transport==='fetch').length,1);
  assert.equal(h.created.length,1);assert.equal(h.revoked.length,0);assert.equal(h.get('image-F1'),button);assert.equal(button.querySelector('img'),image);
  assert.equal(h.app.state.urls.get('F1').url,'blob:test-0');assert.equal(h.app.state.urls.get('F1').size,11);assert.equal(h.app.state.attachmentPending.size,0);
});
test('editing text, caption or alt text keeps the attachment and lightbox while updating readable metadata',async()=>{
  let payload=fixture({images:[{id:'F1',title:'Original',alt:'Original alt'}]});
  const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
  const button=h.get('image-F1'),image=button.querySelector('img');
  await h.click('homeSlackImages',{target:{closest:()=>({dataset:{slackImage:'F1'}})}});
  payload=fixture({text:'Edited post',images:[{id:'F1',title:'New <caption>',alt:'New alt "quoted"'}]});await h.app.refresh();await flush();
  assert.equal(h.get('homeSlackBody').innerHTML,'Edited post');assert.equal(h.get('image-F1'),button);assert.equal(button.querySelector('img'),image);
  assert.equal(image.alt,'New alt "quoted"');assert.equal(button.querySelector('span').textContent,'New <caption>');assert.equal(button.getAttribute('aria-label'),'Enlarge image: New <caption>');
  assert.equal(h.get('homeSlackImageDialog').open,true);assert.equal(h.get('homeSlackLargeImage').src,'blob:test-0');assert.equal(h.get('homeSlackLargeImage').alt,'New alt "quoted"');assert.equal(h.get('homeSlackImageTitle').textContent,'New <caption>');
  assert.equal(h.api.calls.filter(call=>call.action==='image').length,1);assert.equal(h.created.length,1);assert.equal(h.revoked.length,0);
});
test('a new latest message replaces attachment bytes even if Slack reuses the same file ID',async()=>{
  let payload=fixture({images:[{id:'F1'}]});const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
  const oldButton=h.get('image-F1');await h.click('homeSlackImages',{target:{closest:()=>({dataset:{slackImage:'F1'}})}});
  payload=fixture({ts:'1790953260.000002',images:[{id:'F1'}]});await h.app.refresh();await flush();
  assert.deepEqual(h.api.calls.filter(call=>call.action==='image').map(call=>call.message_ts),['1790953200.000001','1790953260.000002']);
  assert.notEqual(h.get('image-F1'),oldButton);assert.deepEqual(h.revoked,['blob:test-0']);assert.equal(h.app.state.urls.get('F1').url,'blob:test-1');assert.equal(h.get('homeSlackImageDialog').open,false);
});
test('gallery additions, removals and reordering reuse only current-message files and revoke removed images',async()=>{
  let payload=fixture({images:[{id:'F1'},{id:'F2'}]});const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
  const first=h.get('image-F1'),second=h.get('image-F2'),secondUrl=h.app.state.urls.get('F2').url;
  payload=fixture({images:[{id:'F2'},{id:'F1'},{id:'F3'}]});await h.app.refresh();await flush();
  assert.equal(h.get('image-F1'),first);assert.equal(h.get('image-F2'),second);assert.deepEqual(h.get('homeSlackImages').children.map(button=>button.dataset.slackImage),['F2','F1','F3']);
  assert.deepEqual(h.api.calls.filter(call=>call.action==='image').map(call=>call.file_id),['F1','F2','F3']);assert.equal(h.revoked.length,0);
  payload=fixture({images:[{id:'F2'}]});await h.app.refresh();await flush();assert.equal(h.app.state.urls.size,1);assert.equal(h.app.state.urls.get('F2').url,secondUrl);assert.equal(h.app.state.imageButtons.size,1);assert.equal(h.revoked.length,2);
  payload=fixture({text:'Same post, attachments removed',images:[]});await h.app.refresh();assert.equal(h.app.state.urls.size,0);assert.equal(h.app.state.imageButtons.size,0);assert.equal(h.get('homeSlackImages').hidden,true);assert.equal(h.get('homeSlackImages').innerHTML,'');assert.equal(h.revoked.length,3);
});
test('warm attachment caches cannot bypass a fresh failed workspace check',async()=>{
  const payload=fixture({images:[{id:'F1'}]});const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
  await h.click('homeSlackImages',{target:{closest:()=>({dataset:{slackImage:'F1'}})}});const requests=h.api.calls.length;
  h.api.access=()=>{throw new Error('Access could not be verified');};await h.app.refresh();
  assert.equal(h.api.membershipChecks,2);assert.equal(h.api.calls.length,requests);assert.equal(h.app.state.urls.size,0);assert.equal(h.get('homeSlackImages').innerHTML,'');assert.equal(h.get('homeSlackMessage').hidden,true);assert.equal(h.get('homeSlackImageDialog').open,false);assert.deepEqual(h.revoked,['blob:test-0']);
});
test('an unchanged partial gallery keeps completed files, aborts old downloads and retries only unfinished files',async()=>{
  const pending=deferred();let secondReads=0;
  const payload=fixture({images:[{id:'F1'},{id:'F2'}]});const h=harness({handler:body=>{
    if(body.action==='message')return {data:payload,error:null};
    if(body.file_id==='F2'&&++secondReads===1)return pending.promise;
    return {data:new Blob([body.file_id],{type:'image/png'}),error:null};
  }});await h.settle();
  const first=h.get('image-F1'),firstUrl=h.app.state.urls.get('F1').url,oldRequest=h.api.requests.find(request=>request.transport==='fetch'&&JSON.parse(request.body).file_id==='F2');
  assert.equal(oldRequest.signal.aborted,false);await h.app.refresh();await flush();assert.equal(oldRequest.signal.aborted,true);
  assert.equal(h.get('image-F1'),first);assert.equal(h.app.state.urls.get('F1').url,firstUrl);assert.equal(h.api.calls.filter(call=>call.action==='image'&&call.file_id==='F1').length,1);assert.equal(h.api.calls.filter(call=>call.action==='image'&&call.file_id==='F2').length,2);
  assert.equal(h.app.state.urls.size,2);assert.equal(h.created.length,2);assert.equal(h.revoked.length,0);assert.equal(h.app.state.attachmentPending.size,0);
  pending.resolve(new Response('stale bytes',{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(h.created.length,2);assert.equal(h.app.state.urls.get('F1').url,firstUrl);
});
test('failed downloads and image decode errors retry without redownloading good attachments',async()=>{
  let badReads=0;const payload=fixture({images:[{id:'F1'},{id:'F2'},{id:'F3'}]});const h=harness({handler:body=>{
    if(body.action==='message')return {data:payload,error:null};
    if(body.file_id==='F2'&&++badReads===1)return new Response('{}',{status:404});
    return {data:new Blob(['bytes'],{type:'image/png'}),error:null};
  }});await h.settle();
  const goodUrl=h.app.state.urls.get('F1').url,third=h.get('image-F3').querySelector('img');
  third.events.error[0]();assert.equal(h.app.state.urls.size,1);assert.match(h.get('image-F2').innerHTML,/Image unavailable/);assert.match(h.get('image-F3').innerHTML,/Image unavailable/);
  await h.app.refresh();await flush();assert.equal(h.app.state.urls.size,3);assert.equal(h.app.state.urls.get('F1').url,goodUrl);
  assert.equal(h.api.calls.filter(call=>call.action==='image'&&call.file_id==='F1').length,1);assert.equal(h.api.calls.filter(call=>call.action==='image'&&call.file_id==='F2').length,2);assert.equal(h.api.calls.filter(call=>call.action==='image'&&call.file_id==='F3').length,2);
  assert.equal(h.revoked.length,1);
});
test('logout, revocation and pagehide abort in-flight attachments and late bytes cannot recreate cleared caches',async()=>{
  for(const event of ['logout','revocation','pagehide']){
    const pending=deferred(),payload=fixture({images:[{id:'F1'},{id:'F2'}]});const h=harness({handler:body=>body.action==='message'?{data:payload,error:null}:body.file_id==='F2'?pending.promise:{data:new Blob(['bytes'],{type:'image/png'}),error:null}});await h.settle();
    const request=h.api.requests.find(request=>request.transport==='fetch'&&JSON.parse(request.body).file_id==='F2');
    if(event==='logout')h.signOut();else h.listeners['window:'+(event==='revocation'?'paws-access-revoked':'pagehide')]();
    assert.equal(request.signal.aborted,true,event);assert.equal(h.app.state.urls.size,0,event);assert.equal(h.app.state.imageButtons.size,0,event);assert.equal(h.app.state.attachmentPending.size,0,event);assert.equal(h.get('homeSlackImages').innerHTML,'',event);
    pending.resolve(new Response('old bytes',{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(h.created.length,1,event);assert.equal(h.revoked.length,1,event);
  }
});
test('an account switch cannot reuse previous attachment blobs or let late responses and decode errors replace new files',async()=>{
  const pending=deferred();let reads=0;const payload=fixture({images:[{id:'F1'},{id:'F2'}]});const h=harness({handler:body=>{
    if(body.action==='message')return {data:payload,error:null};
    if(body.file_id==='F2'&&++reads===1)return pending.promise;
    return {data:new Blob(['current bytes'],{type:'image/png'}),error:null};
  }});await h.settle();
  const oldImage=h.get('image-F1').querySelector('img'),oldRequest=h.api.requests.find(request=>request.transport==='fetch'&&JSON.parse(request.body).file_id==='F2');
  h.api.session={user:{id:'other-staff'},access_token:'other-jwt'};await h.app.refresh();await flush();assert.equal(oldRequest.signal.aborted,true);assert.equal(h.revoked.length,1);assert.equal(h.created.length,3);
  const newUrl=h.app.state.urls.get('F1').url;assert.notEqual(newUrl,'blob:test-0');oldImage.events.error[0]();assert.equal(h.app.state.urls.get('F1').url,newUrl);
  pending.resolve(new Response('old private bytes',{headers:{'Content-Type':'image/png'}}));await flush();assert.equal(h.created.length,3);assert.equal(h.app.state.urls.get('F1').url,newUrl);
  const imageRequests=h.api.requests.filter(request=>request.transport==='fetch');assert.ok(imageRequests.slice(2).every(request=>request.headers.Authorization==='Bearer other-jwt'));
});
test('attachment caches retain at most the current 12-image gallery and reject files above 8 MiB',async()=>{
  let payload=fixture({images:Array.from({length:15},(_,i)=>({id:'F'+i}))});const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob([new Uint8Array(body.file_id==='F0'?8*1024*1024+1:64)],{type:'image/png'}),error:null})});await h.settle();
  for(let i=0;i<20&&h.app.state.attachmentPending.size;i++)await flush();
  assert.equal(h.api.calls.filter(call=>call.action==='image').length,12);assert.equal(h.app.state.imageButtons.size,12);assert.equal(h.app.state.urls.size,11);assert.equal(h.app.state.urls.has('F0'),false);assert.match(h.get('image-F0').innerHTML,/Image unavailable/);
  assert.ok([...h.app.state.urls.values()].reduce((sum,item)=>sum+item.size,0)<=96*1024*1024);
  for(let i=0;i<3;i++){payload=fixture({ts:`17909532${i+1}.000002`,images:[{id:'F1'}]});await h.app.refresh();await flush();assert.equal(h.app.state.urls.size,1);assert.equal(h.app.state.imageButtons.size,1);assert.equal(h.created.length-h.revoked.length,1);}
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB/);
});
test('pagehide invalidates pending metadata and BFCache restore reauthorizes instead of reviving cached blobs',async()=>{
  const pending=deferred(),payload=fixture({images:[{id:'F1'}]});const h=harness({handler:body=>({data:body.action==='message'?payload:new Blob(['bytes'],{type:'image/png'}),error:null})});await h.settle();
  h.api.handler=()=>pending.promise;const refresh=h.app.refresh();await flush();h.listeners['window:pagehide']();assert.equal(h.app.state.urls.size,0);
  pending.resolve({data:fixture({text:'Private late metadata',images:[{id:'F2'}]}),error:null});await refresh;await flush();assert.equal(h.app.state.urls.size,0);assert.doesNotMatch(h.get('homeSlackBody').innerHTML,/Private late metadata/);
  h.api.handler=body=>({data:body.action==='message'?payload:new Blob(['new bytes'],{type:'image/png'}),error:null});h.listeners['window:pageshow']({persisted:true});await flush();assert.equal(h.app.state.urls.size,1);assert.equal(h.created.length,2);assert.equal(h.revoked.length,1);assert.equal(h.api.membershipChecks,3);
});
