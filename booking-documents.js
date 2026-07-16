'use strict';




const DOC_TYPE_LABELS = {
  guarantee_form: 'Guarantee Form',
  release_order:  'Release Order',
  delivery_order: 'Delivery Order',
};

const DOC_STATUS_META = {
  pending_review: { cls: 's-pending',  label: 'Pending Review' },
  verified:       { cls: 's-approved', label: 'Verified' },
  rejected:       { cls: 's-rejected', label: 'Rejected' },
};

const DOC_SETUP_SQL = `create table if not exists booking_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public_bookings(id) on delete set null,
  document_type text not null check (document_type in ('guarantee_form','release_order','delivery_order')),
  file_name text,
  file_data text,
  status text not null default 'pending_review' check (status in ('pending_review','verified','rejected')),
  submitted_by text,
  submitted_by_email text,
  notes text,
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists depot_storage_zones (
  id uuid primary key default gen_random_uuid(),
  zone_name text not null,
  container_type text default 'General',
  capacity int not null default 0,
  occupied int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);`;

let _docFilter = 'pending_review';
let _docRowsCache = [];
let _docBookingsCache = {};
let _storageZonesCache = [];

function docBadge(status) {
  const meta = DOC_STATUS_META[status] || { cls: 's-off_duty', label: status || '—' };
  return `<span class="sbadge ${meta.cls}">${meta.label}</span>`;
}

function isMissingTableError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return err.code === '42P01' || msg.includes('does not exist') || msg.includes('could not find the table');
}

function copyDocSetupSQL() {
  if (!navigator.clipboard) { toast('Clipboard not available — copy the SQL from booking-documents.js manually', 'warning'); return; }
  navigator.clipboard.writeText(DOC_SETUP_SQL)
    .then(() => toast('Setup SQL copied — paste into Supabase → SQL Editor', 'success'))
    .catch(() => toast('Could not copy — select and copy manually', 'error'));
}

 function docSetupNotice(compact) {
  return `<div class="vault-locked-banner" style="grid-column:1/-1">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A227" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
    <div>
      <div class="title">${compact ? 'Storage zones not set up' : 'Document Verification not set up'}</div>
      <div class="desc">${compact ? "The 'depot_storage_zones' table" : "The 'booking_documents' / 'depot_storage_zones' tables"} don't exist in Supabase yet. Run the setup SQL, then hit Refresh.</div>
      <button class="action-btn ghost" style="margin-top:10px" onclick="copyDocSetupSQL()">⧉ Copy Setup SQL</button>
    </div>
  </div>`;


/* ── Section entry point ──────────────────────────────────────────── */
async function renderDocVerification() {
  if (!isAdmin()) { toast("You don't have access to this section", 'error'); return; }
  await Promise.all([ renderStorageAvailability(), renderDocList() ]);
}

function filterDocVerification(filter, btn) {
  _docFilter = filter;
  document.querySelectorAll('#sec-docverification .filter-row .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDocList();
}

/* ── Document list ─────────────────────────────────────────────────── */
async function renderDocList() {
  const el = document.getElementById('docVerificationList');
  if (!el) return;
  el.innerHTML = `<div class="empty-state"><div class="empty-state-label">Loading documents…</div></div>`;

  try {
    let q = supabase.from('booking_documents').select('*').order('created_at', { ascending: false });
    if (_docFilter !== 'all') q = q.eq('status', _docFilter);
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    _docRowsCache = rows;

    const bookingIds = [...new Set(rows.map(r => r.booking_id).filter(Boolean))];
    _docBookingsCache = {};
    if (bookingIds.length) {
      const { data: bookings, error: bErr } = await supabase.from('public_bookings').select('*').in('id', bookingIds);
      if (!bErr && bookings) bookings.forEach(b => { _docBookingsCache[b.id] = b; });
    }

    renderDocListRows(rows);
  } catch (e) {
    if (isMissingTableError(e)) {
      el.innerHTML = docSetupNotice(false);
    } else {
      console.error('Document Verification query failed:', e.message);
      el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><div class="empty-state-label">Could not load documents</div><div class="empty-state-sub">${sanitize(e.message || 'Check your connection')}</div></div>`;
    }
  }
}

function renderDocListRows(rows) {
  const el = document.getElementById('docVerificationList');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><div class="empty-state-label">No documents in this filter</div></div>`;
    return;
  }
  el.innerHTML = rows.map(docRowHtml).join('');
}

function docRowHtml(d) {
  const booking = _docBookingsCache[d.booking_id];
  const who = booking
    ? `${sanitize(booking.full_name || 'Unknown')} · ${sanitize(booking.email || '')}`
    : (d.submitted_by ? sanitize(d.submitted_by) : 'Unknown submitter');
  const contRef = booking?.container
    ? `<span class="mono" style="color:var(--gold)">${sanitize(booking.container)}</span>`
    : (d.booking_id ? `<span class="mono" style="font-size:10px;color:var(--text-3)">Booking ${d.booking_id.slice(0,8)}</span>` : '');

  return `
  <div class="req-card">
    <div class="req-card-head">
      <div>
        <div style="font-size:12.5px;font-weight:700;color:var(--text)">${DOC_TYPE_LABELS[d.document_type] || d.document_type}</div>
        <div class="req-meta">${who} · ${fmtDate(d.created_at)}</div>
      </div>
      <div style="text-align:right">${docBadge(d.status)}${contRef ? `<div style="margin-top:4px">${contRef}</div>` : ''}</div>
    </div>
    ${d.notes ? `<div class="req-items">${sanitize(d.notes)}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="modal-btn ghost" onclick="showDocumentDetail('${d.id}')">View</button>
      ${d.status === 'pending_review' ? `
        <button class="modal-btn success" onclick="verifyDocument('${d.id}')">Verify</button>
        <button class="modal-btn danger" onclick="promptRejectDocument('${d.id}')">Reject</button>
      ` : ''}
    </div>
  </div>`;
}

/* ── Document detail modal ────────────────────────────────────────── */
function docFilePreviewHtml(d) {
  if (!d.file_data) return '<div class="empty-state" style="padding:20px"><div class="empty-state-label">No file attached</div></div>';
  const isImage = /^data:image\//.test(d.file_data);
  const isPdf   = /^data:application\/pdf/.test(d.file_data) || /\.pdf$/i.test(d.file_name || '');
  if (isImage) {
    return `<div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:14px"><img src="${d.file_data}" style="width:100%;display:block;cursor:zoom-in" onclick="window.open('${d.file_data}','_blank')"/></div>`;
  }
  if (isPdf) {
    return `<div class="ops-notice" style="margin-bottom:14px"><span>${sanitize(d.file_name || 'document.pdf')}</span><a href="${d.file_data}" target="_blank" style="margin-left:auto">Open PDF →</a></div>`;
  }
  return `<div class="ops-notice" style="margin-bottom:14px"><span>${sanitize(d.file_name || 'Attached file')}</span><a href="${d.file_data}" target="_blank" download="${sanitize(d.file_name || 'document')}" style="margin-left:auto">Download →</a></div>`;
}

function showDocumentDetail(id) {
  const d = _docRowsCache.find(r => r.id === id);
  if (!d) { toast('Document not found — refresh and try again', 'error'); return; }
  const booking = _docBookingsCache[d.booking_id];

  openModal(DOC_TYPE_LABELS[d.document_type] || 'Document', `
    ${docFilePreviewHtml(d)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="fg" style="margin:0"><label>Status</label><div>${docBadge(d.status)}</div></div>
      <div class="fg" style="margin:0"><label>Submitted</label><div style="font-size:12px;color:var(--text)">${fmtTime(d.created_at)} · ${fmtDate(d.created_at)}</div></div>
      <div class="fg" style="margin:0"><label>Submitted By</label><div style="font-size:12px;color:var(--text)">${sanitize(d.submitted_by || booking?.full_name || '—')}</div></div>
      <div class="fg" style="margin:0"><label>Contact</label><div style="font-size:12px;color:var(--text)">${sanitize(d.submitted_by_email || booking?.email || '—')}</div></div>
      ${booking ? `
      <div class="fg" style="margin:0"><label>Container</label><div class="mono" style="font-size:12px;color:var(--gold)">${sanitize(booking.container || '—')}</div></div>
      <div class="fg" style="margin:0"><label>Service Type</label><div style="font-size:12px;color:var(--text)">${sanitize(booking.service_type || '—')}</div></div>
      ` : `<div class="fg" style="margin:0;grid-column:1/-1"><label>Booking Reference</label><div style="font-size:12px;color:var(--text-3)">${d.booking_id ? `#${d.booking_id.slice(0,8)} (booking record not found)` : 'Not linked to a booking'}</div></div>`}
    </div>
    ${d.notes ? `<div class="fg"><label>Submitter Notes</label><div style="font-size:12px;color:var(--text-2);padding:10px;background:var(--surface);border-radius:5px">${sanitize(d.notes)}</div></div>` : ''}
    ${d.status !== 'pending_review' ? `
      <div class="fg"><label>Review Notes</label><div style="font-size:12px;color:var(--text-2);padding:10px;background:var(--surface);border-radius:5px">${sanitize(d.review_notes || '—')}</div></div>
      <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-3);margin-bottom:10px">Reviewed by ${sanitize(d.reviewed_by || '—')} · ${d.reviewed_at ? fmtDate(d.reviewed_at) : '—'}</div>
    ` : ''}
    ${d.status === 'pending_review' ? `
      <div style="display:flex;gap:8px;padding-top:12px;border-top:1px solid var(--border)">
        <button class="modal-btn success" onclick="verifyDocument('${d.id}')">Verify Document</button>
        <button class="modal-btn danger" onclick="promptRejectDocument('${d.id}')">Reject Document</button>
      </div>
    ` : ''}
  `);
}

/* ── Verify / reject actions ──────────────────────────────────────── */
async function verifyDocument(id) {
  if (!isAdmin()) { toast('Admin rights required', 'error'); return; }
  const d = _docRowsCache.find(r => r.id === id);
  if (!d) { toast('Document not found', 'error'); return; }
  toast('Saving…', 'info', 1200);
  const { error } = await supabase.from('booking_documents').update({
    status: 'verified',
    reviewed_by: state.profile.username,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) { toast(`Could not verify — ${error.message}`, 'error', 5000); return; }
  addAudit(state.profile.username, 'Document Verified', `${DOC_TYPE_LABELS[d.document_type] || d.document_type} — ${id.slice(0,8)}`);
  closeModal();
  toast('Document verified', 'success');
  renderDocList();
}

function promptRejectDocument(id) {
  openModal('Reject Document', `
    <div class="ops-notice" style="margin-bottom:12px">This marks the document as rejected. The clearing agent/forwarder who submitted it should be notified to re-upload.</div>
    <div class="fg"><label>Reason for rejection</label><textarea id="doc_reject_reason" rows="3" placeholder="e.g. Illegible scan, wrong booking reference, expired guarantee…"></textarea></div>
    <button class="submit-btn" style="background:var(--red)" onclick="rejectDocument('${id}')">Reject Document →</button>
  `);
}

async function rejectDocument(id) {
  const reason = document.getElementById('doc_reject_reason')?.value.trim();
  if (!reason) { toast('A rejection reason is required', 'error'); return; }
  const d = _docRowsCache.find(r => r.id === id);
  toast('Saving…', 'info', 1200);
  const { error } = await supabase.from('booking_documents').update({
    status: 'rejected',
    review_notes: sanitize(reason),
    reviewed_by: state.profile.username,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) { toast(`Could not reject — ${error.message}`, 'error', 5000); return; }
  addAudit(state.profile.username, 'Document Rejected', `${d ? (DOC_TYPE_LABELS[d.document_type] || d.document_type) : 'Document'} — ${reason.slice(0,60)}`);
  closeModal();
  toast('Document rejected', 'warning');
  renderDocList();
}

/* ── Depot storage availability ───────────────────────────────────── */
async function renderStorageAvailability() {
  const el = document.getElementById('storageAvailabilityList');
  if (!el) return;
  try {
    const { data, error } = await supabase.from('depot_storage_zones').select('*').order('zone_name', { ascending: true });
    if (error) throw error;
    _storageZonesCache = data || [];
    renderStorageZoneCards(_storageZonesCache);
  } catch (e) {
    if (isMissingTableError(e)) {
      el.innerHTML = docSetupNotice(true);
    } else {
      console.error('Storage availability query failed:', e.message);
      el.innerHTML = `<div class="empty-state" style="padding:12px"><div class="empty-state-label">Could not load storage data</div></div>`;
    }
  }
}

function renderStorageZoneCards(zones) {
  const el = document.getElementById('storageAvailabilityList');
  if (!el) return;
  const addBtn = isAdmin() ? `<button class="action-btn ghost" style="margin-top:10px" onclick="showAddStorageZoneModal()">+ Add Storage Zone</button>` : '';
  if (!zones.length) {
    el.innerHTML = `<div class="empty-state" style="padding:10px 0"><div class="empty-state-label">No storage zones configured yet</div></div>${addBtn}`;
    return;
  }
  el.innerHTML = `<div class="truck-grid">${zones.map(z => {
    const pct = z.capacity > 0 ? Math.min(100, Math.round((z.occupied / z.capacity) * 100)) : 0;
    const colour = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
    return `<div class="line-card">
      <div class="line-code-badge">${sanitize(z.container_type || 'General')}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">${sanitize(z.zone_name)}</div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text-3);margin-bottom:4px"><span>${z.occupied} / ${z.capacity} used</span><span style="color:${colour}">${pct}%</span></div>
      <div class="fsb-track"><div class="fsb-fill" style="width:${pct}%;background:${colour}"></div></div>
      ${isAdmin() ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="tbl-btn" onclick="adjustZoneOccupied('${z.id}',-1)">− Free bay</button>
        <button class="tbl-btn" onclick="adjustZoneOccupied('${z.id}',1)">+ Occupy bay</button>
        <button class="tbl-btn" style="color:var(--red)" onclick="deleteStorageZone('${z.id}')">Delete</button>
      </div>` : ''}
    </div>`;
  }).join('')}</div>${addBtn}`;
}

function showAddStorageZoneModal() {
  if (!isAdmin()) { toast('Admin rights required', 'error'); return; }
  openModal('Add Storage Zone', `
    <div class="form-row-2">
      <div class="fg"><label>Zone Name</label><input id="sz_name" placeholder="Yard A — Block 3"/></div>
      <div class="fg"><label>Container Type</label><input id="sz_type" placeholder="General / Reefer / Hazmat"/></div>
    </div>
    <div class="form-row-2">
      <div class="fg"><label>Capacity (TEU)</label><input id="sz_cap" type="number" placeholder="50"/></div>
      <div class="fg"><label>Currently Occupied</label><input id="sz_occ" type="number" placeholder="0"/></div>
    </div>
    <div class="fg"><label>Notes</label><input id="sz_notes" placeholder="Optional…"/></div>
    <button class="submit-btn" onclick="saveStorageZone()">Add Zone →</button>
  `);
}

async function saveStorageZone() {
  const name = document.getElementById('sz_name').value.trim();
  const cap  = Math.max(0, parseInt(document.getElementById('sz_cap').value) || 0);
  if (!name || !cap) { toast('Zone name and capacity are required', 'error'); return; }
  const occ = Math.max(0, parseInt(document.getElementById('sz_occ').value) || 0);
  const row = {
    zone_name: sanitize(name),
    container_type: sanitize(document.getElementById('sz_type').value.trim()) || 'General',
    capacity: cap,
    occupied: Math.min(occ, cap),
    notes: sanitize(document.getElementById('sz_notes').value.trim()),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('depot_storage_zones').insert(row);
  if (error) { toast(`Could not save zone — ${error.message}`, 'error', 5000); return; }
  addAudit(state.profile.username, 'Storage Zone Added', name);
  closeModal();
  toast('Storage zone added', 'success');
  renderStorageAvailability();
}

async function adjustZoneOccupied(id, delta) {
  if (!isAdmin()) { toast('Admin rights required', 'error'); return; }
  const z = _storageZonesCache.find(z => z.id === id);
  if (!z) return;
  const next = Math.max(0, Math.min(z.capacity, z.occupied + delta));
  if (next === z.occupied) return;
  const { error } = await supabase.from('depot_storage_zones').update({ occupied: next, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast(`Could not update — ${error.message}`, 'error'); return; }
  z.occupied = next;
  renderStorageZoneCards(_storageZonesCache);
}

async function deleteStorageZone(id) {
  if (!isAdmin()) { toast('Admin rights required', 'error'); return; }
  if (!confirm('Delete this storage zone?')) return;
  const { error } = await supabase.from('depot_storage_zones').delete().eq('id', id);
  if (error) { toast(`Could not delete — ${error.message}`, 'error'); return; }
  addAudit(state.profile.username, 'Storage Zone Deleted', id);
  toast('Zone deleted', 'success');
  renderStorageAvailability();
}

/* ── Wire into the core app without touching script.js ────────────── */
sectionRenderers.docverification = renderDocVerification;
SECTION_META.docverification = ['Operations', 'Document Verification'];

const _origBuildBadgesForDocs = buildBadges;
buildBadges = function () {
  _origBuildBadgesForDocs();
  updateDocVerificationBadge();
};

async function updateDocVerificationBadge() {
  const badge = document.getElementById('badge-docverification');
  if (!badge || !state.currentUser) return;
  try {
    const { count, error } = await supabase.from('booking_documents').select('id', { count: 'exact', head: true }).eq('status', 'pending_review');
    if (error) throw error;
    badge.textContent = count || '';
    badge.style.display = count ? 'inline' : 'none';
  } catch (e) {
    // Table probably isn't set up yet — fail silently rather than
    // spamming the console every time badges refresh.
    badge.style.display = 'none';
  }
}
