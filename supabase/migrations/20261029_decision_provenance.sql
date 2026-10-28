-- Decision provenance (additive, idempotent). Immutable evidence for each new PAPER entry. Nothing here touches existing tables.
create table if not exists public.dbv5_decisions (
  id text primary key,
  sym text not null,
  ts timestamptz not null,
  record jsonb not null,
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.dbv5_decision_inputs (
  decision_id text not null references public.dbv5_decisions(id),
  tf text not null check (tf in ('m5','m15','h1','h4')),
  source text not null,
  bars jsonb not null,
  bars_sha256 text not null check (bars_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (decision_id, tf)
);
create index if not exists dbv5_decisions_sym_ts on public.dbv5_decisions (sym, ts desc);

-- Append-only: block UPDATE, DELETE and TRUNCATE for every role (including service_role). Dropping the trigger needs table ownership.
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
revoke all on public.dbv5_decisions, public.dbv5_decision_inputs from anon, authenticated;

-- One transaction writes the record and its inputs. Idempotent on identical content; a same-id record with a different hash raises.
create or replace function public.dbv5_record_decision(d jsonb, inputs jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare existing text; fresh boolean := false;
begin
  select record_sha256 into existing from dbv5_decisions where id = d->>'id';
  if existing is null then
    insert into dbv5_decisions(id, sym, ts, record, record_sha256) values (d->>'id', d->>'sym', (d->>'ts')::timestamptz, d->'record', d->>'record_sha256');
    fresh := true;
  elsif existing <> d->>'record_sha256' then
    raise exception 'decision % already recorded with a different hash', d->>'id';
  end if;
  insert into dbv5_decision_inputs(decision_id, tf, source, bars, bars_sha256)
    select i->>'decision_id', i->>'tf', i->>'source', i->'bars', i->>'bars_sha256' from jsonb_array_elements(inputs) i
    on conflict (decision_id, tf) do nothing;
  return fresh;
end $$;
revoke all on function public.dbv5_record_decision(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.dbv5_record_decision(jsonb, jsonb) to service_role;
-- Retention: no pruning (about 0.1 MB per entry). Review storage monthly; any removal needs an explicit owner decision.
