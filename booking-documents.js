'use strict';

const DOC_BUCKET = 'booking-documents';

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

let _docFilter = 'pending_review';
let _docRowsCache = [];
let _docBookingsCache = {};
let _storageZonesCache = [];

function docBadge(status) {
  const meta = DOC_STATUS_META[status] || { cls: 's-off_duty', label: status || '—' };
  return `<span class="sbadge ${meta.cls}">${meta.label}</span>`;
}

function profileName(userId) {
  if (!userId) return null;
  const p = state.db.profiles.find(p => p.id === userId);
  return p ? p.name : null;
}

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
    let q = supabase.from('booking_documents').select('*').order('uploaded_at', { ascending: false });
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
    console.error('Document Verification query failed:', e.message);
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><div class="empty-state-label">Could not load documents</div><div class="empty-state-sub">${sanitize(e.message || 'Check your connection')}</div></div>`;
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
  const uploaderName = profileName(d.uploaded_by);
  const who = uploaderName
    ? sanitize(uploaderName)
    : (booking ? `${sanitize(booking.full_name || 'Unknown')} · ${sanitize(booking.email || '')}` : 'Unknown submitter');
  const cont = d.container_no || booking?.container;
  const contRef = cont
    ? `<span class="mono" style="color:var(--gold);cursor:pointer" onclick="event.stopPropagation();closeModal();showContainerDetail('${sanitize(cont)}')">${sanitize(cont)}</span>`
    : (d.booking_id ? `<span class="mono" style="font-size:10px;color:var(--text-3);cursor:pointer" onclick="event.stopPropagation();showPublicBookingDetail('${d.booking_id}')">Booking ${d.booking_id.slice(0,8)}</span>` : '');

  return `
  <div class="req-card">
    <div class="req-card-head">
      <div>
        <div style="font-size:12.5px;font-weight:700;color:var(--text)">${DOC_TYPE_LABELS[d.doc_type] || d.doc_type}</div>
        <div class="req-meta">${who} · ${fmtDate(d.uploaded_at)}</div>
      </div>
      <div style="text-align:right">${docBadge(d.status)}${contRef ? `<div style="margin-top:4px">${contRef}</div>` : ''}</div>
    </div>
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
async function getDocSignedUrl(filePath) {
  if (!filePath) return null;
  try {
    const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(filePath, 3600);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (e) {
    console.error('Signed URL generation failed:', e.message);
    return null;
  }
}

function docFilePreviewHtml(d, signedUrl) {
  if (!d.file_path) return '<div class="empty-state" style="padding:20px"><div class="empty-state-label">No file attached</div></div>';
  if (!signedUrl) return `<div class="ops-notice" style="margin-bottom:14px">Could not generate a preview link for this file. <button class="modal-btn ghost" onclick="showDocumentDetail('${d.id}')" style="margin-left:8px">Retry</button></div>`;

  const mime = (d.mime_type || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isPdf   = mime === 'application/pdf' || /\.pdf$/i.test(d.file_name || '');

  if (isImage) {
    return `<div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:14px"><img src="${signedUrl}" style="width:100%;display:block;cursor:zoom-in" onclick="window.open('${signedUrl}','_blank')"/></div>`;
  }
  if (isPdf) {
    return `<div class="ops-notice" style="margin-bottom:14px"><span>${sanitize(d.file_name || 'document.pdf')}</span><a href="${signedUrl}" target="_blank" style="margin-left:auto">Open PDF →</a></div>`;
  }
  return `<div class="ops-notice" style="margin-bottom:14px"><span>${sanitize(d.file_name || 'Attached file')}${d.file_size_bytes ? ` · ${Math.round(d.file_size_bytes/1024)} KB` : ''}</span><a href="${signedUrl}" target="_blank" download="${sanitize(d.file_name || 'document')}" style="margin-left:auto">Download →</a></div>`;
}

async function showDocumentDetail(id) {
  const d = _docRowsCache.find(r => r.id === id);
  if (!d) { toast('Document not found — refresh and try again', 'error'); return; }
  const booking = _docBookingsCache[d.booking_id];

  openModal(DOC_TYPE_LABELS[d.doc_type] || 'Document', `<div class="empty-state" style="padding:20px"><div class="empty-state-label">Loading file…</div></div>`);
  const signedUrl = await getDocSignedUrl(d.file_path);

  const uploaderName = profileName(d.uploaded_by);
  const reviewerName = profileName(d.reviewed_by);
  const cont = d.container_no || booking?.container;

  openModal(DOC_TYPE_LABELS[d.doc_type] || 'Document', `
    ${docFilePreviewHtml(d, signedUrl)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="fg" style="margin:0"><label>Status</label><div>${docBadge(d.status)}</div></div>
      <div class="fg" style="margin:0"><label>Uploaded</label><div style="font-size:12px;color:var(--text)">${fmtTime(d.uploaded_at)} · ${fmtDate(d.uploaded_at)}</div></div>
      <div class="fg" style="margin:0"><label>Uploaded By</label><div style="font-size:12px;color:var(--text)">${sanitize(uploaderName || booking?.full_name || '—')}</div></div>
      <div class="fg" style="margin:0"><label>Contact</label><div style="font-size:12px;color:var(--text)">${sanitize(booking?.email || '—')}</div></div>
      <div class="fg" style="margin:0"><label>Container</label><div class="mono" style="font-size:12px;color:var(--gold)">${cont ? `<a href="#" onclick="closeModal();showContainerDetail('${sanitize(cont)}');return false">${sanitize(cont)} →</a>` : '—'}</div></div>
      <div class="fg" style="margin:0"><label>Booking</label><div style="font-size:12px;color:var(--text)">${d.booking_id ? `<a href="#" onclick="showPublicBookingDetail('${d.booking_id}');return false">View Booking →</a>` : '—'}</div></div>
    </div>
    ${d.trip_id ? `<div class="fg"><label>Linked Trip</label><div style="font-size:12px"><a href="#" onclick="closeModal();showTripDetail('${d.trip_id}');return false">View Trip →</a></div></div>` : ''}
    ${d.status !== 'pending_review' ? `
      <div class="fg"><label>Review Notes</label><div style="font-size:12px;color:var(--text-2);padding:10px;background:var(--surface);border-radius:5px">${sanitize(d.review_notes || '—')}</div></div>
      <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-3);margin-bottom:10px">Reviewed by ${sanitize(reviewerName || '—')} · ${d.reviewed_at ? fmtDate(d.reviewed_at) : '—'}</div>
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
    reviewed_by: state.currentUser.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) { toast(`Could not verify — ${error.message}`, 'error', 5000); return; }
  addAudit(state.profile.username, 'Document Verified', `${DOC_TYPE_LABELS[d.doc_type] || d.doc_type} — ${id.slice(0,8)}`);
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
    reviewed_by: state.currentUser.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) { toast(`Could not reject — ${error.message}`, 'error', 5000); return; }
  addAudit(state.profile.username, 'Document Rejected', `${d ? (DOC_TYPE_LABELS[d.doc_type] || d.doc_type) : 'Document'} — ${reason.slice(0,60)}`);
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
    console.error('Storage availability query failed:', e.message);
    el.innerHTML = `<div class="empty-state" style="padding:12px"><div class="empty-state-label">Could not load storage data</div></div>`;
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
    const cap = z.capacity_teu || 0;
    const occ = z.occupied_teu || 0;
    const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;
    const colour = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
    return `<div class="line-card">
      <div class="line-code-badge">${z.active === false ? 'Inactive' : 'Active'}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">${sanitize(z.zone_name)}</div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text-3);margin-bottom:4px"><span>${occ} / ${cap} TEU used</span><span style="color:${colour}">${pct}%</span></div>
      <div class="fsb-track"><div class="fsb-fill" style="width:${pct}%;background:${colour}"></div></div>
      ${isAdmin() ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="tbl-btn" onclick="adjustZoneOccupied('${z.id}',-1)">− Free bay</button>
        <button class="tbl-btn" onclick="adjustZoneOccupied('${z.id}',1)">+ Occupy bay</button>
        <button class="tbl-btn" onclick="toggleZoneActive('${z.id}')">${z.active === false ? 'Reactivate' : 'Deactivate'}</button>
        <button class="tbl-btn" style="color:var(--red)" onclick="deleteStorageZone('${z.id}')">Delete</button>
      </div>` : ''}
    </div>`;
  }).join('')}</div>${addBtn}`;
}

function showAddStorageZoneModal() {
  if (!isAdmin()) { toast('Admin rights required', 'error'); return; }
  openModal('Add Storage Zone', `
    <div class="fg"><label>Zone Name</label><input id="sz_name" placeholder="Yard A — Block 3"/></div>
    <div class="form-row-2">
      <div class="fg"><label>Capacity (TEU)</label><input id="sz_cap" type="number" placeholder="50"/></div>
      <div class="fg"><label>Currently Occupied (TEU)</label><input id="sz_occ" type="number" placeholder="0"/></div>
    </div>
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
    capacity_teu: cap,
    occupied_teu: Math.min(occ, cap),
    active: true,
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
  const cap = z.capacity_teu || 0;
  const next = Math.max(0, Math.min(cap, (z.occupied_teu || 0) + delta));
  if (next === z.occupied_teu) return;
  const { error } = await supabase.from('depot_storage_zones').update({ occupied_teu: next, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast(`Could not update — ${error.message}`, 'error'); return; }
  z.occupied_teu = next;
  renderStorageZoneCards(_storageZonesCache);
}

async function toggleZoneActive(id) {
  if (!isAdmin()) { toast('Admin rights required', 'error'); return; }
  const z = _storageZonesCache.find(z => z.id === id);
  if (!z) return;
  const next = !(z.active !== false);
  const { error } = await supabase.from('depot_storage_zones').update({ active: next, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast(`Could not update — ${error.message}`, 'error'); return; }
  z.active = next;
  addAudit(state.profile.username, 'Storage Zone Status', `${z.zone_name} → ${next ? 'active' : 'inactive'}`);
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

/* ══════════════════════════════════════════════════════════════════
   CROSS-LINKING HOOKS — called directly from script.js (buildBadges,
   buildAlerts, liveSearch, showContainerDetail, showTripDetail,
   renderReport, renderPublicBookings). No monkey-patching: script.js
   contains typeof-guarded calls to these functions by name.
══════════════════════════════════════════════════════════════════ */

async function updateDocVerificationBadge() {
  const badge = document.getElementById('badge-docverification');
  if (!badge || !state.currentUser) return;
  try {
    const { count, error } = await supabase.from('booking_documents').select('id', { count: 'exact', head: true }).eq('status', 'pending_review');
    if (error) throw error;
    badge.textContent = count || '';
    badge.style.display = count ? 'inline' : 'none';
  } catch (e) {
    console.error('Doc badge count failed:', e.message);
    badge.style.display = 'none';
  }
}

async function appendPendingDocAlerts() {
  const list = document.getElementById('alertsList');
  if (!list || !state.currentUser || !isAdmin()) return;
  try {
    const { count, error } = await supabase.from('booking_documents').select('id', { count: 'exact', head: true }).eq('status', 'pending_review');
    if (error) throw error;
    if (!count) return;
    if (list.querySelector('.empty-state')) list.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'alert-item warn';
    row.style.cursor = 'pointer';
    row.onclick = () => { toggleAlerts(); showSection('docverification', document.querySelector('[data-section="docverification"]')); };
    row.innerHTML = `<div class="alert-dot-sm" style="background:var(--amber)"></div><span>${count} document${count===1?'':'s'} awaiting verification</span>`;
    list.appendChild(row);
    const dot = document.getElementById('alertDot');
    if (dot) dot.style.display = 'block';
  } catch (e) { console.warn('Pending doc alert check failed:', e.message); }
}

async function appendDocSearchResults(q) {
  if (!q || q.length < 2 || !isAdmin()) return;
  try {
    const { data, error } = await supabase.from('booking_documents').select('id,doc_type,container_no,status').ilike('container_no', `%${q}%`).limit(3);
    if (error || !data || !data.length) return;
    const panel = document.getElementById('searchResults');
    if (!panel) return;
    data.forEach(d => {
      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `<span class="search-result-type">Document</span><div><div style="font-size:12px;color:var(--text)">${DOC_TYPE_LABELS[d.doc_type]||d.doc_type} — ${sanitize(d.container_no||'—')}</div><div style="font-size:10px;color:var(--text-3)">${d.status.replace('_',' ')}</div></div>`;
      row.onclick = () => {
        panel.style.display = 'none';
        document.getElementById('globalSearch').value = '';
        showSection('docverification', document.querySelector('[data-section="docverification"]'));
        setTimeout(() => showDocumentDetail(d.id), 350);
      };
      panel.appendChild(row);
    });
    panel.style.display = 'block';
  } catch (e) { /* best-effort — search stays silent on failure */ }
}

async function appendContainerLinkedDocuments(cont) {
  if (!isAdmin()) return;
  try {
    const { data, error } = await supabase.from('booking_documents').select('*').ilike('container_no', cont);
    if (error || !data || !data.length) return;
    const body = document.getElementById('modalBody');
    if (!body || body.dataset.container !== cont) return; // modal moved on to something else
    const html = `<div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;color:var(--text-3);text-transform:uppercase;margin:14px 0 8px">Linked Documents (${data.length})</div>` +
      data.map(d => `<div class="activity-row" style="cursor:pointer" onclick="closeModal();showSection('docverification',document.querySelector('[data-section=&quot;docverification&quot;]'));setTimeout(()=>showDocumentDetail('${d.id}'),350)"><div style="flex:1"><div style="font-size:11.5px;color:var(--text)">${DOC_TYPE_LABELS[d.doc_type]||d.doc_type}</div></div>${docBadge(d.status)}</div>`).join('');
    body.insertAdjacentHTML('beforeend', html);
  } catch (e) { /* silent */ }
}

async function appendTripLinkedDocuments(tripId) {
  if (!isAdmin()) return;
  try {
    const { data, error } = await supabase.from('booking_documents').select('*').eq('trip_id', tripId);
    if (error || !data || !data.length) return;
    const body = document.getElementById('modalBody');
    if (!body || body.dataset.tripId !== tripId) return;
    const html = `<div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;color:var(--text-3);text-transform:uppercase;margin:14px 0 8px">Linked Documents (${data.length})</div>` +
      data.map(d => `<div class="activity-row" style="cursor:pointer" onclick="closeModal();showSection('docverification',document.querySelector('[data-section=&quot;docverification&quot;]'));setTimeout(()=>showDocumentDetail('${d.id}'),350)"><div style="flex:1"><div style="font-size:11.5px;color:var(--text)">${DOC_TYPE_LABELS[d.doc_type]||d.doc_type}</div></div>${docBadge(d.status)}</div>`).join('');
    body.insertAdjacentHTML('beforeend', html);
  } catch (e) { /* silent */ }
}

async function renderDocumentsReportTab(out) {
  if (!isAdmin()) { out.innerHTML = '<div class="empty-state"><div class="empty-state-label">Admin rights required</div></div>'; return; }
  out.innerHTML = `<div class="report-block"><h3>Document Verification</h3><div class="empty-state" style="padding:10px 0"><div class="empty-state-label">Loading…</div></div></div>`;
  try {
    const { data, error } = await supabase.from('booking_documents').select('status,doc_type,uploaded_at');
    if (error) throw error;
    const rows = data || [];
    const pending  = rows.filter(r=>r.status==='pending_review').length;
    const verified = rows.filter(r=>r.status==='verified').length;
    const rejected = rows.filter(r=>r.status==='rejected').length;
    const byType = {};
    rows.forEach(r=>{ byType[r.doc_type] = (byType[r.doc_type]||0)+1; });
    out.innerHTML = `
      <div class="report-block">
        <h3>Document Verification Summary</h3>
        ${reportRow('Total Documents', rows.length)}
        ${reportRow('Pending Review', pending)}
        ${reportRow('Verified', verified)}
        ${reportRow('Rejected', rejected)}
      </div>
      <div class="report-block">
        <h3>By Document Type</h3>
        ${Object.entries(byType).map(([t,c])=>reportRow(DOC_TYPE_LABELS[t]||t, c)).join('') || '<div style="color:var(--text-3);font-size:12px">No documents yet</div>'}
      </div>
      <div style="margin-top:4px"><button class="action-btn ghost" onclick="showSection('docverification', document.querySelector('[data-section=&quot;docverification&quot;]'))">Open Document Verification →</button></div>
    `;
  } catch (e) {
    out.innerHTML = `<div class="report-block"><h3>Document Verification</h3><div class="empty-state"><div class="empty-state-label">Could not load — ${sanitize(e.message)}</div></div></div>`;
  }
}

async function attachDocChipsToBookings() {
  const container = document.getElementById('publicBookingsList');
  if (!container) return;
  try {
    const { data, error } = await supabase.from('booking_documents').select('booking_id,status');
    if (error || !data) return;
    const counts = {};
    data.forEach(d => {
      if (!d.booking_id) return;
      const rec = counts[d.booking_id] || { total: 0, pending: 0 };
      rec.total++;
      if (d.status === 'pending_review') rec.pending++;
      counts[d.booking_id] = rec;
    });
    container.querySelectorAll('[data-booking-id]').forEach(card => {
      const rec = counts[card.dataset.bookingId];
      if (!rec || card.querySelector('.doc-chip')) return;
      const chip = document.createElement('span');
      chip.className = `sbadge doc-chip ${rec.pending ? 's-pending' : 's-approved'}`;
      chip.style.marginLeft = '6px';
      chip.textContent = rec.pending ? `${rec.pending} doc(s) pending` : `${rec.total} doc(s) verified`;
      const badgeRow = card.querySelector('span.sbadge');
      if (badgeRow) badgeRow.insertAdjacentElement('afterend', chip);
    });
  } catch (e) { /* silent */ }
}
