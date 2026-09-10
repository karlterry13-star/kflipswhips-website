const { getServiceClient, verifyAdmin, json, corsHeaders } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' });
  }

  const { user, error: authError } = await verifyAdmin(event);
  if (!user) return json(401, { ok: false, error: authError || 'Unauthorized.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'Invalid request.' }); }

  const name = (body.name || '').trim();
  if (!name) return json(400, { ok: false, error: 'Name is required.' });

  const parts = name.split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  const supabase = getServiceClient();
  const row = {
    first_name: firstName,
    last_name: lastName,
    full_name: name,
    email: (body.email || '').trim() || null,
    phone: (body.phone || '').trim() || null,
    vehicle_interest_raw: (body.vehicleInterest || '').trim() || null,
    budget: (body.budget || '').trim() || null,
   status: body.status || 'New',
    lead_source: body.source || 'Manual / Staff entry',
    next_follow_up: body.nextFollowUp || null,
    message: (body.notes || '').trim() || null,
  };

  const { data, error } = await supabase.from('leads').insert(row).select().single();
  if (error) {
    console.error('Manual lead insert failed:', error.message);
    return json(500, { ok: false, error: 'Could not create lead.' });
  }
  return json(200, { ok: true, lead: data });
};
