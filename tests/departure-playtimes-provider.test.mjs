import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSource} from '../supabase/functions/hq-departure-playtimes/adapter.mjs';
import {buildDailyView,DomainError} from '../supabase/functions/hq-departure-playtimes/domain.mjs';

const DAY='2026-11-23';
const TYPE_NAMES=new Map(Object.entries({20:'Standard Dog Boarding',22:'Luxury Dog Boarding',7:'Cat Boarding',18:'Daycare Limit Reached - Business Only',25:'Daycare | Custom Enrichment Full Day',26:'Daycare | Custom Enrichment Half Day',23:'Daycare | Custom Full Day',24:'Daycare | Custom Half Day',17:'Daycare | Employee - Business Only',8:'Daycare | Enrichment Full Day',9:'Daycare | Enrichment Half Day',5:'Daycare | Full Day',4:'Daycare | Half Day',15:'Daycare | Puppy Program',27:'Daycare | Puppy Program Half Day',28:'Puppy Socialization - Business Only'}));
const PACKAGES=[
  ['85','Gold Activity Package | Group'],['87','Silver Activity Package | Group'],['88','Bronze Activity Package | Group'],
  ['89','Gold Activity Package | Custom'],['90','Silver Activity Package | Custom'],['91','Bronze Activity Package | Custom'],
  ['92','Puppy Activity Package'],['98','à la Carte Enrichment Add On | Boarding']
];
const CAT_PACKAGES=[['6','Gold Activity Package Cats'],['7','Silver Activity Package Cats'],['8','Bronze Activity Package Cats']];
const stamp=value=>String(Date.parse(value)/1000);
function fixture({date=DAY,typeId='20',services}={}){
  const booked=services??[{id:'990001',name:(typeId==='7'?CAT_PACKAGES:PACKAGES)[0][1],scheduled_at:`${date}T09:00:00-05:00`,scheduled_until:`${date}T09:30:00-05:00`,cost:'51.23',completed_by:null,completed_at:null}];
  const detail={reservation_id:'6001',start_date:`${date}T08:00:00-05:00`,end_date:`${date}T17:00:00-05:00`,cancelled_date:null,wait_list_date:null,check_in_date:`${date}T08:01:00-05:00`,check_out_date:null,
    reservation_type:{id:typeId,type:TYPE_NAMES.get(typeId)||'Unreviewed category'},animal:{id:'7001',name:'River',breed:'Mixed'},owner:{last_name:'West',email:'fixture-private@example.test'},services:booked,transaction:[]};
  const bundle={businessDate:date,fetchedAt:`${date}T16:00:00.000Z`,failures:{},types:[...TYPE_NAMES].map(([id,type])=>({id,type})),species:[{value:'1',label:'Dog'},{value:'2',label:'Cat'}],
    whiteboard:{checking_in:[],checking_out:[{id:'6001',animal_id:'7001',type_id:typeId,type:detail.reservation_type.type,a_first:'River',o_last:'West',end_date:stamp(detail.end_date),check_out_stamp:null}]},
    checked_in:{6001:structuredClone(detail)},date_range:{6001:structuredClone(detail)}};
  const calls=[],catalog=PACKAGES.map(([id,name])=>({id,name,duration:'30'}));catalog.push({id:'12',name:'Departure Bath',duration:'30'});
  const catCatalog=CAT_PACKAGES.map(([id,name],i)=>({id,name,duration:i===2?'15':'1'}));
  const reader={peek:()=>bundle,async lookup(name,id){calls.push([name,id]);if(name==='get_services_by_type')return {type_id:String(id),allowable_services:structuredClone(String(id)==='7'?catCatalog:catalog)};if(name==='get_locations')return [{id:'1',value:'1',label:'Paws',name:'Paws',timezone:'America/New_York'}];throw new Error(`Unexpected lookup: ${name}`);}};
  return {reader,bundle,calls,catalog,catCatalog,edit(fn){for(const details of [bundle.checked_in,bundle.date_range])fn(details['6001']);}};
}
async function daily(f,states=[]){const source=await buildSource(f.reader,f.bundle);return {source,view:buildDailyView(source,states,{now:Date.parse(f.bundle.fetchedAt)})};}
const closedCode=error=>error instanceof DomainError&&['SOURCE_MAPPING_REQUIRED','SOURCE_INCOMPLETE','CONFLICTING_SOURCE','INVALID_SOURCE'].includes(error.code);
const rejectsClosed=f=>assert.rejects(buildSource(f.reader,f.bundle),closedCode);

test('legacy booked occurrence maps once from duplicate dictionaries and never proposes charges',async()=>{
  const f=fixture(),{source,view}=await daily(f);assert.equal(source.complete,true);assert.equal(source.locationId,'1');assert.equal(source.fetchedAt,f.bundle.fetchedAt);assert.equal(view.summary.dogs,1);assert.equal(view.summary.playtimes,1);
  const service=view.departures[0].services[0];assert.equal(service.occurrenceId,`990001.${DAY}`);assert.equal(service.serviceId,'85');assert.equal(service.durationMinutes,30);assert.equal(service.scheduledAt,`${DAY}T14:00:00.000Z`);assert.equal(service.priceCents,null);assert.equal(service.billingEligible,false);assert.equal(view.summary.proposedCents,0);assert.deepEqual(view.expectedCharges,[]);
  assert.ok(!JSON.stringify(source).includes('fixture-private@example.test'));assert.ok(!JSON.stringify(source).includes('51.23'));assert.ok(f.calls.every(([name])=>name!=='animals'));
});

test('each configured package and enrichment booking is a single daily item without component expansion',async()=>{
  const services=PACKAGES.map(([,name],i)=>({id:String(990001+i),name,scheduled_at:`${DAY}T09:00:00-05:00`,scheduled_until:`${DAY}T09:30:00-05:00`,cost:'999.99'}));
  const f=fixture({services}),{view}=await daily(f);assert.equal(view.summary.playtimes,PACKAGES.length);assert.deepEqual(view.departures[0].services.map(s=>s.serviceId).sort(),PACKAGES.map(([id])=>id).sort());assert.ok(view.departures[0].services.every(s=>s.quantity===1&&s.priceCents===null));assert.deepEqual(view.expectedCharges,[]);
});

test('allowable catalog services are classification evidence and never create missing bookings',async()=>{
  const empty=await daily(fixture({services:[]}));assert.equal(empty.view.summary.dogs,1);assert.equal(empty.view.summary.playtimes,0);
  const f=fixture();f.edit(detail=>detail.services.push({id:'990009',name:'Departure Bath',scheduled_at:`${DAY}T10:00:00-05:00`,scheduled_until:`${DAY}T10:30:00-05:00`,cost:'20.00'},{id:'990010',name:'Unlisted nail trim',scheduled_at:null,scheduled_until:null,cost:'5.00'}));
  assert.equal((await daily(f)).view.summary.playtimes,1);
});

test('dog and cat boarding are shown while daycare with a booked activity package stays excluded',async()=>{
  for(const typeId of ['20','22']){const {view}=await daily(fixture({typeId}));assert.equal(view.summary.dogs,1);assert.equal(view.summary.playtimes,1);}
  const cat=await daily(fixture({typeId:'7'}));assert.equal(cat.view.summary.dogs,0);assert.equal(cat.view.summary.cats,1);assert.equal(cat.view.summary.pets,1);assert.equal(cat.view.summary.playtimes,1);assert.equal(cat.view.departures[0].species,'cat');
  for(const typeId of ['4','5','8','9','15','17','18','23','24','25','26','27','28','999']){
    const f=fixture({typeId});if(typeId==='999')f.bundle.types.push({id:typeId,type:'Unreviewed category'});
    const {view}=await daily(f);assert.equal(view.summary.dogs,0,`non-boarding category ${typeId}`);assert.equal(view.summary.playtimes,0);assert.ok(!f.calls.some(([name])=>name==='get_services_by_type'));
  }
  for(const typeId of ['20','7']){const renamed=fixture({typeId});renamed.bundle.types.find(row=>row.id===typeId).type='Unreviewed boarding label';await assert.rejects(buildSource(renamed.reader,renamed.bundle),error=>error instanceof DomainError&&error.code==='SOURCE_MAPPING_REQUIRED');}
});

test('cat activity packages use the verified cat catalog and remain one non-billable booked item each',async()=>{
  const services=CAT_PACKAGES.map(([,name],i)=>({id:String(990101+i),name,scheduled_at:`${DAY}T09:00:00-05:00`,scheduled_until:`${DAY}T09:${i===2?'15':'01'}:00-05:00`,cost:'45.00'}));
  const f=fixture({typeId:'7',services}),{source,view}=await daily(f);assert.equal(source.departures[0].species,'cat');assert.equal(view.summary.dogs,0);assert.equal(view.summary.cats,1);assert.equal(view.summary.pets,1);assert.equal(view.summary.playtimes,3);assert.deepEqual(view.departures[0].services.map(s=>s.serviceId).sort(),['6','7','8']);assert.ok(view.departures[0].services.every(s=>s.quantity===1&&s.priceCents===null&&!s.billingEligible));assert.deepEqual(view.expectedCharges,[]);assert.ok(f.calls.some(([name,id])=>name==='get_services_by_type'&&String(id)==='7'));
  const empty=await daily(fixture({typeId:'7',services:[]}));assert.equal(empty.view.summary.pets,1);assert.equal(empty.view.summary.playtimes,0);
});

test('a verified staff-only enrichment booking retains its actual occurrence without inventing a billing catalog ID',async()=>{
  const name='à la Carte Enrichment Add On - Business Only';
  const f=fixture({services:[{id:'990099',name,scheduled_at:`${DAY}T09:00:00-05:00`,scheduled_until:`${DAY}T09:30:00-05:00`,cost:'75.00'}]});
  assert.ok(!f.catalog.some(row=>row.name===name));
  const {source,view}=await daily(f);assert.equal(source.services.length,1);assert.equal(view.summary.playtimes,1);
  const service=view.departures[0].services[0];assert.equal(service.occurrenceId,`990099.${DAY}`);assert.equal(service.serviceId,'booked.990099');assert.equal(service.serviceName,name);assert.equal(service.quantity,1);assert.equal(service.priceCents,null);assert.equal(service.billingEligible,false);assert.deepEqual(view.expectedCharges,[]);assert.equal(view.summary.proposedCents,0);
});

test('grooming is ignored while checked-out boarding dogs outside the whiteboard remain visible',async()=>{
  const f=fixture(),checkedOut=structuredClone(f.bundle.date_range['6001']),grooming=structuredClone(checkedOut);
  checkedOut.reservation_id='6002';checkedOut.animal={id:'7002',name:'Sage',breed:'Mixed'};checkedOut.check_out_date=`${DAY}T10:30:00-05:00`;checkedOut.services[0].id='990002';f.bundle.date_range['6002']=checkedOut;
  grooming.reservation_id='6003';grooming.animal={id:'7003',name:'Grooming only',breed:'Unknown'};grooming.reservation_type={id:'6',type:'Grooming'};grooming.services[0].id='990003';grooming.services[0].name='Unreviewed grooming enrichment';f.bundle.date_range['6003']=grooming;
  assert.ok(!f.bundle.types.some(row=>row.id==='6'));assert.ok(!f.bundle.whiteboard.checking_out.some(row=>row.id==='6002'||row.id==='6003'));
  const {view}=await daily(f);assert.equal(view.summary.dogs,2);assert.equal(view.summary.playtimes,2);assert.deepEqual(view.departures.map(row=>row.dogName).sort(),['River','Sage']);assert.equal(view.departures.find(row=>row.dogName==='Sage').checkedOutAt,`${DAY}T15:30:00.000Z`);
  f.bundle.types.push({id:'6',type:'Grooming'});f.bundle.whiteboard.checking_out.push({id:'6003',animal_id:'7003',type_id:'6',end_date:stamp(grooming.end_date)});
  assert.deepEqual((await daily(f)).view.departures.map(row=>row.dogName).sort(),['River','Sage']);
});

test('missing or malformed daycare details cannot block valid boarding departures',async()=>{
  const f=fixture();
  f.bundle.whiteboard.checking_out.push({id:'8001',animal_id:'9001',type_id:'4',end_date:'not-a-timestamp'});
  f.bundle.date_range['8002']={reservation_id:'8002',reservation_type:{id:'5',type:TYPE_NAMES.get('5')},animal:null,services:null,end_date:'not-a-timestamp'};
  f.bundle.checked_in['8003']={reservation_type:{id:'4',type:TYPE_NAMES.get('4')}};
  const {source,view}=await daily(f);assert.equal(source.complete,true);assert.equal(view.summary.dogs,1);assert.equal(view.summary.playtimes,1);assert.equal(view.departures[0].dogName,'River');
});

test('missing source coverage and mismatched reservation identities cannot become an empty complete schedule',async()=>{
  for(const field of ['whiteboard','checked_in','date_range']){const f=fixture();f.bundle.failures[field]='GINGR_READ_FAILED';await rejectsClosed(f);}
  const absent=fixture();absent.bundle.checked_in={};absent.bundle.date_range={};await rejectsClosed(absent);
  const wrongAnimal=fixture();wrongAnimal.edit(detail=>{detail.animal.id='9999';});await rejectsClosed(wrongAnimal);
  const wrongType=fixture();wrongType.edit(detail=>{detail.reservation_type.id='7';});await rejectsClosed(wrongType);
});

test('only the Eastern service day is shown and explicitly cancelled items are excluded',async()=>{
  const f=fixture();f.edit(detail=>{detail.end_date=`${DAY}T22:00:00-05:00`;detail.services.push(
    {id:'990002',name:PACKAGES[1][1],scheduled_at:'2026-11-24T00:30:00Z',scheduled_until:'2026-11-24T01:00:00Z',cost:'40.00'},
    {id:'990003',name:PACKAGES[2][1],scheduled_at:'2026-11-23T03:30:00Z',scheduled_until:'2026-11-23T04:00:00Z',cost:'30.00'},
    {id:'990004',name:PACKAGES[3][1],scheduled_at:'2026-11-24T05:00:00Z',scheduled_until:'2026-11-24T05:30:00Z',cost:'30.00'},
    {id:'990005',name:PACKAGES[4][1],scheduled_at:`${DAY}T11:00:00-05:00`,scheduled_until:`${DAY}T11:30:00-05:00`,cancelled_date:`${DAY}T08:00:00-05:00`,cost:'20.00'});});f.bundle.whiteboard.checking_out[0].end_date=stamp(`${DAY}T22:00:00-05:00`);
  const {view}=await daily(f);assert.deepEqual(view.departures[0].services.map(s=>s.occurrenceId).sort(),[`990001.${DAY}`,`990002.${DAY}`]);
  const cancelled=fixture();cancelled.edit(detail=>{detail.cancelled_date=`${DAY}T07:00:00-05:00`;});assert.equal((await daily(cancelled)).view.summary.dogs,0);
});

test('exact repeated rows deduplicate but conflicting reservation or occurrence rows fail closed',async()=>{
  const duplicate=fixture();duplicate.edit(detail=>detail.services.push(structuredClone(detail.services[0])));assert.equal((await daily(duplicate)).view.summary.playtimes,1);
  const moved=fixture();moved.bundle.date_range['6001'].services[0].scheduled_at=`${DAY}T09:15:00-05:00`;await rejectsClosed(moved);
  const conflict=fixture();conflict.edit(detail=>detail.services.push({...detail.services[0],name:PACKAGES[1][1]}));await rejectsClosed(conflict);
  const changedAnimal=fixture();changedAnimal.bundle.date_range['6001'].animal.id='7999';await rejectsClosed(changedAnimal);
});

test('dog and cat occurrence identities survive time changes and isolate reused IDs on another day',async()=>{
  for(const typeId of ['20','7']){
  const first=fixture({typeId}),initial=await daily(first),key=initial.view.departures[0].services[0].key;
  first.edit(detail=>{detail.services[0].scheduled_at=`${DAY}T10:00:00-05:00`;detail.services[0].scheduled_until=`${DAY}T10:30:00-05:00`;});
  const state={key,skipped:true,revision:1,skippedBy:{id:'staff',name:'Staff'},skippedAt:`${DAY}T15:30:00.000Z`};
  const moved=await daily(first,[state]);assert.equal(moved.view.departures[0].services[0].key,key);assert.equal(moved.view.departures[0].services[0].skipped,true);
  const next=await daily(fixture({typeId,date:'2026-11-24'}),[state]);assert.notEqual(next.view.departures[0].services[0].key,key);assert.equal(next.view.departures[0].services[0].occurrenceId,'990001.2026-11-24');assert.equal(next.view.departures[0].services[0].skipped,false);
  }
});

test('unknown activity-like bookings fail closed rather than being guessed or silently omitted',async()=>{
  for(const name of ['New Activity Package','Unlisted group playtime','Special enrichment session','à la Carte Enrichment Add On - New Business Only']){
    const f=fixture();f.edit(detail=>detail.services.push({...detail.services[0],id:'990099',name}));await assert.rejects(buildSource(f.reader,f.bundle),error=>error instanceof DomainError&&error.code==='SOURCE_MAPPING_REQUIRED');
  }
  const cat=fixture({typeId:'7'});cat.edit(detail=>{detail.services[0].name='Unreviewed cat TLC';});await assert.rejects(buildSource(cat.reader,cat.bundle),error=>error instanceof DomainError&&error.code==='SOURCE_MAPPING_REQUIRED');
});

test('explicit-offset and Unix timestamps are supported while bare local times are rejected',async()=>{
  const unix=fixture();unix.edit(detail=>{detail.services[0].scheduled_at=stamp(`${DAY}T09:00:00-05:00`);detail.services[0].scheduled_until=stamp(`${DAY}T09:30:00-05:00`);});assert.equal((await daily(unix)).view.summary.playtimes,1);
  const bare=fixture();bare.edit(detail=>{detail.services[0].scheduled_at=`${DAY} 09:00:00`;});await rejectsClosed(bare);
});
