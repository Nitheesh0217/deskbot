-- CALL-1: one directional call per market (LONG / SHORT, rule-based, 4-hour horizon) recorded before its outcome and scored later.
-- Only open rows can change, and only their score fields; nothing can be deleted.
create table if not exists public.dbv5_calls (
  id bigserial primary key,
  sym text not null, t bigint not null, horizon_h double precision not null,
  lean text not null check (lean in ('LONG', 'SHORT')), votes integer, source text, cautions jsonb,
  px double precision not null, atr double precision,
  status text not null default 'open' check (status in ('open', 'scored')),
  px_end double precision, end_t bigint, move_pct double precision, move_atr double precision, hit boolean,
  created_at timestamptz not null default now(), scored_at timestamptz,
  unique (sym, t)
);
create index if not exists dbv5_calls_open on public.dbv5_calls (status) where status = 'open';
create or replace function public.dbv5_calls_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'dbv5 calls are append-only (%)', tg_op; end if;
  if old.status <> 'open' then raise exception 'scored call % cannot change', old.id; end if;
  if (new.sym, new.t, new.horizon_h, new.lean, new.votes, new.source, new.px, new.atr, new.created_at)
     is distinct from (old.sym, old.t, old.horizon_h, old.lean, old.votes, old.source, old.px, old.atr, old.created_at)
  then raise exception 'call % identity cannot change', old.id; end if;
  return new;
end $$;
create or replace trigger dbv5_calls_guard before update or delete on public.dbv5_calls for each row execute function public.dbv5_calls_guard();
create or replace trigger dbv5_calls_no_truncate before truncate on public.dbv5_calls for each statement execute function public.dbv5_calls_guard();
alter table public.dbv5_calls enable row level security;
revoke all on public.dbv5_calls from public, anon, authenticated;
grant select, insert, update on public.dbv5_calls to service_role;
grant usage on sequence public.dbv5_calls_id_seq to service_role;
