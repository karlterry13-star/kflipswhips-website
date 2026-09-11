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

  // Text notification — best effort. A failure here never blocks the lead from being saved,
  // since the lead is already safely in the database at this point.
  try {
    await sendLeadTextAlert(row);
  } catch (e) {
    console.error('SMS notification failed:', e.message);
  }

  // Klaviyo — best effort, same as above. Creates/updates the profile and fires a
  // "Submitted Vehicle Search Quiz" event, which triggers any Klaviyo Flow set to
  // trigger off that metric.
  try {
    await sendToKlaviyo(row);
  } catch (e) {
    console.error('Klaviyo sync failed:', e.message);
  }

  return json(200, { ok: true });
};

async function sendToKlaviyo(lead) {
  const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!apiKey) {
    console.log('Klaviyo not configured — skipping.');
    return;
  }

  const profileAttributes = {
    email: lead.email || undefined,
    phone_number: lead.phone || undefined,
    first_name: lead.first_name || undefined,
    last_name: lead.last_name || undefined,
    properties: {
      vehicle_interest: lead.vehicle_interest_raw || undefined,
      budget: lead.budget || undefined,
      lead_source: lead.lead_source || undefined,
      utm_source: lead.utm_source || undefined,
      utm_medium: lead.utm_medium || undefined,
      utm_campaign: lead.utm_campaign || undefined,
    },
  };

  const eventBody = {
    data: {
      type: 'event',
      attributes: {
        properties: {
          vehicle_interest: lead.vehicle_interest_raw || null,
          budget: lead.budget || null,
          message: lead.message || null,
        },
        metric: {
          data: {
            type: 'metric',
            attributes: { name: 'Submitted Vehicle Search Quiz' },
          },
        },
        profile: { data: { type: 'profile', attributes: profileAttributes } },
        time: new Date().toISOString(),
      },
    },
  };

  const res = await fetch('https://a.klaviyo.com/api/events', {
    method: 'POST',
    headers: {
      'Authorization': `Klaviyo-API-Key ${apiKey}`,
      'Content-Type': 'application/json',
      'revision': '2024-10-15',
    },
    body: JSON.stringify(eventBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Klaviyo error ${res.status}: ${text}`);
  }

  // Optionally also add the profile to a specific List, if you've set one up
  // (useful if your Flow is triggered by list membership rather than this event).
  const listId = process.env.KLAVIYO_LIST_ID;
  if (listId && lead.email) {
    const listRes = await fetch(`https://a.klaviyo.com/api/lists/${listId}/relationships/profiles`, {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${apiKey}`,
        'Content-Type': 'application/json',
        'revision': '2024-10-15',
      },
      body: JSON.stringify({
        data: [{ type: 'profile', attributes: { email: lead.email } }],
      }),
    }).catch(() => null);
    // Non-fatal if this specific call format isn't accepted by your list config —
    // the event above already handles metric-triggered flows regardless.
    if (listRes && !listRes.ok) {
      console.log('Klaviyo list-add skipped/failed (non-fatal):', listRes.status);
    }
  }
}

async function sendLeadTextAlert(lead) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.NOTIFY_PHONE_NUMBER;
  if (!sid || !token || !from || !to) {
    console.log('SMS not configured — skipping notification.');
    return;
  }

  const parts = [
    `New lead: ${lead.full_name || '(no name)'}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.vehicle_interest_raw ? `Wants: ${lead.vehicle_interest_raw}` : null,
    lead.budget ? `Budget: ${lead.budget}` : null,
  ].filter(Boolean);
  const body = parts.join('\n');

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error ${res.status}: ${text}`);
  }
}
