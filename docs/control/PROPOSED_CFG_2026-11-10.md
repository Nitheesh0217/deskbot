# Proposed paper config change (NOT applied; needs the owner's approval)

**What:** turn off strategies with negative 3-year expectancy after costs (`docs/research/2026-11-10-layer-agreement/RESULTS.md`).
**Why:** they are the measured cause of the fee drag on BTC and of most of GOLD's losses.
**Scope:** paper books only. This is risk-reducing: it changes no stop, target, size, risk limit or open position. HTF_TREND, VWAP_REVERT, D_THRUST and D_BEARTRAP stay on.

| Book | Strategy → RISK_SCALE 0 |
|---|---|
| BTC | SWEEP_REV, SESSION_BO, TREND_MTF |
| GOLD | SWEEP_REV, SESSION_BO, TREND_MTF, EMA_CROSS |

## Before applying
Record both books (`select id, state->'pos', state->'cfg' from dbv5_state`). If a book holds a position opened by one of these strategies, the change only blocks new entries; the open plan is managed as before.

## SQL (run once; row ids are `main` for BTC and `gold` for GOLD, from `data.ts bookOf`)
Each update also advances `state._rev`. A run that loaded the old revision then fails its compare-and-set save and retries on the next cron tick, so it cannot write the old config back.
```sql
update dbv5_state
   set state = jsonb_set(jsonb_set(state, '{cfg,RISK_SCALE}',
                 coalesce(state->'cfg'->'RISK_SCALE','{}'::jsonb) || '{"SWEEP_REV":0,"SESSION_BO":0,"TREND_MTF":0}'::jsonb),
               '{_rev}', to_jsonb(coalesce((state->>'_rev')::int, 0) + 1)),
       updated_at = now()
 where id = 'main';
update dbv5_state
   set state = jsonb_set(jsonb_set(state, '{cfg,RISK_SCALE}',
                 coalesce(state->'cfg'->'RISK_SCALE','{}'::jsonb) || '{"SWEEP_REV":0,"SESSION_BO":0,"TREND_MTF":0,"EMA_CROSS":0}'::jsonb),
               '{_rev}', to_jsonb(coalesce((state->>'_rev')::int, 0) + 1)),
       updated_at = now()
 where id = 'gold';
insert into dbv5_events(kind, msg, symbol) values
  ('CONFIG', 'Owner-approved: RISK_SCALE 0 for SWEEP_REV, SESSION_BO, TREND_MTF (research 2026-11-10)', 'BTC'),
  ('CONFIG', 'Owner-approved: RISK_SCALE 0 for SWEEP_REV, SESSION_BO, TREND_MTF, EMA_CROSS (research 2026-11-10)', 'GOLD');
```

## Verify
The next run's coverage shows each strategy as OFF with reason `scale`; the shadow lanes keep recording them, so the evidence keeps accumulating.

## Rollback
Set each value back to 1 (EMA_CROSS on GOLD back to 0.25).
