const { getServiceClient, verifyAdmin, json, corsHeaders } = require('./_shared');

const VALID_STATUSES = [
  'New', 'Contacted', 'Qualified', 'Vehicle Search',
  'Appointment', 'Negotiating', 'Sold', 'Lost',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const { user, error: authError } = await verifyAdmin(event);
  if (!user) return json(401, { ok: false, error: authError || 'Unauthorized.' });

  const supabase = getServiceClient();

  // ---- GET: fetch one lead + its notes ----
  if (event.httpMethod === 'GET') {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { ok: false, error: 'Missing lead id.' });

    const { data: lead, error: leadErr } = await supabase.from('leads').select('*').eq('id', id).single();
    if (leadErr || !lead) return json(404, { ok: false, error: 'Lead not found.' });

    const { data: notes } = await supabase
      .from('lead_notes')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false });

    return json(200, { ok: true, lead, notes: notes || [] });
  }

  // ---- PATCH: update fields on a lead (status, follow-up date, contacted date, assigned user) ----
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'Invalid request.' }); }

    const { id, ...updates } = body;
    if (!id) return json(400, { ok: false, error: 'Missing lead id.' });

    const allowed = {};
    if (updates.status !== undefined) {
      if (!VALID_STATUSES.includes(updates.status)) {
        return json(400, { ok: false, error: 'Invalid status value.' });
      }
      allowed.status = updates.status;
    }
    if (updates.next_follow_up !== undefined) allowed.next_follow_up = updates.next_follow_up || null;
    if (updates.last_contacted_date !== undefined) allowed.last_contacted_date = updates.last_contacted_date || null;
    if (updates.assigned_user !== undefined) allowed.assigned_user = String(updates.assigned_user).slice(0, 100);

    if (Object.keys(allowed).length === 0) {
      return json(400, { ok: false, error: 'No valid fields to update.' });
    }

    const { data, error } = await supabase.from('leads').update(allowed).eq('id', id).select().single();
    if (error) {
      console.error('Update failed:', error.message);
      return json(500, { ok: false, error: 'Could not update lead.' });
    }
    return json(200, { ok: true, lead: data });
  }

  // ---- POST: add a timestamped internal note ----
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'Invalid request.' }); }

    const { id, note } = body;
    if (!id || !note || !note.trim()) {
      return json(400, { ok: false, error: 'Missing lead id or note text.' });
    }

    const { data, error } = await supabase
      .from('lead_notes')
      .insert({ lead_id: id, note: note.trim().slice(0, 2000), created_by: user.email || 'admin' })
      .select()
      .single();

    if (error) {
      console.error('Note insert failed:', error.message);
      return json(500, { ok: false, error: 'Could not save note.' });
    }
    return json(200, { ok: true, note: data });
  }

  return json(405, { ok: false, error: 'Method not allowed.' });
};
