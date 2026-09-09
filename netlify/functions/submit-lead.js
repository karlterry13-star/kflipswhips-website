const { getServiceClient, json, corsHeaders } = require('./_shared');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen || 300);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { ok: false, error: 'Invalid request.' });
  }

  // ---- Honeypot: a hidden field named "company_website" that real visitors never fill in.
  // Bots that auto-fill every field will trip it. We return a normal success response
  // (so the bot doesn't learn anything) but never write a row.
  if (body.company_website) {
    return json(200, { ok: true });
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const vehicleInterest = clean(body.vehicleInterest, 300);
  const budget = clean(body.budget, 60);

  if (!name || (!email && !phone)) {
    return json(400, { ok: false, error: 'Please include your name and a phone number or email.' });
  }
  if (email && !EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: 'That email address doesn\'t look right.' });
  }

  const parts = name.split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    console.error('Config error:', e.message);
    return json(500, { ok: false, error: 'Something went wrong. Please call or text us instead.' });
  }

  // ---- Best-effort duplicate guard: same email/phone in the last 10 minutes = don't double-insert
  // (handles accidental double-submits / double-clicks, not a security control).
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let dupQuery = supabase.from('leads').select('id').gte('created_at', tenMinAgo).limit(1);
    if (email) dupQuery = dupQuery.eq('email', email);
    else dupQuery = dupQuery.eq('phone', phone);
    const { data: dup } = await dupQuery;
    if (dup && dup.length > 0) {
      return json(200, { ok: true });
    }
  } catch (e) {
    // if the duplicate check itself fails, don't block the real submission over it
    console.error('Duplicate check failed:', e.message);
  }

  // ---- Best-effort rate limit: more than 5 submissions from the same IP in 5 minutes = reject.
  // NOTE: this is a simple database-backed check, not true infrastructure-level rate limiting.
  // For stronger protection against a determined bot, add Netlify's rate limiting or a
  // Turnstile/CAPTCHA challenge on the form (the code is structured so that's a drop-in addition —
  // see the TODO below).
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('leads')
      .select('id')
      .eq('submitted_ip', ip)
      .gte('created_at', fiveMinAgo);
    if (recent && recent.length >= 5) {
      return json(429, { ok: false, error: 'Too many submissions. Please try again shortly.' });
    }
  } catch (e) {
    console.error('Rate limit check failed:', e.message);
  }

  // TODO (optional, later): verify a Cloudflare Turnstile / reCAPTCHA token here before inserting.

  const row = {
    first_name: firstName,
    last_name: lastName,
    full_name: name,
    email: email || null,
    phone: phone || null,
    vehicle_interest_raw: vehicleInterest || null,
    budget: budget || null,
    message: clean(body.message, 2000) || null,
    lead_source: clean(body.lead_source, 60) || 'Website',
    utm_source: clean(body.utm_source, 100) || null,
    utm_medium: clean(body.utm_medium, 100) || null,
    utm_campaign: clean(body.utm_campaign, 100) || null,
    utm_content: clean(body.utm_content, 100) || null,
    utm_term: clean(body.utm_term, 100) || null,
    landing_page: clean(body.landing_page, 300) || null,
    referrer: clean(body.referrer, 300) || null,
    status: 'New',
    submitted_ip: ip,
  };

  const { error } = await supabase.from('leads').insert(row);
  if (error) {
    console.error('Insert failed:', error.message);
    return json(500, { ok: false, error: 'Something went wrong. Please call or text us instead.' });
  }

  return json(200, { ok: true });
};
