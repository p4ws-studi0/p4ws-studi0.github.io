/* Latest #general post for approved HQ members. No Slack secrets or private URLs leave this function. */
export function createHandler({env, fetch:request=fetch, now=Date.now, log=(_entry)=>{}}) {
  const origin=env.HQ_ORIGIN||'https://hq.pawspet.com';
  const project=env.SUPABASE_URL, apiKey=env.SUPABASE_ANON_KEY;
  const trimmed=value=>typeof value==='string'?value.trim():value;
  const token=trimmed(env.SLACK_BOT_TOKEN), team=trimmed(env.SLACK_TEAM_ID), channel=trimmed(env.SLACK_GENERAL_CHANNEL_ID);
  const cache=new Map(),pending=new Map();let cooldown=0;
  const MAX_IMAGE=8*1024*1024;
  const imageTypes=new Set(['image/jpeg','image/png','image/gif','image/webp','image/avif']);
  class Failure extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
  const fail=(status,code)=>{throw new Failure(status,code);};
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json',...extra}});
  const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='slack.com'||u.hostname.endsWith('.slack.com'))?u.href:null;}catch{return null;}};
  const string=value=>typeof value==='string'?value:'';
  const diagnosticReasons=new Set(['MISSING_SUPABASE_URL','MALFORMED_SUPABASE_URL','MISSING_SUPABASE_ANON_KEY','MALFORMED_SUPABASE_ANON_KEY','MISSING_SLACK_BOT_TOKEN','MALFORMED_SLACK_BOT_TOKEN','MISSING_SLACK_TEAM_ID','MALFORMED_SLACK_TEAM_ID','MISSING_SLACK_GENERAL_CHANNEL_ID','MALFORMED_SLACK_GENERAL_CHANNEL_ID','BOT_TEAM_MISMATCH','CHANNEL_ID_MISMATCH','CHANNEL_NOT_GENERAL','CHANNEL_PRIVATE','BOT_NOT_CHANNEL_MEMBER','SLACK_API_ERROR','SLACK_HTTP_ERROR','SLACK_RATE_LIMITED']);
  const diagnosticMethods=new Set(['auth.test','conversations.info','users.info','conversations.members','conversations.history','chat.getPermalink','files.info']);
  const diagnosticErrors=new Set(['missing_scope','not_in_channel','invalid_auth','token_revoked','account_inactive','channel_not_found','access_denied','file_not_found','file_deleted','user_not_found','ekm_access_denied','ratelimited']);
  function diagnose(reason,method,slackError) {
    if(!diagnosticReasons.has(reason))return;
    const entry={reason,...(diagnosticMethods.has(method)?{method}:{}),...(diagnosticErrors.has(slackError)?{slack_error:slackError}:{})};
    // Never log values, IDs, raw errors, provider payloads, or requested/actual scopes.
    try{log(entry);}catch{/* Diagnostics must not change authorization or response behavior. */}
  }
  async function cached(key,ttl,read) {
    const hit=cache.get(key);if(hit&&hit.until>now())return hit.value;
    if(pending.has(key))return pending.get(key);
    const work=read().then(value=>{if(cache.size>300)cache.clear();cache.set(key,{value,until:now()+ttl});return value;}).finally(()=>pending.delete(key));
    pending.set(key,work);return work;
  }
  async function slack(method,params={}) {
    if(cooldown>now())fail(429,'RATE_LIMITED');
    const res=await request(`https://slack.com/api/${method}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(res.status===429){diagnose('SLACK_RATE_LIMITED',method);cooldown=now()+Math.max(1,Math.min(300,Number(res.headers.get('Retry-After'))||60))*1000;fail(429,'RATE_LIMITED');}
    if(!res.ok){diagnose('SLACK_HTTP_ERROR',method);fail(502,'SLACK_UNAVAILABLE');}
    const data=await res.json();
    if(!data.ok) {
      diagnose('SLACK_API_ERROR',method,data.error);
      if(['missing_scope','not_in_channel','invalid_auth','token_revoked','account_inactive'].includes(data.error)){cache.clear();fail(503,'CONNECTION_REQUIRED');}
      fail(502,'SLACK_UNAVAILABLE');
    }
    return data;
  }
  async function userInfo(id) {return cached(`user:${id}`,30000,async()=>{const data=await slack('users.info',{user:id});return data.user;});}
  async function authorize(req) {
    const bearer=req.headers.get('Authorization');if(!/^Bearer\s+\S+$/i.test(bearer||''))fail(401,'AUTH_REQUIRED');
    if(!project){diagnose('MISSING_SUPABASE_URL');fail(503,'CONNECTION_REQUIRED');}
    try{const parsed=new URL(project);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||!['','/'].includes(parsed.pathname))throw new Error();}
    catch{diagnose('MALFORMED_SUPABASE_URL');fail(503,'CONNECTION_REQUIRED');}
    if(!apiKey){diagnose('MISSING_SUPABASE_ANON_KEY');fail(503,'CONNECTION_REQUIRED');}
    if(typeof apiKey!=='string'||/\s/.test(apiKey)){diagnose('MALFORMED_SUPABASE_ANON_KEY');fail(503,'CONNECTION_REQUIRED');}
    const authHeaders={apikey:apiKey,Authorization:bearer};
    const res=await request(`${project}/auth/v1/user`,{headers:authHeaders,signal:AbortSignal.timeout(10000),redirect:'error'});
    if(res.status===401||res.status===403)fail(401,'AUTH_REQUIRED');if(!res.ok)fail(502,'AUTH_UNAVAILABLE');
    const user=await res.json();if(!/^[0-9a-f-]{36}$/i.test(user.id||''))fail(401,'AUTH_REQUIRED');
    const staff=await request(`${project}/rest/v1/hq_tour_staff?select=user_id&user_id=eq.${user.id}&active=eq.true&limit=1`,{headers:authHeaders,signal:AbortSignal.timeout(10000),redirect:'error'});
    if(staff.status===401||staff.status===403)fail(403,'ACCESS_DENIED');if(!staff.ok)fail(502,'AUTH_UNAVAILABLE');
    const approvals=await staff.json();if(!Array.isArray(approvals)||!approvals.some(row=>row.user_id===user.id))fail(403,'ACCESS_DENIED');
    if(!token){diagnose('MISSING_SLACK_BOT_TOKEN');fail(503,'CONNECTION_REQUIRED');}
    if(typeof token!=='string'||/\s/.test(token)){diagnose('MALFORMED_SLACK_BOT_TOKEN');fail(503,'CONNECTION_REQUIRED');}
    if(!team){diagnose('MISSING_SLACK_TEAM_ID');fail(503,'CONNECTION_REQUIRED');}
    if(typeof team!=='string'||!/^T[A-Z0-9]+$/.test(team)){diagnose('MALFORMED_SLACK_TEAM_ID');fail(503,'CONNECTION_REQUIRED');}
    if(!channel){diagnose('MISSING_SLACK_GENERAL_CHANNEL_ID');fail(503,'CONNECTION_REQUIRED');}
    if(typeof channel!=='string'||!/^C[A-Z0-9]+$/.test(channel)){diagnose('MALFORMED_SLACK_GENERAL_CHANNEL_ID');fail(503,'CONNECTION_REQUIRED');}
    // identity_data is provider-owned. user_metadata is editable and must never authorize Slack access.
    const identities=(user.identities||[]).filter(i=>i.provider==='slack_oidc');
    const identity=identities.find(i=>{
      const d=i.identity_data||{};return (d.custom_claims?.['https://slack.com/team_id']||d['https://slack.com/team_id'])===team;
    });
    const data=identity?.identity_data||{};
    const slackUser=string(data.sub||data.provider_id);if(!/^[UW][A-Z0-9]+$/.test(slackUser))fail(403,'ACCESS_DENIED');
    await cached('configuration',300000,async()=>{
      const auth=await slack('auth.test');if(auth.team_id!==team){diagnose('BOT_TEAM_MISMATCH','auth.test');fail(503,'CONNECTION_REQUIRED');}
      const result=await slack('conversations.info',{channel});
      if(result.channel?.id!==channel){diagnose('CHANNEL_ID_MISMATCH','conversations.info');fail(503,'CONNECTION_REQUIRED');}
      if(!result.channel?.is_general){diagnose('CHANNEL_NOT_GENERAL','conversations.info');fail(503,'CONNECTION_REQUIRED');}
      if(result.channel?.is_private){diagnose('CHANNEL_PRIVATE','conversations.info');fail(503,'CONNECTION_REQUIRED');}
      if(!result.channel?.is_member){diagnose('BOT_NOT_CHANNEL_MEMBER','conversations.info');fail(503,'CONNECTION_REQUIRED');}
      return true;
    });
    const viewer=await userInfo(slackUser);
    if(!viewer||viewer.deleted||viewer.is_bot||viewer.team_id!==team)fail(403,'ACCESS_DENIED');
    const members=await cached('members',30000,async()=>{
      const found=new Set();let cursor='';const seen=new Set();
      for(let page=0;page<100;page++) {
        const response=await slack('conversations.members',{channel,limit:'200',...(cursor?{cursor}:{})});
        for(const id of response.members||[])found.add(id);
        cursor=string(response.response_metadata?.next_cursor).trim();if(!cursor)return found;
        if(seen.has(cursor))fail(502,'SLACK_UNAVAILABLE');seen.add(cursor);
      }
      fail(502,'SLACK_UNAVAILABLE');
    });
    if(!members.has(slackUser))fail(403,'ACCESS_DENIED');
  }
  async function latest() {
    return cached('latest',30000,async()=>{
      let cursor='';const seen=new Set();
      for(let page=0;page<20;page++) {
        const data=await slack('conversations.history',{channel,limit:'100',...(cursor?{cursor}:{})});
        const candidates=(data.messages||[]).filter(m=>m.type==='message'&&!m.hidden&&!m.deleted&&/^\d+\.\d+$/.test(m.ts||'')&&
          (!m.subtype||['bot_message','file_share','me_message','thread_broadcast'].includes(m.subtype))&&
          (!m.thread_ts||m.thread_ts===m.ts||m.subtype==='thread_broadcast'));
        candidates.sort((a,b)=>{const [as,af]=a.ts.split('.'),[bs,bf]=b.ts.split('.');return as.length!==bs.length?bs.length-as.length:bs.localeCompare(as)||bf.padEnd(6,'0').localeCompare(af.padEnd(6,'0'));});
        if(candidates.length)return candidates[0];
        cursor=string(data.response_metadata?.next_cursor).trim();if(!cursor)return null;
        if(seen.has(cursor))fail(502,'SLACK_UNAVAILABLE');seen.add(cursor);
      }
      // Do not claim the channel is empty when a long run of system events hides its last post.
      fail(502,'SLACK_UNAVAILABLE');
    });
  }
  function messageFiles(message) {
    const files=new Map();for(const file of message.files||[])if(/^F[A-Z0-9]+$/.test(file.id||''))files.set(file.id,file);
    // Slack-native image blocks may reference file IDs rather than a top-level files array.
    const visit=blocks=>{for(const block of blocks||[]){const f=block.slack_file;if(f?.id&&/^F[A-Z0-9]+$/.test(f.id)&&!files.has(f.id))files.set(f.id,{id:f.id,title:block.title?.text||block.alt_text,mimetype:'image/unknown'});if(block.accessory)visit([block.accessory]);if(Array.isArray(block.elements))visit(block.elements);}};
    visit(message.blocks);return [...files.values()].slice(0,100);
  }
  function blockText(blocks) {
    const element=node=>{
      if(node.type==='text')return string(node.text);
      if(node.type==='link')return node.text?`<${string(node.url)}|${string(node.text)}>`:`<${string(node.url)}>`;
      if(node.type==='user')return `<@${string(node.user_id)}>`;
      if(node.type==='channel')return `<#${string(node.channel_id)}>`;
      if(node.type==='emoji')return `:${string(node.name)}:`;
      if(node.type==='broadcast')return `<!${string(node.range)}>`;
      if(node.type==='section')return [typeof node.text==='string'?node.text:string(node.text?.text),...(Array.isArray(node.fields)?node.fields.map(element):[])].filter(Boolean).join('\n');
      if(typeof node.text==='string')return node.text;
      if(node.text?.text)return string(node.text.text);
      if(Array.isArray(node.elements))return node.elements.map(element).join(node.type==='rich_text_section'?'':'\n');
      return '';
    };
    return (blocks||[]).map(element).filter(Boolean).join('\n');
  }
  async function messageView(message) {
    if(!message)return null;
    let author=string(message.bot_profile?.name||message.username)||'Team member';
    if(message.user) {
      const user=await userInfo(message.user);
      author=string(user?.profile?.display_name).trim()||string(user?.profile?.real_name).trim()||string(user?.real_name).trim()||author;
    }
    const link=await cached(`link:${message.ts}`,300000,async()=>safeLink((await slack('chat.getPermalink',{channel,message_ts:message.ts})).permalink));
    const images=[],files=[];
    for(let f of messageFiles(message)) {
      if(!f.mimetype||f.mimetype==='image/unknown'||f.file_access==='check_file_info') {
        try {f=(await slack('files.info',{file:f.id})).file||f;}
        catch(error){if(error.code==='CONNECTION_REQUIRED'||error.code==='RATE_LIMITED')throw error;}
      }
      const title=string(f.title||f.name)||'Attachment';
      if((imageTypes.has(f.mimetype)||f.mimetype==='image/unknown')&&!f.is_external&&images.length<12)images.push({id:f.id,title,alt:string(f.alt_txt)||title});
      else files.push({id:f.id,title,permalink:safeLink(f.permalink)||link});
    }
    let text=string(message.text);
    if(!text)text=blockText(message.blocks);
    if(!text&&Array.isArray(message.attachments))text=message.attachments.map(a=>string(a.text||a.fallback)).filter(Boolean).join('\n');
    return {ts:message.ts,text,author:{name:author},permalink:link,images,files};
  }
  function imageUrl(value,redirect=false) {
    try {
      const url=new URL(value);
      const allowed=url.hostname==='files.slack.com'||redirect&&(['files-origin.slack.com','files-edge.slack.com'].includes(url.hostname)||url.hostname.endsWith('.slack-edge.com')||url.hostname.endsWith('.slack-files.com'));
      if(url.protocol==='https:'&&allowed&&!url.port&&!url.username&&!url.password)return url;
    }catch{}
    fail(502,'IMAGE_UNAVAILABLE');
  }
  function matchesImage(bytes,type) {
    const ascii=(start,len)=>String.fromCharCode(...bytes.slice(start,start+len));
    return type==='image/png'?bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):
      type==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
      type==='image/gif'?['GIF87a','GIF89a'].includes(ascii(0,6)):
      type==='image/webp'?ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP':
      type==='image/avif'?ascii(4,4)==='ftyp'&&/avif|avis/.test(ascii(8,24)):false;
  }
  async function imageResponse(body) {
    if(!/^F[A-Z0-9]+$/.test(body.file_id||'')||!/^\d+\.\d+$/.test(body.message_ts||''))fail(400,'INVALID_REQUEST');
    const message=await latest();if(!message||message.ts!==body.message_ts||!messageFiles(message).some(f=>f.id===body.file_id))fail(404,'IMAGE_UNAVAILABLE');
    const result=await slack('files.info',{file:body.file_id}),file=result.file;
    if(!file||file.id!==body.file_id||file.is_external||!imageTypes.has(file.mimetype))fail(404,'IMAGE_UNAVAILABLE');
    // Bind the server-derived URL to the permitted current post, never to a caller-supplied URL.
    let url=imageUrl(file.thumb_960||file.thumb_720||file.thumb_480||file.url_private);
    for(let redirect=0;redirect<4;redirect++) {
      const res=await request(url.href,{headers:url.hostname==='files.slack.com'?{Authorization:`Bearer ${token}`}:{},redirect:'manual',signal:AbortSignal.timeout(15000)});
      if([301,302,303,307,308].includes(res.status)) {const location=res.headers.get('Location');await res.body?.cancel();if(!location)fail(502,'IMAGE_UNAVAILABLE');url=imageUrl(new URL(location,url).href,true);continue;}
      if(!res.ok)fail(502,'IMAGE_UNAVAILABLE');
      const type=string(res.headers.get('Content-Type')).split(';')[0].trim().toLowerCase();
      if(!imageTypes.has(type)||Number(res.headers.get('Content-Length')||0)>MAX_IMAGE){await res.body?.cancel();fail(413,'IMAGE_UNAVAILABLE');}
      if(!res.body)fail(502,'IMAGE_UNAVAILABLE');
      const reader=res.body.getReader(),chunks=[];let length=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_IMAGE)fail(413,'IMAGE_UNAVAILABLE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(!matchesImage(bytes,type))fail(502,'IMAGE_UNAVAILABLE');
      return new Response(bytes,{headers:{...headers,'Content-Type':type,'Content-Length':String(length),'Content-Disposition':'inline'}});
    }
    fail(502,'IMAGE_UNAVAILABLE');
  }
  return async function handler(req) {
    if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:{code:'ACCESS_DENIED'}},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
    try {
      if(Number(req.headers.get('Content-Length')||0)>4096)fail(400,'INVALID_REQUEST');
      const raw=await req.text();if(raw.length>4096)fail(400,'INVALID_REQUEST');
      let body;try{body=JSON.parse(raw);}catch{fail(400,'INVALID_REQUEST');}
      if(!body||!['message','image'].includes(body.action))fail(400,'INVALID_REQUEST');
      await authorize(req);
      if(body.action==='image')return await imageResponse(body);
      return json({message:await messageView(await latest()),updated_at:new Date(now()).toISOString()});
    }catch(error){
      const status=error instanceof Failure?error.status:502,code=error instanceof Failure?error.code:'UNAVAILABLE';
      return json({error:{code}},status,status===429?{'Retry-After':String(Math.max(1,Math.ceil((cooldown-now())/1000)))}:{});
    }
  };
}
if(typeof Deno!=='undefined') {
  const keys=['HQ_ORIGIN','SUPABASE_URL','SUPABASE_ANON_KEY','SLACK_BOT_TOKEN','SLACK_TEAM_ID','SLACK_GENERAL_CHANNEL_ID'];
  Deno.serve(createHandler({env:Object.fromEntries(keys.map(key=>[key,Deno.env.get(key)])),log:entry=>console.warn('hq-slack-general',JSON.stringify(entry))}));
}
