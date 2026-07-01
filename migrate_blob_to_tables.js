
'use strict';
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);


const idMap = {
  trucks: new Map(),
  drivers: new Map(),
  trips: new Map(),
  shippingLines: new Map(),
  invoices: new Map(),
};

async function main() {
  console.log('Fetching legacy app_state blob…');
  const { data: row, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'main')
    .single();
  if (error) throw error;
  const db = row.data;


  for (const l of db.shippingLines || []) {
    const { data: inserted, error } = await supabase.from('shipping_lines').insert({
      code: l.code, name: l.name, contact: l.contact,
      rate_20ft: l.rate20, rate_40ft: l.rate40, rate_hc: l.rateHC,
      active: l.active,
    }).select('id').single();
    if (error) { console.error('shipping_lines failed:', l.code, error.message); continue; }
    idMap.shippingLines.set(l.id, inserted.id);
  }
  console.log(`shipping_lines: ${idMap.shippingLines.size} migrated`);

  
  for (const t of db.trucks || []) {
    const { data: inserted, error } = await supabase.from('trucks').insert({
      reg: t.reg, make: t.make, type: t.type, year: t.year, colour: t.colour,
      status: t.status, fuel_pct: Math.round(t.fuelPct), mileage: t.mileage,
      last_service: t.lastService, next_service: t.nextService, notes: t.notes,
      licence_plate: t.licencePlate, vin: t.vin,
    }).select('id').single();
    if (error) { console.error('trucks failed:', t.reg, error.message); continue; }
    idMap.trucks.set(t.id, inserted.id);
  }
  console.log(`trucks: ${idMap.trucks.size} migrated`);

  
  for (const d of db.drivers || []) {
    const { data: inserted, error } = await supabase.from('drivers').insert({
      name: d.name, phone: d.phone, licence: d.licence, licence_exp: d.licenceExp,
      status: d.status, truck_id: idMap.trucks.get(d.truckId) || null,
      trips_today: d.tripsToday, current_load: d.load, location: d.location,
      id_no: d.idNo, rating: d.rating,
    }).select('id').single();
    if (error) { console.error('drivers failed:', d.name, error.message); continue; }
    idMap.drivers.set(d.id, inserted.id);
  }
  console.log(`drivers: ${idMap.drivers.size} migrated`);

  
  for (const t of db.trips || []) {
    const { data: inserted, error } = await supabase.from('trips').insert({
      truck_id: idMap.trucks.get(t.truckId) || null,
      driver_id: idMap.drivers.get(t.driverId) || null,
      container: t.container, container_type: t.ctype, work_type: t.workType,
      origin: t.origin, destination: t.dest,
      shipping_line_id: idMap.shippingLines.get(t.shippingLine) || null,
      status: t.status, start_time: t.startTime, eta: t.eta,
      distance: t.distance, priority: t.priority, notes: t.notes,
      reference: t.ref,
    }).select('id').single();
    if (error) { console.error('trips failed:', t.container, error.message); continue; }
    idMap.trips.set(t.id, inserted.id);
  }
  console.log(`trips: ${idMap.trips.size} migrated`);

  // ── 6. maintenance (references trucks) ──
  let maintCount = 0;
  for (const m of db.maintenance || []) {
    const { error } = await supabase.from('maintenance').insert({
      truck_id: idMap.trucks.get(m.truckId) || null,
      type: m.type, description: m.desc, priority: m.priority, status: m.status,
      date: m.date, cost: m.cost, technician: m.tech, resolved_date: m.resolvedDate,
    });
    if (error) { console.error('maintenance failed:', m.id, error.message); continue; }
    maintCount++;
  }
  console.log(`maintenance: ${maintCount} migrated`);

  // ── 7. fuel_logs ──
  let fuelCount = 0;
  for (const f of db.fuel || []) {
    const { error } = await supabase.from('fuel_logs').insert({
      truck_id: idMap.trucks.get(f.truckId) || null,
      driver_id: idMap.drivers.get(f.driverId) || null,
      date: f.date, litres: f.litres, price_per_litre: f.pricePerLitre,
      station: f.station, odometer: f.odometer, receipt: f.receipt,
    });
    if (error) { console.error('fuel_logs failed:', f.id, error.message); continue; }
    fuelCount++;
  }
  console.log(`fuel_logs: ${fuelCount} migrated`);

  // ── 8. shutouts ──
  let shutoutCount = 0;
  for (const s of db.shutouts || []) {
    const { error } = await supabase.from('shutouts').insert({
      container: s.container, vessel: s.vessel, voyage: s.voyage,
      line_id: idMap.shippingLines.get(s.line) || null,
      date: s.date, status: s.status, reason: s.reason,
      truck_id: idMap.trucks.get(s.truckId) || null,
      driver_id: idMap.drivers.get(s.driverId) || null, notes: s.notes,
    });
    if (error) { console.error('shutouts failed:', s.id, error.message); continue; }
    shutoutCount++;
  }
  console.log(`shutouts: ${shutoutCount} migrated`);

  // ── 9. interchange ──
  let icCount = 0;
  for (const i of db.interchange || []) {
    const { error } = await supabase.from('interchange').insert({
      container: i.container, line_id: idMap.shippingLines.get(i.line) || null,
      date: i.date, type: i.type,
      truck_id: idMap.trucks.get(i.truck) || null,
      driver_id: idMap.drivers.get(i.driver) || null,
      condition: i.condition, notes: i.notes, status: i.status, img: i.img,
    });
    if (error) { console.error('interchange failed:', i.id, error.message); continue; }
    icCount++;
  }
  console.log(`interchange: ${icCount} migrated`);

  // ── 10. requisitions (no FKs — requester is stored as free text) ──
  let reqCount = 0;
  for (const r of db.requisitions || []) {
    const { error } = await supabase.from('requisitions').insert({
      requester: r.requester, category: r.category, items: r.items,
      amount: r.amount, date: r.date, status: r.status, approver: r.approver,
      approved_date: r.approvedDate, notes: r.notes,
    });
    if (error) { console.error('requisitions failed:', r.id, error.message); continue; }
    reqCount++;
  }
  console.log(`requisitions: ${reqCount} migrated`);

  // ── 11. workshop_jobs ──
  let wsCount = 0;
  for (const w of db.workshop || []) {
    const { error } = await supabase.from('workshop_jobs').insert({
      truck_id: idMap.trucks.get(w.truckId) || null,
      title: w.title, description: w.desc, tech: w.tech, status: w.status,
      reported: w.reported, diagnosed: w.diagnosed, parts: w.parts,
      labour: w.labour, total: w.total,
    });
    if (error) { console.error('workshop_jobs failed:', w.id, error.message); continue; }
    wsCount++;
  }
  console.log(`workshop_jobs: ${wsCount} migrated`);

  // ── 12. invoices (capture new ids for invoice_trips join) ──
  for (const i of db.invoices || []) {
    const { data: inserted, error } = await supabase.from('invoices').insert({
      client: i.client, date: i.date, due: i.due, status: i.status,
      subtotal: i.subtotal, vat: i.vat, total: i.total, paid: i.paid,
      ref: i.ref, notes: i.notes,
    }).select('id').single();
    if (error) { console.error('invoices failed:', i.ref, error.message); continue; }
    idMap.invoices.set(i.id, inserted.id);
  }
  console.log(`invoices: ${idMap.invoices.size} migrated`);

  // ── 13. invoice_trips (join table from invoice.trips[] array) ──
  const invoiceTripsRows = [];
  for (const inv of db.invoices || []) {
    const newInvId = idMap.invoices.get(inv.id);
    if (!newInvId) continue;
    for (const oldTripId of inv.trips || []) {
      const newTripId = idMap.trips.get(oldTripId);
      if (newTripId) invoiceTripsRows.push({ invoice_id: newInvId, trip_id: newTripId });
    }
  }
  if (invoiceTripsRows.length) {
    const { error } = await supabase.from('invoice_trips').insert(invoiceTripsRows);
    if (error) console.error('invoice_trips failed:', error.message);
  }
  console.log(`invoice_trips: ${invoiceTripsRows.length} migrated`);

  // ── 14. billing_rates (old: rates keyed by container type string) ──
  const billingRows = Object.entries(db.billingRates || {}).map(([ctype, v]) => ({
    ctype, base: v.base, per_km: v.perKm,
  }));
  if (billingRows.length) {
    const { error } = await supabase.from('billing_rates').upsert(billingRows);
    if (error) console.error('billing_rates failed:', error.message);
  }
  console.log(`billing_rates: ${billingRows.length} migrated`);

  // ── 15. allocation_rules ──
  const allocRows = (db.allocationRules || []).map(r => ({
    name: r.name, description: r.desc, weight: r.weight, active: r.active,
  }));
  if (allocRows.length) {
    const { error } = await supabase.from('allocation_rules').insert(allocRows);
    if (error) console.error('allocation_rules failed:', error.message);
  }
  console.log(`allocation_rules: ${allocRows.length} migrated`);

  // ── 16. tracking_positions (keyed by old truck id in the blob) ──
  const trackingRows = [];
  for (const [oldTruckId, p] of Object.entries(db.trackingPositions || {})) {
    const newTruckId = idMap.trucks.get(oldTruckId);
    if (!newTruckId) continue;
    trackingRows.push({
      truck_id: newTruckId, lat: p.lat, lng: p.lng, speed: p.speed,
      heading: p.heading, zone: p.zone, last_update: p.lastUpdate,
    });
  }
  if (trackingRows.length) {
    const { error } = await supabase.from('tracking_positions').upsert(trackingRows);
    if (error) console.error('tracking_positions failed:', error.message);
  }
  console.log(`tracking_positions: ${trackingRows.length} migrated`);

  // ── 17. audit_log ──
  const auditRows = (db.auditLog || []).map(a => ({
    username: a.user, action: a.action, detail: a.detail, time: a.time,
  }));
  if (auditRows.length) {
    const { error } = await supabase.from('audit_log').insert(auditRows);
    if (error) console.error('audit_log failed:', error.message);
  }
  console.log(`audit_log: ${auditRows.length} migrated`);

  // ── 18. app_settings (single row, update in place) ──
  if (db.settings) {
    const { error } = await supabase.from('app_settings').update({
      company_name: db.settings.companyName,
      backup_date: db.settings.backupDate,
      map_api_key: db.settings.mapApiKey,
      whatsapp: db.settings.whatsapp,
      mpesa: db.settings.mpesa,
    }).eq('id', 1);
    if (error) console.error('app_settings failed:', error.message);
    else console.log('app_settings: updated');
  }

  console.log('\nMigration complete. Verify row counts in Supabase before archiving app_state.');
  console.log('Old ID -> new UUID counts:', {
    trucks: idMap.trucks.size, drivers: idMap.drivers.size,
    trips: idMap.trips.size, shippingLines: idMap.shippingLines.size,
    invoices: idMap.invoices.size,
  });
}

main().catch(e => { console.error(e); process.exit(1); });

