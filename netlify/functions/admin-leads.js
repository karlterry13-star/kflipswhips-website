const { getServiceClient, verifyAdmin, json, corsHeaders } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { ok: false, error: 'Method not allowed.' });
  }

  const { user, error: authError } = await verifyAdmin(event);
  if (!user) return json(401, { ok: false, error: authError || 'Unauthorized.' });

  const supabase = getServiceClient();
  const q = event.queryStringParameters || {};

  let query = supabase.from('leads').select('*').order('created_at', { ascending: false });

  if (q.status) query = query.eq('status', q.status);
  if (q.source) query = query.eq('lead_source', q.source);
  if (q.make) query = query.ilike('vehicle_make', `%${q.make}%`);
  if (q.model) query = query.ilike('vehicle_model', `%${q.model}%`);
  if (q.dateFrom) query = query.gte('created_at', q.dateFrom);
  if (q.dateTo) query = query.lte('created_at', q.dateTo);
  if (q.search) {
    const s = q.search.replace(/[%_]/g, '');
    query = query.or(
      `full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,vehicle_interest_raw.ilike.%${s}%,vehicle_make.ilike.%${s}%,vehicle_model.ilike.%${s}%`
    );
  }

  const { data: leads, error } = await query.limit(500);
  if (error) {
    console.error('List query failed:', error.message);
    return json(500, { ok: false, error: 'Could not load leads.' });
  }

  // Dashboard stats computed over the FULL table, not just the filtered/paged view.
  const { data: allLeads, error: statsError } = await supabase
    .from('leads')
    .select('status, next_follow_up');

  let stats = { total: 0, newLeads: 0, needsFollowUp: 0, contacted: 0, appointments: 0, sold: 0, lost: 0 };
  if (!statsError && allLeads) {
    const today = new Date().toISOString().slice(0, 10);
    stats.total = allLeads.length;
    stats.newLeads = allLeads.filter((l) => l.status === 'New').length;
    stats.contacted = allLeads.filter((l) => l.status === 'Contacted').length;
    stats.appointments = allLeads.filter((l) => l.status === 'Appointment').length;
    stats.sold = allLeads.filter((l) => l.status === 'Sold').length;
    stats.lost = allLeads.filter((l) => l.status === 'Lost').length;
    stats.needsFollowUp = allLeads.filter(
      (l) => l.next_follow_up && l.next_follow_up <= today && !['Sold', 'Lost'].includes(l.status)
    ).length;
  }

  return json(200, { ok: true, leads, stats });
};
