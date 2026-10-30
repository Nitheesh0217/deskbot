-- W2 (additive only; no data is changed or removed).
-- 1) Per-worker telemetry on each scan row (call maker, setup tracker, options reader errors and counts).
alter table public.dbv5_scans add column if not exists work jsonb;
-- 2) Exactly-once work-log records for the position manager: the edge function inserts with
--    ON CONFLICT (work_key) DO NOTHING, so overlapping or retried runs cannot record the same action twice.
--    Rows without a key (all other agents) keep work_key NULL; NULLs never conflict.
alter table public.dbv5_agent_log add column if not exists work_key text;
create unique index if not exists dbv5_agent_log_work_key on public.dbv5_agent_log (work_key);
