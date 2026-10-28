-- DRAFT, NOT APPLIED. Shadow research lanes: independent paper state per (instrument, strategy). Nothing here touches the live book tables.
-- Lane events are append-only and an outcome can only follow its own decision (decision-before-outcome is enforced by the database).
create table if not exists public.dbv5_lane_state (
  lane_id text primary key,                 -- '<book>:<strategy>'
  sym text not null, strategy text not null,
  spec jsonb not null, cfg_sha256 text not null check (cfg_sha256 ~ '^[0-9a-f]{64}$'),
  state jsonb not null, would_have_disabled jsonb, last_bar_t bigint,
  updated_at timestamptz not null default now()
);
create table if not exists public.dbv5_lane_events (
  lane_id text not null references public.dbv5_lane_state(lane_id),
  seq bigint not null check (seq > 0),
  kind text not null check (kind in ('decision','outcome')),
  decision_id text not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  primary key (lane_id, seq)
);
create index if not exists dbv5_lane_events_decision on public.dbv5_lane_events (lane_id, decision_id);
create or replace function public.dbv5_lane_events_guard() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then raise exception 'dbv5 lane events are append-only (% on %)', tg_op, tg_table_name; end if;
  if new.kind = 'outcome' and not exists (select 1 from public.dbv5_lane_events d where d.lane_id = new.lane_id and d.decision_id = new.decision_id and d.kind = 'decision' and d.seq < new.seq)
    then raise exception 'outcome % has no earlier decision in lane %', new.decision_id, new.lane_id; end if;
  if new.kind = 'decision' and exists (select 1 from public.dbv5_lane_events d where d.lane_id = new.lane_id and d.decision_id = new.decision_id and d.kind = 'decision')
    then raise exception 'decision % already recorded in lane %', new.decision_id, new.lane_id; end if;
  return new;
end $$;
drop trigger if exists dbv5_lane_events_insert on public.dbv5_lane_events;
create trigger dbv5_lane_events_insert before insert on public.dbv5_lane_events for each row execute function public.dbv5_lane_events_guard();
drop trigger if exists dbv5_lane_events_nochange on public.dbv5_lane_events;
create trigger dbv5_lane_events_nochange before update or delete on public.dbv5_lane_events for each row execute function public.dbv5_lane_events_guard();
drop trigger if exists dbv5_lane_events_notruncate on public.dbv5_lane_events;
create trigger dbv5_lane_events_notruncate before truncate on public.dbv5_lane_events for each statement execute function public.dbv5_lane_events_guard();
alter table public.dbv5_lane_state enable row level security; alter table public.dbv5_lane_events enable row level security;
revoke all on public.dbv5_lane_state, public.dbv5_lane_events from public, anon, authenticated, service_role;   -- Supabase default privileges give service_role everything on new tables
grant select, insert, update on public.dbv5_lane_state to service_role;   -- lane state is mutable by design
grant select, insert on public.dbv5_lane_events to service_role;          -- events are not
