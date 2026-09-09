# KFlipsWhips CRM — README

A production-ready lead/CRM backend for the KFlipsWhips website, built on:
- **Supabase** (Postgres database + Auth)
- **Netlify Functions** (serverless, Node.js) for all privileged database access
- Plain static HTML/CSS/JS for both the public site and the admin app — no build step, no framework, deploys as-is to Netlify

---

## Architecture

```
public/
  index.html          ← public marketing site (your existing design, untouched)
  admin/
    index.html         ← admin CRM app (Supabase Auth login + dashboard)
netlify/
  functions/
    _shared.js         ← Supabase service-role client + auth verification helper
    submit-lead.js     ← PUBLIC: receives contact-form submissions, writes to Supabase
    admin-leads.js     ← ADMIN: list/search/filter leads + dashboard stats
    admin-lead.js      ← ADMIN: get one lead + notes, update fields, add a note
    admin-lead-create.js ← ADMIN: manually add a walk-in/phone lead
supabase/
  schema.sql           ← run once in Supabase's SQL editor
netlify.toml           ← routing + build config
package.json           ← Netlify installs @supabase/supabase-js from this automatically
```

### Data flow

1. A visitor fills out the contact form on `index.html`.
2. The form POSTs to `/api/submit-lead`, which Netlify redirects to the `submit-lead` function.
3. That function validates input, checks a honeypot field and a light duplicate/rate check, then inserts a row into the `leads` table **using the Supabase service role key** (server-side only).
4. You log into `/admin` with your email + password. This calls `supabase.auth.signInWithPassword` directly against Supabase — your password never touches this codebase.
5. Once signed in, the admin app calls `/api/admin-leads`, `/api/admin-lead`, etc., attaching your session's access token as `Authorization: Bearer <token>`.
6. Each of those functions calls `verifyAdmin()`, which asks Supabase's own auth server "is this a valid, current session?" before doing anything. If not, it returns 401 and the admin app sends you back to the login screen.
7. Only after that check passes does the function use the service-role client to read/write `leads` / `lead_notes`.

### Why this is secure

- **No admin password anywhere in the code.** Supabase's Auth service owns credential storage and verification (industry-standard hashing, rate limiting, etc.).
- **The service role key never reaches the browser.** It lives only in Netlify's environment variables and is read inside the functions, which run on Netlify's servers.
- **Row Level Security is set to deny-all** on both tables (see `supabase/schema.sql`). Even if someone got a valid anon key and tried to query the database directly from the browser, RLS blocks it. The only way in is through the authenticated Netlify Functions.
- **Sessions are handled by Supabase's own SDK** (`@supabase/supabase-js` loaded via CDN in `admin/index.html`), which manages short-lived access tokens and automatic refresh. Logging out calls `supabase.auth.signOut()`, which invalidates the local session.

### A note on how sessions are stored

This is a static site + serverless-functions architecture (no server-rendered pages), so the standard approach is: Supabase's client SDK keeps your session (a short-lived JWT) in the browser's local storage, and every admin API call sends it as a bearer token, which gets re-verified server-side on every single request. This is the normal, supported pattern for this kind of architecture and is different from (but not weaker than) a server-rendered app using an httpOnly cookie — the key security property, that a request can't be trusted without Supabase independently validating it, is the same either way.

---

## Local development

There isn't really a "local dev server" needed since this is static HTML + serverless functions. If you have the Netlify CLI installed, `netlify dev` from the project root will run the functions locally and proxy `/api/*` correctly. Otherwise, just deploy to Netlify directly (see below) — every push updates it.

---

## Database migrations

All schema lives in `supabase/schema.sql`. It's written to be safe to re-run (`create table if not exists`, etc.). If you need to change the schema later, add new `alter table` statements to that same file (or a new dated file) rather than editing table definitions in place, so there's always a record of what changed and when.

---

## Backup considerations

Supabase takes automatic daily backups on paid plans; the free tier does not include point-in-time backups. If your lead volume becomes business-critical, consider either upgrading your Supabase plan for backups, or periodically exporting the `leads` table (Supabase Dashboard → Table Editor → Export as CSV).

---

## Troubleshooting

**"Incorrect email or password" but you're sure it's right** — make sure the admin user was actually created in Supabase (Authentication → Users) and that you're using the same project's URL/anon key pasted into `admin/index.html`.

**Leads aren't showing up in `/admin`** — check the Netlify Function logs (Netlify dashboard → your site → Functions → `submit-lead`) for errors, and confirm `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set correctly in Netlify's environment variables.

**"Unauthorized" errors in the admin app right after logging in** — the session token may not have propagated yet; refresh the page. If it persists, check that the `SUPABASE_URL` and `SUPABASE_ANON_KEY` pasted into `admin/index.html` match the same project as the server-side env vars.

**Refreshing `/admin` gives a 404** — check that `netlify.toml`'s redirect for `/admin/*` deployed correctly; it should serve `admin/index.html` for any path under `/admin/`.

See also `docs/CRM_OPERATIONS_LOG.md` for specific issues already resolved during development.
