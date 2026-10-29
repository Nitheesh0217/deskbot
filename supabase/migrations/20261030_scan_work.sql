-- Additive: per-worker telemetry on each scan row (call maker, setup tracker, options reader errors and counts).
alter table public.dbv5_scans add column if not exists work jsonb;
