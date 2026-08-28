-- Increment the admin shared-key throttle atomically so concurrent failed
-- attempts cannot overwrite one another with a lower count.

create or replace function public.register_admin_login_failure(p_fingerprint text)
returns table (failed_attempts smallint, blocked_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.admin_login_attempts%rowtype;
begin
  insert into public.admin_login_attempts (
    fingerprint, failed_attempts, window_started_at, blocked_until, last_attempt_at
  ) values (
    p_fingerprint, 1, now(), null, now()
  )
  on conflict (fingerprint) do update
  set failed_attempts = case
        when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then 1
        else public.admin_login_attempts.failed_attempts + 1
      end,
      window_started_at = case
        when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then now()
        else public.admin_login_attempts.window_started_at
      end,
      blocked_until = case
        when (
          case
            when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then 1
            else public.admin_login_attempts.failed_attempts + 1
          end
        ) >= 5 then now() + interval '15 minutes'
        else null
      end,
      last_attempt_at = now()
  returning * into attempt_row;

  failed_attempts := attempt_row.failed_attempts;
  blocked_until := attempt_row.blocked_until;
  return next;
end;
$$;

revoke execute on function public.register_admin_login_failure(text) from public, anon, authenticated;
grant execute on function public.register_admin_login_failure(text) to service_role;
