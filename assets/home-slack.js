/* Read-only #general update. Slack credentials and private image URLs stay on the server. */
(() => {
  'use strict';
  const widget = document.getElementById('homeSlackWidget');
  if (!widget) return;
  const $ = id => document.getElementById(id);
  const imageEndpoint = 'https://dppjgglaeieevsfwsbii.supabase.co/functions/v1/hq-slack-general';
  const state = {userId: null, authEpoch: 0, requestId: 0, imageEpoch: 0, loading: false, lastAttempt: 0, urls: new Map(), emojiUrls: new Map()};
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
  function clearImages() {
    state.imageEpoch++;
    if ($('homeSlackImageDialog').open) $('homeSlackImageDialog').close();
    $('homeSlackLargeImage').removeAttribute('src');
    $('homeSlackLargeImage').alt = '';
    $('homeSlackImageTitle').textContent = '';
    state.urls.forEach(item => URL.revokeObjectURL(item.url));
    state.urls.clear();
    state.emojiUrls.forEach(url=>URL.revokeObjectURL(url));
    state.emojiUrls.clear();
    $('homeSlackBody').querySelectorAll('[data-slack-emoji]').forEach(slot=>{slot.textContent=`:${slot.dataset.slackEmoji}:`;});
    $('homeSlackImages').innerHTML = '';
    $('homeSlackImages').hidden = true;
  }
  function clearMessage(text) {
    clearImages();
    widget.removeAttribute('data-custom-emoji-status');
    $('homeSlackMessage').hidden = true;
    $('homeSlackBody').innerHTML = '';
    $('homeSlackAuthor').textContent = '';
    $('homeSlackInitials').textContent = '';
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
  async function invoke(body,current=()=>true) {
    let timer;
    const controller = new AbortController();
    try {
      return await Promise.race([
        ['image','emoji'].includes(body.action) ? fetchImage(body,current,controller.signal) : supabaseClient.functions.invoke('hq-slack-general',{body}),
        new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(new Error('TIMEOUT'));},20000);})
      ]);
    } finally {clearTimeout(timer);}
  }
  function imageError(error) {
    // Only inspect the HTTP status. Server/provider error details never appear in the widget.
    return [401,403].includes(error?.context?.status);
  }
  async function loadImage(file, messageTs, current, imageEpoch) {
    const valid = () => current() && imageEpoch === state.imageEpoch;
    const slot = () => $('homeSlackImages').querySelector(`[data-slack-image="${file.id}"]`);
    try {
      const {data,error} = await invoke({action:'image',file_id:file.id,message_ts:messageTs},valid);
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
      if (!(data instanceof Blob) || !/^image\/(png|jpeg|jpg|gif|webp|avif)$/i.test(data.type) || data.size > 8 * 1024 * 1024) throw new Error('Unsupported image');
      const button = slot();
      if (!button || !valid()) return;
      const url = URL.createObjectURL(data);
      state.urls.set(file.id,{url,title:file.title,alt:file.alt});
      button.innerHTML = `<img src="${escape(url)}" alt="${escape(file.alt)}" loading="lazy" decoding="async"><span>${escape(file.title)}</span>`;
      button.disabled = false;
      button.setAttribute('aria-label',`Enlarge image: ${file.title}`);
      button.querySelector('img')?.addEventListener('error',()=> {
        if (!valid()) return;
        URL.revokeObjectURL(url);
        state.urls.delete(file.id);
        button.disabled = true;
        button.innerHTML = '<span class="home-slack-image-failed">Image unavailable<br>View it in Slack</span>';
        button.setAttribute('aria-label',`${file.title}: image unavailable`);
      },{once:true});
    } catch {
      if (!valid()) return;
      const button = slot();
      if (button) {
        button.innerHTML = '<span class="home-slack-image-failed">Image unavailable<br>View it in Slack</span>';
        button.setAttribute('aria-label',`${file.title}: image unavailable`);
      }
    }
  }
  async function loadEmoji(name,messageTs,current,imageEpoch) {
    const valid=()=>current()&&imageEpoch===state.imageEpoch;
    const slots=()=>$('homeSlackBody').querySelectorAll(`[data-slack-emoji="${name}"]`);
    try {
      const {data,error}=await invoke({action:'emoji',emoji_name:name,message_ts:messageTs},valid);
      if(!valid())return;
      if(error){
        if(imageError(error)){clearMessage('This Slack update is unavailable.');setStatus('Your Slack access may have changed. Try Refresh.',true);}
        return;
      }
      if(!(data instanceof Blob)||!/^image\/(png|jpeg|jpg|gif|webp|avif)$/i.test(data.type)||data.size>1024*1024||!slots().length)return;
      const url=URL.createObjectURL(data);state.emojiUrls.set(name,url);
      slots().forEach(slot=>{
        slot.innerHTML=`<img src="${escape(url)}" alt=":${name}:" title=":${name}:" decoding="async">`;
        slot.querySelector('img')?.addEventListener('error',()=>{
          if(!valid())return;
          slots().forEach(item=>{item.textContent=`:${name}:`;});
          URL.revokeObjectURL(url);state.emojiUrls.delete(name);
        },{once:true});
      });
    }catch{/* Keep the readable shortcode if optional custom emoji loading fails. */}
  }
  function render(payload,current) {
    clearImages();
    const message = payload?.message;
    if (!message) {clearMessage('No messages in #general yet.'); return;}
    widget.setAttribute('data-custom-emoji-status',message.custom_emoji_ready===true?'ready':message.custom_emoji_ready===false?'unavailable':'unknown');
    const name = String(message.author?.name || 'Slack member').slice(0,200);
    const date = new Date(Number(message.ts) * 1000);
    const validDate = Number.isFinite(date.getTime());
    $('homeSlackAuthor').textContent = name;
    $('homeSlackInitials').textContent = name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0] || '').join('').toUpperCase() || '#';
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
    const seen = new Set();
    const images = (Array.isArray(message.images) ? message.images : []).filter(file=> {
      if (!/^F[A-Z0-9]{1,30}$/.test(String(file.id)) || seen.has(file.id)) return false;
      seen.add(file.id); return true;
    }).slice(0,12).map(file=>({id:file.id,title:String(file.title || 'Attached image').slice(0,200),alt:String(file.alt || file.title || 'Image attached to the Slack message').slice(0,500)}));
    $('homeSlackImages').innerHTML = images.map(file=>`<button type="button" class="home-slack-image" data-slack-image="${file.id}" aria-label="Loading image: ${escape(file.title)}" disabled><span class="home-slack-image-failed">Loading image…</span></button>`).join('');
    $('homeSlackImages').hidden = images.length === 0;
    $('homeSlackMessage').hidden = false;
    $('homeSlackEmpty').hidden = true;
    widget.classList.remove('is-empty');
    const imageEpoch = state.imageEpoch;
    // Keep private image requests bounded, including when a message contains a gallery.
    const emojiNames=[...new Set([...$('homeSlackBody').querySelectorAll('[data-slack-emoji]')].map(slot=>slot.dataset.slackEmoji))].slice(0,64);
    const jobs=[...images.map(file=>()=>loadImage(file,message.ts,current,imageEpoch)),...emojiNames.map(name=>()=>loadEmoji(name,message.ts,current,imageEpoch))];
    let next = 0;
    const worker = async () => {while (current() && imageEpoch === state.imageEpoch && next < jobs.length) await jobs[next++]();};
    for (let i=0;i<Math.min(3,jobs.length);i++) void worker();
  }
  async function refresh({automatic = false} = {}) {
    if (state.loading || (automatic && (document.hidden || $('homeSlackImageDialog').open || Date.now() - state.lastAttempt < 10000))) return;
    const epoch = state.authEpoch;
    const requestId = ++state.requestId;
    const current = () => epoch === state.authEpoch && requestId === state.requestId;
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
      state.userId = auth.session.user.id;
      const {data,error} = await invoke({action:'message'});
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
    $('homeSlackImageTitle').textContent = item.title;
    $('homeSlackLargeImage').src = item.url;
    $('homeSlackLargeImage').alt = item.alt;
    $('homeSlackImageDialog').showModal();
    $('homeSlackImageClose').focus();
  });
  $('homeSlackImageClose').addEventListener('click',()=>$('homeSlackImageDialog').close());
  $('homeSlackImageDialog').addEventListener('click',event=> {if (event.target === $('homeSlackImageDialog')) $('homeSlackImageDialog').close();});
  $('homeSlackImageDialog').addEventListener('close',()=> {
    $('homeSlackLargeImage').removeAttribute('src');
    if (Date.now() - state.lastAttempt >= 60000) void refresh({automatic:true});
  });
  window.addEventListener('focus',()=>refresh({automatic:true}));
  window.addEventListener('online',()=>refresh({automatic:true}));
  window.addEventListener('pagehide',clearImages);
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
