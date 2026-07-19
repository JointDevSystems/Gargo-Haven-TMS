(function () {
  'use strict';

  const BUCKET = 'booking-documents';
  const DOC_TYPES = ['guarantee_form', 'release_order', 'delivery_order'];


  const OUTBOUND_REQUIRED_DOC_TYPES = ['release_order'];


  const PORT_LOCATIONS = ['Mombasa Port (KPA)', 'APM Terminals', 'APM Terminals Mombasa'];


  function getRequiredDocTypes({ serviceType, origin, destination }) {
    const required = [];
    const originIsPort = PORT_LOCATIONS.indexOf(origin) !== -1;
    const destIsPort = PORT_LOCATIONS.indexOf(destination) !== -1;

    if (serviceType === 'Depot Storage') {
      required.push('guarantee_form');
    }

    if (serviceType === 'Port Haulage' || serviceType === 'Full Transport Package') {
      if (destIsPort && !originIsPort) required.push('release_order');   // going TO port = export
      else if (originIsPort && !destIsPort) required.push('delivery_order'); // coming FROM port = import
      else if (!originIsPort && !destIsPort) required.push('guarantee_form'); // depot-to-depot: container still moves in/out of depot custody at one end
      // both-port case (rare/unlikely) intentionally left unrequired — flag for review if it occurs.

      if (serviceType === 'Full Transport Package' && required.indexOf('guarantee_form') === -1) required.push('guarantee_form');
    }

    return required;
  }

  function client() {
    if (window.ghSupabase) return window.ghSupabase;
    throw new Error('Supabase client not initialised — load script.js first, or provide window.ghSupabase.');
  }

  function assertDocType(docType) {
    if (DOC_TYPES.indexOf(docType) === -1) {
      throw new Error('doc_type must be one of: ' + DOC_TYPES.join(', '));
    }
  }



  async function _uploadDocument({ bookingId, tripId, docType, containerNo, file }) {
    if (!bookingId && !tripId) throw new Error('bookingId or tripId is required');
    if (bookingId && tripId) throw new Error('Provide either bookingId or tripId, not both');
    if (!file) throw new Error('No file selected');
    assertDocType(docType);

    const { data: sessionData } = await client().auth.getSession();
    const userId = sessionData && sessionData.session ? sessionData.session.user.id : null;
    if (!userId) throw new Error('Please sign in before uploading documents.');

    const parentId = bookingId || tripId;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${parentId}/${docType}-${Date.now()}-${safeName}`;

    const { error: uploadErr } = await client()
      .storage.from(BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (uploadErr) throw new Error(uploadErr.message || 'Upload failed — please try again');

    const { data: row, error: insertErr } = await client()
      .from('booking_documents')
      .insert({
        booking_id: bookingId || null,
        trip_id: tripId || null,
        doc_type: docType,
        container_no: containerNo || null,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        file_size_bytes: file.size || null,
        uploaded_by: userId,
      })
      .select('*')
      .single();

    if (insertErr) {

      await client().storage.from(BUCKET).remove([path]).catch(() => {});
      throw new Error(insertErr.message || 'Could not record uploaded document');
    }
    return row;
  }

  async function uploadBookingDocument({ bookingId, docType, containerNo, file }) {
    if (!bookingId) throw new Error('bookingId (booking reference) is required');
    return _uploadDocument({ bookingId, docType, containerNo, file });
  }


  async function uploadTripDocument({ tripId, docType, containerNo, file }) {
    if (!tripId) throw new Error('tripId is required');
    return _uploadDocument({ tripId, docType, containerNo, file });
  }


  async function myBookingDocuments(bookingId) {
    const { data, error } = await client()
      .from('booking_documents')
      .select('*')
      .eq('booking_id', bookingId)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not load documents');
    return data || [];
  }


  async function storageAvailability() {
    const { data, error } = await client()
      .from('depot_storage_availability')
      .select('*')
      .order('zone_name');
    if (error) throw new Error(error.message || 'Could not load storage availability');
    return data || [];
  }


  async function reviewQueue(status) {
    let query = client()
      .from('booking_documents')
      .select('*, public_bookings(id, full_name, company, service_type, container, storage_status)');

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    query = query.order('uploaded_at', { ascending: status === 'pending_review' });

    const { data, error } = await query;
    if (error) throw new Error(error.message || 'Could not load review queue');
    return data || [];
  }

  // Back-compat alias for the original pending-only queue.
  async function pendingReviewQueue() {
    return reviewQueue('pending_review');
  }


  async function documentsForBooking(bookingId) {
    const { data, error } = await client()
      .from('booking_documents')
      .select('*')
      .eq('booking_id', bookingId)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not load documents');
    return data || [];
  }



  async function documentsForBookings(bookingIds) {
    const ids = (bookingIds || []).filter(Boolean);
    if (!ids.length) return {};

    const { data, error } = await client()
      .from('booking_documents')
      .select('*')
      .in('booking_id', ids)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not load documents');

    const byBooking = {};
    (data || []).forEach(function (doc) {
      if (!byBooking[doc.booking_id]) byBooking[doc.booking_id] = [];
      byBooking[doc.booking_id].push(doc);
    });
    return byBooking;
  }


  async function documentsForTrip(tripId) {
    const { data, error } = await client()
      .from('booking_documents')
      .select('*')
      .eq('trip_id', tripId)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not load documents');
    return data || [];
  }

  async function documentsForTrips(tripIds) {
    const ids = (tripIds || []).filter(Boolean);
    if (!ids.length) return {};

    const { data, error } = await client()
      .from('booking_documents')
      .select('*')
      .in('trip_id', ids)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not load documents');

    const byTrip = {};
    (data || []).forEach(function (doc) {
      if (!byTrip[doc.trip_id]) byTrip[doc.trip_id] = [];
      byTrip[doc.trip_id].push(doc);
    });
    return byTrip;
  }


  async function outboundReviewQueue(status) {
    let query = client()
      .from('booking_documents')
      .select('*, trips(id, container, container_type, work_type, origin, destination, status, storage_zone_id, storage_teu, storage_released)')
      .not('trip_id', 'is', null);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    query = query.order('uploaded_at', { ascending: status === 'pending_review' });

    const { data, error } = await query;
    if (error) throw new Error(error.message || 'Could not load outbound review queue');
    return data || [];
  }


  async function readyToProcessBookings() {
    const { data: bookings, error } = await client()
      .from('public_bookings')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message || 'Could not load bookings');

    const list = bookings || [];
    if (!list.length) return [];

    const docsByBooking = await documentsForBookings(list.map(function (b) { return b.id; }));

    return list
      .map(function (b) {
        const required = getRequiredDocTypes({ serviceType: b.service_type, origin: b.pickup_location, destination: b.dropoff_location });
        const docs = docsByBooking[b.id] || [];
        const verifiedTypes = {};
        docs.forEach(function (d) { if (d.status === 'verified') verifiedTypes[d.doc_type] = true; });
        const missing = required.filter(function (rt) { return !verifiedTypes[rt]; });
        return { booking: b, required: required, missing: missing, docs: docs };
      })
      .filter(function (entry) { return entry.required.length > 0 && entry.missing.length === 0; });
  }

 
  async function releaseStorageForTrip(tripId) {
    const { data: trip, error: tripErr } = await client()
      .from('trips')
      .select('id, storage_zone_id, storage_teu, storage_released')
      .eq('id', tripId)
      .single();
    if (tripErr) throw new Error(tripErr.message || 'Trip not found');
    if (!trip.storage_zone_id || !trip.storage_teu) return { released: false, reason: 'no_allocation' };
    if (trip.storage_released) return { released: false, reason: 'already_released' };

    const { data: zone, error: zoneErr } = await client()
      .from('depot_storage_zones')
      .select('*')
      .eq('id', trip.storage_zone_id)
      .single();
    if (zoneErr) throw new Error(zoneErr.message || 'Storage zone not found');

    const newOccupied = Math.max(0, (zone.occupied_teu || 0) - trip.storage_teu);
    const { error: zoneUpdateErr } = await client()
      .from('depot_storage_zones')
      .update({ occupied_teu: newOccupied, updated_at: new Date().toISOString() })
      .eq('id', trip.storage_zone_id);
    if (zoneUpdateErr) throw new Error(zoneUpdateErr.message || 'Could not free storage space');

    const { error: tripUpdateErr } = await client()
      .from('trips')
      .update({ storage_released: true })
      .eq('id', tripId);
    if (tripUpdateErr) throw new Error(tripUpdateErr.message || 'Could not mark storage as released');

    return { released: true };
  }


  async function isStaffMember() {
    try {
      const { data: sessionData } = await client().auth.getSession();
      const userId = sessionData && sessionData.session ? sessionData.session.user.id : null;
      if (!userId) return false;

      const { data, error } = await client()
        .from('staff_members')
        .select('user_id')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();
      if (error) return false;
      return !!data;
    } catch (e) {
      return false;
    }
  }


  async function getDownloadUrl(filePath, expiresInSeconds = 300) {
    const { data, error } = await client()
      .storage.from(BUCKET)
      .createSignedUrl(filePath, expiresInSeconds);
    if (error) throw new Error(error.message || 'Could not generate download link');
    return data.signedUrl;
  }

  async function verifyDocument(documentId, notes) {
    const { data: sessionData } = await client().auth.getSession();
    const reviewerId = sessionData && sessionData.session ? sessionData.session.user.id : null;
    const { error } = await client()
      .from('booking_documents')
      .update({
        status: 'verified',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
      })
      .eq('id', documentId);
    if (error) throw new Error(error.message || 'Could not verify document');

  }

  async function rejectDocument(documentId, notes) {
    if (!notes) throw new Error('A reason is required when rejecting a document');
    const { data: sessionData } = await client().auth.getSession();
    const reviewerId = sessionData && sessionData.session ? sessionData.session.user.id : null;
    const { error } = await client()
      .from('booking_documents')
      .update({
        status: 'rejected',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes,
      })
      .eq('id', documentId);
    if (error) throw new Error(error.message || 'Could not reject document');
  }


  async function allocateStorage(bookingId, zoneId, teu) {
    const { data: zone, error: zoneErr } = await client()
      .from('depot_storage_zones')
      .select('*')
      .eq('id', zoneId)
      .single();
    if (zoneErr) throw new Error(zoneErr.message || 'Zone not found');
    if (zone.capacity_teu - zone.occupied_teu < teu) {
      throw new Error(`Not enough space in ${zone.zone_name} — only ${zone.capacity_teu - zone.occupied_teu} TEU free`);
    }

    const { error: zoneUpdateErr } = await client()
      .from('depot_storage_zones')
      .update({ occupied_teu: zone.occupied_teu + teu, updated_at: new Date().toISOString() })
      .eq('id', zoneId);
    if (zoneUpdateErr) throw new Error(zoneUpdateErr.message || 'Could not reserve storage space');

    const { error: bookingUpdateErr } = await client()
      .from('public_bookings')
      .update({ storage_status: 'allocated', storage_zone_id: zoneId })
      .eq('id', bookingId);
    if (bookingUpdateErr) throw new Error(bookingUpdateErr.message || 'Could not update booking status');
  }

  window.bookingDocs = {
   
    uploadBookingDocument,
    uploadTripDocument,
    myBookingDocuments,
    storageAvailability,
   
    pendingReviewQueue,
    reviewQueue,
    outboundReviewQueue,
    readyToProcessBookings,
    documentsForBooking,
    documentsForBookings,
    documentsForTrip,
    documentsForTrips,
    isStaffMember,
    getDownloadUrl,
    verifyDocument,
    rejectDocument,
    allocateStorage,
    releaseStorageForTrip,
    getRequiredDocTypes,
    DOC_TYPES,
    OUTBOUND_REQUIRED_DOC_TYPES,
    PORT_LOCATIONS,
  };
})();
