-- W2 (additive only; no data is changed or removed).
-- 1) Per-worker telemetry on each scan row (call maker, setup tracker, options reader errors and counts).
alter table public.dbv5_scans add column if not exists work jsonb;
-- 2) Exactly-once work-log records for the position manager: the edge function inserts with
--    ON CONFLICT (work_key) DO NOTHING, so overlapping or retried runs cannot record the same action twice.
--    Rows without a key (all other agents) keep work_key NULL; NULLs never conflict.
alter table public.dbv5_agent_log add column if not exists work_key text;
create unique index if not exists dbv5_agent_log_work_key on public.dbv5_agent_log (work_key);
-- 3) Scoped acknowledgement of delivered work-log records: removes exactly the listed keys from one book's outbox in a single
--    statement. It touches no other part of the state and does not change state._rev, so a delayed (stale) worker's
--    acknowledgement can never overwrite a newer position, equity or newer pending records. Returns the remaining count.
create or replace function public.dbv5_ack_work(p_id text, p_keys text[]) returns integer
language sql security definer set search_path = public as $$
  update public.dbv5_state
     set state = jsonb_set(state, '{_workOutbox}',
                 coalesce((select jsonb_agg(e) from jsonb_array_elements(state->'_workOutbox') e where not ((e->'output'->>'key') = any(p_keys))), '[]'::jsonb))
   where id = p_id and jsonb_typeof(state->'_workOutbox') = 'array'
  returning jsonb_array_length(state->'_workOutbox');
$$;
revoke all on function public.dbv5_ack_work(text, text[]) from public, anon, authenticated;
grant execute on function public.dbv5_ack_work(text, text[]) to service_role;
