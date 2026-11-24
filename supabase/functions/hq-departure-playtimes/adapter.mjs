// Verified legacy reservation mapping, separate from the credential-owning reader.
import {DomainError,normalizeSnapshot,easternDate} from './domain.mjs';
// Only current Paws dog and cat boarding categories. Daycare and grooming are
// outside this feature; no species is inferred from a breed or another booking.
const BOARDING_TYPES=new Map(Object.entries({20:'Standard Dog Boarding',22:'Luxury Dog Boarding',7:'Cat Boarding'}));
const PLAY_CATALOG=new Map(Object.entries({6:'Gold Activity Package Cats',7:'Silver Activity Package Cats',8:'Bronze Activity Package Cats',85:'Gold Activity Package | Group',87:'Silver Activity Package | Group',88:'Bronze Activity Package | Group',89:'Gold Activity Package | Custom',90:'Silver Activity Package | Custom',91:'Bronze Activity Package | Custom',92:'Puppy Activity Package',98:'à la Carte Enrichment Add On | Boarding'}));
const activityLike=name=>/playtime|activity package|enrichment|\btlc\b/i.test(name);
// Observed actual booked extra; the self-service catalog omits this staff-only
// service. Retain its actual booking-row identity, without inventing a catalog
// mapping or price. Any future billing integration must resolve that mapping.
const BOOKED_ACTIVITY_NAMES=new Set(['à la Carte Enrichment Add On - Business Only']);
const clean=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
function fail(reason,code='SOURCE_MAPPING_REQUIRED'){throw Object.assign(new DomainError(code,409),{mappingReason:reason});}
function identifier(value){if(!/^[1-9]\d{0,19}$/.test(String(value)))fail('invalid_source_id');return String(value);}
function stamp(value,nullable=false){
  if(nullable&&(value===null||value===undefined||value===''||value==='0'||value===0))return null;
  let tick;
  if(typeof value==='number'||typeof value==='string'&&/^\d{9,13}$/.test(value)){const numeric=Number(value);tick=numeric<1e12?numeric*1000:numeric;}
  else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))tick=Date.parse(value);
  if(!Number.isFinite(tick))fail('ambiguous_source_timestamp');return new Date(tick).toISOString();
}
const cancelled=row=>row.cancelled===true||row.cancelled==='1'||!!stamp(row.cancelled_date??row.cancelled_at,true);
function sourceRows(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=='object'||Object.keys(value).some(key=>!/^\d+$/.test(key)))fail('missing_reservation_details','SOURCE_INCOMPLETE');
  return Object.values(value);
}
function species(typeId,types){
  const name=types.get(typeId);
  if(BOARDING_TYPES.has(typeId)&&name===BOARDING_TYPES.get(typeId))return typeId==='7'?'cat':'dog';
  fail('unreviewed_boarding_category');
}
function projectReservation(row){
  if(!row||typeof row!=='object'||!Array.isArray(row.services))fail('missing_booked_service_list','SOURCE_INCOMPLETE');
  const reservationId=identifier(row.reservation_id),animalId=identifier(row.animal?.id),typeId=identifier(row.reservation_type?.id);
  const serviceRows=row.services.map(service=>{
    if(!service||typeof service!=='object')fail('invalid_booked_service');
    return {id:identifier(service.id),name:clean(service.name),scheduledAt:service.scheduled_at??null,scheduledUntil:service.scheduled_until??null,cancelled:cancelled(service),quantity:service.quantity??1};
  }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {reservationId,animalId,typeId,dogName:clean(row.animal.name),ownerLast:clean(row.owner?.last_name),departureAt:stamp(row.end_date),checkedOutAt:stamp(row.check_out_date,true),cancelled:cancelled(row),waitlisted:!!stamp(row.wait_list_date,true)&&!stamp(row.check_in_date,true),serviceRows};
}
async function concurrent(items,limit,work){
  const output=new Array(items.length);let index=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const i=index++;output[i]=await work(items[i]);}}));return output;
}
export async function buildSource(reader,bundle){
  if(!bundle||Object.keys(bundle.failures||{}).length||!Array.isArray(bundle.whiteboard?.checking_out)||!Array.isArray(bundle.types)||!/^\d{4}-\d{2}-\d{2}$/.test(bundle.businessDate||''))fail('incomplete_provider_response','SOURCE_INCOMPLETE');
  const types=new Map();for(const row of bundle.types){const id=identifier(row.id),name=clean(row.type);if(types.has(id)&&types.get(id)!==name)fail('conflicting_type_catalog','CONFLICTING_SOURCE');types.set(id,name);}
  const details=new Map();
  for(const raw of [...sourceRows(bundle.checked_in),...sourceRows(bundle.date_range)]){
    if(raw?.reservation_type?.id==null)fail('missing_reservation_category','SOURCE_INCOMPLETE');
    if(!BOARDING_TYPES.has(String(raw.reservation_type.id)))continue;
    const row=projectReservation(raw),prior=details.get(row.reservationId);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('conflicting_reservation_responses','CONFLICTING_SOURCE');
    details.set(row.reservationId,row);
  }
  const boards=new Map();
  for(const row of bundle.whiteboard.checking_out){
    if(row?.type_id==null)fail('missing_whiteboard_category','SOURCE_INCOMPLETE');
    if(!BOARDING_TYPES.has(String(row.type_id)))continue;
    const id=identifier(row.id),detail=details.get(id);
    if(!detail)fail('whiteboard_reservation_details_missing','SOURCE_INCOMPLETE');
    if(!types.has(detail.typeId))fail('whiteboard_category_outside_configured_source');
    if(detail.animalId!==identifier(row.animal_id)||detail.typeId!==identifier(row.type_id)||detail.departureAt!==stamp(row.end_date))fail('whiteboard_details_changed','CONFLICTING_SOURCE');
    if(boards.has(id)&&JSON.stringify(boards.get(id))!==JSON.stringify(row))fail('conflicting_whiteboard_rows','CONFLICTING_SOURCE');boards.set(id,row);
  }
  // Keep today's dog/cat boarding departures, including pets that already
  // checked out. Daycare reservations never create rows or skip items.
  const candidates=[...details.values()].filter(row=>BOARDING_TYPES.has(row.typeId)&&!row.cancelled&&!row.waitlisted&&easternDate(row.departureAt)===bundle.businessDate);
  const departures=candidates.map(row=>({...row,species:species(row.typeId,types)}));
  if(!departures.length)return normalizeSnapshot({locationId:'1',businessDate:bundle.businessDate,fetchedAt:bundle.fetchedAt,complete:true,departures:[],services:[]});
  const typeIds=[...new Set([...departures.map(row=>row.typeId),...['20','22'].filter(id=>types.has(id))])];
  const catalogs=await concurrent(typeIds,4,async typeId=>{
    const response=await reader.lookup('get_services_by_type',typeId);
    if(!response||String(response.type_id)!==typeId||!Array.isArray(response.allowable_services)||response.allowable_services.length>500)fail('unsupported_service_catalog','SOURCE_INCOMPLETE');
    return response.allowable_services;
  });
  const catalogIds=new Set(),byName=new Map();
  for(const row of catalogs.flat()){
    const id=identifier(row.id),name=clean(row.name);catalogIds.add(id);
    if(PLAY_CATALOG.has(id)&&PLAY_CATALOG.get(id)!==name)fail('changed_playtime_catalog');
    if(PLAY_CATALOG.get(id)!==name)continue;
    if(byName.has(name)&&byName.get(name)!==id)fail('ambiguous_playtime_catalog');byName.set(name,id);
  }
  const services=[],occurrences=new Map();
  for(const departure of departures)for(const service of departure.serviceRows){
    if(service.cancelled)continue;
    const catalogId=byName.get(service.name),sourceOnly=BOOKED_ACTIVITY_NAMES.has(service.name);
    if(catalogId||sourceOnly||activityLike(service.name)){
      if(easternDate(stamp(service.scheduledAt))!==bundle.businessDate)continue;
    }
    if(!catalogId&&!sourceOnly){if(activityLike(service.name))fail('unmapped_booked_activity_service');continue;}
    if(catalogIds.has(service.id))fail('catalog_id_is_not_booked_occurrence');
    const scheduledAt=stamp(service.scheduledAt),serviceDate=easternDate(scheduledAt);if(serviceDate!==bundle.businessDate)continue;
    const scheduledUntil=stamp(service.scheduledUntil),durationMinutes=(Date.parse(scheduledUntil)-Date.parse(scheduledAt))/60000;
    if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>1440)fail('unknown_service_duration');
    const prior=occurrences.get(service.id);
    if(prior&&prior!==departure.reservationId)fail('booked_id_reused_between_reservations','CONFLICTING_SOURCE');occurrences.set(service.id,departure.reservationId);
    services.push({occurrenceId:`${service.id}.${serviceDate}`,reservationId:departure.reservationId,animalId:departure.animalId,serviceId:catalogId??`booked.${service.id}`,serviceName:service.name,serviceDate,scheduledAt,durationMinutes,priceCents:null,quantity:service.quantity,isPlaytime:true,cancelled:false,alreadyBilled:false});
  }
  return normalizeSnapshot({locationId:'1',businessDate:bundle.businessDate,fetchedAt:bundle.fetchedAt,complete:true,departures:departures.map(({reservationId,animalId,dogName,ownerLast,departureAt,checkedOutAt,species})=>({reservationId,animalId,dogName,ownerLast,departureAt,checkedOutAt,species,cancelled:false})),services});
}
