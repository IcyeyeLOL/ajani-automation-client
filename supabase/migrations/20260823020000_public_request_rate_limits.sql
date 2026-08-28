-- Shared, atomic throttling for anonymous request saves. A process-local map is
-- ineffective when traffic is spread across multiple serverless instances.

create table public.public_request_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.public_request_rate_limits enable row level security;
revoke all on table public.public_request_rate_limits from public, anon, authenticated;

create function public.consume_public_request_allowance(
  p_fingerprint text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if char_length(p_fingerprint) <> 64
    or p_limit < 1 or p_limit > 1000
    or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit_parameters';
  end if;

  insert into public.public_request_rate_limits (
    fingerprint, window_started_at, request_count, updated_at
  ) values (
    p_fingerprint, now(), 1, now()
  )
  on conflict (fingerprint) do update
  set
    window_started_at = case
      when public.public_request_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else public.public_request_rate_limits.window_started_at
    end,
    request_count = case
      when public.public_request_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else public.public_request_rate_limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

revoke execute on function public.consume_public_request_allowance(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_request_allowance(text, integer, integer) to service_role;

create index public_request_rate_limits_updated_idx
  on public.public_request_rate_limits (updated_at);
