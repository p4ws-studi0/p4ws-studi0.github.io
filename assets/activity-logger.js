/* Best-effort OAuth-return metadata. Page visits are never recorded. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PawsActivityLogger=api;
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  function cleanPath(value) {
    try {
      const path=decodeURIComponent(String(value||'').split(/[?#]/,1)[0]);
      if(!path.startsWith('/')||path.startsWith('//')||path.length>500||/[\\?#%\u0000-\u001f\u007f]/.test(path)||/(^|\/)\.{1,2}(\/|$)/.test(path))return '';
      return path.replace(/\/index\.html$/,'/').replace(/\.html$/,'')||'/';
    }catch{return '';}
  }
  function createLogger({client,ensureAccess,win,doc,signIn=false,schedule=setTimeout,cancel=clearTimeout}) {
    let epoch=0,userId=null,timer=null,stopped=false,revoked=false,started=false;
    const sent=new Set(),pending=new Set();
    const path=()=>cleanPath(win.location?.pathname||'');
    const allowedPath=()=>path()&&!['/login','/auth/callback/','/404','/report-loading','/template'].includes(path());
    async function record(action) {
      if(stopped||revoked||doc.hidden||!allowedPath()||action!=='sign_in')return;
      const generation=epoch,route=path(),key=action+':'+route;
      if(sent.has(key)||pending.has(key))return;
      pending.add(key);
      try {
        const {data,error}=await client.auth.getSession();
        if(stopped||revoked||generation!==epoch||error||!data?.session?.user)return;
        const session=data.session;
        if(userId&&userId!==session.user.id){epoch++;userId=session.user.id;sent.clear();pending.clear();queue();return;}
        userId=session.user.id;
        if(ensureAccess)await ensureAccess(session);
        if(stopped||revoked||generation!==epoch)return;
        const result=await client.rpc('hq_activity_record_visit',{p_path:route,p_action:action});
        if(!stopped&&!revoked&&generation===epoch&&!result.error)sent.add(key);
      }catch{/* History must never interrupt navigation, sign-in, or data entry. */}
      finally{if(generation===epoch)pending.delete(key);}
    }
    function queue() {
      if(!signIn||stopped||timer!==null)return;
      timer=schedule(()=>{timer=null;void record('sign_in');},1200);
    }
    const reset=()=>{epoch++;sent.clear();pending.clear();if(timer!==null){cancel(timer);timer=null;}};
    const onRevoke=()=>{reset();revoked=true;userId=null;};
    const onRestore=()=>{reset();revoked=false;queue();};
    function start() {
      if(started)return;started=true;
      win.addEventListener('paws-access-revoked',onRevoke);
      win.addEventListener('paws-access-restored',onRestore);
      win.addEventListener('pagehide',()=>{reset();stopped=true;});
      win.addEventListener('pageshow',event=>{if(event.persisted){reset();stopped=false;queue();}});
      doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)queue();});
      client.auth.onAuthStateChange((event,session)=>{
        const next=session?.user?.id||null;
        if(event==='SIGNED_OUT'||userId&&next!==userId){reset();userId=next;if(!next)revoked=true;else{revoked=false;queue();}}
      });
      queue();
    }
    return {start,record};
  }
  let singleton=null;
  function start(options) {if(!singleton){singleton=createLogger({...options,win:options.win||window,doc:options.doc||document});singleton.start();}return singleton;}
  return {cleanPath,createLogger,start};
});
