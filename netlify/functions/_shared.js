const { createClient } = require('@supabase/supabase-js');

// Server-only client. SUPABASE_SERVICE_ROLE_KEY must NEVER be sent to the browser —
// it is only ever read here, inside a Netlify Function that runs on Netlify's servers.
function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Verifies the admin's session token (sent by the browser as "Authorization: Bearer <token>")
// against Supabase's own auth server. This is the server-side validation the spec requires —
// the browser can't fake this, because it doesn't have anything Supabase will accept as valid
// unless the person actually signed in with a correct email + password.
async function verifyAdmin(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { user: null, error: 'Missing authorization token.' };

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) {
    return { user: null, error: 'Invalid or expired session.' };
  }
  return { user: data.user, error: null };
}

function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

module.exports = { getServiceClient, verifyAdmin, corsHeaders, json };
