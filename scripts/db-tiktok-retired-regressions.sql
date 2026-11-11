-- Synthetic, transactional checks that TikTok is retired. Root harness runs
-- only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  catalog jsonb; failed boolean;
begin
  ---------------------------------------------------------------------------
  -- The definitions stay (history is kept) but leave the catalog.
  ---------------------------------------------------------------------------
  if (select count(*) from public.analytics_metric_definitions where source = 'tiktok') <> 7 then
    raise exception 'TikTok definitions must be kept so logged numbers keep their meaning';
  end if;
  if exists (select 1 from public.analytics_metric_definitions where source = 'tiktok' and active) then
    raise exception 'every TikTok metric must be inactive';
  end if;
  catalog := public.load_analytics_catalog();
  if exists (select 1 from jsonb_array_elements(catalog->'metrics') m where m->>'source' = 'tiktok') then
    raise exception 'retired TikTok metrics must leave the catalog';
  end if;

  ---------------------------------------------------------------------------
  -- Nothing new can be written or charted.
  ---------------------------------------------------------------------------
  begin
    perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', 'tiktok.views', 'date', today, 'value', 10)), 'manual', 'admin');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'retired TikTok metrics must refuse new numbers'; end if;
  begin
    perform public.load_analytics_series(array['tiktok.followers'], 'day', today - 1, today);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'retired TikTok metrics must not be charted'; end if;

  raise notice 'tiktok regressions passed: kept, inactive, out of the catalog, unwritable';
end;
$$;
rollback;
