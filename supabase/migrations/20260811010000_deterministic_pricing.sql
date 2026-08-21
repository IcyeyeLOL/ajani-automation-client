-- Pricing is data-driven and auditable. No AI or browser client can assign a
-- quote. The trusted pricing worker reads these rows and inserts reviewed quotes.

create table public.pricing_modules (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  module_key text not null,
  display_name text not null,
  complexity_points integer not null check (complexity_points >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vertical, module_key)
);

create table public.build_request_quotes (
  id uuid primary key default gen_random_uuid(),
  build_request_id uuid not null unique references public.build_requests(id) on delete cascade,
  pricing_version text not null default 'v1',
  tier text not null check (tier in ('clean_match', 'guided_custom', 'custom')),
  selected_modules jsonb not null default '[]'::jsonb,
  complexity_score integer not null check (complexity_score >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by text references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_review_consistency check (
    (review_status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (review_status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create trigger pricing_modules_set_updated_at before update on public.pricing_modules for each row execute function public.set_updated_at();
create trigger build_request_quotes_set_updated_at before update on public.build_request_quotes for each row execute function public.set_updated_at();

alter table public.pricing_modules enable row level security;
alter table public.build_request_quotes enable row level security;

create policy "organization members can read their reviewed quotes" on public.build_request_quotes
  for select to authenticated
  using (exists (
    select 1 from public.build_requests request
    where request.id = build_request_id and public.is_org_member(request.organization_id)
  ));
