/* Edge-function behavior with synthetic users, messages, files, and HTTP responses. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/hq-slack-general/index.ts'),'utf8');
const loaded=import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const UUID='00000000-0000-4000-8000-000000000001';
const TEAM='TTEST',CHANNEL='CGENERAL',VIEWER='UVIEWER',AUTHOR='UAUTHOR',FILE='FIMAGE';
const ORIGIN='https://hq.pawspet.com',PROJECT='https://fixture.supabase.co';
const PNG=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const copy=value=>structuredClone(value);
const account=(extra={})=>({id:UUID,identities:[{provider:'slack_oidc',identity_data:{sub:VIEWER,provider_id:VIEWER,custom_claims:{'https://slack.com/team_id':TEAM}}}],...extra});
const message=(extra={})=>({type:'message',user:AUTHOR,text:'A synthetic team update',ts:'1770000000.000123',...extra});
const file=(extra={})=>({id:FILE,title:'Fixture image',mimetype:'image/png',is_external:false,url_private:'https://files.slack.com/files-pri/TTEST-FIMAGE/fixture.png',...extra});
async function environment(options={}){
 const {createHandler}=await loaded;
 const state={clock:Date.parse('2026-10-02T15:00:00Z'),user:account(),approved:true,members:[VIEWER],messages:[message()],files:{[FILE]:file()},emojis:{},users:{},calls:[],diagnostics:[],intercept:null,...options};
 const env={SUPABASE_URL:PROJECT,SUPABASE_ANON_KEY:'fixture-public-key',SLACK_BOT_TOKEN:'fixture-private-token',SLACK_TEAM_ID:TEAM,SLACK_GENERAL_CHANNEL_ID:CHANNEL,...options.env};
 const mock=async(input,init={})=>{
  const url=new URL(input),headers=new Headers(init.headers),params=init.body instanceof URLSearchParams?Object.fromEntries(init.body):{};
  const call={url:url.href,method:init.method||'GET',headers,params,redirect:init.redirect,signal:init.signal,api:url.hostname==='slack.com'?url.pathname.split('/').pop():null};
  state.calls.push(call);const custom=await state.intercept?.(call,state);if(custom!==undefined)return custom;
  if(url.origin===PROJECT&&url.pathname==='/auth/v1/user')return state.user?json(state.user):json({message:'Invalid token'},401);
  if(url.origin===PROJECT&&url.pathname==='/rest/v1/hq_tour_staff')return json(state.approved?[{user_id:state.user.id}]:[]);
  if(url.hostname==='files.slack.com'||url.hostname.endsWith('.slack-edge.com')||url.hostname==='my.slack.com')return new Response(PNG,{headers:{'Content-Type':'image/png'}});
  assert.equal(url.hostname,'slack.com',`Unexpected upstream host ${url.hostname}`);
  switch(call.api){
   case 'auth.test':return json({ok:true,team_id:TEAM});
   case 'conversations.info':return json({ok:true,channel:{id:CHANNEL,is_general:true,is_member:true,is_private:false}});
   case 'users.info':return json({ok:true,user:state.users[params.user]||{id:params.user,team_id:TEAM,deleted:false,is_bot:false,profile:{display_name:params.user===VIEWER?'Fixture viewer':'Fixture author'}}});
   case 'conversations.members':return json({ok:true,members:state.members,response_metadata:{next_cursor:''}});
   case 'conversations.history':return json({ok:true,messages:state.messages,response_metadata:{next_cursor:''}});
   case 'chat.getPermalink':return json({ok:true,permalink:`https://fixture.slack.com/archives/${CHANNEL}/p${params.message_ts.replace('.','')}`});
   case 'files.info':return state.files[params.file]?json({ok:true,file:state.files[params.file]}):json({ok:false,error:'file_not_found'});
   case 'emoji.list':return json({ok:true,emoji:state.emojis});
   default:assert.fail(`Unexpected Slack API ${call.api}`);
  }
 };
 const handler=createHandler({env,fetch:mock,now:()=>state.clock,log:options.log||((entry)=>state.diagnostics.push(entry))});
 return {state,env,handler,
  async request(body={action:'message'},init={}){
   const headers={Origin:ORIGIN,Authorization:'Bearer fixture-user-jwt','Content-Type':'application/json',...init.headers};
   for(const key of Object.keys(headers))if(headers[key]===null)delete headers[key];
   return handler(new Request('https://fixture.supabase.co/functions/v1/hq-slack-general',{method:'POST',...init,headers,body:typeof body==='string'?body:JSON.stringify(body)}));
  },
  calls:method=>state.calls.filter(call=>call.api===method),
  advance:ms=>{state.clock+=ms;}
 };
}
async function errorIs(response,status,code){assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});}

test('setup diagnostics distinguish each missing or malformed environment key without logging values',async()=>{
 for(const [key,value,reason] of [
  ['SUPABASE_URL','','MISSING_SUPABASE_URL'],['SUPABASE_URL','not a URL secret','MALFORMED_SUPABASE_URL'],
  ['SUPABASE_ANON_KEY','','MISSING_SUPABASE_ANON_KEY'],['SUPABASE_ANON_KEY','key with spaces','MALFORMED_SUPABASE_ANON_KEY'],
  ['SLACK_BOT_TOKEN','','MISSING_SLACK_BOT_TOKEN'],['SLACK_BOT_TOKEN','token with spaces','MALFORMED_SLACK_BOT_TOKEN'],
  ['SLACK_TEAM_ID','','MISSING_SLACK_TEAM_ID'],['SLACK_TEAM_ID','https://fixture.slack.com','MALFORMED_SLACK_TEAM_ID'],
  ['SLACK_GENERAL_CHANNEL_ID','','MISSING_SLACK_GENERAL_CHANNEL_ID'],['SLACK_GENERAL_CHANNEL_ID','#general','MALFORMED_SLACK_GENERAL_CHANNEL_ID']
 ]){
  const h=await environment({env:{[key]:value}});await errorIs(await h.request(),503,'CONNECTION_REQUIRED');
  assert.deepEqual(h.state.diagnostics,[{reason}]);assert.equal(h.state.calls.filter(call=>call.api).length,0);
 }
});
test('surrounding whitespace in Slack secrets is trimmed without interpreting URLs or changing IDs',async()=>{
 const h=await environment({env:{SLACK_BOT_TOKEN:' \nfixture-private-token\t',SLACK_TEAM_ID:' TTEST\n',SLACK_GENERAL_CHANNEL_ID:'\tCGENERAL '}});
 assert.equal((await h.request()).status,200);assert.deepEqual(h.state.diagnostics,[]);
 assert.ok(h.state.calls.filter(call=>call.api).every(call=>call.headers.get('Authorization')==='Bearer fixture-private-token'));
 assert.equal(h.calls('conversations.info')[0].params.channel,CHANNEL);
});
test('configuration diagnostics distinguish workspace and channel setup failures',async()=>{
 for(const [patch,reason] of [[{id:'COTHER'},'CHANNEL_ID_MISMATCH'],[{is_general:false},'CHANNEL_NOT_GENERAL'],[{is_private:true},'CHANNEL_PRIVATE'],[{is_member:false},'BOT_NOT_CHANNEL_MEMBER']]){
  const h=await environment({intercept:call=>call.api==='conversations.info'?json({ok:true,channel:{id:CHANNEL,is_general:true,is_member:true,is_private:false,...patch}}):undefined});
  await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.deepEqual(h.state.diagnostics,[{reason,method:'conversations.info'}]);
 }
 const h=await environment({intercept:call=>call.api==='auth.test'?json({ok:true,team_id:'TOPAQUESECRET'}):undefined});
 await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.deepEqual(h.state.diagnostics,[{reason:'BOT_TEAM_MISMATCH',method:'auth.test'}]);
});
test('Slack diagnostics allowlist error codes and never include raw provider data or thrown details',async()=>{
 for(const error of ['missing_scope','not_in_channel','invalid_auth','token_revoked','account_inactive']){
  const h=await environment({intercept:call=>call.api==='auth.test'?json({ok:false,error,needed:'secret needed scopes',provided:'secret supplied scopes',token:'secret token'}):undefined});
  await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.deepEqual(h.state.diagnostics,[{reason:'SLACK_API_ERROR',method:'auth.test',slack_error:error}]);
 }
 const unknown=await environment({intercept:call=>call.api==='auth.test'?json({ok:false,error:'secret raw error payload'}):undefined});
 await errorIs(await unknown.request(),502,'SLACK_UNAVAILABLE');assert.deepEqual(unknown.state.diagnostics,[{reason:'SLACK_API_ERROR',method:'auth.test'}]);
 const thrown=await environment({intercept:call=>{if(call.api==='auth.test')throw new Error('secret transport error');}});
 await errorIs(await thrown.request(),502,'UNAVAILABLE');assert.deepEqual(thrown.state.diagnostics,[]);
});
test('diagnostic sink errors cannot change access checks or expose log details',async()=>{
 const h=await environment({env:{SLACK_BOT_TOKEN:''},log:()=>{throw new Error('secret diagnostic failure');}});
 await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.equal(h.state.calls.filter(call=>call.api).length,0);
});

test('Slack endpoint handles CORS and rejects unsupported methods without fetching records',async()=>{
 const h=await environment();
 const preflight=await h.handler(new Request('https://fixture.test',{method:'OPTIONS',headers:{Origin:ORIGIN}}));assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 await errorIs(await h.request({action:'message'},{headers:{Origin:'https://evil.example'}}),403,'ACCESS_DENIED');
 await errorIs(await h.handler(new Request('https://fixture.test',{method:'GET'})),405,'METHOD_NOT_ALLOWED');assert.equal(h.state.calls.length,0);
});
test('Slack endpoint rejects malformed, unsupported and oversized input before upstream work',async()=>{
 const h=await environment();for(const body of ['not json','null','[]',JSON.stringify({action:'other'}),JSON.stringify({action:'message',junk:'x'.repeat(4096)})])await errorIs(await h.request(body),400,'INVALID_REQUEST');
 assert.equal(h.state.calls.length,0);
});
test('missing or invalid user authorization never reaches Slack',async()=>{
 for(const bearer of [null,'','fixture-user-jwt','Bearer a b']){const h=await environment();await errorIs(await h.request({action:'message'},{headers:{Authorization:bearer}}),401,'AUTH_REQUIRED');assert.equal(h.state.calls.length,0);}
 const h=await environment({user:null});await errorIs(await h.request(),401,'AUTH_REQUIRED');assert.equal(h.state.calls.filter(call=>call.api).length,0);
});
test('staff authorization is checked with the caller JWT and unapproved accounts are denied',async()=>{
 const h=await environment({approved:false});await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(h.state.calls.filter(call=>call.api).length,0);
 assert.ok(h.state.calls.every(call=>call.headers.get('Authorization')==='Bearer fixture-user-jwt'));
 const staff=h.state.calls.find(call=>call.url.includes('/rest/v1/'));assert.equal(new URL(staff.url).searchParams.get('user_id'),`eq.${UUID}`);assert.equal(new URL(staff.url).searchParams.get('active'),'eq.true');
});
test('editable user metadata cannot forge a Slack identity or workspace',async()=>{
 for(const user of [account({identities:[],user_metadata:{sub:VIEWER,provider_id:VIEWER,custom_claims:{'https://slack.com/team_id':TEAM}}}),account({identities:[{provider:'email',identity_data:{sub:VIEWER,'https://slack.com/team_id':TEAM}}]}),account({identities:[{provider:'slack_oidc',identity_data:{sub:VIEWER,custom_claims:{'https://slack.com/team_id':'TOTHER'}}}]})]){
  const h=await environment({user});await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(h.state.calls.filter(call=>call.api).length,0);
 }
});
test('deleted, bot and foreign-workspace Slack viewers cannot read the feed',async()=>{
 for(const viewer of [{deleted:true},{is_bot:true},{team_id:'TOTHER'}]){
  const h=await environment({users:{[VIEWER]:{id:VIEWER,team_id:TEAM,deleted:false,is_bot:false,...viewer}}});await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(h.calls('conversations.history').length,0);
 }
 const h=await environment({members:[],users:{[VIEWER]:{id:VIEWER,team_id:TEAM,deleted:false,is_bot:false,is_restricted:true,is_ultra_restricted:true}}});assert.equal((await h.request()).status,200);assert.equal(h.calls('conversations.members').length,0);
});
test('bot workspace and channel must match the configured public general channel',async()=>{
 for(const channel of [{id:'COTHER'},{is_general:false},{is_member:false},{is_private:true}]){
  const h=await environment({intercept:call=>call.api==='conversations.info'?json({ok:true,channel:{id:CHANNEL,is_general:true,is_member:true,is_private:false,...channel}}):undefined});await errorIs(await h.request(),503,'CONNECTION_REQUIRED');assert.equal(h.calls('conversations.history').length,0);
 }
 const h=await environment({intercept:call=>call.api==='auth.test'?json({ok:true,team_id:'TOTHER'}):undefined});await errorIs(await h.request(),503,'CONNECTION_REQUIRED');
});
test('workspace guests receive the public widget without a separate channel-member tier',async()=>{
 const h=await environment({members:[]});assert.equal((await h.request()).status,200);assert.equal(h.calls('conversations.members').length,0);
});
test('channel roster API failures cannot deny otherwise valid workspace access',async()=>{
 const h=await environment({intercept:call=>call.api==='conversations.members'?json({ok:false,error:'missing_scope'}):undefined});
 assert.equal((await h.request()).status,200);assert.equal(h.calls('conversations.members').length,0);
});
test('latest post skips system events, hidden messages and thread replies and sorts exact timestamp strings',async()=>{
 const h=await environment({messages:[message({ts:'1770000000.000001',text:'older'}),message({ts:'1770000000.000009',text:'latest'}),message({ts:'1770000000.000007',text:'middle'}),message({ts:'1770000001.000001',subtype:'channel_join'}),message({ts:'1770000002.000001',hidden:true}),message({ts:'1770000003.000001',deleted:true}),message({ts:'1770000004.000001',thread_ts:'1770000000.000001'})]});
 const res=await h.request(),body=await res.json();assert.equal(res.status,200);assert.equal(body.message.text,'latest');assert.equal(body.message.ts,'1770000000.000009');assert.equal(body.message.author.name,'Fixture author');
 assert.equal(body.message.permalink,`https://fixture.slack.com/archives/${CHANNEL}/p1770000000000009`);
 assert.equal(h.calls('conversations.history')[0].params.channel,CHANNEL);
});
test('history pagination finds a real post after an event-only page and returns null for empty history',async()=>{
 const h=await environment({intercept:call=>call.api==='conversations.history'?json({ok:true,messages:call.params.cursor?[message()]:[message({subtype:'channel_join'})],response_metadata:{next_cursor:call.params.cursor?'':'older'}}):undefined});
 assert.equal((await (await h.request()).json()).message.text,'A synthetic team update');assert.equal(h.calls('conversations.history').length,2);
 const empty=await environment({messages:[]});assert.equal((await (await empty.request()).json()).message,null);
});
test('repeated history cursors fail instead of reporting an empty channel',async()=>{
 const h=await environment({intercept:call=>call.api==='conversations.history'?json({ok:true,messages:[message({subtype:'channel_join'})],response_metadata:{next_cursor:'loop'}}):undefined});
 await errorIs(await h.request(),502,'SLACK_UNAVAILABLE');
});
test('file-only and bot posts are displayed without requiring message text or user',async()=>{
 const image=await environment({messages:[message({subtype:'file_share',text:'',files:[file()]})]});const response=await image.request(),body=await response.json();
 assert.equal(body.message.text,'');assert.deepEqual(body.message.images,[{id:FILE,title:'Fixture image',alt:'Fixture image'}]);
 assert.ok(!JSON.stringify(body).includes('files.slack.com'));assert.ok(!JSON.stringify(body).includes(image.env.SLACK_BOT_TOKEN));
 const bot=await environment({messages:[message({user:undefined,subtype:'bot_message',bot_profile:{name:'Fixture app'},text:'',attachments:[{fallback:'Attachment update'}]})]});const botBody=await (await bot.request()).json();
 assert.equal(botBody.message.author.name,'Fixture app');assert.equal(botBody.message.text,'Attachment update');
});
test('block-only rich text preserves readable text, mentions and links',async()=>{
 const h=await environment({messages:[message({text:'',blocks:[{type:'rich_text',elements:[
  {type:'rich_text_section',elements:[{type:'text',text:'Hello '},{type:'user',user_id:'UAUTHOR'},{type:'text',text:' in '},{type:'channel',channel_id:CHANNEL},{type:'text',text:' '},{type:'emoji',name:'wave'}]},
  {type:'rich_text_section',elements:[{type:'link',url:'https://example.com/update',text:'Read update'}]}
 ]}]})]});
 const body=await (await h.request()).json();assert.equal(body.message.text,`Hello <@UAUTHOR> in <#${CHANNEL}> :wave:\n<https://example.com/update|Read update>`);
});
test('block-only sections retain both their heading and all field text',async()=>{
 const h=await environment({messages:[message({text:'',blocks:[
  {type:'header',text:{type:'plain_text',text:'Team update'}},
  {type:'section',text:{type:'mrkdwn',text:'Today'},fields:[{type:'mrkdwn',text:'*Opening*'},{type:'plain_text',text:'7 am'}]},
  {type:'section',fields:[{type:'plain_text',text:'Closing'},{type:'plain_text',text:'6 pm'}]}
 ]})]});
 const body=await (await h.request()).json();assert.equal(body.message.text,'Team update\nToday\n*Opening*\n7 am\nClosing\n6 pm');
});
test('the supplied message fallback remains authoritative when blocks are also present',async()=>{
 const h=await environment({messages:[message({text:'Complete fallback',blocks:[{type:'section',text:{type:'plain_text',text:'Block detail'}}]})]});
 assert.equal((await (await h.request()).json()).message.text,'Complete fallback');
});
test('check_file_info and ID-only files are hydrated before classifying images',async()=>{
 for(const brief of [{id:FILE,file_access:'check_file_info'},{id:FILE}]){
  const h=await environment({messages:[message({text:'',files:[brief]})],files:{[FILE]:file({title:'Hydrated image',alt_txt:'Descriptive image text'})}});
  const body=await (await h.request()).json();assert.deepEqual(body.message.images,[{id:FILE,title:'Hydrated image',alt:'Descriptive image text'}]);assert.equal(body.message.files.length,0);
  assert.equal(h.calls('files.info').length,1);assert.equal(h.calls('files.info')[0].params.file,FILE);assert.ok(!JSON.stringify(body).includes('url_private'));
  assert.equal((await h.request({action:'image',file_id:FILE,message_ts:message().ts})).status,200);
 }
});
test('hydrated non-image files remain attachments and inaccessible files preserve the post',async()=>{
 const document=await environment({messages:[message({files:[{id:FILE,file_access:'check_file_info'}]})],files:{[FILE]:file({mimetype:'application/pdf',title:'Fixture document'})}});
 const docBody=await (await document.request()).json();assert.equal(docBody.message.images.length,0);assert.equal(docBody.message.files[0].title,'Fixture document');
 const inaccessible=await environment({messages:[message({files:[{id:FILE,file_access:'check_file_info'}]})],files:{}});
 const unavailable=await inaccessible.request();assert.equal(unavailable.status,200);const body=await unavailable.json();assert.equal(body.message.text,'A synthetic team update');assert.equal(body.message.images.length,0);assert.equal(body.message.files[0].id,FILE);
});
test('file hydration still propagates missing permissions and rate limits',async()=>{
 for(const [status,code] of [[503,'CONNECTION_REQUIRED'],[429,'RATE_LIMITED']]){
  const h=await environment({messages:[message({files:[{id:FILE,file_access:'check_file_info'}]})],intercept:call=>call.api==='files.info'?(status===503?json({ok:false,error:'missing_scope'}):new Response(null,{status:429,headers:{'Retry-After':'30'}})):undefined});
  await errorIs(await h.request(),status,code);
 }
});
test('Slack-native image blocks deduplicate file IDs and unsafe file permalinks do not reach clients',async()=>{
 const h=await environment({messages:[message({files:[file(),file({id:'FDOC',mimetype:'application/pdf',permalink:'javascript:alert(1)'})],blocks:[{type:'image',slack_file:{id:FILE},alt_text:'same'},{type:'section',accessory:{type:'image',slack_file:{id:'FBLOCK'},alt_text:'Block image'}}]})]});
 const body=await (await h.request()).json();assert.deepEqual(body.message.images.map(image=>image.id),[FILE,'FBLOCK']);assert.equal(body.message.files[0].permalink,body.message.permalink);assert.ok(!JSON.stringify(body).includes('javascript:'));
});
test('authors with missing display names fall back to real name and links must be HTTPS Slack URLs',async()=>{
 const h=await environment({users:{[AUTHOR]:{id:AUTHOR,profile:{display_name:' ',real_name:' Real name '}}},intercept:call=>call.api==='chat.getPermalink'?json({ok:true,permalink:'https://slack.com.evil.example/stolen'}):undefined});
 const body=await (await h.request()).json();assert.equal(body.message.author.name,'Real name');assert.equal(body.message.permalink,null);
});
test('cached content never bypasses fresh Supabase JWT and staff checks',async()=>{
 const h=await environment();assert.equal((await h.request()).status,200);assert.equal((await h.request()).status,200);assert.equal(h.calls('conversations.history').length,1);
 assert.equal(h.state.calls.filter(call=>call.url.includes('/auth/v1/user')).length,2);assert.equal(h.state.calls.filter(call=>call.url.includes('/rest/v1/hq_tour_staff')).length,2);
 h.state.approved=false;await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(h.calls('conversations.history').length,1);
 h.state.approved=true;h.state.user=null;await errorIs(await h.request(),401,'AUTH_REQUIRED');assert.equal(h.calls('conversations.history').length,1);
});
test('Slack deactivation revokes feed access when the short viewer cache expires',async()=>{
 const h=await environment();assert.equal((await h.request()).status,200);h.state.users[VIEWER]={id:VIEWER,team_id:TEAM,is_bot:false,deleted:true};h.advance(30001);
 await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(h.calls('conversations.history').length,1);assert.equal(h.calls('users.info').filter(call=>call.params.user===VIEWER).length,2);
});
test('a second viewer must prove active workspace identity even with warm content cache',async()=>{
 const h=await environment({users:{UOTHER:{id:'UOTHER',team_id:TEAM,deleted:true,is_bot:false}}});assert.equal((await h.request()).status,200);h.state.user=account({id:'00000000-0000-4000-8000-000000000002',identities:[{provider:'slack_oidc',identity_data:{sub:'UOTHER',custom_claims:{'https://slack.com/team_id':TEAM}}}]});
 await errorIs(await h.request(),403,'ACCESS_DENIED');assert.equal(h.calls('conversations.history').length,1);assert.ok(h.calls('users.info').some(call=>call.params.user==='UOTHER'));
});
test('Slack JSON errors and rate limits are sanitized and Retry-After enforces backoff',async()=>{
 for(const error of ['missing_scope','invalid_auth','token_revoked']){const h=await environment({intercept:call=>call.api==='conversations.history'?json({ok:false,error,secret:'must not leak'}):undefined});await errorIs(await h.request(),503,'CONNECTION_REQUIRED');}
 const generic=await environment({intercept:call=>call.api==='conversations.history'?json({ok:false,error:'fatal_error'}):undefined});await errorIs(await generic.request(),502,'SLACK_UNAVAILABLE');
 const limited=await environment({intercept:call=>call.api==='conversations.history'?new Response('',{status:429,headers:{'Retry-After':'45'}}):undefined});
 const first=await limited.request();assert.equal(first.headers.get('Retry-After'),'45');await errorIs(first,429,'RATE_LIMITED');
 limited.advance(1000);const second=await limited.request();assert.equal(second.headers.get('Retry-After'),'44');await errorIs(second,429,'RATE_LIMITED');assert.equal(limited.calls('conversations.history').length,1);
});
test('both message and image responses are private, noncacheable and CORS-scoped',async()=>{
 const h=await environment({messages:[message({files:[file()]})]});const msg=await h.request(),img=await h.request({action:'image',file_id:FILE,message_ts:message().ts});
 for(const response of [msg,img]){assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');}
 assert.equal(img.headers.get('Content-Type'),'image/png');assert.deepEqual(new Uint8Array(await img.arrayBuffer()),PNG);
});
test('image requests require authorization and cannot request unrelated files or old posts',async()=>{
 const h=await environment({messages:[message({files:[file()]})]});
 await errorIs(await h.request({action:'image',file_id:FILE,message_ts:message().ts},{headers:{Authorization:null}}),401,'AUTH_REQUIRED');
 await errorIs(await h.request({action:'image',file_id:'https://evil.example',message_ts:message().ts}),400,'INVALID_REQUEST');
 await errorIs(await h.request({action:'image',file_id:'FUNRELATED',message_ts:message().ts}),404,'IMAGE_UNAVAILABLE');
 await errorIs(await h.request({action:'image',file_id:FILE,message_ts:'1770000000.000000'}),404,'IMAGE_UNAVAILABLE');assert.equal(h.calls('files.info').length,0);
});
test('file info must describe the requested hosted raster image',async()=>{
 for(const changed of [{id:'FOTHER'},{is_external:true},{mimetype:'text/html'},{mimetype:'image/svg+xml'}]){
  const h=await environment({messages:[message({files:[file()]})],files:{[FILE]:file(changed)}});await errorIs(await h.request({action:'image',file_id:FILE,message_ts:message().ts}),404,'IMAGE_UNAVAILABLE');
  assert.equal(h.state.calls.filter(call=>new URL(call.url).hostname==='files.slack.com').length,0);
 }
});
test('the proxy rejects non-Slack, credentialed, non-HTTPS and nonstandard-port file URLs',async()=>{
 for(const url of ['https://evil.example/image.png','http://files.slack.com/image.png','https://files.slack.com.evil.example/image.png','https://user:pass@files.slack.com/image.png','https://files.slack.com:444/image.png']){
  const h=await environment({messages:[message({files:[file()]})],files:{[FILE]:file({url_private:url})}});await errorIs(await h.request({action:'image',file_id:FILE,message_ts:message().ts}),502,'IMAGE_UNAVAILABLE');
  assert.ok(h.state.calls.every(call=>new URL(call.url).hostname!=='evil.example'));
 }
});
test('allowed image redirects strip the bot token on CDN hosts and reject foreign redirects',async()=>{
 const h=await environment({messages:[message({files:[file()]})],intercept:call=>new URL(call.url).hostname==='files.slack.com'?new Response(null,{status:302,headers:{Location:'https://cdn.slack-edge.com/fixture.png'}}):undefined});
 assert.equal((await h.request({action:'image',file_id:FILE,message_ts:message().ts})).status,200);
 const initial=h.state.calls.find(call=>new URL(call.url).hostname==='files.slack.com'),cdn=h.state.calls.find(call=>new URL(call.url).hostname==='cdn.slack-edge.com');assert.equal(initial.headers.get('Authorization'),`Bearer ${h.env.SLACK_BOT_TOKEN}`);assert.equal(cdn.headers.get('Authorization'),null);assert.equal(initial.redirect,'manual');
 const evil=await environment({messages:[message({files:[file()]})],intercept:call=>new URL(call.url).hostname==='files.slack.com'?new Response(null,{status:302,headers:{Location:'https://evil.example/image.png'}}):undefined});await errorIs(await evil.request({action:'image',file_id:FILE,message_ts:message().ts}),502,'IMAGE_UNAVAILABLE');assert.ok(!evil.state.calls.some(call=>new URL(call.url).hostname==='evil.example'));
});
test('redirect loops stop after a bounded number of image requests',async()=>{
 const h=await environment({messages:[message({files:[file()]})],intercept:call=>new URL(call.url).hostname==='files.slack.com'?new Response(null,{status:302,headers:{Location:'/again.png'}}):undefined});
 await errorIs(await h.request({action:'image',file_id:FILE,message_ts:message().ts}),502,'IMAGE_UNAVAILABLE');assert.equal(h.state.calls.filter(call=>new URL(call.url).hostname==='files.slack.com').length,4);
});
test('HTML, SVG, false image signatures and oversized image bodies never reach the browser',async()=>{
 for(const [type,bytes,status] of [['text/html','<html>login</html>',413],['image/svg+xml','<svg/>',413],['image/png','<html>not an image</html>',502],['image/png',new Uint8Array(8*1024*1024+1),413]]){
  const h=await environment({messages:[message({files:[file()]})],intercept:call=>new URL(call.url).hostname==='files.slack.com'?new Response(bytes,{headers:{'Content-Type':type}}):undefined});await errorIs(await h.request({action:'image',file_id:FILE,message_ts:message().ts}),status,'IMAGE_UNAVAILABLE');
 }
 const h=await environment({messages:[message({files:[file()]})],intercept:call=>new URL(call.url).hostname==='files.slack.com'?new Response(PNG,{headers:{'Content-Type':'image/png','Content-Length':String(9*1024*1024)}}):undefined});await errorIs(await h.request({action:'image',file_id:FILE,message_ts:message().ts}),413,'IMAGE_UNAVAILABLE');
});
test('upstream failures expose no token or exception detail',async()=>{
 const h=await environment({intercept:call=>{if(call.api==='conversations.history')throw new Error('fixture-private-token sensitive upstream detail');}});await errorIs(await h.request(),502,'UNAVAILABLE');
});

const emojiURL=name=>`https://emoji.slack-edge.com/${TEAM}/${name}/fixture.png`;
const emojiRequest=(name='paws',ts=message().ts)=>({action:'emoji',emoji_name:name,message_ts:ts});
const emojiCalls=h=>h.state.calls.filter(call=>['emoji.slack-edge.com','my.slack.com'].includes(new URL(call.url).hostname));

test('custom emoji readiness can be checked even when the current post contains no emoji names',async()=>{
 const ready=await environment();const good=await (await ready.request()).json();assert.equal(good.message.custom_emoji_ready,true);assert.deepEqual(good.message.custom_emojis,[]);
 const denied=await environment({intercept:call=>call.api==='emoji.list'?json({ok:false,error:'missing_scope'}):undefined});const response=await denied.request();assert.equal(response.status,200);assert.equal((await response.json()).message.custom_emoji_ready,false);
});

test('custom emoji metadata resolves workspace aliases and standard aliases without exposing a catalog or URLs',async()=>{
 const h=await environment({messages:[message({text:':paws: :party: :approved: :heart: :paws: :unknown:'})],emojis:{paws:emojiURL('paws'),party:'alias:paws',approved:'alias:white_check_mark',heart:emojiURL('custom-heart'),unused:emojiURL('unused')}});
 const response=await h.request(),body=await response.json();assert.equal(response.status,200);
 assert.deepEqual(body.message.custom_emojis,[{name:'paws',image:true},{name:'party',image:true},{name:'approved',alias:'white_check_mark'},{name:'heart',image:true}]);
 assert.doesNotMatch(JSON.stringify(body),/emoji\.slack-edge\.com|my\.slack\.com\/emoji|fixture-private-token|unused/);
 assert.equal(h.calls('emoji.list').length,1);assert.equal(h.calls('emoji.list')[0].headers.get('Authorization'),'Bearer fixture-private-token');
});

test('custom emoji discovery follows visible message fallback and skips code and URL destinations',async()=>{
 const text=':paws: `:code:` ``` :block: ``` <https://example.test/:path:|:label:> https://example.test/:bare:';
 const names=['paws','code','block','path','label','bare'],emojis=Object.fromEntries(names.map(name=>[name,emojiURL(name)]));
 const h=await environment({messages:[message({text})],emojis});const body=await (await h.request()).json();assert.deepEqual(body.message.custom_emojis,[{name:'paws',image:true},{name:'label',image:true}]);
 for(const name of names.filter(name=>!['paws','label'].includes(name)))await errorIs(await h.request(emojiRequest(name)),404,'IMAGE_UNAVAILABLE');
 assert.equal((await h.request(emojiRequest('label'))).status,200,'visible link labels may contain custom emoji');
 const blocks=await environment({messages:[message({text:'',blocks:[{type:'rich_text',elements:[{type:'rich_text_section',elements:[{type:'emoji',name:'paws'}]}]}]})],emojis:{paws:emojiURL('paws')}});
 const blockBody=await (await blocks.request()).json();assert.equal(blockBody.message.text,':paws:');assert.deepEqual(blockBody.message.custom_emojis,[{name:'paws',image:true}]);
 const attachment=await environment({messages:[message({text:'',attachments:[{fallback:':paws:'}]})],emojis:{paws:emojiURL('paws')}});assert.deepEqual((await (await attachment.request()).json()).message.custom_emojis,[{name:'paws',image:true}]);
});

test('emoji catalog lookup is coalesced and cached for five minutes while authorization remains fresh',async()=>{
 const h=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')}});
 const responses=await Promise.all([h.request(),h.request(),h.request()]);assert.ok(responses.every(response=>response.status===200));assert.equal(h.calls('emoji.list').length,1);
 h.advance(299999);assert.equal((await h.request()).status,200);assert.equal(h.calls('emoji.list').length,1);
 h.advance(2);assert.equal((await h.request()).status,200);assert.equal(h.calls('emoji.list').length,2);
 assert.equal(h.state.calls.filter(call=>call.url.includes('/auth/v1/user')).length,5);assert.equal(h.state.calls.filter(call=>call.url.includes('/rest/v1/hq_tour_staff')).length,5);
});

test('missing emoji scope, HTTP errors, rate limits, malformed payloads and network failures preserve the post and image feed',async()=>{
 for(const failure of [()=>json({ok:false,error:'missing_scope',needed:'sensitive-scope-details'}),()=>new Response(null,{status:500}),()=>new Response(null,{status:429,headers:{'Retry-After':'300'}}),()=>new Response('invalid JSON',{headers:{'Content-Type':'application/json'}}),()=>json({ok:true,emoji:[]}),()=>{throw new Error('private upstream token detail');}]){
  const h=await environment({messages:[message({text:'Team :paws:',files:[file()]})],intercept:call=>call.api==='emoji.list'?failure():undefined});
  const response=await h.request(),body=await response.json();assert.equal(response.status,200);assert.equal(body.message.text,'Team :paws:');assert.deepEqual(body.message.custom_emojis,[]);assert.equal(body.message.images.length,1);assert.doesNotMatch(JSON.stringify(body),/sensitive-scope-details|private upstream token detail/);
  assert.equal((await h.request({action:'image',file_id:FILE,message_ts:message().ts})).status,200);
  h.advance(30001);assert.equal((await h.request()).status,200,'optional emoji failure cannot set shared Slack cooldown');assert.equal(h.calls('conversations.history').length,2);
 }
});

test('custom metadata is bounded to 64 unique used shortcodes and ignores inherited object keys',async()=>{
 const names=Array.from({length:70},(_,index)=>`custom_${index}`),h=await environment({messages:[message({text:names.map(name=>`:${name}:`).join(' ')+` :${names[0]}:`})],emojis:Object.fromEntries(names.map(name=>[name,emojiURL(name)]))});
 const body=await (await h.request()).json();assert.equal(body.message.custom_emojis.length,64);assert.equal(new Set(body.message.custom_emojis.map(item=>item.name)).size,64);assert.ok(body.message.custom_emojis.every(item=>names.includes(item.name)&&item.image===true));
 const plain=await environment({messages:[message({text:':constructor: :__proto__: :prototype:'})]});assert.deepEqual((await (await plain.request()).json()).message.custom_emojis,[]);
});

test('custom emoji alias cycles, malformed targets and excessive chains cannot leak or loop',async()=>{
 const longChain=Object.fromEntries(Array.from({length:22},(_,index)=>[`long_${index}`,index===21?emojiURL('end'):`alias:long_${index+1}`]));
 const h=await environment({messages:[message({text:':self: :cycle_a: :bad: :long_0: :near_0:'})],emojis:{self:'alias:self',cycle_a:'alias:cycle_b',cycle_b:'alias:cycle_a',bad:'alias:https://evil.example',...longChain,...Object.fromEntries(Array.from({length:15},(_,index)=>[`near_${index}`,index===14?emojiURL('near-end'):`alias:near_${index+1}`]))}});
 const body=await (await h.request()).json();assert.deepEqual(body.message.custom_emojis,[{name:'near_0',image:true}]);
 for(const name of ['self','cycle_a','bad','long_0'])await errorIs(await h.request(emojiRequest(name)),404,'IMAGE_UNAVAILABLE');
 assert.equal(emojiCalls(h).length,0);assert.equal(h.calls('emoji.list').length,1);
});

test('custom emoji bytes require current user approval and active workspace membership even with warm metadata',async()=>{
 const h=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')}});assert.equal((await h.request()).status,200);
 await errorIs(await h.request(emojiRequest(),{headers:{Authorization:null}}),401,'AUTH_REQUIRED');assert.equal(emojiCalls(h).length,0);
 h.state.approved=false;await errorIs(await h.request(emojiRequest()),403,'ACCESS_DENIED');assert.equal(emojiCalls(h).length,0);
 h.state.approved=true;h.state.users[VIEWER]={id:VIEWER,team_id:TEAM,is_bot:false,deleted:true};h.advance(30001);await errorIs(await h.request(emojiRequest()),403,'ACCESS_DENIED');assert.equal(emojiCalls(h).length,0);
});

test('emoji proxy accepts only the current post used original name and never a caller-selected URL',async()=>{
 const h=await environment({messages:[message({text:':party:'})],emojis:{party:'alias:paws',paws:emojiURL('paws'),unrelated:emojiURL('unrelated')}});
 for(const name of ['paws','unrelated'])await errorIs(await h.request(emojiRequest(name)),404,'IMAGE_UNAVAILABLE');
 await errorIs(await h.request(emojiRequest('party','1770000000.000000')),404,'IMAGE_UNAVAILABLE');
 for(const name of ['',':party:','https://evil.example','../paws','paws" onclick="x','a'.repeat(101)])await errorIs(await h.request(emojiRequest(name)),400,'INVALID_REQUEST');
 assert.equal(emojiCalls(h).length,0);
 const response=await h.request({...emojiRequest('party'),url:'http://169.254.169.254/latest/meta-data'});assert.equal(response.status,200);assert.equal(emojiCalls(h).length,1);assert.equal(emojiCalls(h)[0].url,emojiURL('paws'));assert.ok(h.state.calls.every(call=>!call.url.includes('169.254.169.254')));
 h.state.messages=[message({ts:'1770000001.000123',text:'Newer post'})];h.advance(30001);await errorIs(await h.request(emojiRequest('party')),404,'IMAGE_UNAVAILABLE');assert.equal(emojiCalls(h).length,1);
});

test('custom emoji raster responses are private and neither supported CDN host receives a bearer token',async()=>{
 for(const url of [emojiURL('paws'),'https://my.slack.com/emoji/paws/fixture.png']){
  const h=await environment({messages:[message({text:':paws:'})],emojis:{paws:url}}),response=await h.request(emojiRequest());assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Content-Length'),String(PNG.length));assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),PNG);
  assert.equal(emojiCalls(h).length,1);assert.equal(emojiCalls(h)[0].headers.get('Authorization'),null);assert.equal(emojiCalls(h)[0].redirect,'manual');
 }
});

test('custom emoji URL allowlist rejects foreign, credentialed, plain HTTP, nonstandard-port and non-emoji legacy paths',async()=>{
 for(const url of ['https://evil.example/paws.png','https://emoji.slack-edge.com.evil.example/paws.png','https://cdn.slack-edge.com/paws.png','http://emoji.slack-edge.com/paws.png','https://user:pass@emoji.slack-edge.com/paws.png','https://emoji.slack-edge.com:444/paws.png','https://my.slack.com/files/paws.png','https://my.slack.com/emoji.evil/paws.png','http://my.slack.com/emoji/paws.png']){
  const h=await environment({messages:[message({text:':paws:'})],emojis:{paws:url}});await errorIs(await h.request(emojiRequest()),404,'IMAGE_UNAVAILABLE');assert.equal(emojiCalls(h).length,0);assert.ok(h.state.calls.every(call=>!call.url.includes('evil.example')));
 }
});

test('custom emoji redirects remain on the exact allowlist without credentials and loops are bounded',async()=>{
 const h=await environment({messages:[message({text:':paws:'})],emojis:{paws:'https://my.slack.com/emoji/paws/fixture.png'},intercept:call=>new URL(call.url).hostname==='my.slack.com'?new Response(null,{status:302,headers:{Location:emojiURL('paws')}}):undefined});assert.equal((await h.request(emojiRequest())).status,200);assert.equal(emojiCalls(h).length,2);assert.ok(emojiCalls(h).every(call=>call.headers.get('Authorization')===null));
 for(const location of ['https://evil.example/paws.png','https://cdn.slack-edge.com/paws.png','http://emoji.slack-edge.com/paws.png','https://my.slack.com/files/paws.png']){
  const blocked=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')},intercept:call=>new URL(call.url).hostname==='emoji.slack-edge.com'?new Response(null,{status:302,headers:{Location:location}}):undefined});await errorIs(await blocked.request(emojiRequest()),502,'IMAGE_UNAVAILABLE');assert.equal(emojiCalls(blocked).length,1);assert.ok(!blocked.state.calls.some(call=>call.url===location));
 }
 const loop=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')},intercept:call=>new URL(call.url).hostname==='emoji.slack-edge.com'?new Response(null,{status:302,headers:{Location:'/again.png'}}):undefined});await errorIs(await loop.request(emojiRequest()),502,'IMAGE_UNAVAILABLE');assert.equal(emojiCalls(loop).length,4);
});

test('custom emoji proxy rejects active formats, bad signatures and bodies above one MiB while leaving attachments at their own limit',async()=>{
 for(const [type,bytes,status] of [['text/html','<html>login</html>',413],['image/svg+xml','<svg/>',413],['image/png','not a PNG',502],['image/png',new Uint8Array(1024*1024+1),413]]){
  const h=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')},intercept:call=>new URL(call.url).hostname==='emoji.slack-edge.com'?new Response(bytes,{headers:{'Content-Type':type}}):undefined});await errorIs(await h.request(emojiRequest()),status,'IMAGE_UNAVAILABLE');
 }
 const advertised=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')},intercept:call=>new URL(call.url).hostname==='emoji.slack-edge.com'?new Response(PNG,{headers:{'Content-Type':'image/png','Content-Length':String(1024*1024+1)}}):undefined});await errorIs(await advertised.request(emojiRequest()),413,'IMAGE_UNAVAILABLE');
 const max=new Uint8Array(1024*1024);max.set(PNG);const exact=await environment({messages:[message({text:':paws:'})],emojis:{paws:emojiURL('paws')},intercept:call=>new URL(call.url).hostname==='emoji.slack-edge.com'?new Response(max,{headers:{'Content-Type':'image/png'}}):undefined});assert.equal((await exact.request(emojiRequest())).status,200);
 const attachment=await environment({messages:[message({files:[file()]})],intercept:call=>new URL(call.url).hostname==='files.slack.com'?new Response(max,{headers:{'Content-Type':'image/png'}}):undefined});assert.equal((await attachment.request({action:'image',file_id:FILE,message_ts:message().ts})).status,200);
});
