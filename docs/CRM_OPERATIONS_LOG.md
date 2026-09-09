# CRM Operations Log

Running log of issues discovered and permanent rules for future work on this codebase.

---

### Environment constraint: no live network access during development
**Problem:** The environment this project was built in has no internet access — cannot create a Supabase project, run `npm install`, deploy to Netlify, or submit a real test lead.
**Cause:** Sandboxed build environment.
**Solution:** All code was written to be correct by inspection and validated with `node --check` on every function and inline script (all passed). Live end-to-end verification (real Supabase project + real deploy) must be done by the site owner after deployment, following the test checklist in README-CRM.md.
**Rule:** Never claim a live integration has been "tested" unless it was actually run against a live Supabase project and a live Netlify deploy. State clearly what was verified (syntax, logic, schema) versus what still needs the owner's own test pass.

---

### Admin authentication: Supabase Auth, not a custom password
**Problem:** An earlier version of this CRM (before Supabase was introduced) used a hardcoded client-side password string to gate the admin view. That is not secure — anyone viewing page source finds the password.
**Cause:** Was built before a real backend/auth provider was wired in.
**Solution:** Replaced entirely with Supabase Auth (`supabase.auth.signInWithPassword`). No password of any kind lives in the code. Every admin API call is verified server-side against Supabase's own auth server via the Netlify Functions in `netlify/functions/_shared.js`.
**Rule:** Never reintroduce a hardcoded password or client-side-only auth check for `/admin`. All admin data access must go through a Netlify Function that calls `verifyAdmin()`.

---

### Service role key exposure
**Problem:** The Supabase service role key bypasses Row Level Security entirely. If it ever ends up in a file served to the browser, anyone can read/write/delete all lead data.
**Rule:** The service role key is read only via `process.env.SUPABASE_SERVICE_ROLE_KEY` inside `netlify/functions/_shared.js`, and only used inside Netlify Functions (server-side). Never reference it in anything under `public/`. The browser only ever sees `SUPABASE_URL` and `SUPABASE_ANON_KEY`, which are safe to expose because RLS denies all direct table access to the anon role — the anon key can only be used to sign in.

---

### Row Level Security is intentionally "deny all"
**Problem/Decision:** It might seem like RLS policies are "missing" from `supabase/schema.sql`.
**Explanation:** This is deliberate. No policies are created for `anon` or `authenticated` roles, so by default nobody can read or write `leads` or `lead_notes` directly from the browser — not even a logged-in admin's session token, if someone tried to query Supabase directly from client JS. All access goes through the Netlify Functions using the service role key.
**Rule:** Do not add permissive RLS policies later "to make development easier." If direct client access to the database is ever genuinely needed, add a narrowly-scoped policy (e.g., `authenticated` can `select` where `assigned_user = auth.uid()`) rather than a broad one, and document why here.

---

_Review this file before making further changes to the CRM._
