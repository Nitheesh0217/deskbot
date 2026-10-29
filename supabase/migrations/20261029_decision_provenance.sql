-- Decision provenance (additive, idempotent). Immutable evidence for each new PAPER entry. Nothing here touches existing tables.
create table if not exists public.dbv5_decisions (
  id text primary key check (id like 'D-%'),
  sym text not null,
  ts timestamptz not null,
  record jsonb not null,
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.dbv5_decision_inputs (
  decision_id text not null references public.dbv5_decisions(id),
  tf text not null check (tf in ('m5','m15','h1','h4')),
  source text not null check (source <> ''),
  bars jsonb not null check (jsonb_typeof(bars) = 'array' and jsonb_array_length(bars) > 0),
  bars_sha256 text not null check (bars_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (decision_id, tf)
);
create index if not exists dbv5_decisions_sym_ts on public.dbv5_decisions (sym, ts desc);

-- Append-only: block UPDATE, DELETE and TRUNCATE for every role. Dropping a trigger needs table ownership.
create or replace function public.dbv5_decisions_immutable() returns trigger language plpgsql as $$
begin raise exception 'dbv5 decision evidence is append-only (% on %)', tg_op, tg_table_name; end $$;
drop trigger if exists dbv5_decisions_no_change on public.dbv5_decisions;
create trigger dbv5_decisions_no_change before update or delete on public.dbv5_decisions for each row execute function public.dbv5_decisions_immutable();
drop trigger if exists dbv5_decisions_no_truncate on public.dbv5_decisions;
create trigger dbv5_decisions_no_truncate before truncate on public.dbv5_decisions for each statement execute function public.dbv5_decisions_immutable();
drop trigger if exists dbv5_inputs_no_change on public.dbv5_decision_inputs;
create trigger dbv5_inputs_no_change before update or delete on public.dbv5_decision_inputs for each row execute function public.dbv5_decisions_immutable();
drop trigger if exists dbv5_inputs_no_truncate on public.dbv5_decision_inputs;
create trigger dbv5_inputs_no_truncate before truncate on public.dbv5_decision_inputs for each statement execute function public.dbv5_decisions_immutable();

alter table public.dbv5_decisions enable row level security;
alter table public.dbv5_decision_inputs enable row level security;
-- No role gets direct write access. service_role may only READ; every write goes through the validating function below.
revoke all on public.dbv5_decisions, public.dbv5_decision_inputs from public, anon, authenticated, service_role;
grant select on public.dbv5_decisions, public.dbv5_decision_inputs to service_role;

-- Atomic, validating, idempotent writer. SECURITY DEFINER is deliberate: it lets the function (owned by the table owner) insert while
-- service_role has no INSERT privilege, so a direct insert cannot skip validation. search_path is pinned; execute is granted to service_role only.
-- The function checks structure and the consistency of record references with the input rows (source, count, hash string). It cannot
-- recompute the SHA-256 of the canonical JSON (the canonicalisation is defined in TypeScript); that is verified by scripts/replay_decision.ts.
create or replace function public.dbv5_record_decision(d jsonb, inputs jsonb) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  did text := d->>'id'; rec jsonb := d->'record'; ex public.dbv5_decisions%rowtype; i jsonb; ref jsonb; tf text; n int;
begin
  if did is null or did not like 'D-%' then raise exception 'decision id missing or malformed'; end if;
  if rec is null or jsonb_typeof(rec) <> 'object' then raise exception 'decision record missing'; end if;
  if rec->>'schema' <> 'deskbot.decision/1' then raise exception 'unsupported decision schema %', rec->>'schema'; end if;
  if rec->>'decisionId' is distinct from did then raise exception 'record decisionId does not match id'; end if;
  if rec->>'sym' is distinct from d->>'sym' then raise exception 'record sym does not match'; end if;
  if (rec->>'decidedAt')::timestamptz is distinct from (d->>'ts')::timestamptz then raise exception 'record decidedAt does not match ts'; end if;
  if coalesce(d->>'record_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'record_sha256 malformed'; end if;
  if inputs is null or jsonb_typeof(inputs) <> 'array' or jsonb_array_length(inputs) <> 4 then raise exception 'exactly 4 input rows are required'; end if;
  foreach tf in array array['m5','m15','h1','h4'] loop
    select count(*) into n from jsonb_array_elements(inputs) x where x->>'tf' = tf;
    if n <> 1 then raise exception 'timeframe % must appear exactly once (found %)', tf, n; end if;
  end loop;
  for i in select value from jsonb_array_elements(inputs) loop
    if i->>'decision_id' is distinct from did then raise exception 'input row decision_id does not match'; end if;
    if coalesce(i->>'source','') = '' then raise exception 'input source missing'; end if;
    if coalesce(i->>'bars_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'input hash malformed'; end if;
    if jsonb_typeof(i->'bars') <> 'array' or jsonb_array_length(i->'bars') = 0 then raise exception 'input bars missing'; end if;
    ref := rec->'inputs'->'frames'->(i->>'tf');
    if ref is null then raise exception 'record has no reference for %', i->>'tf'; end if;
    if ref->>'sha256' is distinct from i->>'bars_sha256' or ref->>'source' is distinct from i->>'source' or (ref->>'count')::int is distinct from jsonb_array_length(i->'bars')
      then raise exception 'input % does not match the record reference (hash/source/count)', i->>'tf'; end if;
  end loop;
  -- serialise concurrent writers of the same decision id; the second waits, then sees the first's committed row
  perform pg_advisory_xact_lock(hashtextextended(did, 0));
  select * into ex from public.dbv5_decisions where id = did;
  if found then
    if ex.record_sha256 <> d->>'record_sha256' or ex.record <> rec or ex.sym <> d->>'sym' or ex.ts <> (d->>'ts')::timestamptz then raise exception 'decision % already recorded with different content', did; end if;
    if (select count(*) from public.dbv5_decision_inputs where decision_id = did) <> 4
       or exists (select 1 from jsonb_array_elements(inputs) x left join public.dbv5_decision_inputs s on s.decision_id = did and s.tf = x->>'tf'
                  where s.tf is null or s.source <> x->>'source' or s.bars_sha256 <> x->>'bars_sha256' or s.bars <> x->'bars')
      then raise exception 'decision % already recorded with different inputs', did; end if;
    return false;   -- identical retry: nothing changes
  end if;
  insert into public.dbv5_decisions(id, sym, ts, record, record_sha256) values (did, d->>'sym', (d->>'ts')::timestamptz, rec, d->>'record_sha256');
  insert into public.dbv5_decision_inputs(decision_id, tf, source, bars, bars_sha256)
    select x->>'decision_id', x->>'tf', x->>'source', x->'bars', x->>'bars_sha256' from jsonb_array_elements(inputs) x;
  return true;
end $$;
revoke all on function public.dbv5_record_decision(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.dbv5_record_decision(jsonb, jsonb) to service_role;
-- Retention: no pruning (about 0.1-0.2 MB per entry). Review storage monthly; any removal needs an explicit owner decision.
