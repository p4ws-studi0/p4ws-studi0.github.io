/* Paws HQ daily closing. Literal records, exact cents, and one entry per date. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),TABLE='hq_end_of_day';
  const FIELDS=[['staff_name','Staff name',500],['cash_received','Cash received',200],['checks_received','Checks received',200],['card_tips_received','Card tips received',200],['card_tips_paid','Card tips paid to staff',200],['receipts_paid','Receipts paid from drawer',200],['receipt_description','Receipt description',20000],['drawer_total','Drawer total',200],['cash_replaced','Cash returned to drawer',200],['cash_deposit','Cash deposit',200],['check_deposit','Check deposit',200],['total_deposit','Total deposit',200],['notes','Notes about today',20000],['additional_note','Additional note',20000],['bills_100','$100 bills',200],['bills_50','$50 bills',200],['bills_20','$20 bills',200],['bills_10','$10 bills',200],['bills_5','$5 bills',200],['bills_1','$1 bills',200],['quarters','Quarters',200],['dimes','Dimes',200],['nickels','Nickels',200],['pennies','Pennies',200]];
  const PROTECTED=['drawer_total','total_deposit'],KEYS=FIELDS.map(([key])=>key).filter(key=>!PROTECTED.includes(key));
  const DENOMINATIONS=['bills_100','bills_50','bills_20','bills_10','bills_5','bills_1','quarters','dimes','nickels','pennies'];
  const DENOMINATION_CENTS={bills_100:10000n,bills_50:5000n,bills_20:2000n,bills_10:1000n,bills_5:500n,bills_1:100n,quarters:25n,dimes:10n,nickels:5n,pennies:1n};
  const MONEY=['cash_received','checks_received','card_tips_received','card_tips_paid','receipts_paid','cash_replaced','cash_deposit','check_deposit',...DENOMINATIONS];
  const TEXT_FIELDS=['staff_name','receipt_description','notes','additional_note'];
  const text=value=>String(value??''),nonblank=value=>text(value).trim().length>0;
  const escape=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const normalized=value=>text(value).replace(/\r\n?/g,'\n');
  function easternToday(now=new Date()) {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const value=kind=>parts.find(part=>part.type===kind).value;return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function validDate(value) {
    const match=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return false;
    const [year,month,day]=match.slice(1).map(Number);if(year<1000||year>9999)return false;
    const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
  }
  function shiftDate(value,days) {const [year,month,day]=value.split('-').map(Number);return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);}
  const formatDate=(value,options={month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',...options}).format(new Date(`${value}T12:00:00Z`));
  const weekDates=end=>Array.from({length:7},(_,index)=>shiftDate(end,-index));
  const rangeLabel=end=>`${formatDate(shiftDate(end,-6),{month:'short',day:'numeric',year:'numeric'})} – ${formatDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  function parseMoney(value,{limit=true}={}) {
    let cleaned=text(value).trim(),negative=false,signSeen=false,accounting=false;
    if(!cleaned)return {valid:true,cents:null};
    const invalid=()=>({valid:false,cents:null,message:'Enter a dollar amount with up to 2 decimal places.'});
    if(cleaned.startsWith('(')||cleaned.endsWith(')')) {
      if(!cleaned.startsWith('(')||!cleaned.endsWith(')'))return invalid();
      accounting=true;negative=true;cleaned=cleaned.slice(1,-1).trim();
    }
    if(/^[+-]/.test(cleaned)) {if(accounting)return invalid();negative=cleaned[0]==='-';signSeen=true;cleaned=cleaned.slice(1);}
    if(cleaned.startsWith('$'))cleaned=cleaned.slice(1);
    if(/^[+-]/.test(cleaned)) {if(accounting||signSeen)return invalid();negative=cleaned[0]==='-';cleaned=cleaned.slice(1);}
    if(!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?|\.\d{1,2})$/.test(cleaned))return invalid();
    const [whole,fraction='']=cleaned.replace(/,/g,'').split('.');
    const cents=BigInt(whole||'0')*100n+BigInt(fraction.padEnd(2,'0'));
    if(limit&&cents>99999999999n)return {valid:false,cents:null,message:'Enter an amount of $999,999,999.99 or less.'};
    return {valid:true,cents:negative?-cents:cents};
  }
  function parseQuantity(key,value) {
    const raw=text(value).trim(),unit=DENOMINATION_CENTS[key];
    const invalid=message=>({valid:false,cents:null,quantity:null,message});
    if(!unit)return invalid('Choose a bill or coin denomination.');
    if(!raw)return {valid:true,cents:null,quantity:null};
    if(raw.length>200||!/^\+?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(raw))return invalid('Enter a whole number of bills or coins, 0 or more.');
    const quantity=BigInt(raw.replace(/,/g,'').split('.')[0]),cents=quantity*unit;
    if(cents>99999999999n)return invalid('This count is too large. Check the number of bills or coins.');
    return {valid:true,cents,quantity};
  }
  function quantityValue(key,amount) {
    const parsed=parseMoney(amount,{limit:false}),unit=DENOMINATION_CENTS[key];
    if(!unit||!parsed.valid)return null;
    if(parsed.cents===null)return '';
    return parsed.cents>=0n&&parsed.cents%unit===0n?String(parsed.cents/unit):null;
  }
  const quantityInputValue=(editor,key)=>Object.hasOwn(editor?.quantityInputs||{},key)?editor.quantityInputs[key]:quantityValue(key,editor?.values[key])??'';
  const invalidQuantities=editor=>DENOMINATIONS.filter(key=>Object.hasOwn(editor?.quantityInputs||{},key)&&!parseQuantity(key,editor.quantityInputs[key]).valid);
  const drawerSum=editor=>invalidQuantities(editor).length?{valid:false,cents:null}:sumMoney(editor.values,DENOMINATIONS);
  function centsText(cents) {const absolute=cents<0n?-cents:cents;return `${cents<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;}
  function currency(cents) {
    if(cents===null||cents===undefined)return '—';
    const absolute=cents<0n?-cents:cents,whole=String(absolute/100n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return `${cents<0n?'-':''}$${whole}.${String(absolute%100n).padStart(2,'0')}`;
  }
  function sumMoney(values,keys) {
    let cents=0n,entered=false;
    for(const key of keys) {const parsed=parseMoney(values[key]);if(!parsed.valid)return {valid:false,cents:null};if(parsed.cents!==null){entered=true;cents+=parsed.cents;}}
    return {valid:true,cents:entered?cents:null};
  }
  function hasActivity(values) {
    if(TEXT_FIELDS.some(key=>nonblank(values[key])))return true;
    return MONEY.some(key=>{const parsed=parseMoney(values[key]);return !parsed.valid||parsed.cents!==null&&parsed.cents!==0n;});
  }
  const valuesOf=row=>Object.fromEntries(FIELDS.map(([key])=>[key,text(row?.[key])]));
  const state={logs:[],deletedRows:[],editors:new Map(),loadedDates:new Set(),ready:false,loading:false,userId:null,epoch:0,request:0,today:easternToday(),weekEnd:easternToday(),selectedDate:easternToday(),firstDate:null,historyVisible:12,metadataLoaded:false,undo:null,undoSaving:false,toastTimer:null,pointerField:null};
  const reportState={busy:false,printing:false,request:0,model:null,start:'',end:'',pendingStart:'',pendingEnd:'',month:'',selecting:false,focusDate:'',returnFocus:null,urls:new Set()};
  const reportWindowState={expanded:false,position:null,drag:null};
  const jumpState={month:'',focusDate:'',invalid:false};
  const current=epoch=>epoch===state.epoch;
  const dirty=editor=>Boolean(invalidQuantities(editor).length)||(editor.base?KEYS.some(key=>editor.values[key]!==text(editor.base[key])):KEYS.some(key=>nonblank(editor.values[key])));
  const unfinished=()=>state.undoSaving||[...state.editors.values()].some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error);
  const formFocused=()=>Boolean(document.activeElement?.closest?.('#dayFields'));
  const rowForDate=date=>state.logs.find(row=>row.entry_date===date)||state.deletedRows.find(row=>row.entry_date===date)||null;
  function editorForDate(date,{create=true}={}) {
    let editor=state.editors.get(date);if(editor)return editor;
    const row=rowForDate(date);if(row?.deleted_at||!create||!state.loadedDates.has(date))return null;
    editor={id:row?.id||crypto.randomUUID(),date,base:row?{...row}:null,values:valuesOf(row),quantityInputs:{},saving:null,deleting:false,deleteAttempt:false,error:'',conflict:false,attempt:null,fieldErrors:{}};
    state.editors.set(date,editor);return editor;
  }
  function message(value,error=false) {$('pageMessage').textContent=value;$('pageMessage').hidden=!value;$('pageMessage').classList.toggle('is-error',error);}
  function errorText(error) {
    if(error?.code==='AUTH')return 'Sign in to Paws HQ to view and save End Of Day.';
    if(error?.code==='ACCESS'||error?.code==='42501')return 'This account does not have End Of Day access.';
    if(error?.code==='CONFLICT')return 'This day changed on another device. Your entries are still here. Copy them before reloading the day.';
    if(error?.code==='22023'||error?.code==='22003')return 'Check the amounts below. Use dollar values with up to 2 decimal places.';
    if(['42P01','PGRST205'].includes(error?.code))return 'End Of Day records are unavailable. Please try again later.';
    return 'Could not save. Your entries are still here. Check your connection, then retry.';
  }
  function toast(value,undo=null) {
    clearTimeout(state.toastTimer);state.undo=undo;$('toastText').textContent=value;$('undoDelete').hidden=!undo;$('toast').hidden=false;
    state.toastTimer=setTimeout(()=>{$('toast').hidden=true;},5000);controls();
  }
  function remember(row) {
    const index=state.logs.findIndex(item=>item.entry_date===row.entry_date);if(index<0)state.logs.push(row);else state.logs[index]=row;
    state.deletedRows=state.deletedRows.filter(item=>item.entry_date!==row.entry_date);if(row.deleted_at)state.deletedRows.push(row);
    if(!state.firstDate||row.entry_date<state.firstDate)state.firstDate=row.entry_date;
    state.loadedDates.add(row.entry_date);
  }
  function mergeRows(rows,start,end) {
    const incoming=new Set(rows.map(row=>row.entry_date));
    state.logs=state.logs.filter(row=>row.entry_date<start||row.entry_date>end||incoming.has(row.entry_date));
    for(const row of rows) {
      remember(row);const editor=state.editors.get(row.entry_date);
      if(editor&&!dirty(editor)&&!editor.saving&&!editor.deleting&&!editor.error) {
        if(row.deleted_at)state.editors.delete(row.entry_date);else {editor.id=row.id;editor.base={...row};editor.values=valuesOf(row);editor.quantityInputs={};}
      }
    }
    for(const date of weekDates(end)) {
      state.loadedDates.add(date);const editor=state.editors.get(date);
      if(!incoming.has(date)&&editor?.base&&!dirty(editor)&&!editor.saving&&!editor.deleting&&!editor.error)state.editors.delete(date);
    }
  }
  function inputField(key,{multiline=false,label=null}={}) {
    const [,,limit]=FIELDS.find(([name])=>name===key),fieldLabel=label||FIELDS.find(([name])=>name===key)[1];
    const editor=editorForDate(state.selectedDate),quantity=DENOMINATIONS.includes(key),value=escape(quantity?quantityInputValue(editor,key):editor?.values[key]),id=`field-${key}`,money=MONEY.includes(key)&&!quantity;
    const accessible=`aria-labelledby="label-${key}" aria-describedby="${quantity?`amount-${key} `:''}error-${key}"`;
    const input=multiline?`<textarea id="${id}" ${accessible} data-field="${key}" maxlength="${limit}" rows="3">${value}</textarea>`:`<input id="${id}" ${accessible} data-field="${key}"${quantity?' data-quantity inputmode="numeric"':money?' data-money inputmode="decimal"':''}${key==='staff_name'?' list="staffSuggestions" autocomplete="off"':''} type="text" maxlength="${limit}" value="${value}"${quantity?' placeholder="0"':money?' placeholder="0.00"':''} />`;
    const caption=quantity?`<span class="eod-denomination-label"><span id="label-${key}">${escape(fieldLabel)}</span><small id="amount-${key}" class="eod-quantity-amount"></small></span>`:`<span id="label-${key}">${escape(fieldLabel)}</span>`;
    return `<label class="eod-field">${caption}${input}<span id="error-${key}" class="eod-field-error" hidden></span></label>`;
  }
  function renderForm() {
    $('dayEyebrow').textContent=state.selectedDate===state.today?'TODAY’S ENTRY':'DAILY ENTRY';
    $('dayTitle').textContent=formatDate(state.selectedDate,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    const editor=editorForDate(state.selectedDate),row=rowForDate(state.selectedDate);
    if(!editor) {
      $('dayContent').innerHTML=row?.deleted_at?`<div class="eod-deleted-day"><h3>This day’s entry was deleted</h3><p>Restore it to view or update the original details.</p><button type="button" class="tr-button tr-button-primary" data-restore-date="${escape(row.entry_date)}">Restore entry</button></div>`:'<div class="eod-deleted-day"><p>Loading this day’s entry…</p></div>';return;
    }
    const moneyIn=['cash_received','checks_received','card_tips_received'].map(key=>inputField(key)).join('');
    const moneyOut=['card_tips_paid','receipts_paid','cash_replaced'].map(key=>inputField(key)).join('');
    const counts=DENOMINATIONS.map(key=>inputField(key)).join('');
    $('dayContent').innerHTML=`<div id="dayError" class="eod-day-error" hidden><span id="dayErrorText" role="alert"></span><button id="retryDay" type="button" data-day-action="retry">Retry</button></div>
      <div id="dayFields" data-day-date="${escape(editor.date)}" class="eod-entry-grid">
        <section class="eod-card eod-money-card glass"><div class="eod-card-heading"><span class="eod-step">1</span><div><h3>Money in &amp; out</h3><p>Record what was received and paid from the drawer.</p></div></div>
          <div class="eod-staff-field">${inputField('staff_name')}</div><p class="eod-group-label">RECEIVED FROM CUSTOMERS</p><div class="eod-fields-three">${moneyIn}</div>
          <p class="eod-group-label">DRAWER PAYOUTS &amp; REPLACEMENT</p><div class="eod-fields-three">${moneyOut}</div><p class="eod-money-note">Cash returned to drawer replaces a previous shortfall.</p><div class="eod-receipt-field">${inputField('receipt_description',{multiline:true,label:'Receipts — store and what was purchased'})}</div></section>
        <section class="eod-card eod-count-card glass"><div class="eod-card-heading"><span class="eod-step">2</span><div><h3>Count the drawer</h3><p>Enter the number of bills or coins. Dollar totals calculate automatically.</p></div></div><div class="eod-count-grid">${counts}</div>
          <div class="eod-total-block"><span>Counted drawer <span class="tr-sr-only">calculated from bill and coin quantities</span></span><output id="drawerTotal">—</output></div><p id="drawerBalance" class="eod-balance">Drawer target: $200.00</p><p id="drawerRecorded" class="eod-recorded-note" hidden></p></section>
          <section class="eod-card eod-deposit-card glass"><div class="eod-card-heading"><span class="eod-step">3</span><div><h3>Deposits &amp; notes</h3><p>Record the deposit and anything the next shift should know.</p></div></div><div class="eod-fields-two">${inputField('cash_deposit')}${inputField('check_deposit')}</div>
            <div class="eod-total-block"><span>Total deposit <span class="tr-sr-only">calculated from cash and check deposit</span></span><output id="depositTotal">—</output></div><p id="depositRecorded" class="eod-recorded-note" hidden></p>
            <div class="eod-notes-field">${inputField('notes',{multiline:true})}</div><p class="eod-manager-help">If the day doesn’t balance, let a manager know. Ask a manager or Jen if you need change to make a deposit.</p>
            <details class="eod-extra-note"${nonblank(editor.values.additional_note)?' open':''}><summary>Additional note</summary>${inputField('additional_note',{multiline:true,label:'Additional note from the original log'})}</details></section>
      </div><div class="eod-day-actions"><span>Changes save automatically · drawer counts become dollar totals</span><button id="deleteDay" class="eod-delete" type="button" data-day-action="delete">${editor.base?'Delete entry':'Clear entry'}</button></div>`;
    updateEditorStatus(editor);renderCalculations(editor);
  }
  function recordedNote(id,editor,key,total) {
    const node=$(id);if(!node)return;const stored=text(editor.base?.[key]),parsed=parseMoney(stored,{limit:false});
    const differs=nonblank(stored)&&total.valid&&total.cents!==null&&(!parsed.valid||parsed.cents!==total.cents);
    node.hidden=!differs;
    node.textContent=differs?`Recorded ${key==='total_deposit'?'deposit':'drawer'} total: ${parsed.valid?currency(parsed.cents):stored}. This differs from the current ${key==='total_deposit'?'cash + checks':'denomination'} sum. The recorded value is kept unless those amounts are edited.`:'';
  }
  function renderCalculations(editor) {
    if(editor?.date!==state.selectedDate)return;
    const drawer=drawerSum(editor),deposit=sumMoney(editor.values,['cash_deposit','check_deposit']);
    if($('drawerTotal'))$('drawerTotal').textContent=drawer.valid?currency(drawer.cents):'Check counts';
    for(const key of DENOMINATIONS) {
      const node=$(`amount-${key}`);if(!node)continue;const raw=Object.hasOwn(editor.quantityInputs||{},key),parsed=parseMoney(editor.values[key],{limit:false}),legacy=!raw&&quantityValue(key,editor.values[key])===null;
      node.textContent=legacy?`Saved amount: ${parsed.valid?currency(parsed.cents):text(editor.values[key])}. Enter a count to update.`:invalidQuantities(editor).includes(key)?'Check quantity':parsed.cents===null?`${currency(DENOMINATION_CENTS[key])} each`:currency(parsed.cents);node.classList.toggle('is-legacy',legacy);
    }
    if($('depositTotal'))$('depositTotal').textContent=deposit.valid?currency(deposit.cents):'Check amounts';
    const balance=$('drawerBalance');if(balance) {
      balance.dataset.state='idle';
      if(!drawer.valid)balance.textContent='Fix a highlighted count to calculate the drawer total.';
      else if(!hasActivity(editor.values)||drawer.cents===null)balance.textContent='Drawer target: $200.00';
      else {const difference=drawer.cents-20000n;balance.dataset.state=difference===0n?'met':difference<0n?'short':'over';balance.textContent=difference===0n?'$200.00 drawer target met':difference<0n?`Short by ${currency(-difference)} from the $200.00 target`:`Over by ${currency(difference)} from the $200.00 target`;}
    }
    recordedNote('drawerRecorded',editor,'drawer_total',drawer);recordedNote('depositRecorded',editor,'total_deposit',deposit);
  }
  function displayedTotal(editor,row,key) {
    if(key==='drawer_total'&&editor&&invalidQuantities(editor).length)return 'Check counts';
    const keys=key==='drawer_total'?DENOMINATIONS:['cash_deposit','check_deposit'];
    if(editor&&keys.some(name=>!editor.base?nonblank(editor.values[name]):editor.values[name]!==text(editor.base[name]))) {const total=sumMoney(editor.values,keys);return total.valid?currency(total.cents):'Check amounts';}
    const parsed=parseMoney(row?.[key]??editor?.base?.[key],{limit:false});return parsed.valid?currency(parsed.cents):text(row?.[key])||'—';
  }
  function renderWeek() {
    $('weekRange').textContent=rangeLabel(state.weekEnd);if(document.activeElement!==$('jumpDate')&&!jumpState.invalid)$('jumpDate').value=formatJumpDate(state.weekEnd);
    $('weekRows').innerHTML=weekDates(state.weekEnd).map(date=>{
      const row=rowForDate(date),editor=state.editors.get(date),values=editor?.values||valuesOf(row),selected=date===state.selectedDate;
      const status=row?.deleted_at?'Deleted':editor?.error?'Not saved':editor?.saving?'Saving…':editor&&dirty(editor)?'Unsaved':hasActivity(values)?'Has details':'Not started';
      return `<tr${selected?' class="is-selected"':''}><td><div class="eod-day-date"><button class="eod-day-select" type="button" data-open-date="${date}" aria-label="View ${escape(formatDate(date,{month:'long',day:'numeric',year:'numeric'}))}">${escape(formatDate(date,{weekday:'short',month:'short',day:'numeric'}))}</button>${date===state.today?'<span class="eod-today-tag">Today</span>':''}</div></td><td>${escape(values.staff_name)||'—'}</td><td>${row?.deleted_at?'—':escape(displayedTotal(editor,row,'drawer_total'))}</td><td>${row?.deleted_at?'—':escape(displayedTotal(editor,row,'total_deposit'))}</td><td><span class="eod-entry-state${editor?.error?' is-error':''}">${status}</span></td><td><button class="eod-open-day" type="button" data-open-date="${date}" aria-label="${selected?'Viewing':'Open'} ${escape(formatDate(date,{month:'long',day:'numeric',year:'numeric'}))}"${!state.ready||state.loading?' disabled':''}>${selected?'Viewing':'Open'}</button></td></tr>`;
    }).join('');
  }
  function renderHistory() {
    const ends=[];for(let index=1;index<=state.historyVisible;index++) {const end=shiftDate(state.today,-7*index);if(state.firstDate&&end<state.firstDate)break;ends.push(end);}
    $('historyList').innerHTML=state.ready?ends.map(end=>`<button type="button" data-week-end="${end}"${end===state.weekEnd?' class="is-selected"':''}>${escape(rangeLabel(end))}<span>View these seven days</span></button>`).join(''):'<p>Sign in to browse earlier entries.</p>';
    $('loadOlderWeeks').hidden=Boolean(state.firstDate&&shiftDate(state.today,-7*(state.historyVisible+1))<state.firstDate);
  }
  function renderDeleted() {
    const rows=[...state.deletedRows].sort((a,b)=>b.entry_date.localeCompare(a.entry_date));$('deletedCount').textContent=rows.length;
    $('deletedList').innerHTML=rows.length?rows.map(row=>`<div class="tr-deleted-dog"><div><strong>${escape(formatDate(row.entry_date,{weekday:'short',month:'short',day:'numeric',year:'numeric'}))}</strong><span>${escape(row.staff_name)||'No staff name entered'}</span></div><button type="button" class="tr-button tr-button-subtle" data-restore-date="${escape(row.entry_date)}">Restore</button></div>`).join(''):'<p>No deleted entries.</p>';
  }
  function renderAttention() {
    const editors=[...state.editors.values()].filter(editor=>editor.date!==state.selectedDate&&(dirty(editor)||editor.error||editor.saving));
    $('attentionList').hidden=!editors.length;$('attentionList').innerHTML=editors.length?`<span>Entries to finish:</span>${editors.map(editor=>`<button type="button" data-attention-date="${editor.date}">${escape(formatDate(editor.date,{month:'short',day:'numeric',year:'numeric'}))}${editor.error?' · not saved':editor.saving?' · saving':' · unsaved'}</button>`).join('')}`:'';
  }
  function renderStaffSuggestions() {const names=[...new Set(state.logs.filter(row=>!row.deleted_at&&nonblank(row.staff_name)).map(row=>row.staff_name))].sort((a,b)=>a.localeCompare(b));$('staffSuggestions').innerHTML=names.map(name=>`<option value="${escape(name)}"></option>`).join('');}
  function updateEditorStatus(editor) {
    if(editor?.date!==state.selectedDate)return;
    document.querySelectorAll('#dayFields [data-field]').forEach(input=>{
      input.disabled=!state.ready||state.loading||state.undoSaving||reportState.busy||editor.deleting||editor.deleteAttempt;
      const error=editor.fieldErrors[input.dataset.field]||'',node=$(`error-${input.dataset.field}`);input.setAttribute('aria-invalid',error?'true':'false');
      if(node){node.hidden=!error;node.textContent=error;}
    });
    const error=$('dayError');if(error){error.hidden=!editor.error;$('dayErrorText').textContent=editor.error;const button=$('retryDay');button.textContent=editor.conflict?'Reload day':'Retry';button.dataset.dayAction=editor.conflict?'reload':editor.deleteAttempt?'delete':'retry';button.disabled=!state.ready||state.loading||Boolean(editor.saving||editor.deleting);}
    const button=$('deleteDay');if(button)button.disabled=!state.ready||state.loading||state.undoSaving||Boolean(editor.saving||editor.deleting);
  }
  function controls() {
    const blocked=!state.ready||state.loading||state.undoSaving||reportState.busy||reportState.printing;
    for(const id of ['previousWeek','nextWeek','goToday','jumpDate','openDateCalendar','loadOlderWeeks'])$(id).disabled=blocked;
    $('refreshLogs').disabled=state.loading||state.undoSaving||reportState.busy;
    $('openWeekReport').disabled=blocked;
    $('expandWeekReport').disabled=reportState.printing;
    for(const id of ['selectReportDates','reportLastSeven'])$(id).disabled=reportState.busy||reportState.printing;
    for(const id of ['downloadReport','printReport'])$(id).disabled=blocked||!reportState.model||!$('reportDatePicker').hidden;
    $('weekReportContent').setAttribute('aria-busy',String(reportState.busy));
    document.querySelectorAll('[data-restore-date],[data-week-end],[data-open-date]').forEach(button=>{button.disabled=blocked;});
    const editor=editorForDate(state.selectedDate,{create:false});
    $('saveStatus').textContent=state.loading?'Loading…':editor?.deleting||editor?.saving||state.undoSaving?'Saving…':editor?.error?'Changes not saved':editor&&dirty(editor)?'Unsaved changes':!state.ready?'':editor?.base?'All changes saved':'Ready for today’s entry';
    $('saveStatus').classList.toggle('is-error',Boolean(editor?.error));if(editor)updateEditorStatus(editor);
  }
  function render({form=true}={}) {renderWeek();if(form)renderForm();renderHistory();renderDeleted();renderAttention();renderStaffSuggestions();controls();}
  async function requireStaff(epoch) {
    if(typeof supabaseClient==='undefined')throw {code:'AUTH'};const {data,error}=await supabaseClient.auth.getSession();
    if(!current(epoch)||error||!data?.session?.user)throw {code:'AUTH'};const id=data.session.user.id;
    if(typeof ensureHqWorkspaceAccess==='function')await ensureHqWorkspaceAccess(data.session);
    const result=await supabaseClient.from('hq_tour_staff').select('user_id,active').eq('user_id',id).eq('active',true).maybeSingle();
    if(!current(epoch))throw {code:'AUTH'};if(result.error)throw result.error;if(!result.data)throw {code:'ACCESS'};state.userId=id;
  }
  async function fetchWeek(end,valid) {
    const result=await supabaseClient.from(TABLE).select('*').gte('entry_date',shiftDate(end,-6)).lte('entry_date',end).order('entry_date',{ascending:false}).range(0,499);
    if(!valid())return [];if(result.error)throw result.error;return result.data||[];
  }
  async function fetchMetadata(valid) {
    const result=await supabaseClient.from(TABLE).select('entry_date').order('entry_date',{ascending:true}).limit(1).maybeSingle();
    if(!valid())return null;if(result.error)throw result.error;return result.data?.entry_date||null;
  }
  async function fetchDeleted(valid) {
    const rows=[];for(let offset=0;;offset+=500) {
      const result=await supabaseClient.from(TABLE).select('*').not('deleted_at','is',null).order('entry_date',{ascending:false}).range(offset,offset+499);
      if(!valid())return [];if(result.error)throw result.error;rows.push(...(result.data||[]));if(!result.data||result.data.length<500)return rows;
    }
  }
  async function loadWeek({silent=false,navigation=false}={}) {
    if(state.loading||state.undoSaving||reportState.busy)return;
    if(!navigation&&(unfinished()||formFocused()||document.activeElement===$('jumpDate')||!$('jumpDatePicker').hidden)) {if(!silent)message('Your entries are kept. Finish editing or retry unsaved days before refreshing.');return;}
    const epoch=state.epoch,request=++state.request,end=state.weekEnd,valid=()=>current(epoch)&&request===state.request;
    state.loading=true;controls();if(!silent)message('');
    try {
      await requireStaff(epoch);if(!valid())return;
      const needMetadata=!state.metadataLoaded,needDeleted=needMetadata||!silent&&!navigation;
      const [rows,first,deleted]=await Promise.all([fetchWeek(end,valid),needMetadata?fetchMetadata(valid):Promise.resolve(state.firstDate),needDeleted?fetchDeleted(valid):Promise.resolve(null)]);
      if(!valid())return;mergeRows(rows,shiftDate(end,-6),end);if(needMetadata){state.firstDate=first;state.metadataLoaded=true;}
      if(deleted){state.deletedRows=deleted;for(const row of deleted)remember(row);}
      state.ready=true;message('');
    }catch(error){if(!valid())return;state.ready=false;if(['AUTH','ACCESS','42501'].includes(error?.code)){state.logs=[];state.deletedRows=[];state.editors.clear();state.loadedDates.clear();}message(errorText(error),true);}
    finally{if(valid()){state.loading=false;render({form:!formFocused()});}}
  }
  function takeInput(input) {
    const date=input.closest('[data-day-date]')?.dataset.dayDate,key=input.dataset.field,editor=state.editors.get(date);
    if(!editor||!KEYS.includes(key)||editor.deleting||editor.deleteAttempt)return;
    const original=editor.base?text(editor.base[key]):'';
    if(DENOMINATIONS.includes(key)) {
      editor.quantityInputs??={};editor.quantityInputs[key]=input.value;
      const parsed=parseQuantity(key,input.value),base=parseMoney(original,{limit:false});
      if(parsed.valid) {editor.values[key]=base.valid&&base.cents===parsed.cents?original:parsed.cents===null?'':centsText(parsed.cents);delete editor.fieldErrors[key];}
      else editor.fieldErrors[key]=parsed.message;
    }else {
      editor.values[key]=input.value===normalized(original)?original:input.value;
      if(MONEY.includes(key)){const parsed=parseMoney(editor.values[key]);if(parsed.valid)delete editor.fieldErrors[key];else editor.fieldErrors[key]=parsed.message;}
    }
    if(!editor.conflict)editor.error='';controls();renderCalculations(editor);renderAttention();
  }
  const changedPatch=editor=>Object.fromEntries(KEYS.filter(key=>!editor.base?nonblank(editor.values[key]):editor.values[key]!==text(editor.base[key])).map(key=>[key,editor.values[key]]));
  function validate(editor) {
    const patch=changedPatch(editor);editor.fieldErrors={};for(const key of MONEY)if(key in patch){const parsed=parseMoney(editor.values[key]);if(!parsed.valid)editor.fieldErrors[key]=parsed.message;}
    for(const key of invalidQuantities(editor))editor.fieldErrors[key]=parseQuantity(key,editor.quantityInputs[key]).message;
    if(Object.keys(editor.fieldErrors).length){editor.error='Check the highlighted counts or amounts. Your entries are still here.';controls();return false;}return true;
  }
  async function fetchDate(date) {const result=await supabaseClient.from(TABLE).select('*').eq('entry_date',date).maybeSingle();if(result.error)throw result.error;return result.data;}
  function accept(editor,saved) {editor.id=saved.id;editor.base={...saved};for(const key of DENOMINATIONS)if(Object.hasOwn(editor.quantityInputs||{},key)){const count=parseQuantity(key,editor.quantityInputs[key]),amount=parseMoney(saved[key],{limit:false});if(count.valid&&amount.valid&&count.cents===amount.cents)delete editor.quantityInputs[key];}for(const key of PROTECTED)editor.values[key]=text(saved[key]);editor.attempt=null;editor.error='';editor.conflict=false;remember(saved);}
  function mergeUntouched(editor,reference,patch,fresh) {
    for(const key of KEYS)if(!(key in patch)) {
      const prior=text(reference?.[key]),local=editor.values[key],remote=text(fresh[key]);
      if(local!==prior&&remote!==prior&&local!==remote)throw {code:'CONFLICT'};
      if(local===prior) {
        if(DENOMINATIONS.includes(key)&&Object.hasOwn(editor.quantityInputs||{},key)){const count=parseQuantity(key,editor.quantityInputs[key]),amount=parseMoney(prior,{limit:false});if(count.valid&&amount.valid&&count.cents===amount.cents)delete editor.quantityInputs[key];}
        editor.values[key]=remote;
      }
    }
  }
  function syncUntouchedFields(editor) {
    if(editor.date!==state.selectedDate)return;document.querySelectorAll('#dayFields [data-field]').forEach(input=>{if(document.activeElement!==input)input.value=DENOMINATIONS.includes(input.dataset.field)?quantityInputValue(editor,input.dataset.field):editor.values[input.dataset.field];});renderCalculations(editor);
  }
  async function reconcile(editor,epoch) {
    const attempt=editor.attempt;if(!attempt)return;const fresh=await fetchDate(editor.date);if(!current(epoch))return;
    if(!fresh){if(!attempt.base){editor.attempt=null;return;}throw {code:'CONFLICT'};}if(fresh.deleted_at)throw {code:'CONFLICT'};
    const equal=Object.keys(attempt.patch).every(key=>text(fresh[key])===attempt.patch[key]);
    if(equal) {mergeUntouched(editor,attempt.base,attempt.patch,fresh);accept(editor,fresh);syncUntouchedFields(editor);return;}
    if(!attempt.base) {
      if(Object.keys(attempt.patch).some(key=>nonblank(fresh[key])&&text(fresh[key])!==attempt.patch[key]))throw {code:'CONFLICT'};
      mergeUntouched(editor,null,attempt.patch,fresh);accept(editor,fresh);syncUntouchedFields(editor);return;
    }
    if(Object.keys(attempt.patch).every(key=>text(fresh[key])===text(attempt.base[key]))) {mergeUntouched(editor,attempt.base,attempt.patch,fresh);accept(editor,fresh);syncUntouchedFields(editor);return;}
    throw {code:'CONFLICT'};
  }
  function saveEditor(editor) {
    if(!editor||editor.deleting||editor.deleteAttempt||editor.conflict||!state.ready)return Promise.resolve();if(editor.saving)return editor.saving;if(!dirty(editor))return Promise.resolve();
    if(invalidQuantities(editor).length){validate(editor);return Promise.resolve();}
    if(!KEYS.some(key=>nonblank(editor.values[key]))) {editor.error='This entry is empty. Enter a detail or delete the entry.';controls();return Promise.resolve();}
    if(!validate(editor))return Promise.resolve();const epoch=state.epoch;
    const task=(async()=>{
      try {
        await requireStaff(epoch);if(!current(epoch))return;if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
        while(dirty(editor)&&KEYS.some(key=>nonblank(editor.values[key]))) {
          if(!validate(editor))return;const patch=changedPatch(editor),base=editor.base?{...editor.base}:null;editor.attempt={base,patch};
          const result=base?await supabaseClient.from(TABLE).update(patch).eq('id',editor.id).eq('revision',base.revision).select('*').maybeSingle():await supabaseClient.from(TABLE).insert({id:editor.id,entry_date:editor.date,...patch}).select('*').single();
          if(!current(epoch))return;if(result.error?.code==='23505'||!result.error&&!result.data){await reconcile(editor,epoch);if(!current(epoch))return;continue;}if(result.error)throw result.error;accept(editor,result.data);renderCalculations(editor);
        }
        if(dirty(editor)&&editor.base&&!KEYS.some(key=>nonblank(editor.values[key])))editor.error='This entry is empty. Enter a detail or delete the entry.';message('');
      }catch(error){if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';}}
      finally{if(current(epoch)){editor.saving=null;controls();renderWeek();renderAttention();if(!formFocused()&&editor.date===state.selectedDate)renderForm();}}
    })();editor.saving=task;controls();return task;
  }
  async function selectDate(date,{week=false}={}) {
    if(!validDate(date)||!state.ready||state.loading||state.undoSaving||reportState.busy)return false;
    toggleJumpCalendar(false,{focus:false});jumpState.invalid=false;$('jumpDate').setAttribute('aria-invalid','false');
    const epoch=state.epoch;
    const previous=editorForDate(state.selectedDate,{create:false});if(previous&&dirty(previous)&&!previous.conflict&&!previous.deleteAttempt)saveEditor(previous);
    state.selectedDate=date;if(week){state.weekEnd=date;state.historyVisible=12;render();await loadWeek({navigation:true});}else render();
    return current(epoch)&&state.ready&&state.selectedDate===date;
  }
  function revealSection(id) {
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    $(id)?.scrollIntoView?.({behavior:reduced?'auto':'smooth',block:'start'});
  }
  async function openDay(date,options={}) {if(await selectDate(date,options))revealSection('dayPanel');}
  async function deleteDay(editor) {
    if(!editor||!state.ready||state.loading||state.undoSaving||editor.saving||editor.deleting)return;
    if(!editor.base&&!editor.attempt){state.editors.delete(editor.date);render();toast('Entry cleared.');return;}
    const epoch=state.epoch;editor.deleting=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;if(editor.attempt)await reconcile(editor,epoch);if(!current(epoch))return;
      if(!editor.base){state.editors.delete(editor.date);render();return;}
      if(editor.deleteAttempt) {const fresh=await fetchDate(editor.date);if(!current(epoch))return;if(fresh?.deleted_at){remember(fresh);state.editors.delete(editor.date);render();toast('Entry deleted.',fresh);return;}if(!fresh||fresh.revision!==editor.base.revision)throw {code:'CONFLICT'};}
      editor.deleteAttempt=true;const result=await supabaseClient.from(TABLE).update({deleted_at:new Date().toISOString()}).eq('id',editor.id).eq('revision',editor.base.revision).select('*').maybeSingle();
      if(!current(epoch))return;if(result.error)throw result.error;if(!result.data)throw {code:'CONFLICT'};remember(result.data);state.editors.delete(editor.date);render({form:editor.date===state.selectedDate});toast('Entry deleted.',result.data);
    }catch(error){if(current(epoch)){editor.error=errorText(error);editor.conflict=error?.code==='CONFLICT';}}
    finally{if(current(epoch)){editor.deleting=false;controls();}}
  }
  async function restoreDay(row=state.undo) {
    if(!row||!state.ready||state.loading||state.undoSaving)return;const epoch=state.epoch;state.undoSaving=true;controls();
    try {
      await requireStaff(epoch);if(!current(epoch))return;const result=await supabaseClient.from(TABLE).update({deleted_at:null}).eq('id',row.id).eq('revision',row.revision).select('*').maybeSingle();if(!current(epoch))return;
      let saved=result.data;if(result.error||!saved){const fresh=await fetchDate(row.entry_date);if(!current(epoch))return;if(fresh&&!fresh.deleted_at)saved=fresh;else throw result.error||{code:'CONFLICT'};}
      remember(saved);const editor=state.editors.get(saved.entry_date);if(editor&&!dirty(editor)&&!editor.error)state.editors.delete(saved.entry_date);render({form:!formFocused()});toast('Entry restored.');
    }catch(error){if(current(epoch))message(errorText(error),true);}
    finally{if(current(epoch)){state.undoSaving=false;controls();}}
  }
  async function reloadDay(editor) {
    if(!editor||editor.saving||editor.deleting||!state.ready)return;const epoch=state.epoch;
    try {await requireStaff(epoch);const fresh=await fetchDate(editor.date);if(!current(epoch))return;if(fresh)remember(fresh);else state.logs=state.logs.filter(row=>row.entry_date!==editor.date);state.editors.delete(editor.date);render();message('');}catch(error){if(current(epoch)){editor.error=errorText(error);controls();}}
  }
  const monthStart=date=>`${date.slice(0,7)}-01`;
  function shiftMonth(date,amount) {
    const [year,month]=date.split('-').map(Number),next=new Date(Date.UTC(year,month-1+amount,1));
    return `${String(next.getUTCFullYear()).padStart(4,'0')}-${String(next.getUTCMonth()+1).padStart(2,'0')}-01`;
  }
  function parseJumpDate(value) {
    const raw=text(value).trim();if(validDate(raw))return raw;
    const match=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);if(!match)return '';
    const date=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;return validDate(date)?date:'';
  }
  function formatJumpDate(date) {return validDate(date)?`${date.slice(5,7)}/${date.slice(8,10)}/${date.slice(0,4)}`:'';}
  function toggleJumpCalendar(open,{focus=true}={}) {
    if(open&&(!state.ready||state.loading||reportState.busy||state.undoSaving))return;
    $('jumpDatePicker').hidden=!open;$('openDateCalendar').setAttribute('aria-expanded',String(open));
    if(open) {const date=parseJumpDate($('jumpDate').value)||state.weekEnd;jumpState.month=monthStart(date);jumpState.focusDate=date;renderJumpCalendar();if(focus)$(`eod-jump-${date}`)?.focus();}
    else if(focus)$('jumpDate').focus();
  }
  function renderJumpCalendar() {
    const month=jumpState.month,first=new Date(`${month}T12:00:00Z`),offset=(first.getUTCDay()+6)%7,count=Number(shiftDate(shiftMonth(month,1),-1).slice(-2)),selected=parseJumpDate($('jumpDate').value)||state.weekEnd,cells=[];
    $('jumpMonth').innerHTML=Array.from({length:12},(_,index)=>{const value=String(index+1).padStart(2,'0');return `<option value="${value}">${escape(formatDate(`2026-${value}-01`,{month:'long'}))}</option>`;}).join('');$('jumpMonth').value=month.slice(5,7);
    const years=new Set(),selectedYear=Number(month.slice(0,4)),todayYear=Number(state.today.slice(0,4));
    for(const center of [selectedYear,todayYear])for(let year=Math.max(1000,center-10);year<=Math.min(9999,center+10);year++)years.add(year);
    $('jumpYear').innerHTML=[...years].sort((a,b)=>a-b).map(year=>`<option value="${year}">${year}</option>`).join('');$('jumpYear').value=String(selectedYear);
    $('jumpPreviousMonth').disabled=month<='1000-01-01';$('jumpNextMonth').disabled=month>='9999-12-01';
    for(let index=0;index<Math.ceil((offset+count)/7)*7;index++) {
      const day=index-offset+1;if(day<1||day>count){cells.push('<span role="gridcell" class="eod-calendar-empty"></span>');continue;}
      const date=`${month.slice(0,7)}-${String(day).padStart(2,'0')}`;
      cells.push(`<button id="eod-jump-${date}" type="button" role="gridcell" data-jump-date="${date}" tabindex="${date===jumpState.focusDate?'0':'-1'}" aria-label="${escape(formatDate(date,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}" aria-selected="${date===selected}"${date===state.today?' aria-current="date"':''} class="${date===selected?'is-range-edge ':''}${date===state.today?'is-today':''}">${day}</button>`);
    }
    const rows=[];for(let index=0;index<cells.length;index+=7)rows.push(`<div role="row" class="eod-calendar-row">${cells.slice(index,index+7).join('')}</div>`);
    $('jumpCalendar').innerHTML=`<div role="grid" aria-label="${escape(formatDate(month,{month:'long',year:'numeric'}))}"><div role="row" class="eod-calendar-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<span role="columnheader" aria-label="${day}">${day.slice(0,1)}</span>`).join('')}</div>${rows.join('')}</div>`;
  }
  function jumpCalendarKey(event) {
    const button=event.target.closest('[data-jump-date]');if(!button)return;
    const date=button.dataset.jumpDate,weekday=(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7,offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};let next;
    if(event.key in offsets)next=shiftDate(date,offsets[event.key]);
    else if(event.key==='PageUp'||event.key==='PageDown') {const month=shiftMonth(date,event.key==='PageUp'?-1:1),last=Number(shiftDate(shiftMonth(month,1),-1).slice(-2));next=`${month.slice(0,7)}-${String(Math.min(Number(date.slice(-2)),last)).padStart(2,'0')}`;}
    else return;
    if(!validDate(next))return;event.preventDefault();jumpState.month=monthStart(next);jumpState.focusDate=next;renderJumpCalendar();$(`eod-jump-${next}`)?.focus();
  }
  async function commitJumpDate() {
    if(!state.ready||state.loading||reportState.busy||state.undoSaving)return false;
    const date=parseJumpDate($('jumpDate').value);jumpState.invalid=!date;$('jumpDate').setAttribute('aria-invalid',String(!date));
    if(!date){message('Enter a valid date as MM/DD/YYYY, or choose a day from the calendar.',true);return false;}
    $('jumpDate').value=formatJumpDate(date);toggleJumpCalendar(false,{focus:false});return openDay(date,{week:true});
  }
  function reportRangeError(start,end) {
    if(!validDate(start)||!validDate(end))return 'Choose a start date and an end date.';
    if(end<start)return 'The end date must be on or after the start date.';
    if((Date.parse(`${end}T12:00:00Z`)-Date.parse(`${start}T12:00:00Z`))/86400000>=366)return 'Choose up to one year of entries at a time.';
    return '';
  }
  const reportRangeLabel=(start,end)=>`${formatDate(start,{month:'short',day:'numeric',year:'numeric'})} – ${formatDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  function reportMessage(value,error=false) {
    $('reportMessage').textContent=value;$('reportMessage').classList.toggle('is-error',error);
  }
  function updateReportRange(start,end) {
    if(reportState.busy||reportState.printing)return false;
    const error=reportRangeError(start,end);if(error){reportMessage(error,true);return false;}
    reportState.request++;reportState.model=null;reportState.start=start;reportState.end=end;reportState.pendingStart=start;reportState.pendingEnd=end;reportState.selecting=false;
    $('weekReportContent').innerHTML='';$('reportDateLabel').textContent=reportRangeLabel(start,end);reportMessage('');controls();return true;
  }
  function toggleReportDates(open) {
    if(open&&(reportState.busy||reportState.printing))return;
    $('reportDatePicker').hidden=!open;$('selectReportDates').setAttribute('aria-expanded',String(open));
    if(open) {
      reportState.pendingStart=reportState.start;reportState.pendingEnd=reportState.end;reportState.selecting=false;reportState.month=monthStart(reportState.start);reportState.focusDate=reportState.start;renderCalendar();$(`eod-calendar-${reportState.start}`)?.focus();
    }
    controls();clampReportPosition();
  }
  function renderCalendar() {
    if(reportState.month>'9999-12-01')reportState.month='9999-12-01';
    if(reportState.month<'1000-01-01')reportState.month='1000-01-01';
    const {pendingStart:start,pendingEnd:end}=reportState,months=[reportState.month],focus=reportState.focusDate||start||months[0];
    $('reportDateHint').textContent=reportState.selecting?'Choose an end date. Select the same day for a one-day report.':'Choose a start date, then an end date.';
    $('reportCalendar').innerHTML=`<div class="eod-calendar-navigation"><span>${escape(formatDate(months[0],{month:'long',year:'numeric'}))}</span><div><button type="button" data-calendar-step="-1" aria-label="Previous month"${months[0]<='1000-01-01'?' disabled':''}>‹</button><button type="button" data-calendar-step="1" aria-label="Next month"${months[0]>='9999-12-01'?' disabled':''}>›</button></div></div><div class="eod-calendar-months">${months.map(month=>{
      const first=new Date(`${month}T12:00:00Z`),offset=(first.getUTCDay()+6)%7,last=shiftDate(shiftMonth(month,1),-1),count=Number(last.slice(-2)),cells=[];
      for(let index=0;index<Math.ceil((offset+count)/7)*7;index++) {
        const day=index-offset+1;if(day<1||day>count){cells.push('<span role="gridcell" class="eod-calendar-empty"></span>');continue;}
        const date=`${month.slice(0,7)}-${String(day).padStart(2,'0')}`,selected=Boolean(start&&end&&date>=start&&date<=end),edge=date===start||date===end;
        cells.push(`<button id="eod-calendar-${date}" type="button" role="gridcell" data-calendar-date="${date}" tabindex="${date===focus?'0':'-1'}" aria-label="${escape(formatDate(date,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}" aria-selected="${selected||date===start}"${date===state.today?' aria-current="date"':''} class="${selected?'is-in-range ':''}${edge?'is-range-edge ':''}${date===state.today?'is-today':''}">${day}</button>`);
      }
      const rows=[];for(let index=0;index<cells.length;index+=7)rows.push(`<div role="row" class="eod-calendar-row">${cells.slice(index,index+7).join('')}</div>`);
      return `<div class="eod-calendar-month"><div role="grid" aria-label="${escape(formatDate(month,{month:'long',year:'numeric'}))}"><div role="row" class="eod-calendar-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<span role="columnheader" aria-label="${day}">${day.slice(0,1)}</span>`).join('')}</div>${rows.join('')}</div></div>`;
    }).join('')}</div>`;
  }
  async function chooseReportDate(date) {
    if(!validDate(date)||reportState.busy||reportState.printing)return;
    if(!reportState.selecting){reportState.pendingStart=date;reportState.pendingEnd='';reportState.selecting=true;reportMessage('');}
    else {
      const start=date<reportState.pendingStart?date:reportState.pendingStart,end=date<reportState.pendingStart?reportState.pendingStart:date;
      if(updateReportRange(start,end)){reportState.pendingStart=start;reportState.pendingEnd=end;reportState.selecting=false;toggleReportDates(false);$('selectReportDates').focus();return prepareReport(start,end);}
    }
    reportState.focusDate=date;renderCalendar();$(`eod-calendar-${date}`)?.focus();
  }
  function calendarKey(event) {
    const button=event.target.closest('[data-calendar-date]');if(!button||reportState.busy)return;
    const date=button.dataset.calendarDate,weekday=(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7;
    const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};let next;
    if(event.key in offsets)next=shiftDate(date,offsets[event.key]);
    else if(event.key==='PageUp'||event.key==='PageDown') {
      const month=shiftMonth(date,event.key==='PageUp'?-1:1),last=Number(shiftDate(shiftMonth(month,1),-1).slice(-2));next=`${month.slice(0,7)}-${String(Math.min(Number(date.slice(-2)),last)).padStart(2,'0')}`;
    }else return;
    if(!validDate(next))return;event.preventDefault();reportState.focusDate=next;
    if(monthStart(next)!==reportState.month)reportState.month=monthStart(next);
    renderCalendar();$(`eod-calendar-${next}`)?.focus();
  }
  function clampReportPosition() {
    const dialog=$('weekReport'),position=reportWindowState.position;
    if(!position||!dialog.open)return;
    if(window.innerWidth<=700) {
      reportWindowState.position=null;dialog.classList.remove('is-positioned');dialog.style.removeProperty('--eod-report-left');dialog.style.removeProperty('--eod-report-top');return;
    }
    if(reportWindowState.expanded)return;
    const rectangle=dialog.getBoundingClientRect(),margin=8;
    position.left=Math.max(margin,Math.min(position.left,Math.max(margin,window.innerWidth-rectangle.width-margin)));
    position.top=Math.max(margin,Math.min(position.top,Math.max(margin,window.innerHeight-rectangle.height-margin)));
    dialog.style.setProperty('--eod-report-left',`${position.left}px`);dialog.style.setProperty('--eod-report-top',`${position.top}px`);dialog.classList.add('is-positioned');
  }
  function endReportDrag(event) {
    const drag=reportWindowState.drag;if(event&&drag&&event.pointerId!==drag.pointerId)return;
    reportWindowState.drag=null;const toolbar=$('reportToolbar');toolbar.classList.remove('is-dragging');
    if(drag)try{toolbar.releasePointerCapture?.(drag.pointerId);}catch(error){/* Capture may already have ended. */}
  }
  function resetReportWindow() {
    endReportDrag();reportWindowState.expanded=false;reportWindowState.position=null;
    const dialog=$('weekReport'),button=$('expandWeekReport');dialog.classList.remove('is-expanded','is-positioned');dialog.style.removeProperty('--eod-report-left');dialog.style.removeProperty('--eod-report-top');
    button.setAttribute('aria-label','Expand preview');button.setAttribute('title','Expand preview');button.setAttribute('aria-pressed','false');
  }
  function toggleReportExpanded() {
    const dialog=$('weekReport');if(!dialog.open||reportState.printing)return;
    endReportDrag();reportWindowState.expanded=!reportWindowState.expanded;dialog.classList.toggle('is-expanded',reportWindowState.expanded);
    if(reportWindowState.expanded)dialog.classList.remove('is-positioned');else clampReportPosition();
    const button=$('expandWeekReport'),label=reportWindowState.expanded?'Restore preview size':'Expand preview';button.setAttribute('aria-label',label);button.setAttribute('title',label);button.setAttribute('aria-pressed',String(reportWindowState.expanded));
  }
  function startReportDrag(event) {
    const dialog=$('weekReport');
    if(!dialog.open||reportWindowState.expanded||reportState.printing||window.innerWidth<=700||event.button!==0||event.isPrimary===false||event.pointerType==='touch'||event.target.closest?.('button,input,select,textarea,a'))return;
    const rectangle=dialog.getBoundingClientRect();event.preventDefault();
    reportWindowState.position={left:rectangle.left,top:rectangle.top};reportWindowState.drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:rectangle.left,top:rectangle.top};
    clampReportPosition();const toolbar=$('reportToolbar');toolbar.classList.add('is-dragging');try{toolbar.setPointerCapture?.(event.pointerId);}catch(error){/* Window pointer listeners still handle this drag. */}
  }
  function moveReportDrag(event) {
    const drag=reportWindowState.drag;if(!drag||event.pointerId!==drag.pointerId)return;
    event.preventDefault();reportWindowState.position={left:drag.left+event.clientX-drag.x,top:drag.top+event.clientY-drag.y};clampReportPosition();
  }
  function clearReport() {
    reportState.request++;reportState.busy=false;reportState.printing=false;reportState.model=null;
    resetReportWindow();
    $('weekReportContent').innerHTML='';$('weekReportPrint').innerHTML='';document.body.classList.remove('eod-print-report');
    for(const url of reportState.urls)URL.revokeObjectURL(url);reportState.urls.clear();
    reportMessage('');$('reportDatePicker').hidden=true;$('selectReportDates').setAttribute('aria-expanded','false');controls();
  }
  function closeReport() {
    const focus=reportState.returnFocus;clearReport();if($('weekReport').open)$('weekReport').close();focus?.focus?.();
  }
  async function prepareReport(start,end) {
    const error=reportRangeError(start,end);if(error){reportMessage(error,true);return null;}
    if(!state.ready||state.loading||reportState.busy||reportState.printing||state.undoSaving)return null;
    const epoch=state.epoch,request=++reportState.request,valid=()=>current(epoch)&&request===reportState.request&&$('weekReport').open;
    reportState.busy=true;reportState.model=null;$('weekReportContent').innerHTML='';reportMessage('Loading preview…');controls();
    try {
      const editors=[...state.editors.values()].filter(editor=>editor.date>=start&&editor.date<=end);
      await Promise.all(editors.map(editor=>saveEditor(editor)));if(!valid())return null;
      if(editors.some(editor=>dirty(editor)||editor.saving||editor.deleting||editor.error))throw {code:'REPORT_UNSAVED'};
      await requireStaff(epoch);if(!valid())return null;
      const result=await supabaseClient.from(TABLE).select('*').gte('entry_date',start).lte('entry_date',end).order('entry_date',{ascending:true}).range(0,499);
      if(!valid())return null;if(result.error)throw result.error;
      const report=window.PawsEodReport.createReport({start,end,rows:result.data||[],fields:FIELDS.map(([key,label,limit])=>[key,DENOMINATIONS.includes(key)?`${label} (amount $)`:label,limit])});
      reportState.model=report;$('weekReportContent').innerHTML=window.PawsEodReport.html(report);reportMessage('');return report;
    }catch(error) {
      if(!valid())return null;
      if(['AUTH','ACCESS','42501'].includes(error?.code)) {state.ready=false;state.logs=[];state.deletedRows=[];state.editors.clear();state.loadedDates.clear();render();}
      reportMessage(error?.code==='REPORT_UNSAVED'?'Finish saving or retry the unsaved entries in this date range, then try again.':error?.code==='AUTH'?'Sign in to Paws HQ to export entries.':error?.code==='ACCESS'||error?.code==='42501'?'Your workspace access could not be confirmed. Refresh Paws HQ and try again.':'Could not load the report. Check your connection and try again.',true);return null;
    }finally {if(valid()){reportState.busy=false;controls();clampReportPosition();}}
  }
  async function openReport() {
    if(!state.ready||state.loading||reportState.busy)return;
    reportState.returnFocus=document.activeElement;updateReportRange(shiftDate(state.weekEnd,-6),state.weekEnd);$('weekReport').showModal();return prepareReport(reportState.start,reportState.end);
  }
  function fitPrintPages() {
    const output=$('weekReportPrint');output.classList.add('is-measuring');
    try {
      for(const page of output.querySelectorAll('.eod-print-page')) {
        const content=page.querySelector('.eod-print-page-content');if(!content)continue;
        const width=page.clientWidth,height=page.clientHeight,contentWidth=content.scrollWidth,contentHeight=content.scrollHeight;
        if(width>0&&height>0&&contentWidth>0&&contentHeight>0)page.style.setProperty('--eod-print-scale',String(Math.min(1,(width-2)/contentWidth,(height-2)/contentHeight)));
      }
    }finally {output.classList.remove('is-measuring');}
  }
  async function outputReport(kind) {
    const report=await prepareReport(reportState.start,reportState.end);
    if(kind==='print'&&document.fonts?.ready)await document.fonts.ready;
    if(!report||!state.ready||!$('weekReport').open||reportState.model!==report)return;
    if(kind==='print') {
      try {
        $('weekReportPrint').innerHTML=window.PawsEodReport.printHtml(report);fitPrintPages();
        reportState.printing=true;document.body.classList.add('eod-print-report');controls();window.print();
      }catch(error){reportState.printing=false;$('weekReportPrint').innerHTML='';document.body.classList.remove('eod-print-report');controls();reportMessage('Could not open printing. Please try again.',true);}return;
    }
    const blob=new Blob([window.PawsEodReport.csv(report)],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),link=document.createElement('a');reportState.urls.add(url);
    link.href=url;link.download=`paws-end-of-day_${report.start}_to_${report.end}.csv`;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>{URL.revokeObjectURL(url);reportState.urls.delete(url);},1000);reportMessage('CSV downloaded.');
  }
  function resetAuth(userId) {
    state.epoch++;state.request++;state.userId=userId;state.ready=false;state.loading=false;state.logs=[];state.deletedRows=[];state.editors.clear();state.loadedDates.clear();state.firstDate=null;state.metadataLoaded=false;state.undo=null;state.undoSaving=false;state.today=easternToday();state.weekEnd=state.today;state.selectedDate=state.today;state.historyVisible=12;
    toggleJumpCalendar(false,{focus:false});jumpState.invalid=false;$('jumpDate').setAttribute('aria-invalid','false');closeReport();clearTimeout(state.toastTimer);$('toast').hidden=true;$('toastText').textContent='';render();message(userId?'Loading End Of Day…':'Sign in to Paws HQ to view End Of Day.');
  }
  function init() {
    if(!$('endOfDayPage'))return;
    $('openDateCalendar').addEventListener('click',()=>toggleJumpCalendar($('jumpDatePicker').hidden));$('closeDateCalendar').addEventListener('click',()=>toggleJumpCalendar(false));
    $('jumpDate').addEventListener('change',commitJumpDate);$('jumpDate').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitJumpDate();}});
    $('jumpDatePicker').addEventListener('click',event=>{
      const day=event.target.closest('[data-jump-date]');if(day){$('jumpDate').value=formatJumpDate(day.dataset.jumpDate);commitJumpDate();return;}
      const step=event.target.closest('[data-jump-month]');if(step&&!step.disabled){const month=shiftMonth(jumpState.month,Number(step.dataset.jumpMonth));if(validDate(month)){jumpState.month=month;jumpState.focusDate=month;renderJumpCalendar();}}
    });$('jumpCalendar').addEventListener('keydown',jumpCalendarKey);
    for(const id of ['jumpMonth','jumpYear'])$(id).addEventListener('change',()=>{const month=`${$('jumpYear').value}-${$('jumpMonth').value}-01`;if(validDate(month)){jumpState.month=month;jumpState.focusDate=month;renderJumpCalendar();}});
    $('jumpCalendarToday').addEventListener('click',()=>{$('jumpDate').value=formatJumpDate(easternToday());commitJumpDate();});
    $('dateJump').addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('jumpDatePicker').hidden){event.preventDefault();toggleJumpCalendar(false);}});
    const closeJumpOutside=event=>{if(!$('jumpDatePicker').hidden&&!$('dateJump').contains(event.target))toggleJumpCalendar(false,{focus:false});};document.addEventListener('pointerdown',closeJumpOutside);document.addEventListener('focusin',closeJumpOutside);
    window.addEventListener('paws-access-revoked',()=>toggleJumpCalendar(false,{focus:false}));window.addEventListener('pagehide',()=>toggleJumpCalendar(false,{focus:false}));
    $('openWeekReport').addEventListener('click',openReport);$('closeWeekReport').addEventListener('click',closeReport);
    $('expandWeekReport').addEventListener('click',toggleReportExpanded);$('reportToolbar').addEventListener('pointerdown',startReportDrag);
    window.addEventListener('pointermove',moveReportDrag);window.addEventListener('pointerup',endReportDrag);window.addEventListener('pointercancel',endReportDrag);
    window.addEventListener('resize',()=>{endReportDrag();clampReportPosition();});
    $('weekReport').addEventListener('close',clearReport);$('weekReport').addEventListener('click',event=>{if(event.target===$('weekReport'))closeReport();});
    $('weekReport').addEventListener('cancel',event=>{if(!$('reportDatePicker').hidden){event.preventDefault();toggleReportDates(false);$('selectReportDates').focus();}});
    $('selectReportDates').addEventListener('click',()=>toggleReportDates($('reportDatePicker').hidden));
    $('reportLastSeven').addEventListener('click',async()=>{const today=easternToday();if(updateReportRange(shiftDate(today,-6),today)){toggleReportDates(false);return prepareReport(reportState.start,reportState.end);}});
    $('reportCalendar').addEventListener('click',event=>{
      const date=event.target.closest('[data-calendar-date]');if(date)return chooseReportDate(date.dataset.calendarDate);
      const step=event.target.closest('[data-calendar-step]');if(step&&!reportState.busy&&!reportState.printing&&!step.disabled){const month=shiftMonth(reportState.month,Number(step.dataset.calendarStep));if(validDate(month)){reportState.month=month;reportState.focusDate=month;renderCalendar();}}
    });$('reportCalendar').addEventListener('keydown',calendarKey);
    $('downloadReport').addEventListener('click',()=>outputReport('csv'));$('printReport').addEventListener('click',()=>outputReport('print'));
    window.addEventListener('paws-access-revoked',closeReport);window.addEventListener('pagehide',closeReport);
    window.addEventListener('beforeprint',()=>{const valid=Boolean(state.ready&&reportState.printing&&reportState.model&&$('weekReport').open);document.body.classList.toggle('eod-print-report',valid);if(valid)fitPrintPages();else $('weekReportPrint').innerHTML='';});
    window.addEventListener('afterprint',()=>{reportState.printing=false;$('weekReportPrint').innerHTML='';document.body.classList.remove('eod-print-report');controls();});
    $('previousWeek').addEventListener('click',()=>selectDate(shiftDate(state.weekEnd,-7),{week:true}));$('nextWeek').addEventListener('click',()=>selectDate(shiftDate(state.weekEnd,7),{week:true}));
    $('goToday').addEventListener('click',()=>{state.today=easternToday();return openDay(state.today,{week:true});});
    $('weekRows').addEventListener('click',event=>{const button=event.target.closest('[data-open-date]');if(button)return openDay(button.dataset.openDate);});
    $('historyList').addEventListener('click',async event=>{const button=event.target.closest('[data-week-end]');if(button&&await selectDate(button.dataset.weekEnd,{week:true}))revealSection('weekSection');});$('loadOlderWeeks').addEventListener('click',()=>{state.historyVisible+=12;renderHistory();controls();});
    $('attentionList').addEventListener('click',event=>{const button=event.target.closest('[data-attention-date]');if(button)return openDay(button.dataset.attentionDate,{week:!weekDates(state.weekEnd).includes(button.dataset.attentionDate)});});
    $('refreshLogs').addEventListener('click',()=>loadWeek());$('undoDelete').addEventListener('click',()=>restoreDay());
    const restore=event=>{const button=event.target.closest('[data-restore-date]');if(button)restoreDay(rowForDate(button.dataset.restoreDate));};$('deletedList').addEventListener('click',restore);
    $('dayContent').addEventListener('input',event=>{if(event.target.matches('[data-field]'))takeInput(event.target);});
    $('dayContent').addEventListener('pointerdown',event=>{const input=event.target.closest('[data-field]');state.pointerField=input||null;const button=event.target.closest('[data-day-action="delete"]');if(button){const editor=editorForDate(state.selectedDate,{create:false});if(editor)editor.skipBlurSave=true;}});
    $('dayContent').addEventListener('focusin',event=>{const input=event.target;if((input.matches('[data-money]')||input.matches('[data-quantity]'))&&state.pointerField!==input)input.select();state.pointerField=null;});
    $('dayContent').addEventListener('focusout',event=>{
      const input=event.target;if(!input.matches('[data-field]'))return;const editor=state.editors.get(input.closest('[data-day-date]')?.dataset.dayDate);if(editor?.skipBlurSave){editor.skipBlurSave=false;return;}const epoch=state.epoch;
      setTimeout(()=>{if(current(epoch)&&editor&&state.editors.get(editor.date)===editor&&!editor.deleting)saveEditor(editor);},0);
    });
    $('dayContent').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.target.blur();}else if(event.key==='Escape'&&event.target.matches('[data-field]'))event.target.blur();});
    $('dayContent').addEventListener('click',event=>{restore(event);const button=event.target.closest('[data-day-action]');if(!button)return;const editor=editorForDate(state.selectedDate,{create:false});if(button.dataset.dayAction==='delete')deleteDay(editor);if(button.dataset.dayAction==='retry')saveEditor(editor);if(button.dataset.dayAction==='reload')reloadDay(editor);});
    window.addEventListener('beforeunload',event=>{if(unfinished()){event.preventDefault();event.returnValue='';}});window.addEventListener('online',()=>loadWeek({silent:true}));window.addEventListener('focus',()=>loadWeek({silent:true}));document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadWeek({silent:true});});setInterval(()=>{if(!document.hidden)loadWeek({silent:true});},30000);
    if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange((event,session)=>{const id=session?.user?.id||null,changed=event==='SIGNED_OUT'||id!==state.userId;if(changed)resetAuth(id);if(id)setTimeout(()=>loadWeek({silent:!changed}),0);});
    render();loadWeek();
  }
  if (document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
