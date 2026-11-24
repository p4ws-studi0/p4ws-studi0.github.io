import { createHash } from 'node:crypto';

export class DomainError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export const TIMEZONE = 'America/New_York';
export const MAX_SOURCE_AGE_MS = 90_000;
const MAX_PRICE_CENTS = 10_000_000, MAX_QUANTITY = 1000;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const fail = (code = 'INVALID_SOURCE', status = 502) => { throw new DomainError(code, status); };
export function instant(value = Date.now()) {
  const result = typeof value === 'function' ? value() : value;
  const number = result instanceof Date ? result.getTime() : typeof result === 'number' ? result : Date.parse(result);
  if (!Number.isFinite(number)) fail('INVALID_CLOCK', 500);
  return number;
}
export const easternDate = value => dayFormat.format(new Date(instant(value)));
function id(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) fail();
  return value;
}
function text(value, empty = false) {
  if (typeof value !== 'string' || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value) || !empty && !value.trim()) fail();
  return value.trim();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail();
  const stamp = Date.parse(value + 'T12:00:00.000Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) fail();
  return value;
}
function iso(value, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  date(value.slice(0, 10));
  return new Date(value).toISOString();
}
function bool(value) { if (typeof value !== 'boolean') fail(); return value; }
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(); return value; }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const joinKey = item => `${item.reservationId}:${item.animalId}`;
export const occurrenceKey = (locationId, service) => `${locationId}:${joinKey(service)}:${service.occurrenceId}`;
function unique(items, keyOf) {
  const output = new Map();
  for (const item of items) {
    const key = keyOf(item), prior = output.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(item)) fail('CONFLICTING_SOURCE', 409);
    if (!prior) output.set(key, item);
  }
  return [...output.values()].sort((a, b) => compare(keyOf(a), keyOf(b)));
}

/** Validate the explicit adapter contract; never guess playtime by its label. */
export function normalizeSnapshot(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail();
  if (source.complete !== true) fail('SOURCE_INCOMPLETE', 409);
  if (!Array.isArray(source.departures) || source.departures.length > 5000 || !Array.isArray(source.services) || source.services.length > 10_000) fail();
  const locationId = id(source.locationId), businessDate = date(source.businessDate), fetchedAt = iso(source.fetchedAt);
  const departures = unique(source.departures.map(row => {
    if (!row || !['dog', 'cat'].includes(row.species)) fail();
    return { reservationId: id(row.reservationId), animalId: id(row.animalId), dogName: text(row.dogName), ownerLast: text(row.ownerLast, true), species: row.species,
      departureAt: iso(row.departureAt), checkedOutAt: iso(row.checkedOutAt, true), cancelled: bool(row.cancelled) };
  }), joinKey);
  const services = unique(source.services.map(row => {
    if (!row) fail();
    const service = { occurrenceId: id(row.occurrenceId), reservationId: id(row.reservationId), animalId: id(row.animalId), serviceId: id(row.serviceId),
      serviceName: text(row.serviceName), serviceDate: date(row.serviceDate), scheduledAt: iso(row.scheduledAt, true), durationMinutes: integer(row.durationMinutes, 1, 1440),
      priceCents: row.priceCents === null ? null : integer(row.priceCents, 0, MAX_PRICE_CENTS), quantity: integer(row.quantity, 1, MAX_QUANTITY),
      isPlaytime: bool(row.isPlaytime), cancelled: bool(row.cancelled), alreadyBilled: bool(row.alreadyBilled) };
    if (service.scheduledAt && easternDate(service.scheduledAt) !== service.serviceDate) fail('CONFLICTING_SOURCE', 409);
    return service;
  }), service => occurrenceKey(locationId, service));
  return { locationId, businessDate, fetchedAt, complete: true, departures, services };
}

function stateMap(states) {
  if (states instanceof Map) return states;
  if (Array.isArray(states)) return new Map(states.map(state => [state.key, state]));
  if (states && typeof states === 'object') return new Map(Object.entries(states));
  return new Map();
}

/** Charges are a local preview only. Assumed Completed never means verified. */
export function buildDailyView(source, states = [], { now = Date.now } = {}) {
  const snapshot = normalizeSnapshot(source), tick = instant(now);
  if (easternDate(tick) !== snapshot.businessDate) fail('BUSINESS_DATE_MISMATCH', 409);
  const scheduleVersion = hash({ locationId: snapshot.locationId, businessDate: snapshot.businessDate, departures: snapshot.departures, services: snapshot.services });
  const overrides = stateMap(states), expectedCharges = [];
  const summary = { dogs: 0, cats: 0, pets: 0, departures: 0, playtimes: 0, skipped: 0, expectedCents: 0, unpriced: 0, alreadyBilled: 0, proposedCents: 0 };
  const departures = snapshot.departures.filter(row => !row.cancelled && easternDate(row.departureAt) === snapshot.businessDate).map(row => {
    const services = snapshot.services.filter(service => joinKey(service) === joinKey(row) && service.isPlaytime && !service.cancelled && service.serviceDate === snapshot.businessDate).map(service => {
      const key = occurrenceKey(snapshot.locationId, service), state = overrides.get(key), skipped = state?.skipped === true;
      const revision = state?.revision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0 || revision > 1_000_000) fail('INVALID_STATE', 500);
      const expectedCents = skipped ? 0 : service.priceCents === null ? null : service.priceCents * service.quantity;
      const billingEligible = !skipped && !service.alreadyBilled && expectedCents !== null;
      const chargeKey = `departure-playtime:${key}`;
      const item = { ...service, key, chargeKey, status: skipped ? 'Skipped' : 'Assumed Completed', verified: false, skipped, revision,
        skippedBy: skipped ? state.skippedBy ?? null : null, skippedAt: skipped ? state.skippedAt ?? null : null, billingEligible, expectedCents };
      summary.playtimes++; if (skipped) summary.skipped++;
      if (expectedCents === null) summary.unpriced++; else summary.expectedCents += expectedCents;
      if (service.alreadyBilled && !skipped) summary.alreadyBilled++;
      if (billingEligible) {
        summary.proposedCents += expectedCents;
        expectedCharges.push({ key, chargeKey, reservationId: row.reservationId, animalId: row.animalId, occurrenceId: service.occurrenceId,
          serviceId: service.serviceId, serviceName: service.serviceName, serviceDate: service.serviceDate, quantity: service.quantity,
          unitPriceCents: service.priceCents, amountCents: expectedCents, currency: 'USD' });
      }
      return item;
    }).sort((a, b) => compare(a.scheduledAt ?? 'z', b.scheduledAt ?? 'z') || compare(a.key, b.key));
    return { ...row, services };
  }).sort((a, b) => compare(a.departureAt, b.departureAt) || compare(a.dogName, b.dogName) || compare(joinKey(a), joinKey(b)));
  summary.dogs = new Set(departures.filter(row => row.species === 'dog').map(row => row.animalId)).size;
  summary.cats = new Set(departures.filter(row => row.species === 'cat').map(row => row.animalId)).size;
  summary.pets = new Set(departures.map(row => row.animalId)).size; summary.departures = departures.length;
  if (![summary.expectedCents, summary.proposedCents].every(Number.isSafeInteger)) fail('INVALID_SOURCE', 502);
  const age = tick - Date.parse(snapshot.fetchedAt), stale = age > MAX_SOURCE_AGE_MS || age < -5000;
  return { businessDate: snapshot.businessDate, locationId: snapshot.locationId, timezone: TIMEZONE, fetchedAt: snapshot.fetchedAt,
    sourceAgeSeconds: Math.max(0, Math.floor(age / 1000)), sourceComplete: true, stale, scheduleVersion, departures, summary, expectedCharges };
}
