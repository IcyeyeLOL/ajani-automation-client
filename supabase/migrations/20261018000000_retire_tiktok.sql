-- TikTok retired (2026-10-18).
--
-- The owner asked for the TikTok section to be removed: the agency doesn't
-- post there. Like X, its definitions become inactive, so TikTok leaves
-- Trends, Log numbers, Import numbers and the ingest endpoint, and nothing new
-- can be written. Any numbers already logged are kept; setting active back to
-- true brings the section back with its history.
begin;

update public.analytics_metric_definitions set active = false where source = 'tiktok';

commit;
