-- Build events are trusted lifecycle records. Client sessions may read events
-- through RLS, but only trusted server/database paths may create them.

drop policy if exists "build authors can create request events" on public.build_events;
revoke insert on table public.build_events from public, anon, authenticated;
