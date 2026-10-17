const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/run-cards.js'),'utf8');
function harness({popup=true}={}) {
  const label={textContent:'Run Cards'},button={disabled:false,querySelector(){return label},setAttribute(){},removeAttribute(){}};
  const scripts=[],alerts=[],destinations=[],timers=new Map();let closed=false,opened=0;
  const context={URL,Date,Math,alert:text=>alerts.push(text),setTimeout:fn=>{timers.set(1,fn);return 1},clearTimeout:id=>timers.delete(id),document:{getElementById:()=>button,createElement:()=>({remove(){this.removed=true}}),head:{appendChild:s=>scripts.push(s)}}};
  context.window={open(){opened++;return popup?{location:{replace:url=>destinations.push(url)},close(){closed=true}}:null}};
  vm.runInNewContext(source,context);
  return {context,button,label,scripts,alerts,destinations,timers,get closed(){return closed},get opened(){return opened},run:day=>context.window.pawsGenerateRunCards(day),reply:value=>{const cb=new URL(scripts.at(-1).src).searchParams.get('callback');context.window[cb](value)}};
}
test('run cards preserves today/tomorrow request and restores button after a PDF response',()=>{
  const h=harness();h.run('tomorrow');assert.equal(new URL(h.scripts[0].src).searchParams.get('start'),'tomorrow');assert.equal(h.button.disabled,true);assert.equal(h.label.textContent,'Preparing…');
  h.run('today');assert.equal(h.opened,1);h.reply('https://example.supabase.co/storage/v1/object/public/cards/tomorrow.pdf');
  assert.equal(h.destinations.length,1);assert.equal(h.button.disabled,false);assert.equal(h.label.textContent,'Run Cards');assert.equal(h.timers.size,0);assert.equal(h.scripts[0].removed,true);
  h.run('today');assert.equal(new URL(h.scripts[1].src).searchParams.get('start'),'today');
});
test('blocked popup makes no generation request and leaves the control available',()=>{const h=harness({popup:false});h.run('today');assert.equal(h.scripts.length,0);assert.equal(h.button.disabled,false);assert.match(h.alerts[0],/allow pop-ups/)});
test('invalid modes make no request',()=>{const h=harness();h.run('yesterday');assert.equal(h.opened,0);assert.equal(h.scripts.length,0)});
test('request error and timeout clean up and allow retry',()=>{for(const mode of ['error','timeout']){const h=harness();h.run('today');if(mode==='error')h.scripts[0].onerror();else h.timers.get(1)();assert.equal(h.closed,true);assert.equal(h.button.disabled,false);assert.equal(h.label.textContent,'Run Cards');assert.equal(h.timers.size,0);assert.equal(h.scripts[0].removed,true);h.run('today');assert.equal(h.opened,2)}});
test('an unsafe or malformed response is not opened',()=>{for(const value of ['javascript:alert(1)','not a URL']){const h=harness();h.run('today');h.reply(value);assert.equal(h.destinations.length,0);assert.equal(h.closed,true);assert.equal(h.button.disabled,false)}});
