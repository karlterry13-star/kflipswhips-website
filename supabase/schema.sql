-- ============================================================
-- KFlipsWhips CRM — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- LEADS ----------
create table if not exists public.leads (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  first_name            text,
  last_name             text,
  full_name             text,
  email                 text,
  phone                 text,
  preferred_contact     text,               -- 'phone' | 'text' | 'email'

  vehicle_interest_raw  text,               -- freeform text from the current site form
  vehicle_make          text,
  vehicle_model         text,
  vehicle_year          text,
  condition_preference  text,               -- 'New' | 'Used' | 'Either'
  budget                text,

  trade_in              boolean default false,
  trade_in_year         text,
  trade_in_make         text,
  trade_in_model        text,
  trade_in_mileage      text,

  message               text,

  lead_source           text default 'Website',
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  utm_term              text,
  landing_page          text,
  referrer              text,

  status                text not null default 'New'
                          check (status in (
                            'New','Contacted','Qualified','Vehicle Search',
                            'Appointment','Negotiating','Sold','Lost'
                          )),
  assigned_user         text,
  last_contacted_date   date,
  next_follow_up        date,

  -- lightweight anti-duplicate/spam helpers
  submitted_ip          text
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_next_follow_up_idx on public.leads (next_follow_up);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_phone_idx on public.leads (phone);

-- keep updated_at current on every change
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

-- ---------- LEAD NOTES (timestamped internal history) ----------
create table if not exists public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  note        text not null,
  created_at  timestamptz not null default now(),
  created_by  text
);

create index if not exists lead_notes_lead_id_idx on public.lead_notes (lead_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- Intentionally locked down to deny-all for every client role.
-- Nothing in the browser (anon key) can read or write these tables,
-- directly, ever. All access goes through Netlify Functions using
-- the SERVICE ROLE key, which bypasses RLS on the server only.
-- ============================================================
alter table public.leads enable row level security;
alter table public.lead_notes enable row level security;
-- No policies are created on purpose — default-deny for anon/authenticated roles.
