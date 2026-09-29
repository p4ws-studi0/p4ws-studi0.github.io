const test=require('node:test');
const {assert,files,read,row,deferred,until,environment}=require('./tour-test-helpers.cjs');
function harness(options={}){
  const h=environment({html:read(files.toursHtml),...options});
  h.evaluate(read(files.editor),'tour-editor.js');
  const changes=[],errors=[],saved=[],busy=[];
  const readiness={ready:true,loading:false};
  const editor=h.window.createTourEditor({isReady:()=>readiness.ready,isLoading:()=>readiness.loading,
    onChange:value=>changes.push(value),onError:value=>errors.push(value),onBusyChange:value=>busy.push(value),onSaved:value=>saved.push(value)});
  return Object.assign(h,{editor,changes,errors,saved,busy,readiness});
}
function fill(h,values={}){
  h.editor.open();
  for(const[id,value]of Object.entries({customerName:'Test Customer',customerInfo:'Draft note',tourDate:'2026-09-29',tourTime:'11:00',staffInitials:'cr',...values}))h.get(id).value=value;
}

test('shared editor saves trimmed data and treats 10:30 / 15:00 as normal hours',async()=>{
  const h=harness({intercept:call=>call.operation==='insert'?{data:row({...call.payload}),error:null}:undefined});
  for(const time of ['10:30','15:00']){
    fill(h,{customerName:' Test Customer ',tourTime:time});await h.submit();
    assert.equal(h.get('tourDialog').open,false);
    const change=h.changes.at(-1);
    assert.equal(change.customer_name,'Test Customer');assert.equal(change.staff_initials,'CR');
    assert.equal(change.outside_hours_confirmed,false);
  }
});

test('outside-hours confirmation and nonblank customer validation preserve form without mutation',async()=>{
  const h=harness({intercept:call=>call.operation==='insert'?{data:row({...call.payload}),error:null}:undefined});
  fill(h,{customerName:'  '});await h.submit();
  assert.match(h.get('formError').textContent,/customer name/);assert.equal(h.api.calls.length,0);
  h.get('customerName').value='Test Customer';h.get('tourTime').value='15:01';await h.submit();
  assert.match(h.get('formError').textContent,/personally lead/);assert.equal(h.api.calls.length,0);
  h.get('outsideHoursConfirmed').checked=true;await h.submit();
  assert.equal(h.changes.at(-1).outside_hours_confirmed,true);
});

test('stale revisions cannot overwrite another edit and retain the draft',async()=>{
  const h=harness({intercept:call=>call.operation==='update'?{data:null,error:null}:undefined});
  h.editor.open(row());h.get('customerInfo').value='Keep this draft';await h.submit();
  assert.equal(h.get('tourDialog').open,true);assert.equal(h.get('customerInfo').value,'Keep this draft');
  assert.match(h.get('formError').textContent,/Someone else changed/);assert.equal(h.changes.length,0);
  assert.deepEqual(h.api.calls.find(c=>c.operation==='update').filters,[['eq','id',row().id],['eq','revision',1]]);
});

test('retry after lost insert response reuses UUID, recovers row and retains subsequent edits',async()=>{
  let attempts=0,savedRow;
  const h=harness({intercept:call=>{
    if(call.operation==='insert'){savedRow??=row(call.payload);return {data:null,error:{code:++attempts===1?'NETWORK':'23505'}};}
    if(call.table==='hq_tours'&&call.operation==='select')return {data:savedRow,error:null};
    if(call.operation==='update')return {data:{...savedRow,...call.payload,revision:2},error:null};
  }});
  fill(h);const id=h.get('tourId').value;await h.submit();
  h.get('customerInfo').value='Newer unsaved note';await h.submit();
  assert.deepEqual(h.api.calls.filter(c=>c.operation==='insert').map(c=>c.payload.id),[id,id]);
  assert.equal(h.get('tourDialog').open,true);assert.equal(h.get('customerInfo').value,'Newer unsaved note');
  assert.match(h.get('formError').textContent,/earlier save succeeded/);
  await h.submit();assert.equal(h.get('tourDialog').open,false);
  assert.equal(h.changes.at(-1).customer_info,'Newer unsaved note');assert.equal(h.changes.at(-1).revision,2);
  assert.deepEqual(h.api.calls.find(c=>c.operation==='update').filters,[['eq','id',id],['eq','revision',1]]);
});

test('delete and undo share revision protection and feedback disappears after five seconds',async()=>{
  let stored=row();
  const h=harness({intercept:call=>{if(call.operation==='update'){stored={...stored,...call.payload,revision:stored.revision+1};return {data:stored,error:null};}}});
  h.editor.confirmDelete(stored);assert.equal(h.get('deleteDialog').open,true);
  await h.click('confirmDelete');assert.equal(h.get('deleteDialog').open,false);assert.ok(h.changes.at(-1).deleted_at);
  await h.click('undoDelete');await until(()=>!h.editor.isBusy());assert.equal(h.changes.at(-1).deleted_at,null);
  const updates=h.api.calls.filter(c=>c.operation==='update');
  assert.deepEqual(updates.map(c=>c.filters.find(([,field])=>field==='revision')[2]),[1,2]);
  assert.equal(h.get('toast').hidden,false);assert.ok(Array.from(h.timers.values()).some(t=>t.delay===5000));
  h.runTimers(5000);assert.equal(h.get('toast').hidden,true);assert.equal(h.get('undoDelete').hidden,true);
});

test('reset invalidates prior save response and its finally cannot unlock a newer save',async()=>{
  const oldRequest=deferred(),newRequest=deferred();let inserts=0;
  const h=harness({intercept:call=>call.operation==='insert'?(++inserts===1?oldRequest.promise:newRequest.promise):undefined});
  fill(h);const oldSave=h.submit();await until(()=>inserts===1);
  h.editor.reset();assert.equal(h.get('tourDialog').open,false);assert.equal(h.get('customerName').value,'');
  fill(h,{customerName:'New session customer'});const newSave=h.submit();await until(()=>inserts===2);
  oldRequest.resolve({data:row({customer_name:'Prior session customer'}),error:null});await oldSave;
  assert.equal(h.editor.isBusy(),true);assert.equal(h.changes.length,0);assert.equal(h.get('tourDialog').open,true);
  newRequest.resolve({data:row({customer_name:'New session customer'}),error:null});await newSave;
  assert.equal(h.editor.isBusy(),false);assert.equal(h.changes.length,1);assert.equal(h.changes[0].customer_name,'New session customer');
});

test('legacy tentative status becomes unknown in editor, and unapproved account cannot save',async()=>{
  const h=harness({active:false});h.editor.open(row({booking_status:'tentative'}));
  assert.equal(h.get('bookingStatus').value,'unknown');
  await h.submit();assert.equal(h.api.calls.some(c=>c.operation==='update'),false);
  assert.match(h.get('formError').textContent,/access/);assert.equal(h.changes.length,0);
});
