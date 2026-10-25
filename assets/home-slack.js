/* Read-only #general update. Slack credentials and private image URLs stay on the server. */
(() => {
  'use strict';
  const widget = document.getElementById('homeSlackWidget');
  if (!widget) return;
  const $ = id => document.getElementById(id);
  const imageEndpoint = 'https://dppjgglaeieevsfwsbii.supabase.co/functions/v1/hq-slack-general';
  const MAX_IMAGES=12,MAX_IMAGE_BYTES=8*1024*1024,MAX_GALLERY_BYTES=MAX_IMAGES*MAX_IMAGE_BYTES;
  const state = {userId: null, authEpoch: 0, requestId: 0, imageEpoch: 0, loading: false, lastAttempt: 0, urls: new Map(), imageButtons:new Map(), attachmentOrder:[], attachmentPending:new Map(), openImageId:null, emojiUrls: new Map(), avatarUrl: null, smallMedia: new Map()};
  const mediaKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:'';
  const rasterBlob=data=>data instanceof Blob&&/^image\/(png|jpeg|jpg|gif|webp|avif)$/i.test(data.type)&&data.size<=1024*1024;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const decode = value => String(value).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const emojiText = value => window.PawsSlackEmoji?.toUnicode(String(value ?? '')) ?? String(value ?? '');
  function safeURL(value, slackOnly = false) {
    try {
      const url = new URL(String(value));
      if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return '';
      if (slackOnly && (url.protocol !== 'https:' || !(url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com')))) return '';
      return url.href;
    } catch { return ''; }
  }
  function link(label, url, renderLabel=value=>escape(emojiText(value))) {
    const href = safeURL(url);
    return href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${renderLabel(label)}</a>` : escape(label);
  }
  // Parse a deliberately small subset of Slack markup; message content never becomes raw HTML.
  function formatText(value, customEmojis=[]) {
    const tokens = [];
    const token = html => {tokens.push(html); return `\u0000${tokens.length - 1}\u0000`;};
    const custom=new Map((Array.isArray(customEmojis)?customEmojis:[]).slice(0,64).filter(item=>/^[a-zA-Z0-9_+\-]{1,100}$/.test(item?.name||'')).map(item=>[item.name,item]));
    let count=0;
    const inline=value=>{
      const images=[];
      const text=String(value).replace(/:([a-zA-Z0-9_+\-]{1,100}):/g,(literal,name)=>{
        const item=custom.get(name);if(!item)return literal;
        if(item.image===true&&count++<256){images.push(`<span class="home-slack-emoji" data-slack-emoji="${name}">${escape(literal)}</span>`);return `\u0001${images.length-1}\u0001`;}
        return /^[a-zA-Z0-9_+\-]{1,100}$/.test(item.alias||'') ? (window.PawsSlackEmoji?.resolve(item.alias)||literal) : literal;
      });
      return escape(emojiText(text)).replace(/\u0001(\d+)\u0001/g,(_,index)=>images[Number(index)]||'');
    };
    let text = String(value || '').slice(0,40000).replace(/[\u0000\u0001]/g,'');
    text = text.replace(/```([\s\S]*?)```|`([^`\n]+)`|<([^<>\n]+)>|[hH][tT][tT][pP][sS]?:\/\/[^\s<>\u0000]+/g, (match, block, code, item) => {
      if (block !== undefined) return token(`<pre><code>${escape(decode(block))}</code></pre>`);
      if (code !== undefined) return token(`<code>${escape(decode(code))}</code>`);
      if (item === undefined) return token(escape(decode(match)));
      const [target,...labels] = item.split('|');
      const label = decode(labels.join('|') || target);
      if (/^https?:\/\//i.test(target)) return token(link(label,decode(target),inline));
      if (target.startsWith('@')) return token(escape(labels.length ? `@${label}` : '@team member'));
      if (target.startsWith('#')) return token(escape(labels.length ? `#${label}` : '#channel'));
      if (/^!(here|channel|everyone)$/.test(target)) return token(escape('@'+target.slice(1)));
      if (target.startsWith('!date^') && labels.length) return token(escape(label));
      return token(escape(decode(match)));
    });
    // Protect custom emoji HTML from the subsequent Slack emphasis formatter too.
    text = inline(decode(text)).replace(/<span class="home-slack-emoji"[^>]*>[^<]*<\/span>/g,token);
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g,'$1<strong>$2</strong>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g,'$1<em>$2</em>')
      .replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/g,'$1<s>$2</s>');
    return text.replace(/\u0000(\d+)\u0000/g,(_,index) => tokens[Number(index)] || '');
  }
  function setStatus(text, error = false) {
    $('homeSlackStatus').textContent = text;
    $('homeSlackStatus').classList.toggle('is-error',error);
  }
  function controls() {
    $('homeSlackRefresh').disabled = state.loading;
    widget.setAttribute('aria-busy',String(state.loading));
  }
  function cancelAttachmentRequests() {
    for(const pending of state.attachmentPending.values())pending.controller.abort();
    state.attachmentPending.clear();
  }
  function closeImage() {
    state.openImageId=null;
    if ($('homeSlackImageDialog').open) $('homeSlackImageDialog').close();
    $('homeSlackLargeImage').removeAttribute('src');
    $('homeSlackLargeImage').alt='';
    $('homeSlackImageTitle').textContent='';
  }
  function clearImages({keepKeys=new Set(),keepAttachments=new Set()}={}) {
    state.imageEpoch++;
    cancelAttachmentRequests();
    if(!keepAttachments.has(state.urls.get(state.openImageId)?.key))closeImage();
    for(const [id,item]of state.urls)if(!keepAttachments.has(item.key)){URL.revokeObjectURL(item.url);state.urls.delete(id);}
    for(const [id,entry]of state.imageButtons)if(!keepAttachments.has(entry.key)){entry.button.remove();state.imageButtons.delete(id);}
    const managed=new Set([...state.smallMedia.values()].map(item=>item.url));
    for(const [key,item]of state.smallMedia)if(!keepKeys.has(key)){URL.revokeObjectURL(item.url);state.smallMedia.delete(key);}
    new Set([...state.emojiUrls.values(),state.avatarUrl].filter(Boolean)).forEach(url=>{if(!managed.has(url))URL.revokeObjectURL(url);});
    state.emojiUrls.clear();
    state.avatarUrl=null;
    const initials=$('homeSlackInitials');initials.textContent=initials.getAttribute('data-initials')||'';
    $('homeSlackBody').querySelectorAll('[data-slack-emoji]').forEach(slot=>{slot.textContent=`:${slot.dataset.slackEmoji}:`;});
    if(!keepAttachments.size){state.attachmentOrder=[];$('homeSlackImages').innerHTML='';$('homeSlackImages').hidden=true;}
  }
  function clearMessage(text) {
    clearImages();
    widget.removeAttribute('data-custom-emoji-status');
    widget.removeAttribute('data-slack-inline-media');
    widget.removeAttribute('data-slack-reused-media');
    $('homeSlackMessage').hidden = true;
    $('homeSlackBody').innerHTML = '';
    $('homeSlackAuthor').textContent = '';
    $('homeSlackInitials').textContent = '';
    $('homeSlackInitials').removeAttribute('data-initials');
    $('homeSlackTime').textContent = '';
    $('homeSlackFiles').innerHTML = '';
    $('homeSlackFiles').hidden = true;
    $('homeSlackOpen').hidden = true;
    $('homeSlackOpen').removeAttribute('href');
    $('homeSlackEmpty').textContent = text;
    $('homeSlackEmpty').hidden = false;
    widget.classList.add('is-empty');
  }
  async function fetchImage(body,current,signal) {
    const {data:auth,error} = await supabaseClient.auth.getSession();
    if (!current()) return {data:null,error:null};
    const session = auth?.session;
    if (error || !session?.access_token || session.user?.id !== state.userId) return {data:null,error:{context:{status:401}}};
    // functions.invoke parses image/* as text and consumes its returned Response.
    // Fetch the protected image directly so its original bytes and MIME type survive.
    const response = await fetch(imageEndpoint,{
      method:'POST',
      headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',signal
    });
    if (!response.ok) return {data:null,error:{context:response}};
    return {data:await response.blob(),error:null};
  }
  async function invoke(body,current=()=>true,signal) {
    let timer;
    const controller = new AbortController();
    let abort;
    try {
      const jobs=[
        ['image','emoji','avatar'].includes(body.action) ? fetchImage(body,current,controller.signal) : supabaseClient.functions.invoke('hq-slack-general',{body}),
        new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(new Error('TIMEOUT'));},20000);})
      ];
      if(signal)jobs.push(new Promise((_,reject)=>{abort=()=>{controller.abort();reject(new Error('ABORTED'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}));
      return await Promise.race(jobs);
    } finally {clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);}
  }
  function imageError(error) {
    // Only inspect the HTTP status. Server/provider error details never appear in the widget.
    return [401,403].includes(error?.context?.status);
  }
  function rememberSmallMedia(data,key) {
    const known=mediaKey(key)&&state.smallMedia.get(key);if(known)return known.url;
    const url=URL.createObjectURL(data);
    const size=[...state.smallMedia.values()].reduce((sum,item)=>sum+item.size,0);
    if(mediaKey(key)&&data.size<=65536&&state.smallMedia.size<65&&size+data.size<=4*1024*1024)state.smallMedia.set(key,{url,size:data.size});
    return url;
  }
  function forgetSmallMedia(key,url) {
    if(mediaKey(key)&&state.smallMedia.get(key)?.url===url)state.smallMedia.delete(key);
    URL.revokeObjectURL(url);
  }
  function acceptInlineMedia(items,wanted) {
    let bytes=0,count=0;
    for(const item of (Array.isArray(items)?items:[]).slice(0,9)) {
      const key=mediaKey(item?.key);
      if(!key||!wanted.has(key)||state.smallMedia.has(key)||typeof item.data!=='string'||item.data.length>87384||!/^[a-zA-Z0-9+/]*={0,2}$/.test(item.data))continue;
      try {
        const raw=atob(item.data);if(raw.length>65536||bytes+raw.length>262144)continue;
        const data=new Blob([Uint8Array.from(raw,character=>character.charCodeAt(0))],{type:String(item.type||'')});
        if(!rasterBlob(data))continue;
        const url=rememberSmallMedia(data,key);
        if(!state.smallMedia.has(key)){URL.revokeObjectURL(url);continue;}
        bytes+=data.size;count++;
      }catch{/* A malformed optional bundle falls back to the protected image endpoint. */}
    }
    return count;
  }
  function showEmoji(name,url,key,valid) {
    const slots=()=>$('homeSlackBody').querySelectorAll(`[data-slack-emoji="${name}"]`);
    state.emojiUrls.set(name,url);
    slots().forEach(slot=>{
      slot.innerHTML=`<img src="${escape(url)}" alt=":${name}:" title=":${name}:" decoding="async">`;
      slot.querySelector('img')?.addEventListener('error',()=>{
        if(!valid())return;
        slots().forEach(item=>{item.textContent=`:${name}:`;});
        forgetSmallMedia(key,url);state.emojiUrls.delete(name);
      },{once:true});
    });
  }
  function showAvatar(url,key,valid) {
    const slot=$('homeSlackInitials');state.avatarUrl=url;
    // The adjacent author name identifies this decorative photo to assistive technology.
    slot.innerHTML=`<img src="${escape(url)}" alt="" decoding="async">`;
    slot.querySelector('img')?.addEventListener('error',()=>{
      if(!valid())return;
      slot.textContent=slot.getAttribute('data-initials')||'';
      forgetSmallMedia(key,url);state.avatarUrl=null;
    },{once:true});
  }
  const attachmentKey=(messageTs,id)=>`${messageTs}:${id}`;
  function normalizedImages(message) {
    if(!/^\d{1,16}\.\d{1,16}$/.test(String(message.ts||'')))return [];
    const seen=new Set();
    return (Array.isArray(message.images)?message.images:[]).filter(file=>{
      if(!/^F[A-Z0-9]{1,30}$/.test(String(file?.id))||seen.has(file.id))return false;
      seen.add(file.id);return true;
    }).slice(0,MAX_IMAGES).map(file=>({id:file.id,title:String(file.title||'Attached image').slice(0,200),alt:String(file.alt||file.title||'Image attached to the Slack message').slice(0,500)}));
  }
  function unavailableImage(entry,title) {
    entry.url=null;entry.button.disabled=true;
    entry.button.innerHTML='<span class="home-slack-image-failed">Image unavailable<br>View it in Slack</span>';
    entry.button.setAttribute('aria-label',`${title}: image unavailable`);
  }
  function showImage(file,item,entry) {
    item.title=file.title;item.alt=file.alt;
    const button=entry.button;
    if(entry.url!==item.url){
      entry.url=item.url;
      button.innerHTML=`<img src="${escape(item.url)}" alt="${escape(item.alt)}" loading="lazy" decoding="async"><span>${escape(item.title)}</span>`;
      const epoch=state.authEpoch;
      button.querySelector('img')?.addEventListener('error',()=>{
        if(epoch!==state.authEpoch||state.urls.get(file.id)!==item)return;
        if(state.openImageId===file.id)closeImage();
        URL.revokeObjectURL(item.url);state.urls.delete(file.id);unavailableImage(entry,item.title);
      },{once:true});
    }else{
      const image=button.querySelector('img'),caption=button.querySelector('span');
      if(image)image.alt=item.alt;
      if(caption)caption.textContent=item.title;
    }
    button.disabled=false;button.setAttribute('aria-label',`Enlarge image: ${item.title}`);
    if(state.openImageId===file.id&&$('homeSlackImageDialog').open){$('homeSlackImageTitle').textContent=item.title;$('homeSlackLargeImage').alt=item.alt;}
  }
  function renderImages(images,messageTs) {
    const order=images.map(file=>attachmentKey(messageTs,file.id)),buttons=[];
    for(const file of images){
      const key=attachmentKey(messageTs,file.id);let entry=state.imageButtons.get(file.id);
      if(!entry||entry.key!==key){
        const button=document.createElement('button');button.type='button';button.className='home-slack-image';button.dataset.slackImage=file.id;
        entry={key,button,url:null};state.imageButtons.set(file.id,entry);
      }
      const item=state.urls.get(file.id);
      if(item?.key===key)showImage(file,item,entry);
      else{entry.url=null;entry.button.disabled=true;entry.button.innerHTML='<span class="home-slack-image-failed">Loading image…</span>';entry.button.setAttribute('aria-label',`Loading image: ${file.title}`);}
      buttons.push(entry.button);
    }
    if(order.length!==state.attachmentOrder.length||order.some((key,index)=>key!==state.attachmentOrder[index]))$('homeSlackImages').replaceChildren(...buttons);
    state.attachmentOrder=order;$('homeSlackImages').hidden=images.length===0;
  }
  async function loadImage(file, messageTs, current, imageEpoch) {
    const valid = () => current() && imageEpoch === state.imageEpoch;
    const key=attachmentKey(messageTs,file.id),entry=state.imageButtons.get(file.id);
    if(!entry||entry.key!==key||state.urls.get(file.id)?.key===key||state.attachmentPending.has(key))return;
    const pending={controller:new AbortController()};state.attachmentPending.set(key,pending);
    try {
      const {data,error} = await invoke({action:'image',file_id:file.id,message_ts:messageTs},valid,pending.controller.signal);
      if (!valid()) return;
      if (error) {
        if (imageError(error)) {
          if (!valid()) return;
          clearMessage('This Slack update is unavailable.');
          setStatus('Your Slack access may have changed. Try Refresh.',true);
          return;
        }
        throw error;
      }
      const bytes=[...state.urls.values()].reduce((sum,item)=>sum+item.size,0);
      if (!(data instanceof Blob) || !/^image\/(png|jpeg|jpg|gif|webp|avif)$/i.test(data.type) || data.size > MAX_IMAGE_BYTES || state.urls.size>=MAX_IMAGES || bytes+data.size>MAX_GALLERY_BYTES) throw new Error('Unsupported image');
      if (!valid()||state.imageButtons.get(file.id)!==entry) return;
      const item={key,url:URL.createObjectURL(data),size:data.size,title:file.title,alt:file.alt};
      state.urls.set(file.id,item);showImage(file,item,entry);
    } catch {
      if (!valid()) return;
      if(state.imageButtons.get(file.id)===entry)unavailableImage(entry,file.title);
    }finally{if(state.attachmentPending.get(key)===pending)state.attachmentPending.delete(key);}
  }
  async function loadEmoji(name,messageTs,current,imageEpoch,key) {
    const valid=()=>current()&&imageEpoch===state.imageEpoch;
    const slots=()=>$('homeSlackBody').querySelectorAll(`[data-slack-emoji="${name}"]`);
    try {
      const cached=mediaKey(key)&&state.smallMedia.get(key);
      if(cached&&valid()){showEmoji(name,cached.url,key,valid);return;}
      const {data,error}=await invoke({action:'emoji',emoji_name:name,message_ts:messageTs},valid);
      if(!valid())return;
      if(error){
        if(imageError(error)){clearMessage('This Slack update is unavailable.');setStatus('Your Slack access may have changed. Try Refresh.',true);}
        return;
      }
      if(!rasterBlob(data)||!slots().length)return;
      showEmoji(name,rememberSmallMedia(data,key),key,valid);
    }catch{/* Keep the readable shortcode if optional custom emoji loading fails. */}
  }
  async function loadAvatar(messageTs,current,imageEpoch,key) {
    const valid=()=>current()&&imageEpoch===state.imageEpoch;
    try {
      const cached=mediaKey(key)&&state.smallMedia.get(key);
      if(cached&&valid()){showAvatar(cached.url,key,valid);return;}
      const {data,error}=await invoke({action:'avatar',message_ts:messageTs},valid);
      if(!valid())return;
      if(error){
        if(imageError(error)){clearMessage('This Slack update is unavailable.');setStatus('Your Slack access may have changed. Try Refresh.',true);}
        return;
      }
      if(!rasterBlob(data))return;
      showAvatar(rememberSmallMedia(data,key),key,valid);
    }catch{/* Keep the author's initials if the optional profile image is unavailable. */}
  }
  function render(payload,current) {
    const message = payload?.message;
    if (!message) {clearMessage('No messages in #general yet.'); return;}
    const images=normalizedImages(message),keepAttachments=new Set(images.map(file=>attachmentKey(message.ts,file.id)));
    const customImages=(Array.isArray(message.custom_emojis)?message.custom_emojis:[]).slice(0,64).filter(item=>item?.image===true&&/^[a-zA-Z0-9_+\-]{1,100}$/.test(item?.name||''));
    const wanted=new Set([message.author?.avatar===true?message.author.avatar_key:'',...customImages.map(item=>item.key)].map(mediaKey).filter(Boolean));
    clearImages({keepKeys:wanted,keepAttachments});
    widget.setAttribute('data-slack-reused-media',String(state.smallMedia.size));
    widget.setAttribute('data-slack-inline-media',String(acceptInlineMedia(payload.media,wanted)));
    widget.setAttribute('data-custom-emoji-status',message.custom_emoji_ready===true?'ready':message.custom_emoji_ready===false?'unavailable':'unknown');
    const name = String(message.author?.name || 'Slack member').slice(0,200);
    const date = new Date(Number(message.ts) * 1000);
    const validDate = Number.isFinite(date.getTime());
    $('homeSlackAuthor').textContent = name;
    $('homeSlackInitials').textContent = name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0] || '').join('').toUpperCase() || '#';
    $('homeSlackInitials').setAttribute('data-initials',$('homeSlackInitials').textContent);
    $('homeSlackTime').textContent = validDate ? new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date) : '';
    if (validDate) $('homeSlackTime').setAttribute('datetime',date.toISOString());
    $('homeSlackTime').setAttribute('title',validDate ? `${date.toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern time` : '');
    $('homeSlackBody').innerHTML = formatText(message.text,message.custom_emojis);
    $('homeSlackBody').hidden = !String(message.text || '').trim();
    const permalink = safeURL(message.permalink,true);
    $('homeSlackOpen').hidden = !permalink;
    if (permalink) $('homeSlackOpen').href = permalink;
    else $('homeSlackOpen').removeAttribute('href');
    const files = (Array.isArray(message.files) ? message.files : []).slice(0,20).filter(file => safeURL(file.permalink,true));
    $('homeSlackFiles').innerHTML = files.map(file=>`<a href="${escape(safeURL(file.permalink,true))}" target="_blank" rel="noopener noreferrer">${escape(file.title || 'Attachment')}<span class="home-slack-file-note">Open in Slack ↗</span></a>`).join('');
    $('homeSlackFiles').hidden = files.length === 0;
    renderImages(images,message.ts);
    $('homeSlackMessage').hidden = false;
    $('homeSlackEmpty').hidden = true;
    widget.classList.remove('is-empty');
    const imageEpoch = state.imageEpoch;
    // Keep private image requests bounded, including when a message contains a gallery.
    const emojiNames=[...new Set([...$('homeSlackBody').querySelectorAll('[data-slack-emoji]')].map(slot=>slot.dataset.slackEmoji))].slice(0,64);
    const keys=new Map(customImages.map(item=>[item.name,mediaKey(item.key)]));
    const jobs=[...(message.author?.avatar===true?[()=>loadAvatar(message.ts,current,imageEpoch,message.author.avatar_key)]:[]),...emojiNames.map(name=>()=>loadEmoji(name,message.ts,current,imageEpoch,keys.get(name))),...images.filter(file=>state.urls.get(file.id)?.key!==attachmentKey(message.ts,file.id)).map(file=>()=>loadImage(file,message.ts,current,imageEpoch))];
    let next = 0;
    const worker = async () => {while (current() && imageEpoch === state.imageEpoch && next < jobs.length) await jobs[next++]();};
    for (let i=0;i<Math.min(3,jobs.length);i++) void worker();
  }
  async function refresh({automatic = false} = {}) {
    if (state.loading || (automatic && (document.hidden || $('homeSlackImageDialog').open || Date.now() - state.lastAttempt < 10000))) return;
    const epoch = state.authEpoch;
    const requestId = ++state.requestId;
    const current = () => epoch === state.authEpoch && requestId === state.requestId;
    cancelAttachmentRequests();
    state.lastAttempt = Date.now();
    state.loading = true;
    controls();
    setStatus('Checking #general…');
    try {
      if (typeof supabaseClient === 'undefined') throw new Error('Client unavailable');
      const {data:auth,error:authError} = await supabaseClient.auth.getSession();
      if (!current()) return;
      if (authError || !auth?.session?.user) {
        clearMessage('Sign in to see the latest Slack update.');
        setStatus('Sign in to Paws HQ to view #general.');
        return;
      }
      if(typeof ensureHqWorkspaceAccess==='function')await ensureHqWorkspaceAccess(auth.session);
      if(!current())return;
      if(state.userId&&state.userId!==auth.session.user.id)clearMessage('Loading the latest Slack update…');
      state.userId = auth.session.user.id;
      const {data,error} = await invoke({action:'message',include_media:true,known_media:[...state.smallMedia.keys()].slice(0,48)});
      if (!current()) return;
      if (error || !data || !Object.hasOwn(data,'message')) throw error || new Error('Invalid response');
      render(data,current);
      setStatus(`Updated ${new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date())} · Refreshes every minute`);
    } catch (error) {
      if (!current()) return;
      let code = '';
      try {code = (await error?.context?.clone()?.json())?.error?.code || '';} catch { /* Network errors have no response body. */ }
      if (!current()) return;
      if (code === 'CONNECTION_REQUIRED') {
        clearMessage('Slack connection is not set up yet.');
        setStatus('Your Paws HQ administrator can connect #general here.',true);
        return;
      }
      if (code === 'AUTH_REQUIRED') {
        clearMessage('Sign in to see the latest Slack update.');
        setStatus('Sign in to Paws HQ to view #general.');
        return;
      }
      if (code === 'ACCESS_DENIED') {
        clearMessage('This Slack update is unavailable for your account.');
        setStatus('Access requires Paws HQ approval and membership in #general.',true);
        return;
      }
      clearMessage('The latest Slack update is unavailable.');
      setStatus('Check your connection or Slack access, then try Refresh.',true);
    } finally {
      if (current()) {state.loading = false; controls();}
    }
  }
  $('homeSlackRefresh').addEventListener('click',()=>refresh());
  $('homeSlackImages').addEventListener('click',event=> {
    const button = event.target.closest('[data-slack-image]');
    const item = button && state.urls.get(button.dataset.slackImage);
    if (!item) return;
    state.openImageId=button.dataset.slackImage;
    $('homeSlackImageTitle').textContent = item.title;
    $('homeSlackLargeImage').src = item.url;
    $('homeSlackLargeImage').alt = item.alt;
    $('homeSlackImageDialog').showModal();
    $('homeSlackImageClose').focus();
  });
  $('homeSlackImageClose').addEventListener('click',()=>$('homeSlackImageDialog').close());
  $('homeSlackImageDialog').addEventListener('click',event=> {if (event.target === $('homeSlackImageDialog')) $('homeSlackImageDialog').close();});
  $('homeSlackImageDialog').addEventListener('close',()=> {
    state.openImageId=null;
    $('homeSlackLargeImage').removeAttribute('src');
    if (state.userId&&Date.now() - state.lastAttempt >= 60000) void refresh({automatic:true});
  });
  window.addEventListener('focus',()=>refresh({automatic:true}));
  window.addEventListener('online',()=>refresh({automatic:true}));
  window.addEventListener('pagehide',()=>{state.authEpoch++;state.requestId++;state.userId=null;state.loading=false;clearMessage('Loading the latest Slack update…');state.lastAttempt=0;controls();});
  window.addEventListener('pageshow',event=>{if(event.persisted)void refresh({automatic:true});});
  window.addEventListener('paws-access-revoked',()=>{
    state.authEpoch++;state.requestId++;state.loading=false;state.userId=null;
    clearMessage('This Slack update is unavailable.');setStatus('Your workspace access has changed.',true);controls();
  });
  document.addEventListener('visibilitychange',()=> {if (!document.hidden) void refresh({automatic:true});});
  setInterval(()=>refresh({automatic:true}),60000);
  if (typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.onAuthStateChange((event,session)=> {
      const userId = session?.user?.id || null;
      const changed = event === 'SIGNED_OUT' || userId !== state.userId;
      if (changed) {
        state.authEpoch++;
        state.requestId++;
        state.userId = userId;
        state.loading = false;
        state.lastAttempt = 0;
        clearMessage(userId ? 'Loading the latest Slack update…' : 'Sign in to see the latest Slack update.');
        setStatus(userId ? 'Checking #general…' : 'Sign in to Paws HQ to view #general.');
        controls();
      }
      // Avoid starting another Supabase call within an auth callback.
      if (userId && changed) setTimeout(()=>refresh(),0);
    });
  }
  void refresh();
})();
